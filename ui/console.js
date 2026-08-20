/* ============================================================
   DSH Launcher · console.js
   控制台 Tab：DSH 启动/停止/强制终止、状态指示、地址、版本、
   日志操作（清空/复制/导出）、事件流状态更新。
   ============================================================ */
(function () {
  "use strict";
  const DSH = window.DSH;
  const { $, invoke, appendLog, showConfirm, copyToClipboard } = DSH;

  let dshRunning = false;

  function ep() { return DSH.endpoints ? DSH.endpoints.current() : null; }

  /* ---------- 状态 ---------- */
  function updateStatus(running, starting) {
    const dot = $("statusDot"), txt = $("statusText");
    if (dot) dot.className = "status-dot" + (starting ? " starting" : running ? " running" : "");
    if (txt) txt.textContent = starting ? "DSH 启动中..." : running ? "DSH 运行中" : "DSH 未运行";
    const cdot = $("ctrlStatusDot"), ctxt = $("ctrlStatusText");
    if (cdot) cdot.className = "ctrl-status-dot" + (starting ? " starting" : running ? " running" : "");
    if (ctxt) ctxt.textContent = starting ? "启动中..." : running ? "运行中" : "未运行";
    const bs = $("btnStart"), bst = $("btnStop");
    if (bs) bs.disabled = running || starting;
    if (bst) bst.disabled = !running;
    const e = ep();
    if (e) { if (running) e.status = "running"; else if (!starting) e.status = "stopped"; }
  }

  /* ---------- 启停 ---------- */
  function wireStartStop() {
    const btnStart = $("btnStart");
    if (btnStart) btnStart.onclick = async function () {
      updateStatus(false, true);
      const e = ep();
      appendLog(`正在启动「${e.name}」的 DSH 基座（端口 ${e.port}）...`, "log-start");
      try {
        await invoke("start_harness", { port: e.port, endpoint_id: e.id, endpoint: e });
        if (!DSH.HAS_TAURI) {
          setTimeout(() => {
            appendLog(`DSH Web 服务就绪：http://127.0.0.1:${e.port}/`, "log-ready");
            appendLog("自动加载 DSH 内置插件与已启用插件");
            updateStatus(true, false); dshRunning = true;
          }, 800);
        }
      } catch (err) {
        appendLog("启动失败：" + err, "log-error");
        if (String(err).includes("已被占用")) {
          appendLog('[提示] 可在「设置 → 通用 → 启动行为」中把端口占用策略改为"自动接管已有实例"，或先停止现有实例再启动', "log-stop");
        }
        updateStatus(false, false);
      }
    };
    const btnStop = $("btnStop");
    if (btnStop) btnStop.onclick = async function () {
      appendLog("正在终止 DSH 所有子进程...");
      try {
        await invoke("stop_harness", { endpoint_id: ep().id });
        if (!DSH.HAS_TAURI) {
          setTimeout(() => { appendLog("DSH 基座已完全停止", "log-stop"); updateStatus(false, false); dshRunning = false; }, 600);
        }
      } catch (err) { appendLog("停止异常：" + err, "log-error"); }
    };
    const btnForce = $("btnForceStop");
    if (btnForce) btnForce.onclick = () => {
      showConfirm("强制终止 DSH", "将强制结束端口上的 DSH 进程（含非启动器托管的外部实例）。正在写入的会话可能被中断，请确认。", async () => {
        appendLog("正在强制终止 DSH 所有进程（含外部实例）...", "log-start");
        try {
          await invoke("stop_harness", { force: true, endpoint_id: ep().id });
          appendLog("已执行强制终止", "log-stop");
          if (!DSH.HAS_TAURI) { updateStatus(false, false); dshRunning = false; }
        } catch (err) { appendLog("强制终止异常：" + err, "log-error"); }
      });
    };
  }

  /* ---------- 版本 / 安装目录 ---------- */
  async function loadDshVersion() {
    try {
      const target = DSH.endpoints ? DSH.endpoints.currentDshTarget() : "";
      const v = await invoke("dsh_version", { distro: target });
      const vt = $("dshVersionText");
      if (vt) { vt.textContent = v.version || "未知"; if (v.path) vt.title = v.path; }
      const cv = $("ctrlVersion");
      if (cv) cv.textContent = v.version || "未知";
      const it = $("dshInstallText");
      const ci = $("ctrlInstallDir");
      if (v.path) {
        const dir = v.path.replace(/[\\/][^\\/]*$/, "");
        if (it) it.value = target ? "WSL：" + target : dir;
        if (ci) ci.textContent = dir;
      }
    } catch (e) {
      const vt = $("dshVersionText");
      if (vt) vt.textContent = "检测失败";
      const cv = $("ctrlVersion");
      if (cv) cv.textContent = "检测失败";
    }
  }

  async function checkDshUpdate() {
    const btn = $("btnCheckDshUpdate");
    if (btn) { btn.disabled = true; btn.textContent = "检查中..."; }
    try {
      const r = await fetch("https://registry.npmjs.org/@deepseek-ai/dsh/latest");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const latest = d.version;
      const inst = ($("dshVersionText") || {}).textContent || "";
      if (!latest) {
        appendLog("[DSH] 无法获取最新版本", "log-error");
        if (btn) { btn.disabled = false; btn.textContent = "检查更新"; }
        return;
      }
      if (inst && inst === latest) {
        appendLog(`[DSH] 已是最新版本 ${latest}`, "log-ready");
        if (btn) { btn.disabled = false; btn.textContent = "已最新"; }
      } else {
        appendLog(`[DSH] 检测到新版本：${inst || "未安装"} → ${latest}，点击「安装 / 更新 DSH」`, "log-stop");
        if (btn) { btn.disabled = false; btn.textContent = "检查更新"; }
      }
    } catch (e) {
      appendLog("[DSH] 检查更新失败：" + e, "log-error");
      if (btn) { btn.disabled = false; btn.textContent = "检查更新"; }
    }
  }

  function wireDshMaintenance() {
    const check = $("btnCheckDshUpdate");
    if (check) check.addEventListener("click", checkDshUpdate);
    const install = $("btnInstallDsh");
    if (install) install.addEventListener("click", () => {
      const target = DSH.endpoints ? DSH.endpoints.currentDshTarget() : "";
      const where = target ? "WSL 发行版 " + target : "Windows 全局";
      showConfirm("安装 / 更新 DSH", `将安装最新版 @deepseek-ai/dsh 到${where}，需要联网，可能需要几分钟。`, async () => {
        const btn = $("btnInstallDsh");
        if (btn) { btn.disabled = true; btn.textContent = "安装中..."; }
        appendLog(`[DSH] 正在安装 / 更新 DSH 本体（${where}）...`, "log-start");
        try {
          const r = await invoke("install_or_update_dsh", { distro: target });
          appendLog(`[DSH] ${r}`, "log-ready");
          await loadDshVersion();
          appendLog("[DSH] 更新完成，请重启 DSH 使新版本生效", "log-stop");
        } catch (err) { appendLog("[DSH] 安装/更新失败：" + err, "log-error"); }
        if (btn) { btn.disabled = false; btn.textContent = "安装 / 更新 DSH"; }
      });
    });
    const reinstall = $("btnReinstallDsh");
    if (reinstall) reinstall.addEventListener("click", () => {
      const target = DSH.endpoints ? DSH.endpoints.currentDshTarget() : "";
      const where = target ? "WSL 发行版 " + target : "Windows 全局";
      showConfirm("重装 DSH", `将静默停止 DSH、卸载后安装最新版 @deepseek-ai/dsh 到${where}。数据目录保留。`, async () => {
        const btn = $("btnReinstallDsh");
        if (btn) { btn.disabled = true; btn.textContent = "重装中..."; }
        appendLog(`[DSH] 正在重装 DSH 本体（${where}：停止→卸载→安装最新）...`, "log-start");
        try {
          await invoke("stop_harness", { force: true, endpoint_id: ep().id });
          const u = await invoke("uninstall_dsh", { distro: target });
          appendLog(`[DSH] 卸载：${u}`, "log-stop");
          const r = await invoke("install_or_update_dsh", { distro: target });
          appendLog(`[DSH] 安装：${r}`, "log-ready");
          await loadDshVersion();
          appendLog("[DSH] 重装完成，请重启 DSH 使新版本生效", "log-stop");
        } catch (err) { appendLog("[DSH] 重装失败：" + err, "log-error"); }
        if (btn) { btn.disabled = false; btn.textContent = "重装 DSH（卸载后装最新版）"; }
      });
    });
    const uninstall = $("btnUninstallDsh");
    if (uninstall) uninstall.addEventListener("click", () => {
      const target = DSH.endpoints ? DSH.endpoints.currentDshTarget() : "";
      const where = target ? "WSL 发行版 " + target : "Windows 全局";
      showConfirm("卸载 DSH", `将静默停止 DSH 并卸载${where}的 @deepseek-ai/dsh。数据目录会保留。`, async () => {
        const btn = $("btnUninstallDsh");
        if (btn) { btn.disabled = true; btn.textContent = "卸载中..."; }
        appendLog(`[DSH] 正在静默停止并卸载 DSH 本体（${where}）...`, "log-start");
        try {
          await invoke("stop_harness", { force: true, endpoint_id: ep().id });
          const r = await invoke("uninstall_dsh", { distro: target });
          appendLog(`[DSH] ${r}`, "log-ready");
          await loadDshVersion();
          appendLog("[DSH] 卸载完成；如需恢复请点「重装 DSH」", "log-stop");
        } catch (err) { appendLog("[DSH] 卸载失败：" + err, "log-error"); }
        if (btn) { btn.disabled = false; btn.textContent = "卸载 DSH"; }
      });
    });
  }

  /* ---------- 日志操作 ---------- */
  function wireLogActions() {
    const clear = $("clearLog");
    if (clear) clear.onclick = () => {
      const box = $("logContent");
      if (box) box.innerHTML = "";
      const c = $("logLineCount");
      if (c) c.textContent = "0";
    };
    const copy = $("copyLog");
    if (copy) copy.onclick = async () => {
      try {
        const t = await invoke("read_launcher_log");
        if (!t) { appendLog("[复制] 日志为空", "log-stop"); return; }
        await copyToClipboard(t, "启动器日志");
      } catch (e) { appendLog("[复制] 读取日志失败：" + e, "log-error"); }
    };
    const exp = $("exportLog");
    if (exp) exp.onclick = async () => {
      try {
        const t = await invoke("read_launcher_log");
        const p = await invoke("save_text_file", { defaultName: "dsh-launcher.log", content: t || "" });
        if (p) appendLog(`[日志] 已导出：${p}`, "log-ready");
      } catch (e) { appendLog("导出日志失败：" + e, "log-error"); }
    };
  }

  /* ---------- 其它控制台动作 ---------- */
  function wireConsoleActions() {
    const openBrowser = () => invoke("open_browser", { endpoint_id: ep().id });
    const openLogs = () => invoke("open_logs_dir");
    const b1 = $("btnOpenBrowserMain");
    if (b1) b1.onclick = openBrowser;
    const b2 = $("btnOpenLogDir2");
    if (b2) b2.onclick = openLogs;
    const b3 = $("btnHideTray");
    if (b3) b3.onclick = () => invoke("hide_to_tray");
    const bc = $("btnCopyUrl");
    if (bc) bc.onclick = () => {
      const u = $("urlInput");
      if (u) copyToClipboard(u.value, "访问地址");
    };
    const bic = $("btnCopyInstall");
    if (bic) bic.onclick = () => {
      const el = $("ctrlInstallDir");
      if (el) copyToClipboard(el.textContent, "DSH 安装目录");
    };
    const bvc = $("btnCopyVersion");
    if (bvc) bvc.onclick = () => {
      const el = $("ctrlVersion");
      if (el) copyToClipboard(el.textContent, "DSH 版本");
    };
  }

  /* ---------- 启动后自动接管：探测当前端端口是否已有 DSH 实例 ---------- */
  async function autoTakeover() {
    const e = ep();
    if (!e) return;
    try {
      const running = await invoke("check_external", { port: e.port });
      if (running) {
        e.status = "running";
        if (DSH.endpoints) DSH.endpoints.save();
        appendLog(`[接管] 检测到 http://127.0.0.1:${e.port}/ 已有 DSH 实例（非本启动器启动），已自动接管`, "log-ready");
        appendLog("[接管] 可点「停止」管理或「强制终止」结束它；点「打开界面」直接使用", "log-stop");
        updateStatus(true, false);
      }
    } catch (err) {
      // 探测失败静默（不打扰用户）
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    wireStartStop();
    wireLogActions();
    wireConsoleActions();
    wireDshMaintenance();
    updateStatus(false, false);
    loadDshVersion();
    appendLog("DSH Launcher 启动器已就绪", "log-ready");
    const e = ep();
    appendLog(`当前端：${e.name}（${DSH.endpoints.typeLabel ? DSH.endpoints.typeLabel(e.type) : e.type}）`, "log-stop");
    appendLog("提示：点击顶部端名称可快速切换端；「设置」中可配置偏好、多端、外观等", "log-stop");
    // 自动接管检测（等界面与后端就绪）
    setTimeout(autoTakeover, 1200);
  }

  window.DSH = Object.assign(window.DSH || {}, {
    console: { init, updateStatus, loadDshVersion }
  });
})();
