/* ============================================================
   DSH Launcher · capabilities.js
   能力中心 Tab：插件管理（分类/批量/更新/导入/启停）、
   技能 Skill、MCP 服务，以及插件市场（发现货架/分类侧栏/
   搜索排序/详情抽屉/安装状态机/离线缓存）。
   ============================================================ */
(function () {
  "use strict";
  const DSH = window.DSH;
  const { $, invoke, escapeHtml, appendLog, showConfirm, explainInstallError, translatePluginLine } = DSH;

  let pluginData = [], skillData = [], mcpData = [];
  let capLoaded = false;
  let selectedPlugins = new Set();
  let pluginDir = 1;

  function ep() { return DSH.endpoints ? DSH.endpoints.current() : null; }

  async function fetchPlugins() { try { pluginData = await invoke("list_plugins", { endpoint_id: ep().id }); } catch (e) { pluginData = []; } }
  async function fetchSkills() { try { skillData = await invoke("list_skills", { endpoint_id: ep().id }); } catch (e) { skillData = []; } }
  async function fetchMcp() { try { mcpData = await invoke("list_mcp", { endpoint_id: ep().id }); } catch (e) { mcpData = []; } }

  async function loadCapabilityData() {
    await Promise.all([fetchPlugins(), fetchSkills(), fetchMcp()]);
    renderPlugins(); renderSkills(); renderMcp();
    capLoaded = true;
  }

  /* ================= 插件管理 ================= */
  function updatePluginDirBtn() { const b = $("btnPluginDir"); if (b) b.textContent = pluginDir === 1 ? "升序" : "降序"; }

  function filteredPluginList() {
    const kw = ($("pluginSearch") && $("pluginSearch").value || "").toLowerCase();
    const kindFilter = ($("pluginKindFilter") && $("pluginKindFilter").value) || "";
    const statusFilter = ($("pluginStatusFilter") && $("pluginStatusFilter").value) || "";
    const sortKey = ($("pluginSort") && $("pluginSort").value) || "";
    let list = pluginData.filter(p => {
      if (kw && !((p.name || "").toLowerCase().includes(kw) || (p.id || "").toLowerCase().includes(kw))) return false;
      if (kindFilter && p.kind !== kindFilter) return false;
      if (statusFilter === "enabled" && !p.enabled) return false;
      if (statusFilter === "disabled" && p.enabled) return false;
      return true;
    });
    const kindOrder = { builtin: 0, extension: 1, selfdev: 2 };
    const dir = pluginDir;
    if (sortKey === "name") list = list.slice().sort((a, b) => dir * (a.name || "").localeCompare(b.name || ""));
    else if (sortKey === "version") list = list.slice().sort((a, b) => dir * String(a.version || "").localeCompare(String(b.version || ""), undefined, { numeric: true }));
    else if (sortKey === "author") list = list.slice().sort((a, b) => dir * (a.author || "").localeCompare(b.author || ""));
    else if (sortKey === "kind") list = list.slice().sort((a, b) => dir * ((kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9)));
    else list = list.slice().sort((a, b) => dir * (((kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9)) || (a.name || "").localeCompare(b.name || "")));
    return list;
  }

  function updatePluginBatchBar() {
    const bar = $("pluginBatchBar"), count = $("pluginBatchCount");
    if (!bar) return;
    if (selectedPlugins.size > 0) { bar.style.display = "flex"; count.textContent = selectedPlugins.size; }
    else { bar.style.display = "none"; count.textContent = "0"; }
  }

  function renderPlugins() {
    const box = $("pluginList");
    if (!box) return;
    box.innerHTML = "";
    if (!pluginData || !pluginData.length) {
      box.innerHTML = '<div class="session-empty">暂无插件（可在「插件市场」安装，或「导入本地」目录）</div>';
      updatePluginBatchBar();
      return;
    }
    const kindLabel = { builtin: "内置", extension: "扩展", selfdev: "自研" };
    const kindCls = { builtin: "tag-builtin", extension: "tag-third", selfdev: "tag-wsl" };
    filteredPluginList().forEach(p => {
      const card = document.createElement("div");
      card.className = "cap-card";
      const tagCls = kindCls[p.kind] || "tag-third";
      // 模板内置 bundle（source=bundle）无行级启停入口；npm 本家扩展（source=npm）可正常启停。
      const canToggle = (p.kind === "extension" || p.source === "local" || (p.kind === "builtin" && p.source === "npm"));
      const canUninstall = (p.kind === "extension" && p.source !== "preset") || p.source === "local";
      const canCheck = p.kind === "extension" && p.source === "npm";
      const canRegister = p.kind === "extension" && p.source === "npm" && !p.enabled;
      card.innerHTML = `
        <div class="cc-head">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <input type="checkbox" class="plugin-check" data-id="${escapeHtml(p.id)}" ${selectedPlugins.has(p.id) ? "checked" : ""} title="选择">
            <span class="cc-name">${escapeHtml(p.name)}</span><span class="cc-ver">${p.version ? "v" + escapeHtml(p.version) : ""}</span>
            <span class="cc-tag ${tagCls}">${kindLabel[p.kind] || "插件"}</span>
          </div>
          <span class="status-badge ${p.enabled ? "badge-on" : "badge-off"}">${p.enabled ? "已启用" : "已禁用"}</span>
        </div>
        <div class="cc-desc">${escapeHtml(p.desc)}</div>
        <div class="cc-meta">ID: ${escapeHtml(p.id)}${p.author ? ` · 作者: ${escapeHtml(p.author)}` : ""}${p.kind === "builtin" ? " · 本家 @deepseek-ai" : ""}${p.kind === "builtin" && p.source === "bundle" ? " · 内置 bundle，跟随 DSH 发行版" : ""}${p.skills && p.skills.length ? ` · 技能: ${p.skills.map(escapeHtml).join(", ")}` : ""}</div>
        <div class="cc-actions">
          ${canToggle ? `<button class="btn-small" data-act="toggle" data-id="${escapeHtml(p.id)}">${p.enabled ? "禁用" : "启用"}</button>` : ""}
          ${canCheck ? `<button class="btn-small" data-act="check" data-id="${escapeHtml(p.id)}">检查更新</button>` : ""}
          ${canRegister ? `<button class="btn-small" data-act="register" data-id="${escapeHtml(p.id)}">注册</button>` : ""}
          ${p.dir ? `<button class="btn-small" data-act="open" data-id="${escapeHtml(p.id)}">打开目录</button>` : ""}
          ${canUninstall ? `<button class="btn-danger" data-act="uninstall" data-id="${escapeHtml(p.id)}">卸载</button>` : ""}
        </div>`;
      box.appendChild(card);
    });
    box.querySelectorAll("input.plugin-check").forEach(cb => {
      cb.onclick = e => {
        e.stopPropagation();
        const id = cb.dataset.id;
        if (cb.checked) selectedPlugins.add(id); else selectedPlugins.delete(id);
        updatePluginBatchBar();
      };
    });
    box.querySelectorAll("button[data-act]").forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        const id = btn.dataset.id, act = btn.dataset.act;
        const p = pluginData.find(x => x.id === id);
        if (act === "toggle") {
          const next = !p.enabled;
          const tip = p.kind === "builtin" ? "（本家组件，禁用后可能影响 DSH 功能；写入后会自动做配置校验）" : (p.kind === "extension" ? "（扩展插件；写入后会自动做配置校验）" : "");
          showConfirm("启用/禁用插件", `确定要${next ? "启用" : "禁用"}「${p.name}」吗？${tip}`, async () => {
            try {
              await invoke("set_plugin_enabled", { id, enabled: next });
              appendLog(`[插件] ${id} ${next ? "已启用" : "已禁用"}，重启 DSH 后生效`, "log-ready");
              await fetchPlugins(); renderPlugins();
            } catch (err) { appendLog(`[插件] 操作失败：${err}`, "log-error"); }
          });
        }
        else if (act === "check") { await checkPluginUpdate(p, btn); }
        else if (act === "register") {
          try {
            const r = await invoke("register_plugin", { id });
            appendLog(`[插件] ${r}`, "log-ready");
            await fetchPlugins(); renderPlugins();
          } catch (err) { appendLog(`[插件] 注册失败：${err}`, "log-error"); }
        }
        else if (act === "update") {
          btn.disabled = true; btn.textContent = "更新中...";
          try {
            const r = await invoke("install_market_plugin", { target: p.id });
            appendLog(`[插件] ${p.name} 已更新：${r}`, "log-ready");
            await fetchPlugins(); renderPlugins();
          } catch (err) {
            appendLog(`[插件] 更新失败：${err}`, "log-error");
            btn.disabled = false; btn.textContent = "重试更新";
          }
        }
        else if (act === "open") {
          try { await invoke("open_plugin_folder", { id }); } catch (err) { appendLog(`打开目录失败：${err}`, "log-error"); }
        }
        else if (act === "uninstall") {
          showConfirm("卸载插件", `确定要卸载插件「${p.name}」吗？${p.source === "local" ? "将删除本地目录并移除注册，重启 DSH 后生效。" : "将调用 pnpm 卸载依赖。"}`, async () => {
            try {
              const r = await invoke("remove_plugin", { id });
              selectedPlugins.delete(id);
              appendLog(`[插件] ${r}`, "log-ready");
              await fetchPlugins(); renderPlugins();
            } catch (err) { appendLog(`[插件] 卸载失败：${err}`, "log-error"); }
          });
        }
      };
    });
    updatePluginBatchBar();
  }

  async function checkPluginUpdate(p, btn) {
    btn.disabled = true; btn.textContent = "检查中...";
    try {
      const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(p.id)}/latest`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const latest = d.version;
      if (!latest) {
        appendLog(`[更新] ${p.name} 无版本信息`, "log-stop");
        btn.disabled = false; btn.textContent = "检查更新"; return;
      }
      const inst = p.version || "";
      if (inst && inst !== latest) {
        appendLog(`[更新] ${p.name} ${inst} → ${latest}`, "log-stop");
        btn.dataset.act = "update"; btn.textContent = "更新 " + latest; btn.disabled = false;
      } else {
        appendLog(`[更新] ${p.name} 已是最新 ${latest}`, "log-ready");
        btn.textContent = "已最新";
      }
    } catch (e) {
      appendLog(`[更新] ${p.name} 检查失败：${e}`, "log-error");
      btn.disabled = false; btn.textContent = "检查更新";
    }
  }

  /* ================= 插件市场 ================= */
  const MARKET_URL = "https://awesome-dsh-plugin.com/plugins.json";
  const MARKET_CACHE_KEY = "dsh_market_cache_v2";
  const MARKET_TTL = 10 * 60 * 1000;
  const MARKET_VIEW_KEY = "dsh_market_view_v2";
  const MARKET_CAT_KEY = "dsh_market_cat_v2";
  const MARKET_RECENT_KEY = "dsh_market_recent_v2";

  let marketData = [], marketCategories = {};
  let marketLoading = false, marketCacheAge = 0, marketOffline = false;
  let marketView = "discover", marketCat = "", marketSort = "combo", marketSource = "", marketSearchKw = "";
  let marketInstalling = new Set();
  let marketRecent = loadMarketRecent();
  let marketHeroIndex = 0, marketHeroTimer = null;
  let marketDetailOpen = false, marketDetailName = "";
  let marketSearchTimer = null;
  let marketStateCache = null;

  function loadMarketRecent() {
    try { const a = JSON.parse(localStorage.getItem(MARKET_RECENT_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveMarketRecent() { try { localStorage.setItem(MARKET_RECENT_KEY, JSON.stringify(marketRecent.slice(0, 12))); } catch (e) { } }
  function recordMarketRecent(name) {
    if (!name) return;
    marketRecent = marketRecent.filter(n => n !== name);
    marketRecent.unshift(name);
    saveMarketRecent();
  }
  function marketTarget(m) {
    if (m.install) { const parts = m.install.trim().split(/\s+/); if (parts.length) return parts[parts.length - 1]; }
    return m.npm || m.name;
  }
  function marketInstalledMap() {
    const map = new Map();
    (pluginData || []).forEach(p => {
      if (p.id) map.set(String(p.id).toLowerCase(), p);
      if (p.name) map.set(String(p.name).toLowerCase(), p);
    });
    return map;
  }
  function refreshMarketStateCache() { marketStateCache = marketInstalledMap(); }
  function cmpVersion(a, b) {
    const pa = String(a || "").replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
    const pb = String(b || "").replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }
  function marketState(m) {
    const im = marketStateCache || marketInstalledMap();
    const installed = !!(m.installed || im.has(String(m.name || "").toLowerCase()) || (m.npm && im.has(String(m.npm).toLowerCase())));
    let update = false, localVersion = "";
    if (installed) {
      const local = im.get(String(m.name || "").toLowerCase()) || (m.npm ? im.get(String(m.npm).toLowerCase()) : null);
      if (local && local.version) localVersion = local.version;
      if (m.version && localVersion && cmpVersion(m.version, localVersion) > 0) update = true;
    }
    return { installed, update, localVersion };
  }
  function marketDesc(m) {
    if (!m.description) return "";
    return m.description.zh || m.description.en || "";
  }
  function marketCategoryZh(m) {
    const c = marketCategories[m.category];
    return c ? (c.zh || c.en || m.category) : (m.category || "");
  }
  function marketMaxStars() {
    let max = 0;
    (marketData || []).forEach(m => { const s = m.stars || 0; if (s > max) max = s; });
    return max;
  }
  function starsNorm(m, max) { return max <= 0 ? 0 : Math.log1p(m.stars || 0) / Math.log1p(max); }
  function daysSinceAdded(m) {
    if (!m.added) return 9999;
    const t = Date.parse(m.added);
    return isNaN(t) ? 9999 : (Date.now() - t) / 86400000;
  }
  function comboScore(m, max) {
    const rec = Math.exp(-daysSinceAdded(m) / 180);
    return +(0.6 * starsNorm(m, max) + 0.4 * rec + (m.npm ? 0.05 : 0)).toFixed(4);
  }
  const REC_CAT_WEIGHT = {
    session: 1.0, memory: 0.9, tools: 0.9, skill: 0.9, workflow: 0.8, model: 0.7,
    ui: 0.6, notify: 0.6, dev: 0.5, usage: 0.4, vision: 0.4, market: 0.3, theme: 0.2, fun: 0.1
  };
  function interestProfile() {
    const prof = new Map();
    const im = marketInstalledMap();
    (marketData || []).forEach(m => {
      if (!m.category) return;
      const installed = im.has(String(m.name || "").toLowerCase()) || (m.npm && im.has(String(m.npm).toLowerCase()));
      if (installed) prof.set(m.category, (prof.get(m.category) || 0) + 1);
    });
    return prof;
  }
  function profileMatch(m, prof) {
    if (!prof || !prof.size) return 0;
    const base = prof.get(m.category) || 0;
    let max = 0; prof.forEach(v => { if (v > max) max = v; });
    return max ? base / max : 0;
  }
  function recScore(m, max, prof) {
    const cat = REC_CAT_WEIGHT[m.category] != null ? REC_CAT_WEIGHT[m.category] : 0.3;
    const rec = Math.exp(-daysSinceAdded(m) / 180);
    const hasProf = !!(prof && prof.size);
    if (hasProf) return +(0.30 * profileMatch(m, prof) + 0.25 * cat + 0.30 * starsNorm(m, max) + 0.15 * rec).toFixed(4);
    return +(0.45 * cat + 0.35 * starsNorm(m, max) + 0.20 * rec).toFixed(4);
  }
  function recommendMarket(max, prof) {
    return (marketData || []).slice().sort((a, b) => recScore(b, max, prof) - recScore(a, max, prof)).slice(0, 12);
  }
  function marketRelatedToInstalled() {
    const im = marketInstalledMap();
    const cats = new Set();
    (marketData || []).forEach(m => {
      if (im.has(String(m.name || "").toLowerCase()) || (m.npm && im.has(String(m.npm).toLowerCase()))) cats.add(m.category);
    });
    const max = marketMaxStars();
    return (marketData || []).filter(m => {
      if (!cats.has(m.category)) return false;
      return !marketState(m).installed;
    }).sort((a, b) => comboScore(b, max) - comboScore(a, max));
  }
  function hlText(s, kw) {
    const raw = String(s == null ? "" : s);
    if (!kw) return escapeHtml(raw);
    const low = raw.toLowerCase(), k = kw.toLowerCase();
    let out = "", idx = 0, pos = low.indexOf(k);
    while (pos !== -1) {
      out += escapeHtml(raw.slice(idx, pos)) + '<span class="mk-hl">' + escapeHtml(raw.slice(pos, pos + k.length)) + '</span>';
      idx = pos + k.length;
      pos = low.indexOf(k, idx);
    }
    out += escapeHtml(raw.slice(idx));
    return out;
  }
  function marketFlags() {
    const max = marketMaxStars();
    const sorted = (marketData || []).slice().sort((a, b) => comboScore(b, max) - comboScore(a, max));
    return {
      hot: new Set(sorted.slice(0, 10).map(m => m.name)),
      pick: new Set(recommendMarket(max, interestProfile()).slice(0, 5).map(m => m.name))
    };
  }
  function mkTagsHTML(m, flags) {
    let html = "";
    if (flags && flags.pick && flags.pick.has(m.name)) html += '<span class="mk-tag mk-tag-pick">精选</span>';
    if (flags && flags.hot && flags.hot.has(m.name)) html += '<span class="mk-tag mk-tag-hot">热门</span>';
    if (daysSinceAdded(m) < 30) html += '<span class="mk-tag mk-tag-new">新</span>';
    return html;
  }
  function mkInstallBtnHTML(m, st) {
    if (marketInstalling.has(marketTarget(m))) {
      return '<button class="btn-small mk-install-btn" data-act="install" data-name="' + escapeHtml(m.name) + '" disabled>安装中...</button>';
    }
    if (st.installed && st.update) {
      return '<button class="btn-small mk-install-btn update" data-act="install" data-name="' + escapeHtml(m.name) + '" title="市场有新版本可用">更新</button>';
    }
    if (st.installed) {
      return '<button class="btn-small mk-install-btn installed" data-act="noop" disabled>已安装</button>';
    }
    return '<button class="btn-primary mk-install-btn" data-act="install" data-name="' + escapeHtml(m.name) + '">安装</button>';
  }
  function mkCardHTML(m, flags) {
    const st = marketState(m);
    const catZh = marketCategoryZh(m);
    const avatar = 'https://github.com/' + encodeURIComponent(m.owner || '') + '.png';
    const initial = (m.owner || "?").trim().charAt(0).toUpperCase();
    const card = document.createElement("div");
    card.className = "mk-card";
    card.dataset.mname = String(m.name || "");
    card.innerHTML = `
      <div class="mc2-head">
        <div class="mk-avatar"><img src="${escapeHtml(avatar)}" loading="lazy" alt=""></div>
        <div style="min-width:0;flex:1">
          <div class="mk-name"><span>${hlText(m.name || "未命名插件", marketSearchKw)}</span>${mkTagsHTML(m, flags)}</div>
          <div class="mk-owner">@${escapeHtml(m.owner || "未知")}</div>
        </div>
      </div>
      <div class="mk-desc">${hlText(marketDesc(m) || "（暂无说明）", marketSearchKw)}</div>
      <div class="mk-foot">
        <div class="mk-stats">
          ${m.stars ? '<span title="GitHub 星标">★ ' + m.stars + '</span>' : ""}
          ${catZh ? '<span>' + escapeHtml(catZh) + '</span>' : ""}
          <span>${m.npm ? "npm" : "GitHub"}</span>
        </div>
        <div class="mk-actions">${mkInstallBtnHTML(m, st)}</div>
      </div>`;
    const img = card.querySelector(".mk-avatar img");
    if (img) img.addEventListener("error", () => { const p = img.parentNode; if (p) p.textContent = initial; });
    card.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      openMarketDetail(m);
    });
    card.querySelectorAll("button[data-act='install']").forEach(b => {
      b.onclick = e => { e.stopPropagation(); marketDoInstall(m, b); };
    });
    return card;
  }

  function setHeroIndex(i, skipReset) {
    const total = document.querySelectorAll("#marketHero .mk-hero-item").length;
    if (!total) return;
    marketHeroIndex = ((i % total) + total) % total;
    const track = $("marketHeroTrack");
    if (track) track.style.transform = `translateX(-${marketHeroIndex * 100}%)`;
    document.querySelectorAll("#marketHero .mk-hero-dot").forEach((d, idx) => d.classList.toggle("active", idx === marketHeroIndex));
    if (!skipReset) startHeroAuto();
  }
  function startHeroAuto() {
    stopHeroAuto();
    marketHeroTimer = setInterval(() => {
      const total = document.querySelectorAll("#marketHero .mk-hero-item").length;
      if (total > 1) setHeroIndex(marketHeroIndex + 1);
    }, 6000);
  }
  function stopHeroAuto() {
    if (marketHeroTimer) { clearInterval(marketHeroTimer); marketHeroTimer = null; }
  }
  function renderHero() {
    const box = $("marketHero");
    if (!box) return;
    const max = marketMaxStars();
    const prof = interestProfile();
    const items = recommendMarket(max, prof).slice(0, 5);
    if (!items.length) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = "";
    const track = document.createElement("div");
    track.className = "mk-hero-track";
    track.id = "marketHeroTrack";
    items.forEach(m => {
      const st = marketState(m);
      const catZh = marketCategoryZh(m);
      const avatar = 'https://github.com/' + encodeURIComponent(m.owner || '') + '.png';
      const initial = (m.owner || "?").trim().charAt(0).toUpperCase();
      const item = document.createElement("div");
      item.className = "mk-hero-item";
      item.innerHTML = `
        <div class="mk-hero-avatar"><img src="${escapeHtml(avatar)}" loading="lazy" alt=""></div>
        <div class="mk-hero-body">
          <div class="mk-hero-name">${hlText(m.name || "未命名插件", marketSearchKw)}<span class="mk-hero-badge">精选</span></div>
          <div class="mk-hero-meta">@${escapeHtml(m.owner || "未知")}${m.stars ? ' · ★ ' + m.stars : ""}${catZh ? " · " + escapeHtml(catZh) : ""}${m.npm ? " · npm" : " · GitHub"}</div>
          <div class="mk-hero-desc">${hlText(marketDesc(m) || "（暂无说明）", marketSearchKw)}</div>
        </div>
        <div class="mk-hero-actions">
          ${mkInstallBtnHTML(m, st)}
          <button class="btn-small" data-act="detail">详情</button>
        </div>`;
      const img = item.querySelector("img");
      if (img) img.addEventListener("error", () => { const p = img.parentNode; if (p) p.textContent = initial; });
      item.querySelectorAll("button[data-act='install']").forEach(b => { b.onclick = e => { e.stopPropagation(); marketDoInstall(m, b); }; });
      item.querySelector("button[data-act='detail']").onclick = e => { e.stopPropagation(); openMarketDetail(m); };
      track.appendChild(item);
    });
    box.appendChild(track);
    const prev = document.createElement("button"); prev.className = "mk-hero-arrow prev"; prev.innerHTML = "&#8249;";
    const next = document.createElement("button"); next.className = "mk-hero-arrow next"; next.innerHTML = "&#8250;";
    const dots = document.createElement("div"); dots.className = "mk-hero-dots";
    items.forEach((_, i) => {
      const d = document.createElement("button");
      d.className = "mk-hero-dot" + (i === 0 ? " active" : "");
      d.dataset.i = i;
      d.onclick = () => setHeroIndex(i);
      dots.appendChild(d);
    });
    box.appendChild(prev); box.appendChild(next); box.appendChild(dots);
    prev.onclick = () => setHeroIndex(marketHeroIndex - 1);
    next.onclick = () => setHeroIndex(marketHeroIndex + 1);
    box.onmouseenter = stopHeroAuto;
    box.onmouseleave = startHeroAuto;
    setHeroIndex(0, true);
    startHeroAuto();
  }
  function renderShelves() {
    const box = $("marketShelves");
    if (!box) return;
    box.innerHTML = "";
    const max = marketMaxStars();
    const prof = interestProfile();
    const flags = marketFlags();
    const sections = [];
    const hot = (marketData || []).slice().sort((a, b) => comboScore(b, max) - comboScore(a, max)).slice(0, 10);
    if (hot.length) sections.push({ title: "热门插件", note: "综合热度排序", items: hot });
    const fresh = (marketData || []).filter(m => daysSinceAdded(m) < 120).sort((a, b) => (b.added || "").localeCompare(a.added || "")).slice(0, 8);
    if (fresh.length) sections.push({ title: "最新上架", note: "近 4 个月添加", items: fresh });
    const rec = recommendMarket(max, prof).slice(0, 10);
    if (rec.length) sections.push({ title: "为你推荐", note: prof.size ? "根据已装插件分类偏好生成" : "综合推荐", items: rec });
    const rel = marketRelatedToInstalled().slice(0, 10);
    if (rel.length) sections.push({ title: "已装插件的同类", note: "同分类高分推荐", items: rel });
    const recent = marketRecent.map(n => marketData.find(m => String(m.name || "").toLowerCase() === String(n).toLowerCase())).filter(Boolean).slice(0, 8);
    if (recent.length) sections.push({ title: "最近浏览", note: "点击卡片查看详情", items: recent });
    if (!sections.length) { box.innerHTML = '<div class="market-empty">暂无推荐内容</div>'; return; }
    sections.forEach(s => {
      const sec = document.createElement("div");
      sec.className = "mk-shelf";
      const head = document.createElement("div");
      head.className = "mk-shelf-head";
      head.innerHTML = '<span class="mk-shelf-title">' + escapeHtml(s.title) + '</span><span class="mk-shelf-note">' + escapeHtml(s.note || "") + '</span>';
      const row = document.createElement("div");
      row.className = "mk-shelf-row";
      s.items.forEach(m => row.appendChild(mkCardHTML(m, flags)));
      sec.appendChild(head); sec.appendChild(row);
      box.appendChild(sec);
    });
  }
  function marketFilteredList() {
    const kw = marketSearchKw;
    let list = (marketData || []).filter(m => {
      if (marketCat && m.category !== marketCat) return false;
      const st = marketState(m);
      if (marketView === "installed" && !st.installed) return false;
      if (marketView === "update" && (!st.installed || !st.update)) return false;
      if (marketSource === "npm" && !m.npm) return false;
      if (marketSource === "github" && m.npm) return false;
      if (kw) {
        const hay = String(m.name + " " + (m.owner || "") + " " + marketDesc(m) + " " + (m.npm || "")).toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    const max = marketMaxStars();
    if (marketSort === "stars") list = list.slice().sort((a, b) => (b.stars || 0) - (a.stars || 0));
    else if (marketSort === "name") list = list.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else if (marketSort === "added") list = list.slice().sort((a, b) => (b.added || "").localeCompare(a.added || ""));
    else list = list.slice().sort((a, b) => comboScore(b, max) - comboScore(a, max));
    return list;
  }
  function renderGrid() {
    const body = $("marketBody");
    if (!body) return;
    const list = marketFilteredList();
    body.innerHTML = "";
    if (!list.length) {
      body.innerHTML = '<div class="market-empty">' + (marketSearchKw ? '没有找到与「' + escapeHtml(marketSearchKw) + '」匹配的插件' : '该条件下暂无插件') + '</div>';
      return;
    }
    const flags = marketFlags();
    const frag = document.createDocumentFragment();
    list.forEach(m => frag.appendChild(mkCardHTML(m, flags)));
    body.appendChild(frag);
  }
  function renderSidebar() {
    const box = $("marketCats");
    if (!box) return;
    box.innerHTML = "";
    const cnt = new Map(); let total = 0;
    (marketData || []).forEach(m => {
      total++;
      if (m.category) cnt.set(m.category, (cnt.get(m.category) || 0) + 1);
    });
    const mk = function (k, label, n) {
      const row = document.createElement("div");
      row.className = "ms-cat" + (marketCat === k ? " active" : "");
      row.innerHTML = '<span class="ms-name">' + escapeHtml(label) + '</span><span class="ms-cnt">' + n + '</span>';
      row.onclick = () => { marketCat = k || ""; localStorage.setItem(MARKET_CAT_KEY, marketCat); renderMarket(); };
      box.appendChild(row);
    };
    mk("", "全部", total);
    Object.keys(marketCategories || {}).forEach(k => {
      const c = marketCategories[k];
      mk(k, (c && (c.zh || c.en)) || k, cnt.get(k) || 0);
    });
    const foot = $("marketSideFoot");
    if (foot) {
      let installed = 0, upd = 0;
      (marketData || []).forEach(m => { const st = marketState(m); if (st.installed) { installed++; if (st.update) upd++; } });
      foot.innerHTML = '<div>已安装 <b style="color:var(--success-green)">' + installed + '</b></div>' +
        '<div>可更新 <b style="color:var(--error-red)">' + upd + '</b></div>' +
        '<div style="color:var(--text-secondary);font-size:10px">数据来源 awesome-dsh-plugin.com</div>';
    }
  }
  function renderStats() {
    const el = $("marketStats");
    if (!el) return;
    const n = (marketData || []).length;
    if (!n) { el.textContent = ""; return; }
    let installed = 0, upd = 0;
    (marketData || []).forEach(m => { const st = marketState(m); if (st.installed) { installed++; if (st.update) upd++; } });
    el.textContent = "共 " + n + " 个插件 · 已安装 " + installed + (upd ? " · 可更新 " + upd : "");
  }
  function setMarketState(kind, text) {
    const el = $("marketDataState");
    if (!el) return;
    el.className = "mb-state" + (kind && kind !== "ok" ? " " + kind : "");
    el.textContent = text || "";
  }
  function updateMarketState() {
    if (marketLoading) { setMarketState("", "同步中..."); return; }
    if (marketOffline) { setMarketState("offline", "离线 · 使用缓存"); return; }
    if (marketData.length && marketCacheAge) {
      const age = Date.now() - marketCacheAge;
      const ago = age < 60000 ? "刚刚" : age < 3600000 ? Math.round(age / 60000) + " 分钟前" : Math.round(age / 3600000) + " 小时前";
      setMarketState("", "数据 " + ago);
    } else { setMarketState("", ""); }
  }
  function saveMarketCache() {
    try { localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({ t: Date.now(), plugins: marketData, categories: marketCategories })); } catch (e) { }
  }
  function loadMarketCache() {
    try {
      const d = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || "null");
      if (d && Array.isArray(d.plugins)) {
        marketData = d.plugins; marketCategories = d.categories || {}; marketCacheAge = d.t || 0;
        return true;
      }
    } catch (e) { }
    return false;
  }
  async function loadMarket(force) {
    if (marketLoading) return;
    marketLoading = true;
    updateMarketState();
    try {
      const resp = await fetch(MARKET_URL, { cache: force ? "reload" : "default" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      marketData = data.plugins || [];
      marketCategories = data.categories || {};
      marketCacheAge = Date.now();
      marketOffline = false;
      saveMarketCache();
      appendLog(`[市场] 已获取 ${marketData.length} 个社区插件`, "log-ready");
      renderMarket();
    } catch (err) {
      marketOffline = true;
      const had = marketData.length > 0;
      if (!had && !loadMarketCache()) {
        setMarketState("error", "加载失败");
        const body = $("marketBody");
        if (body) body.innerHTML = '<div class="market-empty">市场数据加载失败：' + escapeHtml(String(err)) + '</div>';
        appendLog(`[市场] 加载失败：${err}`, "log-error");
      } else {
        setMarketState("offline", "离线 · 使用缓存");
        appendLog(`[市场] 在线获取失败，回退本地缓存：${err}`, "log-stop");
        renderMarket();
      }
    } finally {
      marketLoading = false;
      updateMarketState();
    }
  }
  function syncTabs() {
    document.querySelectorAll("#marketTabs .mt-tab").forEach(t => t.classList.toggle("active", t.dataset.view === marketView));
  }
  function openMarket() {
    const modal = $("marketModal");
    if (!modal) return;
    modal.classList.add("show");
    const v = localStorage.getItem(MARKET_VIEW_KEY);
    if (v === "all" || v === "installed" || v === "update") marketView = v;
    marketCat = localStorage.getItem(MARKET_CAT_KEY) || "";
    syncTabs();
    if (!marketData.length) {
      if (!loadMarketCache()) {
        setMarketState("", "加载中...");
        const body = $("marketBody");
        if (body) body.innerHTML = '<div class="market-empty">正在从 awesome-dsh-plugin.com 拉取市场数据...</div>';
        loadMarket(false);
      } else {
        renderMarket();
        loadMarket(false);
      }
    } else {
      renderMarket();
      if (Date.now() - marketCacheAge > MARKET_TTL && !marketOffline) loadMarket(false);
    }
  }
  function closeMarket() {
    stopHeroAuto();
    closeMarketDetail();
    const modal = $("marketModal");
    if (modal) modal.classList.remove("show");
  }
  async function marketDoInstall(m, btn) {
    const target = marketTarget(m);
    if (marketInstalling.has(target)) return;
    marketInstalling.add(target);
    if (btn) { btn.disabled = true; btn.innerHTML = "安装中..."; }
    appendLog(`[市场] 正在安装 ${m.name}（${target}）...`, "log-start");
    try {
      const r = await invoke("install_market_plugin", { target });
      appendLog(`[市场] 安装完成：${r}`, "log-ready");
      await fetchPlugins(); renderPlugins();
      renderMarket();
      if (marketDetailOpen && marketDetailName === m.name) openMarketDetail(m);
    } catch (err) {
      const msg = String(err);
      const bm = msg.match(/__BUILD_BLOCKED__:([^\s\n]+)/);
      if (bm) {
        const key = bm[1];
        appendLog(`[市场] ${m.name} 的构建脚本被 pnpm 白名单拦截（${key}）`, "log-stop");
        showConfirm("构建白名单确认", `插件「${m.name}」（${key}）需要执行构建脚本（prepare），pnpm 出于安全默认拦截。\n\n是否将 ${key} 加入 pnpm-workspace.yaml 的 allowBuilds 白名单，并自动重试安装？\n\n提示：构建脚本来自第三方插件，加入白名单即允许它在安装时执行。`, async () => {
          try {
            await invoke("allow_builds", { pkg: key });
            appendLog(`[市场] ${key} 已加入构建白名单，自动重试安装...`, "log-stop");
            marketInstalling.delete(target);
            await marketDoInstall(m, btn);
          } catch (e2) {
            appendLog(`[市场] 加入白名单失败：${e2}`, "log-error");
            renderMarket();
          }
        });
        return;
      }
      appendLog(`[市场] 安装失败：${msg}`, "log-error");
      const why = explainInstallError(msg);
      if (why) appendLog(`[市场] 原因：${why}`, "log-error");
      renderMarket();
    } finally {
      marketInstalling.delete(target);
    }
  }
  function marketDoUninstall(m) {
    const target = marketTarget(m);
    showConfirm("卸载插件", `确定卸载「${m.name}」吗？卸载后可随时在市场中重新安装。`, async () => {
      try {
        appendLog(`[市场] 正在卸载 ${m.name}...`, "log-start");
        const r = await invoke("uninstall_market_plugin", { target });
        appendLog(`[市场] 卸载完成：${r}`, "log-ready");
        await fetchPlugins(); renderPlugins();
        renderMarket();
        if (marketDetailOpen && marketDetailName === m.name) openMarketDetail(m);
      } catch (err) {
        const umsg = String(err);
        appendLog(`[市场] 卸载失败：${umsg}`, "log-error");
        const uwhy = explainInstallError(umsg);
        if (uwhy) appendLog(`[市场] 原因：${uwhy}`, "log-error");
      }
    });
  }
  function marketDetailHTML(m) {
    const st = marketState(m);
    const catZh = marketCategoryZh(m);
    const avatar = 'https://github.com/' + encodeURIComponent(m.owner || '') + '.png';
    const flags = marketFlags();
    const rel = (marketData || []).filter(x => x.category === m.category && x.name !== m.name)
      .sort((a, b) => comboScore(b, marketMaxStars()) - comboScore(a, marketMaxStars())).slice(0, 5);
    return `
    <div class="mk-detail-head">
      <span class="mkd-title">插件详情</span>
      <button class="settings-close" data-act="close" title="关闭">&times;</button>
    </div>
    <div class="mk-detail-body">
      <div class="mkd-top">
        <div class="mkd-avatar"><img src="${escapeHtml(avatar)}" loading="lazy" alt=""></div>
        <div style="min-width:0">
          <div class="mkd-name">${escapeHtml(m.name || "未命名插件")}${mkTagsHTML(m, flags)}</div>
          <div class="mkd-owner">@${escapeHtml(m.owner || "未知")}${m.stars ? ' · ★ ' + m.stars : ""}</div>
        </div>
      </div>
      <div class="mkd-tags">
        ${catZh ? '<span class="mk-tag mk-tag-pick">' + escapeHtml(catZh) + '</span>' : ""}
        <span class="mk-tag ${m.npm ? "mk-tag-hot" : "mk-tag-new"}">${m.npm ? "npm 可安装" : "GitHub 源码"}</span>
        ${st.installed ? `<span class="mk-tag mk-tag-new">已安装${st.localVersion ? " v" + escapeHtml(st.localVersion) : ""}</span>` : ""}
        ${st.update ? '<span class="mk-tag mk-tag-update">可更新 v' + escapeHtml(m.version || "") + '</span>' : ""}
      </div>
      <div class="mkd-actions">
        ${mkInstallBtnHTML(m, st)}
        ${st.installed ? '<button class="btn-danger" data-act="uninstall">卸载</button>' : ""}
        ${m.url ? '<button class="btn-small" data-act="home" data-url="' + escapeHtml(m.url) + '">打开主页</button>' : ""}
      </div>
      <div class="mkd-section-title">简介</div>
      <div class="mkd-desc">${escapeHtml(marketDesc(m) || "（暂无说明）")}</div>
      <div class="mkd-section-title">信息</div>
      <div class="mkd-info-row"><span class="mkd-k">作者</span><span class="mkd-v">@${escapeHtml(m.owner || "未知")}</span></div>
      ${catZh ? '<div class="mkd-info-row"><span class="mkd-k">分类</span><span class="mkd-v">' + escapeHtml(catZh) + '</span></div>' : ""}
      <div class="mkd-info-row"><span class="mkd-k">星标</span><span class="mkd-v">★ ${m.stars || 0}</span></div>
      <div class="mkd-info-row"><span class="mkd-k">添加时间</span><span class="mkd-v">${escapeHtml(m.added || "未知")}</span></div>
      <div class="mkd-info-row"><span class="mkd-k">来源</span><span class="mkd-v">${m.npm ? escapeHtml(m.npm) : "GitHub"}</span></div>
      <div class="mkd-section-title">相关推荐</div>
      <div class="mkd-related">
        ${rel.length ? rel.map(r => `
          <div class="mkd-rel-item" data-act="related" data-name="${escapeHtml(r.name)}">
            <div style="min-width:0">
              <div class="mkd-rel-name">${escapeHtml(r.name)}</div>
              <div class="mkd-rel-meta">${escapeHtml(marketCategoryZh(r))}${r.stars ? " · ★ " + r.stars : ""} · ${r.npm ? "npm" : "GitHub"}</div>
            </div>
          </div>`).join("") : '<div style="font-size:12px;color:var(--text-secondary)">暂无同类插件</div>'}
      </div>
    </div>`;
  }
  function openMarketDetail(m) {
    if (!m) return;
    marketDetailOpen = true;
    marketDetailName = m.name;
    recordMarketRecent(m.name);
    const d = $("marketDetail");
    if (!d) return;
    d.classList.add("open");
    d.innerHTML = marketDetailHTML(m);
    const img = d.querySelector(".mkd-avatar img");
    if (img) img.addEventListener("error", () => { const p = img.parentNode; if (p) p.textContent = (m.owner || "?").trim().charAt(0).toUpperCase(); });
    d.querySelectorAll("[data-act]").forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        const act = el.dataset.act;
        if (act === "close") closeMarketDetail();
        else if (act === "install") marketDoInstall(m, el);
        else if (act === "uninstall") marketDoUninstall(m);
        else if (act === "home") { const url = el.dataset.url; if (url) invoke("open_external", { url }).catch(err => appendLog("打开链接失败：" + err, "log-error")); }
        else if (act === "related") { const nm = el.dataset.name; const rm = marketData.find(x => x.name === nm); if (rm) openMarketDetail(rm); }
      };
    });
  }
  function closeMarketDetail() {
    marketDetailOpen = false;
    marketDetailName = "";
    const d = $("marketDetail");
    if (d) d.classList.remove("open");
  }
  function renderMarket() {
    refreshMarketStateCache();
    marketSearchKw = ($("marketSearch") && $("marketSearch").value || "").trim().toLowerCase();
    const sw = $("marketSearch");
    if (sw) sw.closest(".mb-search")?.classList.toggle("has-value", !!marketSearchKw);
    updateMarketState();
    renderSidebar();
    renderStats();
    const body = $("marketBody");
    if (body) body.innerHTML = "";
    if (marketView === "discover" && !marketCat && !marketSearchKw) {
      const hero = $("marketHero"), sh = $("marketShelves");
      if (hero) hero.style.display = "";
      if (sh) sh.style.display = "";
      renderHero();
      renderShelves();
      return;
    }
    stopHeroAuto();
    const hero = $("marketHero"), sh = $("marketShelves");
    if (hero) hero.style.display = "none";
    if (sh) sh.style.display = "none";
    renderGrid();
  }

  /* ================= 技能 ================= */
  function renderSkills() {
    const sel = $("skillFilter");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">全部插件</option>';
    [...new Set(skillData.map(s => s.plugin))].filter(Boolean).forEach(p => {
      const o = document.createElement("option");
      o.value = p; o.textContent = p;
      sel.appendChild(o);
    });
    sel.value = prev;
    const filter = sel.value, onlyOn = ($("skillOnlyEnabled") || {}).checked;
    const box = $("skillList");
    if (!box) return;
    box.innerHTML = "";
    if (!skillData || !skillData.length) {
      box.innerHTML = '<div class="session-empty">未扫描到技能（Skill 是目录下带 frontmatter 的 SKILL.md，属于 DSH 原生技能体系）</div>';
      return;
    }
    skillData.filter(s => (!filter || s.plugin === filter) && (!onlyOn || s.enabled)).forEach(s => {
      const card = document.createElement("div");
      card.className = "cap-card";
      card.innerHTML = `
        <div class="cc-head">
          <div><span class="cc-name">${escapeHtml(s.name)}</span><span class="cc-ver">${escapeHtml(s.plugin)}</span></div>
          <span class="status-badge ${s.enabled ? "badge-on" : "badge-off"}">${s.enabled ? "已启用" : "已禁用"}</span>
        </div>
        <div class="cc-desc">${escapeHtml(s.desc)}</div>
        <div class="cc-meta">ID: ${escapeHtml(s.id)}</div>
        <div class="cc-actions">
          <button class="btn-small" data-act="detail" data-id="${escapeHtml(s.id)}">详情</button>
        </div>`;
      box.appendChild(card);
    });
    box.querySelectorAll("button[data-act]").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const s = skillData.find(x => x.id === id);
        if (s) showConfirm("技能详情", `名称：${s.name}\n所属插件：${s.plugin}\n说明：${s.desc || "（无说明）"}`, () => { });
      };
    });
  }

  /* ================= MCP ================= */
  function renderMcp() {
    const box = $("mcpList");
    if (!box) return;
    box.innerHTML = "";
    if (!mcpData || !mcpData.length) { box.innerHTML = '<div class="session-empty">暂无 MCP 服务（DSH 原生 MCP 配置读取待接入）</div>'; return; }
    mcpData.forEach(m => {
      const card = document.createElement("div");
      card.className = "cap-card";
      const badgeCls = m.status === "connected" ? "badge-on" : m.status === "error" ? "badge-err" : "badge-off";
      const badgeTxt = m.status === "connected" ? "已连接" : m.status === "error" ? "连接异常" : "未连接";
      card.innerHTML = `
        <div class="cc-head">
          <div><span class="cc-name">${escapeHtml(m.name)}</span><span class="cc-ver">${escapeHtml((m.protocol || "").toUpperCase())}</span></div>
          <span class="status-badge ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="cc-desc">${escapeHtml(m.desc)}</div>
        <div class="cc-meta">ID: ${escapeHtml(m.id)} · 端口: ${escapeHtml(m.port)} · 地址: ${escapeHtml(m.url)}</div>
        <div class="cc-actions">
          <button class="btn-small" data-act="toggle" data-id="${escapeHtml(m.id)}">${m.status === "connected" ? "断开" : "连接"}</button>
          <button class="btn-small" data-act="test" data-id="${escapeHtml(m.id)}">测试连接</button>
          <button class="btn-small" data-act="config" data-id="${escapeHtml(m.id)}">配置</button>
          <button class="btn-danger" data-act="remove" data-id="${escapeHtml(m.id)}">删除</button>
        </div>`;
      box.appendChild(card);
    });
    box.querySelectorAll("button[data-act]").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = btn.dataset.id, act = btn.dataset.act;
        const m = mcpData.find(x => x.id === id);
        if (!m) return;
        if (act === "toggle") {
          m.status = m.status === "connected" ? "disconnected" : "connected";
          renderMcp();
          appendLog(`[MCP] ${id} ${m.status === "connected" ? "已连接" : "已断开"}`, "log-ready");
        }
        else if (act === "test") {
          appendLog(`[MCP] 测试 ${id} 连接...`, "log-start");
          setTimeout(() => {
            appendLog(`[MCP] ${id} 连接${m.status === "connected" ? "正常" : "失败"}`, m.status === "connected" ? "log-ready" : "log-error");
          }, 500);
        }
        else if (act === "config") {
          showConfirm("MCP 配置", `服务「${m.name}」配置面板（原型）。\n协议：${m.protocol}\n地址：${m.url}\n端口：${m.port}`, () => { });
        }
        else if (act === "remove") {
          showConfirm("删除 MCP", `确定要删除 MCP 服务「${m.name}」吗？`, () => {
            mcpData = mcpData.filter(x => x.id !== id);
            renderMcp();
            appendLog(`[MCP] ${id} 已删除`, "log-error");
          });
        }
      };
    });
  }

  /* ================= 初始化 ================= */
  function wireToolbar() {
    const refresh = $("btnRefreshPlugin");
    if (refresh) refresh.addEventListener("click", async () => { await fetchPlugins(); renderPlugins(); });
    const search = $("pluginSearch");
    if (search) search.addEventListener("input", renderPlugins);
    const kind = $("pluginKindFilter");
    if (kind) kind.addEventListener("change", renderPlugins);
    const status = $("pluginStatusFilter");
    if (status) status.addEventListener("change", renderPlugins);
    const sort = $("pluginSort");
    if (sort) sort.addEventListener("change", renderPlugins);
    const dirBtn = $("btnPluginDir");
    if (dirBtn) dirBtn.addEventListener("click", () => { pluginDir = pluginDir === 1 ? -1 : 1; updatePluginDirBtn(); renderPlugins(); });
    updatePluginDirBtn();
    const selAll = $("btnSelectAllPlugins");
    if (selAll) selAll.addEventListener("click", () => {
      const list = filteredPluginList();
      const allSelected = list.length > 0 && list.every(p => selectedPlugins.has(p.id));
      if (allSelected) { selectedPlugins.clear(); } else { list.forEach(p => selectedPlugins.add(p.id)); }
      renderPlugins();
    });
    document.querySelectorAll("#pluginBatchBar button[data-batch]").forEach(btn => {
      btn.onclick = async () => {
        const act = btn.dataset.batch;
        if (act === "clear") { selectedPlugins.clear(); renderPlugins(); return; }
        const ids = Array.from(selectedPlugins);
        let ok = 0, skip = 0;
        for (const id of ids) {
          const p = pluginData.find(x => x.id === id);
          if (!p) continue;
          if (act === "enable" || act === "disable") {
            if (!(p.kind === "extension" || p.source === "local" || (p.kind === "builtin" && p.source === "npm"))) { skip++; continue; }
            try { await invoke("set_plugin_enabled", { id, enabled: act === "enable" }); ok++; }
            catch (err) { appendLog(`[批量] ${p.name} 失败：${err}`, "log-error"); }
          } else if (act === "uninstall") {
            if (p.kind === "builtin" && p.source !== "npm") { skip++; continue; }
            try { await invoke("remove_plugin", { id }); ok++; }
            catch (err) { appendLog(`[批量] ${p.name} 卸载失败：${err}`, "log-error"); }
          }
        }
        appendLog(`[批量] ${act === "uninstall" ? "卸载" : (act === "enable" ? "启用" : "禁用")}完成：成功 ${ok}，跳过 ${skip}，重启 DSH 后生效`, "log-stop");
        selectedPlugins.clear();
        await fetchPlugins(); renderPlugins();
      };
    });
    const imp = $("btnImportPlugin");
    if (imp) imp.addEventListener("click", async () => {
      try {
        const p = await invoke("pick_workspace");
        if (!p) return;
        const name = await invoke("import_plugin", { path: p });
        appendLog(`[插件] 已导入并注册：${name}，重启 DSH 后生效`, "log-ready");
        await fetchPlugins(); renderPlugins();
      } catch (e) { appendLog("导入插件失败：" + e, "log-error"); }
    });

    // 市场接线
    const openBtn = $("btnOpenMarket");
    if (openBtn) openBtn.addEventListener("click", openMarket);
    const mc = $("marketClose");
    if (mc) mc.addEventListener("click", closeMarket);
    const mm = $("marketModal");
    if (mm) mm.addEventListener("click", e => { if (e.target === mm) closeMarket(); });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && $("marketModal") && $("marketModal").classList.contains("show")) closeMarket();
    });
    const mref = $("marketRefresh");
    if (mref) mref.addEventListener("click", () => { appendLog("[市场] 正在刷新数据...", "log-start"); loadMarket(true); });
    const mtabs = $("marketTabs");
    if (mtabs) mtabs.addEventListener("click", e => {
      const tab = e.target.closest(".mt-tab");
      if (!tab) return;
      marketView = tab.dataset.view;
      localStorage.setItem(MARKET_VIEW_KEY, marketView);
      syncTabs();
      renderMarket();
    });
    const msort = $("marketSort");
    if (msort) msort.addEventListener("change", e => { marketSort = e.target.value; renderMarket(); });
    const msrc = $("marketSource");
    if (msrc) msrc.addEventListener("change", e => { marketSource = e.target.value; renderMarket(); });
    const msearch = $("marketSearch");
    if (msearch) msearch.addEventListener("input", () => {
      clearTimeout(marketSearchTimer);
      marketSearchTimer = setTimeout(renderMarket, 200);
    });
    const mclear = $("btnMarketClear");
    if (mclear) mclear.addEventListener("click", () => {
      const s = $("marketSearch");
      if (s) { s.value = ""; s.focus(); }
      renderMarket();
    });

    // 技能 / MCP
    const sf = $("skillFilter");
    if (sf) sf.addEventListener("change", renderSkills);
    const so = $("skillOnlyEnabled");
    if (so) so.addEventListener("change", renderSkills);
    const sr = $("btnRefreshSkill");
    if (sr) sr.addEventListener("click", async () => { await fetchSkills(); renderSkills(); });
    const am = $("btnAddMcp");
    if (am) am.addEventListener("click", () => showConfirm("添加 MCP", "DSH 当前未暴露可编辑的原生 MCP 配置入口，此项暂待接入；MCP 能力通常由插件（plugin）暴露。", () => { }));
    const rm = $("btnRefreshMcp");
    if (rm) rm.addEventListener("click", async () => { await fetchMcp(); renderMcp(); });
    const tm = $("btnTestAllMcp");
    if (tm) tm.addEventListener("click", () => appendLog("[MCP] 当前没有已接入的 MCP 服务，无法测试", "log-stop"));
  }

  async function reload() {
    capLoaded = false;
    await loadCapabilityData();
  }

  function init() {
    wireToolbar();
    loadCapabilityData();
  }

  window.DSH = Object.assign(window.DSH || {}, {
    capabilities: {
      init,
      reload,
      ensureLoaded: () => { if (!capLoaded) loadCapabilityData(); }
    }
  });
})();
