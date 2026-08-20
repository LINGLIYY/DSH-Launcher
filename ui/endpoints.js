/* ============================================================
   DSH Launcher · endpoints.js
   多端管理：Windows + WSL 所有 dsh 的枚举、切换、增删、连通检测。
   界面：顶栏端切换器 + 「多端管理」Tab（自动扫描 / 手动添加）。
   ============================================================ */
(function () {
  "use strict";
  const DSH = window.DSH;
  const { $, invoke, escapeHtml, appendLog, showConfirm } = DSH;

  const EP_KEY = "dsh_launcher_endpoints";
  const DEFAULT_ENDPOINTS = [
    { id: "ep-win", name: "本地 Windows", type: "windows", path: "", port: 3080,
      workspace: "", dshHome: "", version: "", status: "stopped", active: true, ssh: "" }
  ];

  let endpoints = loadEndpoints();

  function loadEndpoints() {
    try {
      const d = JSON.parse(localStorage.getItem(EP_KEY) || "null");
      return d && d.length ? d : JSON.parse(JSON.stringify(DEFAULT_ENDPOINTS));
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_ENDPOINTS)); }
  }
  function saveEndpoints() { localStorage.setItem(EP_KEY, JSON.stringify(endpoints)); }
  function currentEndpoint() { return endpoints.find(e => e.active) || endpoints[0]; }
  function typeLabel(t) { return t === "windows" ? "Windows" : t === "wsl" ? "WSL" : "SSH 远程（待开发）"; }
  function typeTagClass(t) { return t === "windows" ? "tag-builtin" : t === "wsl" ? "tag-wsl" : "tag-ssh"; }

  function setActiveEndpoint(id) {
    endpoints.forEach(e => e.active = (e.id === id));
    saveEndpoints();
    updateEndpointUI();
    const ep = currentEndpoint();
    const u = $("urlInput");
    if (u) u.value = `http://127.0.0.1:${ep.port}/`;
    appendLog(`[多端] 已切换到「${ep.name}」（${typeLabel(ep.type)}，端口 ${ep.port}）`, "log-ready");
    // 同步偏好里的端列表
    if (window.DSH.settings && DSH.settings.prefs()) {
      const prefs = DSH.settings.prefs();
      prefs.endpoints = endpoints;
      invoke("set_launcher_prefs", { prefsJson: prefs }).catch(() => { });
    }
    // 若当前激活的 Tab 依赖端数据，立即刷新
    const activeTab = document.querySelector(".tab-panel.active");
    if (activeTab) {
      const tab = activeTab.dataset.tab;
      if (tab === "sessions" && window.DSH.sessions) DSH.sessions.load();
      if (tab === "capabilities" && window.DSH.capabilities) DSH.capabilities.reload();
    }
  }

  function currentDshTarget() { return ($("dshInstallTarget") && $("dshInstallTarget").value) || ""; }

  function updateDshTargetSelect() {
    const sel = $("dshInstallTarget");
    if (!sel) return;
    const cur = sel.value;
    const opts = [["", "Windows"]];
    (endpoints || []).forEach(e => { if (e.type === "wsl" && e.distro) opts.push([e.distro, e.name + "（" + e.distro + "）"]); });
    sel.innerHTML = "";
    opts.forEach(function (o) {
      const el = document.createElement("option");
      el.value = o[0]; el.textContent = o[1];
      sel.appendChild(el);
    });
    if (opts.some(function (o) { return o[0] === cur; })) sel.value = cur;
  }

  /* ---------- 顶栏端切换器 ---------- */
  function updateEndpointUI() {
    const ep = currentEndpoint();
    updateDshTargetSelect();
    const nameEl = $("epName");
    if (nameEl) nameEl.textContent = ep.name;
    const dot = $("epDot");
    if (dot) dot.style.background = ep.status === "running" ? "var(--success-green)" : ep.status === "error" ? "var(--error-red)" : "#999";
    const tag = $("ctrlEpType");
    if (tag) tag.textContent = typeLabel(ep.type);
    const dd = $("endpointDropdown");
    if (!dd) return;
    dd.innerHTML = endpoints.map(e => `
      <div class="ep-item ${e.active ? "active" : ""}" data-id="${escapeHtml(e.id)}">
        <span>${escapeHtml(e.name)}</span>
        <span class="ep-type">${escapeHtml(typeLabel(e.type))}</span>
      </div>`).join("") +
      `<div class="ep-manage" id="epManageBtn">管理多端设置...</div>`;
    dd.querySelectorAll(".ep-item").forEach(item => {
      item.onclick = () => { setActiveEndpoint(item.dataset.id); dd.classList.remove("show"); };
    });
    const mgr = $("epManageBtn");
    if (mgr) mgr.onclick = () => {
      dd.classList.remove("show");
      // 切换到多端管理 Tab
      const btn = document.querySelector('.tab-btn[data-tab="endpoints"]');
      if (btn) btn.click();
    };
  }

  /* ---------- 多端管理 Tab 列表 ---------- */
  function renderEndpointList() {
    const box = $("endpointList");
    if (!box) return;
    box.innerHTML = "";
    endpoints.forEach(e => {
      const card = document.createElement("div");
      card.className = "endpoint-card" + (e.active ? " active" : "");
      const statusCls = e.status === "running" ? "badge-on" : e.status === "error" ? "badge-err" : "badge-off";
      const statusTxt = e.status === "running" ? "运行中" : e.status === "error" ? "异常" : e.status === "unknown" ? "未知" : "已停止";
      const ver = e.version && e.version !== "未检测" ? e.version : "未检测";
      const upstream = e.upstreamVersion ? ` · 上游最新 v${escapeHtml(e.upstreamVersion)}` : "";
      const upd = e.updateAvailable ? `<span class="status-badge badge-upd">可更新 v${escapeHtml(e.updateAvailable)}</span>` : "";
      card.innerHTML = `
        <div class="ec-head">
          <div>
            <span class="ec-name">${escapeHtml(e.name)}</span>
            <span class="ec-type ${typeTagClass(e.type)}">${escapeHtml(typeLabel(e.type))}</span>
            ${e.active ? '<span class="ec-type tag-builtin">当前</span>' : ""}
          </div>
          <span class="status-badge ${statusCls}">${statusTxt}</span>
        </div>
        <div class="ec-meta">
          类型：${escapeHtml(typeLabel(e.type))}${e.distro ? `（${escapeHtml(e.distro)}）` : ""}${e.ssh ? ` · ${escapeHtml(e.ssh)}` : ""}<br>
          DSH 路径：${escapeHtml(e.path)}<br>
          端口：${escapeHtml(String(e.port))} · 当前 v${escapeHtml(ver)}${upstream} ${upd}<br>
          工作目录：${escapeHtml(e.workspace || "未设置")}
        </div>
        <div class="ec-actions">
          ${e.active ? "" : `<button class="btn-small" data-act="activate" data-id="${escapeHtml(e.id)}">切换到此端</button>`}
          <button class="btn-small" data-act="edit" data-id="${escapeHtml(e.id)}">编辑</button>
          <button class="btn-small" data-act="ping" data-id="${escapeHtml(e.id)}">检测连通</button>
          ${e.updateAvailable ? `<button class="btn-normal upd-btn" data-act="update" data-id="${escapeHtml(e.id)}">更新 v${escapeHtml(e.updateAvailable)}</button>` : ""}
          <button class="btn-danger" data-act="remove" data-id="${escapeHtml(e.id)}">删除</button>
        </div>`;
      box.appendChild(card);
    });
    box.querySelectorAll("button[data-act]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id, act = btn.dataset.act;
        const e = endpoints.find(x => x.id === id);
        if (!e) return;
        if (act === "activate") { setActiveEndpoint(id); renderEndpointList(); }
        else if (act === "edit") { editEndpoint(e); }
        else if (act === "ping") {
          appendLog(`[多端] 检测 ${e.name} 连通性...`, "log-start");
          invoke("ping_endpoint", { endpoint: e }).then(status => {
            e.status = status || "unknown";
            saveEndpoints(); renderEndpointList(); updateEndpointUI();
            appendLog(`[多端] ${e.name} ${status === "error" ? "不可达" : status === "running" ? "运行中" : "可达"}`, "log-ready");
          }).catch(() => {
            e.status = "error"; saveEndpoints(); renderEndpointList();
            appendLog(`[多端] ${e.name} 检测失败`, "log-error");
          });
        }
        else if (act === "update") { updateEndpointDsh(e); }
        else if (act === "remove") { removeEndpoint(e); }
      };
    });
  }

  /* ---------- 版本比较：0.1.0-rc.7 语义（数字逐段比，rc 后缀比数字） ---------- */
  function dshCmpVersion(a, b) {
    const parse = s => {
      const m = String(s || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.?(\d+))?/i);
      if (!m) return null;
      return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4] ? parseInt(m[4], 10) : Infinity];
    };
    const pa = parse(a), pb = parse(b);
    if (!pa || !pb) return 0;
    for (let i = 0; i < 4; i++) {
      if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
    }
    return 0;
  }

  /* ---------- 静默版本检测：读上游 latest（缓存 5 分钟）+ 逐个端探测本地版本 ---------- */
  let npmLatestCache = { v: "", t: 0 };
  async function fetchNpmLatest() {
    const now = Date.now();
    if (npmLatestCache.v && now - npmLatestCache.t < 5 * 60 * 1000) return npmLatestCache.v;
    try {
      const r = await fetch("https://registry.npmjs.org/@deepseek-ai/dsh/latest");
      if (!r.ok) return npmLatestCache.v || "";
      const d = await r.json();
      npmLatestCache = { v: String(d.version || "").trim(), t: now };
      return npmLatestCache.v;
    } catch (err) { return npmLatestCache.v || ""; }
  }

  // 检测单个端（静默）：填充 e.version 与 e.updateAvailable；返回是否有更新
  async function probeEndpointVersion(e) {
    if (!e || !e.path) return false;
    let local = "";
    try {
      const v = await invoke("dsh_version_for", { target: { etype: e.type, distro: e.distro || "", path: e.path } });
      local = String(v || "").trim();
    } catch (err) { /* 探测失败保持原值 */ }
    if (!local) return false;
    e.version = local;
    const latest = await fetchNpmLatest();
    if (latest) e.upstreamVersion = latest;
    e.updateAvailable = (latest && dshCmpVersion(local, latest) < 0) ? latest : "";
    return !!e.updateAvailable;
  }

  /* ---------- 启动自动版本检测：静默扫描所有端，有更新才提示 ---------- */
  async function autoCheckVersions() {
    const latest = await fetchNpmLatest();
    if (!latest) return; // 网络不可用则保持静默，下次启动再试
    const updatable = [];
    for (const e of endpoints) {
      try {
        const has = await probeEndpointVersion(e);
        if (has) updatable.push(e);
      } catch (err) { /* 单个端失败不影响其他端 */ }
    }
    saveEndpoints(); renderEndpointList();
    if (updatable.length) {
      updatable.forEach(e => {
        appendLog(`[版本] ${e.name}：v${e.version} → v${e.updateAvailable}，可在「多端管理」点「更新」`, "log-ready");
      });
    }
  }

  /* ---------- 更新端上的 DSH（自动识别全局/自定义目录） ---------- */
  function updateEndpointDsh(e) {
    const latest = e.updateAvailable || "";
    const where = e.type === "wsl" ? `WSL 发行版「${e.distro || "?"}」` : "Windows";
    showConfirm("更新 DSH", `将把「${e.name}」（${where}）的 DSH 更新到 v${latest}。\n\n提醒：\n· 需要联网，可能耗时几分钟\n· 会停止该端正在运行的 DSH\n· 数据目录与会话不受影响`, async () => {
      appendLog(`[版本] 正在更新 ${e.name} 到 v${latest} ...`, "log-start");
      try {
        // 停止该端实例（如有）
        try { await invoke("stop_harness", { force: true, endpoint_id: e.id }); } catch (err) { /* ignore */ }
        // 判断安装方式：全局 vs 自定义目录
        const p = String(e.path || "");
        const lower = p.toLowerCase();
        let result;
        if (e.type === "wsl") {
          const isGlobal = /\/node\/bin\/dsh$|\/usr\/local\/bin\/dsh$|\/n\/bin\/dsh$|\/\.nvm\/versions\/node\/[^/]+\/bin\/dsh$|\/bin\/dsh$/.test(lower);
          if (isGlobal) {
            result = await invoke("install_or_update_dsh", { distro: e.distro || "" });
          } else {
            // 自定义目录：~/dsh-test/bin/dsh → 前缀 ~/dsh-test
            const prefix = p.replace(/\/bin\/dsh$/, "");
            result = await invoke("install_dsh_to", { target: { kind: "wsl", distro: e.distro || "", path: prefix } });
            result = (result && result.msg) || result;
          }
        } else {
          const isGlobal = lower.includes("%appdata%\\npm") || lower.includes("appdata\\roaming\\npm") || !/\\dsh\.cmd$/.test(lower);
          if (isGlobal || !p) {
            result = await invoke("install_or_update_dsh", { distro: "" });
          } else {
            // 自定义目录：D:\tools\dsh-test\dsh.cmd → 前缀 D:\tools\dsh-test
            const prefix = p.replace(/[\\/][^\\/]*$/, "");
            result = await invoke("install_dsh_to", { target: { kind: "dir", distro: "", path: prefix } });
            result = (result && result.msg) || result;
          }
        }
        appendLog(`[版本] ${e.name} 更新完成：${result}`, "log-ready");
        // 更新后静默重新检测
        e.updateAvailable = "";
        e.version = "";
        saveEndpoints();
        await probeEndpointVersion(e);
        saveEndpoints(); renderEndpointList();
        appendLog(`[版本] ${e.name} 当前版本：${e.version || "未知"}`, "log-stop");
      } catch (err) {
        appendLog(`[版本] ${e.name} 更新失败：${err}`, "log-error");
      }
    });
  }

  /* ---------- 删除端：一次确认 + 提醒文字 + 可选一同卸载 DSH ---------- */
  function removeEndpoint(e) {
    const isWsl = e.type === "wsl";
    const warn = isWsl
      ? `确定删除端「${e.name}」吗？\n\n提醒：\n· 仅从启动器列表移除，不会删除该端的会话与配置数据\n· 若该端 DSH 正在运行，会先停止它\n· 勾选下方选项将卸载「${e.distro || "该 WSL 发行版"}」内的 DSH 本体（已隔离 Windows 全局，不会误伤；需联网，可能耗时几分钟）`
      : `确定删除端「${e.name}」吗？\n\n提醒：\n· 仅从启动器列表移除，不会删除 DSH 数据\n· 卸载 Windows 全局 DSH 会影响所有使用全局安装的程序（包括本启动器），请谨慎\n· 若该端 DSH 正在运行，会先停止它\n· 勾选下方选项将卸载 Windows 全局 DSH 本体（需联网，可能耗时几分钟）`;
    const checkLabel = isWsl
      ? `同时卸载「${e.distro || "该 WSL 发行版"}」中的 DSH 本体（@deepseek-ai/dsh，数据目录保留）`
      : "同时卸载 Windows 全局 DSH 本体（@deepseek-ai/dsh，数据目录保留）";
    DSH.confirmCheckDialog("删除端", warn, checkLabel, async uninstall => {
      if (uninstall) {
        appendLog(`[多端] 正在停止并卸载「${e.name}」的 DSH...`, "log-start");
        try {
          await invoke("stop_harness", { force: true, endpoint_id: e.id });
        } catch (err) { appendLog(`[多端] 停止失败（继续卸载）：${err}`, "log-error"); }
        try {
          const r = await invoke("uninstall_dsh", { distro: isWsl ? (e.distro || "") : "" });
          appendLog(`[多端] 卸载：${r}`, "log-ready");
        } catch (err) {
          appendLog(`[多端] 卸载失败：${err}（端仍会从列表移除）`, "log-error");
        }
      }
      endpoints = endpoints.filter(x => x.id !== e.id);
      if (e.active && endpoints.length) endpoints[0].active = true;
      if (!endpoints.length) endpoints = JSON.parse(JSON.stringify(DEFAULT_ENDPOINTS));
      saveEndpoints(); renderEndpointList(); updateEndpointUI();
      appendLog(`[多端] 已删除端「${e.name}」`, "log-stop");
    });
  }

  /* ---------- 编辑端（真实表单：名称 + 端口） ---------- */
  function editEndpoint(ep) {
    DSH.promptDialog("编辑端", `修改「${ep.name}」的名称（留空保持不变）：`, ep.name, name => {
      if (name === null) return;
      DSH.promptDialog("编辑端", "修改端口（1-65535）：", String(ep.port), portRaw => {
        if (portRaw === null) return;
        const port = parseInt(portRaw, 10);
        if (!port || port < 1 || port > 65535) {
          appendLog("[多端] 端口无效，未修改", "log-error");
          return;
        }
        if (name.trim()) ep.name = name.trim();
        ep.port = port;
        saveEndpoints(); renderEndpointList(); updateEndpointUI();
        appendLog(`[多端] 端「${ep.name}」已更新（端口 ${port}）`, "log-ready");
      });
    });
  }

  /* ================= 新建端向导 ================= */
  const ASCII_PATH_RE = /^[A-Za-z0-9_\-./\\:~ ]+$/;

  function flashInvalid(input) {
    input.classList.remove("flash-red");
    void input.offsetWidth; // 重启动画
    input.classList.add("flash-red");
    setTimeout(() => input.classList.remove("flash-red"), 1400);
  }

  // 校验全英文；不合法则红闪并返回 false
  function validateAscii(input) {
    const v = (input.value || "").trim();
    if (v && !ASCII_PATH_RE.test(v)) {
      flashInvalid(input);
      return false;
    }
    return true;
  }

  function openEndpointModal() {
    const m = $("endpointModal");
    if (m) m.classList.add("show");
    switchEpMode("manual");
  }
  function closeEndpointModal() {
    const m = $("endpointModal");
    if (m) m.classList.remove("show");
  }
  function switchEpMode(mode) {
    document.querySelectorAll("#endpointModal .ep-mode-tabs .mt-tab").forEach(t =>
      t.classList.toggle("active", t.dataset.mode === mode));
    document.querySelectorAll("#endpointModal .ep-mode-panel").forEach(p =>
      p.classList.toggle("active", p.dataset.mode === mode));
  }

  /* ---------- 加载 WSL 发行版下拉（支持多子系统） ---------- */
  async function loadWslDistros(selectEl, keepValue) {
    if (!selectEl) return;
    const prev = keepValue ? selectEl.value : "";
    selectEl.innerHTML = '<option value="">（无）</option>';
    let distros = [];
    try { distros = await invoke("wsl_distros"); } catch (e) { /* ignore */ }
    distros.forEach(d => {
      const o = document.createElement("option");
      o.value = d; o.textContent = d;
      selectEl.appendChild(o);
    });
    if (prev && distros.includes(prev)) selectEl.value = prev;
    else if (distros.length === 1) selectEl.value = distros[0];
  }

  // 手动添加（已有 DSH）
  function wireManualAdd() {
    const typeSel = $("newEpType");
    if (typeSel) typeSel.addEventListener("change", function () {
      const isWsl = this.value === "wsl";
      const ssh = $("sshFields");
      if (ssh) ssh.style.display = this.value === "ssh" ? "flex" : "none";
      const rows = ["newEpDistroRow", "newEpUserRow", "newEpPassRow"];
      rows.forEach(id => { const el = $(id); if (el) el.style.display = isWsl ? "flex" : "none"; });
      if (isWsl) loadWslDistros($("newEpDistro"), true);
    });
    const addBtn = $("btnAddEndpoint");
    if (addBtn) addBtn.addEventListener("click", () => {
      const name = ($("newEpName") || {}).value ? $("newEpName").value.trim() : "";
      const type = ($("newEpType") || {}).value || "windows";
      const pathInput = $("newEpPath");
      const path = pathInput ? pathInput.value.trim() : "";
      if (type === "ssh") {
        showConfirm("提示", "SSH 远程端暂待开发：DSH 目前不能安全地直接暴露到公网，本版本不提供远程端点。", () => { });
        return;
      }
      if (!name || !path) {
        showConfirm("提示", "请填写端名称和 DSH 路径。", () => { });
        return;
      }
      if (!validateAscii(pathInput)) {
        const h = $("manualHint");
        if (h) h.textContent = "⚠ 路径包含中文或非法字符（已红闪标出），请改为全英文路径";
        return;
      }
      const distro = type === "wsl" ? (($("newEpDistro") || {}).value || "").trim() : "";
      if (type === "wsl" && !distro) {
        showConfirm("提示", "请选择 WSL 发行版（若列表为空，请先点「自动扫描」或在「关于」确认 WSL 可用）。", () => { });
        return;
      }
      endpoints.push({
        id: "ep-" + Date.now(), name, type, path,
        port: +($("newEpPort") || {}).value || 3080,
        workspace: ($("newEpWorkspace") || {}).value.trim() || "",
        dshHome: "", version: "未检测", status: "stopped", active: false,
        ssh: type === "ssh" ? (($("newEpSsh") || {}).value || "").trim() : "",
        distro,
        user: (($("newEpUser") || {}).value || "").trim(),
        password: (($("newEpPass") || {}).value || "").trim()
      });
      saveEndpoints(); renderEndpointList(); updateEndpointUI();
      if ($("newEpName")) $("newEpName").value = "";
      if (pathInput) pathInput.value = "";
      if ($("newEpWorkspace")) $("newEpWorkspace").value = "";
      if ($("newEpSsh")) $("newEpSsh").value = "";
      if ($("newEpUser")) $("newEpUser").value = "";
      if ($("newEpPass")) $("newEpPass").value = "";
      appendLog(`[多端] 已添加端「${name}」`, "log-ready");
      closeEndpointModal();
    });
  }

  // 安装新 DSH（创建即安装，装到指定目录）
  function wireInstallNew() {
    const targetSel = $("instTarget");
    if (targetSel) targetSel.addEventListener("change", function () {
      const row = $("instDistroRow");
      if (row) row.style.display = this.value === "wsl" ? "flex" : "none";
      const p = $("instPath");
      if (p) p.placeholder = this.value === "wsl" ? "如：~/dsh-test 或 /home/用户名/dsh-test" : "如：D:\\tools\\dsh-test";
    });
    const distroInput = $("instDistro");
    if (distroInput) {
      // 预填已扫描到的发行版（去重），仍可手动修改
      const seen = [];
      (endpoints || []).forEach(e => {
        if (e.type === "wsl" && e.distro && !seen.includes(e.distro)) seen.push(e.distro);
      });
      if (seen.length) distroInput.value = seen[0];
      distroInput.placeholder = seen.length ? `如：${seen.join(" / ")}` : "如：Ubuntu";
    }
    const installBtn = $("btnInstallNewDsh");
    if (installBtn) installBtn.addEventListener("click", () => {
      const kind = ($("instTarget") || {}).value || "dir";
      const distro = distroInput ? distroInput.value.trim() : "";
      const pathInput = $("instPath");
      const path = pathInput ? pathInput.value.trim() : "";
      if (!path) { showConfirm("提示", "请填写安装目录。", () => { }); return; }
      if (!validateAscii(pathInput)) {
        const h = $("installHint");
        if (h) h.innerHTML = "⚠ 安装目录包含中文或非法字符（已红闪标出），请改为全英文目录";
        return;
      }
      if (kind === "wsl" && !distro) { showConfirm("提示", "请填写 WSL 发行版名称。", () => { }); return; }
      const name = ($("instName") || {}).value.trim() || (kind === "wsl" ? `${distro} · 测试端` : "本地测试端");
      const where = kind === "wsl" ? `WSL 发行版「${distro}」的 ${path}` : path;
      showConfirm("安装新的 DSH", `将联网安装 @deepseek-ai/dsh（最新版）到：\n${where}\n\n提醒：\n· 需要联网，可能需要几分钟\n· 安装到指定目录，<b>不会影响</b>现有的全局安装\n· 适合初次使用、或需要再装一个用于测试/隔离的 DSH\n· 安装完成后会自动创建对应的端`, async () => {
        const btn = $("btnInstallNewDsh");
        if (btn) { btn.disabled = true; btn.textContent = "安装中..."; }
        appendLog(`[多端] 正在安装 DSH 到 ${where} ...`, "log-start");
        try {
          const r = await invoke("install_dsh_to", { target: { kind, distro, path } });
          const bin = (r && r.bin) || "";
          const prefix = (r && r.prefix) || path;
          if (!bin) throw new Error("安装结果缺少入口路径");
          endpoints.push({
            id: "ep-" + Date.now(), name, type: kind, path: bin, port: 3080,
            workspace: kind === "wsl" ? "~" : prefix,
            dshHome: "", version: "未检测", status: "stopped", active: false,
            ssh: "", distro: kind === "wsl" ? distro : ""
          });
          saveEndpoints(); renderEndpointList(); updateEndpointUI();
          const msg = (r && r.msg && String(r.msg).trim()) ? String(r.msg).trim() : "";
          appendLog(`[多端] DSH 安装完成：${bin}`, "log-ready");
          if (msg) appendLog(`[多端] ${msg}`, "log-stop");
          appendLog(`[多端] 已自动创建端「${name}」，可在列表中点「检测连通」或直接切换使用`, "log-ready");
          closeEndpointModal();
          if ($("instPath")) $("instPath").value = "";
          if ($("instName")) $("instName").value = "";
        } catch (err) {
          appendLog(`[多端] 安装失败：${err}`, "log-error");
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "安装并创建端"; }
        }
      });
    });
  }

  /* ---------- 扫描进度条 ---------- */
  function setScanProgress(state, text) {
    const box = $("scanProgress");
    const t = $("scanProgressText");
    if (!box) return;
    if (state === "show") {
      box.style.display = "flex";
      if (t) { t.textContent = text || "正在扫描..."; t.className = "sp-text"; }
    } else if (state === "ok" || state === "err") {
      if (t) { t.textContent = text || (state === "ok" ? "扫描完成" : "扫描失败"); t.className = "sp-text " + state; }
      setTimeout(() => { box.style.display = "none"; }, 3000);
    } else {
      box.style.display = "none";
    }
  }

  /* ---------- 自动扫描：Windows + WSL 所有 dsh ---------- */
  async function scanAll() {
    appendLog("[多端] 正在扫描 Windows 与 WSL 中所有 DSH...", "log-start");
    setScanProgress("show", "正在扫描 Windows 与 WSL 中所有 DSH...");
    let found = [];
    try { found = await invoke("scan_terminals"); }
    catch (e) {
      appendLog("[多端] 扫描失败：" + e, "log-error");
      setScanProgress("err", "扫描失败");
      return;
    }
    let added = 0;
    found.forEach(f => {
      if (!f.path) {
        appendLog(`[多端] ${f.name} 未检测到 dsh，已跳过`, "log-stop");
        return;
      }
      if (!endpoints.some(e => e.type === f.type && e.path === f.path)) {
        endpoints.push({
          id: "ep-" + f.type + "-" + Date.now() + Math.random().toString(36).slice(2, 6),
          name: f.name, type: f.type, distro: f.distro || "", path: f.path, port: 3080,
          workspace: "~", dshHome: "", version: f.version || "", status: "stopped", active: false, ssh: ""
        });
        added++;
        appendLog(`[多端] 发现 ${f.type === "windows" ? "Windows" : "WSL"} dsh：${f.path}`, "log-ready");
      }
    });
    saveEndpoints(); renderEndpointList(); updateEndpointUI();
    appendLog(`[多端] 扫描完成，新增 ${added} 个端`, "log-ready");
    const total = found.filter(f => f.path).length;
    setScanProgress("ok", `扫描完成：新增 ${added} 个端（共发现 ${total} 个 dsh）`);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    updateEndpointUI();
    // 端切换器下拉
    const btn = $("endpointBtn");
    if (btn) btn.onclick = e => {
      e.stopPropagation();
      const dd = $("endpointDropdown");
      if (dd) dd.classList.toggle("show");
    };
    document.addEventListener("click", () => {
      const dd = $("endpointDropdown");
      if (dd) dd.classList.remove("show");
    });

    // 多端 Tab
    const scanBtn = $("btnScanEndpoints");
    if (scanBtn) scanBtn.addEventListener("click", scanAll);
    const refreshBtn = $("btnRefreshEndpoints");
    if (refreshBtn) refreshBtn.addEventListener("click", () => {
      renderEndpointList();
      appendLog("[多端] 端状态已刷新", "log-stop");
      autoCheckVersions(); // 顺带静默重扫版本
    });

    // 新建端向导
    const ob = $("btnOpenEndpointModal");
    if (ob) ob.addEventListener("click", openEndpointModal);
    const ec = $("epModalClose");
    if (ec) ec.addEventListener("click", closeEndpointModal);
    const em = $("endpointModal");
    if (em) em.addEventListener("click", e => { if (e.target === em) closeEndpointModal(); });
    document.querySelectorAll("#endpointModal .ep-mode-tabs .mt-tab").forEach(t => {
      t.onclick = () => switchEpMode(t.dataset.mode);
    });
    wireManualAdd();
    wireInstallNew();

    // 启动器启动后：后台静默扫描一次所有端的版本（有更新才提示）
    setTimeout(autoCheckVersions, 2500);
  }

  window.DSH = Object.assign(window.DSH || {}, {
    endpoints: {
      init, render: renderEndpointList,
      current: currentEndpoint,
      all: () => endpoints,
      save: saveEndpoints,
      setActive: setActiveEndpoint,
      updateUI: updateEndpointUI,
      currentDshTarget,
      typeLabel
    }
  });
})();
