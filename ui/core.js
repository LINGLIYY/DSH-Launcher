/* ============================================================
   DSH Launcher · core.js
   基础层：Tauri 兼容 invoke、DOM/日志/确认工具、事件流、启动编排。
   其余模块（endpoints/console/sessions/capabilities/settings）
   均通过 window.DSH 命名空间访问本层。
   ============================================================ */
(function () {
  "use strict";

  const HAS_TAURI = !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);

  // 尚未在 DSH 官方能力中确认/未实现后端的功能：仅原型预览，Tauri 环境回退为空数据
  const PROTO_CMDS = new Set([
    "reload_plugin",
    "get_plugin_config", "set_plugin_config", "import_local_plugin",
    "toggle_skill", "get_skill_config", "set_skill_config",
    "toggle_mcp", "test_mcp", "add_mcp", "remove_mcp",
    "get_usage_stats", "get_usage_limits", "set_usage_limits",
    "export_config", "import_config", "reset_config",
    "list_endpoints", "add_endpoint", "update_endpoint", "remove_endpoint", "set_active_endpoint"
  ]);

  // 浏览器预览 MOCK：仅返回空数据，不展示伪造内容
  const MOCK = {
    get_state: () => ({ status: "stopped", host: "127.0.0.1", port: 3080,
      url: "http://127.0.0.1:3080/", dsh_home: "", dsh_path: "" }),
    start_harness: () => ({ status: "starting" }),
    stop_harness: () => ({ status: "stopped" }),
    list_plugins: () => [], list_skills: () => [], list_mcp: () => [],
    list_sessions: () => [], get_session: () => [], get_market: () => [],
    scan_wsl: () => [], list_endpoints: () => [], get_usage_stats: () => null,
    get_usage_limits: () => null, get_dsh_settings: () => null
  };

  async function invoke(cmd, args) {
    if (HAS_TAURI) {
      if (PROTO_CMDS.has(cmd)) return Promise.reject(new Error("该操作待接入 DSH 官方能力"));
      return window.__TAURI__.core.invoke(cmd, args);
    }
    return MOCK[cmd] ? MOCK[cmd](args) : Promise.resolve(null);
  }

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtTime(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  /* ---------- 日志 ---------- */
  let logLines = 0;
  function appendLog(text, cls) {
    const box = $("logContent");
    if (!box) return;
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text + "\n";
    box.appendChild(s);
    box.scrollTop = box.scrollHeight;
    logLines++;
    const c = $("logLineCount");
    if (c) c.textContent = logLines;
  }

  /* ---------- 确认弹窗 ---------- */
  function showConfirm(title, msg, onOk) {
    const pr = $("promptRow");
    if (pr) pr.style.display = "none";
    const cr = $("confirmCheckRow");
    if (cr) cr.style.display = "none";
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = msg;
    $("confirmModal").classList.add("show");
    $("confirmOk").onclick = () => { $("confirmModal").classList.remove("show"); onOk && onOk(); };
    $("confirmCancel").onclick = () => $("confirmModal").classList.remove("show");
  }

  // 带复选框的确认（如"同时卸载 DSH 本体"），onOk(checked)
  function confirmCheckDialog(title, msg, checkLabel, onOk) {
    const cr = $("confirmCheckRow");
    const cb = $("confirmCheck");
    const cl = $("confirmCheckLabel");
    const pr = $("promptRow");
    if (pr) pr.style.display = "none";
    if (cr && cb && cl) {
      cb.checked = false;
      cl.textContent = checkLabel || "";
      cr.style.display = "flex";
    }
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = msg;
    $("confirmModal").classList.add("show");
    const finish = () => {
      const v = cb ? cb.checked : false;
      if (cr) cr.style.display = "none";
      $("confirmModal").classList.remove("show");
      onOk(v);
    };
    $("confirmOk").onclick = finish;
    $("confirmCancel").onclick = finish;
  }

  // 带输入框的确认（WebView2 下 window.prompt 不可用，用内置弹窗代替）
  function promptDialog(title, msg, defValue, onOk) {
    const pr = $("promptRow");
    const pi = $("promptInput");
    if (!pr || !pi) { showConfirm(title, msg, () => onOk("")); return; }
    pi.value = defValue == null ? "" : String(defValue);
    pr.style.display = "block";
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = msg;
    $("confirmModal").classList.add("show");
    const finish = v => { pr.style.display = "none"; $("confirmModal").classList.remove("show"); onOk(v); };
    $("confirmOk").onclick = () => finish(pi.value);
    $("confirmCancel").onclick = () => finish(null);
    setTimeout(() => { pi.focus(); pi.select(); }, 50);
  }

  /* ---------- 日志翻译（pnpm / dsh 原始输出 → 中文进度） ---------- */
  function translatePluginLine(body) {
    if (/^Progress:/.test(body)) {
      const done = /done/.test(body);
      const n = (body.match(/resolved\s+(\d+)/) || [])[1] || "?";
      const d = (body.match(/downloaded\s+(\d+)/) || [])[1] || "0";
      return done ? `✅ 依赖解析完成（共解析 ${n} 个包）` : `⏳ 依赖进度：已解析 ${n} 个包（下载 ${d}）`;
    }
    if (/^Packages:/.test(body)) return `✅ 依赖变更：${body.replace(/^Packages:/, "").trim()}`;
    if (body.includes("node_modules/") && /(install|build)\$/.test(body)) {
      const pkg = (body.split("node_modules/")[1] || "").split(/[\/ ]/)[0] || "?";
      return `🔨 构建脚本：${pkg}`;
    }
    if (body.includes("git-hosted plugins build on install")) return "⚠️ git 源插件构建脚本被 pnpm 拦截（可在确认弹窗中放行后自动重试）";
    if (body.startsWith("dsh: pnpm failed")) return "❌ pnpm 安装失败，原因见下方输出";
    if (body.includes("Lockfile passes")) return null;
    if (body.trim().startsWith("[WARN]")) return null;
    return body;
  }
  function explainInstallError(msg) {
    if (msg.includes("Failed to connect") || msg.includes("Couldn't connect") || msg.includes("connect timed out")) return "网络无法连接 GitHub（请检查网络或加速器后重试）";
    if (msg.includes("UNABLE_TO_VERIFY") || msg.includes("local issuer certificate")) return "SSL 证书验证失败（加速器/代理证书未被信任：请关闭加速器，或为 git 导入其 CA 证书）";
    if (msg.includes("ENOTFOUND")) return "DNS 解析失败（请检查网络）";
    if (msg.includes("ETIMEDOUT")) return "连接超时（请检查网络或加速器）";
    if (msg.includes("ERR_PNPM_GIT_RESOLVE_FAILED")) return "GitHub 仓库解析失败（多为网络问题）";
    if (msg.includes("ENOENT")) return "缺少依赖工具（如 git/pnpm），请确认已安装";
    return null;
  }

  /* ---------- 复制 ---------- */
  async function copyToClipboard(text, label) {
    if (!text) { appendLog("[复制] 内容为空", "log-stop"); return; }
    try {
      await invoke("copy_text", { text });
      appendLog(`[复制] ${label} 已复制到剪贴板`, "log-stop");
    } catch (e) { appendLog(`[复制] 失败：${e}`, "log-error"); }
  }

  /* ---------- 开关 ---------- */
  function setSwitch(id, on) { const el = $(id); if (el) el.classList.toggle("on", !!on); }
  function isSwitchOn(id) { return !!($(id) && $(id).classList.contains("on")); }

  /* ---------- 事件流监听 ---------- */
  function listenEvents(updateStatus) {
    if (!(HAS_TAURI && window.__TAURI__.event)) return;
    window.__TAURI__.event.listen("harness-log", e => {
      const { level, text } = e.payload;
      const raw = String(text);
      let disp = raw, cls = level === "err" ? "log-error" : level === "ready" ? "log-ready" : "";
      if (raw.startsWith("[插件]")) {
        const tr = translatePluginLine(raw.slice(4));
        if (tr === null) return;
        disp = "[插件] " + tr;
        cls = "log-plugin";
      }
      appendLog(disp, cls);
    });
    window.__TAURI__.event.listen("harness-status", e => {
      const { status } = e.payload;
      if (status === "ready") updateStatus(true, false);
      else if (status === "starting") updateStatus(false, true);
      else updateStatus(false, false);
    });
  }

  /* ---------- 启动编排 ---------- */
  function boot() {
    // 各模块按依赖顺序初始化：endpoints → settings(看板娘/偏好/备份) → console(版本/状态) → capabilities
    if (window.DSH.endpoints) DSH.endpoints.init();
    if (window.DSH.settings) DSH.settings.init();
    if (window.DSH.console) DSH.console.init();
    if (window.DSH.capabilities) DSH.capabilities.init();
    if (window.DSH.sessions) DSH.sessions.init();

    listenEvents(DSH.console ? DSH.console.updateStatus : null);

    // 用真实后端状态回填本地端信息
    (async function initState() {
      try {
        const s = await invoke("get_state");
        const ep = DSH.endpoints ? DSH.endpoints.current() : null;
        if (s && ep) {
          if (s.dsh_home) ep.dshHome = s.dsh_home;
          if (s.dsh_path) ep.path = s.dsh_path;
          if (s.url) {
            const u = $("urlInput"); if (u) u.value = s.url;
          }
          if (s.port) ep.port = s.port;
          DSH.endpoints.save();
          if (s.status === "ready") { if (DSH.console) DSH.console.updateStatus(true, false); }
          else if (s.status === "starting") { if (DSH.console) DSH.console.updateStatus(false, true); }
        }
      } catch (e) { appendLog("初始化状态失败：" + e, "log-error"); }
      try {
        const sessions = await invoke("list_sessions", { filter: "" });
        appendLog("自检: 会话 " + (sessions ? sessions.length : 0) + " 个", "log-stop");
      } catch (e) { /* ignore */ }
    })();
  }

  window.addEventListener("unhandledrejection", e => {
    const msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason);
    try { appendLog("操作待接入：" + msg, "log-stop"); } catch (_) { }
  });

  // 主 Tab 切换（设置页也是 tab，切换时按需加载数据）
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".tab-panel").forEach(c => c.classList.remove("active"));
        const panel = document.querySelector(`.tab-panel[data-tab="${btn.dataset.tab}"]`);
        if (panel) panel.classList.add("active");
        const tab = btn.dataset.tab;
        if (tab === "sessions" && window.DSH.sessions) DSH.sessions.load();
        if (tab === "endpoints" && window.DSH.endpoints) DSH.endpoints.render();
        if (tab === "capabilities" && window.DSH.capabilities) DSH.capabilities.ensureLoaded();
        if (tab === "settings" && window.DSH.settings) DSH.settings.onOpen();
      };
    });
  });

  /* ---------- 能力中心子 Tab ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".sub-tab-btn").forEach(btn => {
      btn.onclick = () => {
        const wrap = btn.closest(".tab-panel[data-tab='capabilities']");
        if (!wrap) return;
        wrap.querySelectorAll(".sub-tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        wrap.querySelectorAll(".sub-tab-content").forEach(c => c.classList.remove("active"));
        const content = wrap.querySelector(`.sub-tab-content[data-sub="${btn.dataset.sub}"]`);
        if (content) content.classList.add("active");
      };
    });
  });

  window.DSH = Object.assign(window.DSH || {}, {
    HAS_TAURI,
    invoke,
    $,
    escapeHtml,
    fmtTime,
    appendLog,
    showConfirm,
    confirmCheckDialog,
    promptDialog,
    translatePluginLine,
    explainInstallError,
    copyToClipboard,
    setSwitch,
    isSwitchOn,
    boot
  });
})();
