/* ============================================================
   DSH Launcher · settings.js
   设置 Tab（全屏页，左导航分区）：
   通用（窗口/启动行为/日志/缩放）、外观（看板娘）、
   运行配置（settings.yaml / cordis.patch.yml 编辑器、用量）、
   数据与维护（目录/导入导出/备份/修复）、关于（环境信息）。
   末尾调用 DSH.boot() 启动整个应用。
   ============================================================ */
(function () {
  "use strict";
  const DSH = window.DSH;
  const { $, invoke, escapeHtml, appendLog, showConfirm, copyToClipboard, setSwitch, isSwitchOn } = DSH;

  let launcherPrefs = null;

  function prefs() { return launcherPrefs; }

  /* ================= 看板娘 ================= */
  const KANBAN_KEY = "dsh_launcher_kanban";
  const DEFAULT_KANBAN = { enabled: true, width: 340, opacity: 0.38, position: "rb", avoid: false, customSrc: "", x: null, y: null };
  let kanbanCfg = loadKanban();

  function loadKanban() {
    try { return { ...DEFAULT_KANBAN, ...JSON.parse(localStorage.getItem(KANBAN_KEY) || "{}") }; }
    catch (e) { return { ...DEFAULT_KANBAN }; }
  }
  function saveKanban() { localStorage.setItem(KANBAN_KEY, JSON.stringify(kanbanCfg)); }

  function applyKanban() {
    const img = $("kanbanImg");
    if (!img) return;
    img.classList.toggle("hidden", !kanbanCfg.enabled);
    if (kanbanCfg.x != null) {
      img.style.right = "auto"; img.style.bottom = "auto";
      img.style.left = kanbanCfg.x + "px"; img.style.top = kanbanCfg.y + "px";
    } else {
      img.style.left = ""; img.style.top = ""; img.style.right = ""; img.style.bottom = "";
      img.classList.toggle("lb", kanbanCfg.position === "lb");
    }
    document.documentElement.style.setProperty("--kanban-width", kanbanCfg.width + "px");
    document.documentElement.style.setProperty("--kanban-opacity", kanbanCfg.opacity);
    document.documentElement.style.setProperty("--kanban-bottom", kanbanCfg.avoid ? "64px" : "24px");
    if (kanbanCfg.customSrc) img.src = kanbanCfg.customSrc;
    setSwitch("swKanban", kanbanCfg.enabled);
    const ks = $("kanbanSize"); if (ks) ks.value = kanbanCfg.width;
    const ksv = $("kanbanSizeVal"); if (ksv) ksv.textContent = kanbanCfg.width + "px";
    const ko = $("kanbanOpacity"); if (ko) ko.value = Math.round(kanbanCfg.opacity * 100);
    const kov = $("kanbanOpacityVal"); if (kov) kov.textContent = kanbanCfg.opacity.toFixed(2);
    const kp = $("kanbanPosition"); if (kp) kp.value = kanbanCfg.position;
    setSwitch("swKanbanAvoid", kanbanCfg.avoid);
  }

  let kanbanEditing = false, kanbanDragging = false, kanbanDragOffset = { x: 0, y: 0 };

  function wireKanban() {
    const img = $("kanbanImg");
    if (!img) return;
    img.addEventListener("error", () => { img.style.display = "none"; });
    const sw = $("swKanban");
    if (sw) sw.onclick = function () { kanbanCfg.enabled = !kanbanCfg.enabled; saveKanban(); applyKanban(); };
    const size = $("kanbanSize");
    if (size) size.oninput = function () {
      kanbanCfg.width = +this.value;
      const v = $("kanbanSizeVal"); if (v) v.textContent = this.value + "px";
      applyKanban();
    };
    if (size) size.onchange = saveKanban;
    const op = $("kanbanOpacity");
    if (op) op.oninput = function () {
      kanbanCfg.opacity = +this.value / 100;
      const v = $("kanbanOpacityVal"); if (v) v.textContent = kanbanCfg.opacity.toFixed(2);
      applyKanban();
    };
    if (op) op.onchange = saveKanban;
    const pos = $("kanbanPosition");
    if (pos) pos.onchange = function () { kanbanCfg.position = this.value; kanbanCfg.x = null; kanbanCfg.y = null; saveKanban(); applyKanban(); };
    const avoid = $("swKanbanAvoid");
    if (avoid) avoid.onclick = function () { kanbanCfg.avoid = !kanbanCfg.avoid; saveKanban(); applyKanban(); };
    const reset = $("btnKanbanReset");
    if (reset) reset.onclick = function () {
      kanbanCfg = { ...DEFAULT_KANBAN };
      saveKanban(); applyKanban();
      appendLog("[启动器] 看板娘已恢复默认设置", "log-stop");
    };
    const pick = $("btnKanbanPick");
    if (pick) pick.onclick = async function () {
      if (DSH.HAS_TAURI) {
        const path = await invoke("pick_file", { filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg"] }] });
        if (path) { kanbanCfg.customSrc = path; saveKanban(); applyKanban(); }
      } else {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*";
        input.onchange = e => {
          const f = e.target.files[0];
          if (f) {
            const r = new FileReader();
            r.onload = ev => { kanbanCfg.customSrc = ev.target.result; saveKanban(); applyKanban(); };
            r.readAsDataURL(f);
          }
        };
        input.click();
      }
    };
    const editPos = $("btnEditKanbanPos");
    if (editPos) editPos.onclick = function () {
      kanbanEditing = true;
      img.classList.add("draggable");
      appendLog("[启动器] 看板娘可自由拖拽，拖到合适位置后点击“确定位置”锁定", "log-stop");
    };
    const lockPos = $("btnLockKanbanPos");
    if (lockPos) lockPos.onclick = function () {
      kanbanEditing = false; kanbanDragging = false;
      img.classList.remove("draggable");
      saveKanban();
      appendLog("[启动器] 看板娘位置已锁定", "log-ready");
    };
    img.addEventListener("pointerdown", e => {
      if (!kanbanEditing) return;
      kanbanDragging = true;
      const r = img.getBoundingClientRect();
      kanbanDragOffset = { x: e.clientX - r.left, y: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener("pointermove", e => {
      if (!kanbanDragging) return;
      kanbanCfg.x = Math.max(0, Math.round(e.clientX - kanbanDragOffset.x));
      kanbanCfg.y = Math.max(0, Math.round(e.clientY - kanbanDragOffset.y));
      applyKanban();
    });
    window.addEventListener("pointerup", () => { kanbanDragging = false; });
  }

  /* ================= 通用偏好 ================= */
  const DEFAULT_LAUNCHER_PREFS = {
    endpoints: [], close_behavior: "tray", single_instance: true, remember_window: true,
    auto_start: false, auto_open_browser: false, always_on_top: false,
    ui_zoom: 1, ui_zoom_locked: false, port_policy: "takeover",
    save_log: true, log_retention_days: 15,
    window: { x: null, y: null, width: 960, height: 720 }
  };

  async function loadLauncherPrefs() {
    try { launcherPrefs = await invoke("get_launcher_prefs"); }
    catch (e) { launcherPrefs = { ...DEFAULT_LAUNCHER_PREFS }; }
    const cb = $("closeBehavior"); if (cb) cb.value = launcherPrefs.close_behavior || "tray";
    const lb = $("launchBehavior"); if (lb) lb.value = launcherPrefs.auto_start ? "auto" : "manual";
    setSwitch("swAutoBrowser", !!launcherPrefs.auto_open_browser);
    setSwitch("swRememberWin", launcherPrefs.remember_window !== false);
    setSwitch("swAlwaysOnTop", !!launcherPrefs.always_on_top);
    setSwitch("swSaveLog", launcherPrefs.save_log !== false);
    const lr = $("logRetention"); if (lr) lr.value = String(launcherPrefs.log_retention_days || 15);
    const pp = $("portPolicy"); if (pp) pp.value = launcherPrefs.port_policy || "takeover";
    const si = $("swSingleInstance");
    if (si) {
      setSwitch("swSingleInstance", true);
      si.classList.add("locked");
      si.title = "当前版本固定开启，避免多实例";
    }
    applyUiZoom();
  }

  async function saveLauncherPrefs() {
    if (!launcherPrefs) return;
    const eps = DSH.endpoints ? DSH.endpoints.all() : [];
    launcherPrefs.endpoints = eps;
    launcherPrefs.auto_start = ($("launchBehavior") || {}).value === "auto";
    launcherPrefs.auto_open_browser = isSwitchOn("swAutoBrowser");
    launcherPrefs.close_behavior = ($("closeBehavior") || {}).value;
    launcherPrefs.remember_window = isSwitchOn("swRememberWin");
    launcherPrefs.always_on_top = isSwitchOn("swAlwaysOnTop");
    launcherPrefs.ui_zoom = parseInt(($("uiZoom") || {}).value || "100", 10) / 100;
    launcherPrefs.ui_zoom_locked = isSwitchOn("swLockZoom");
    launcherPrefs.save_log = isSwitchOn("swSaveLog");
    launcherPrefs.log_retention_days = parseInt(($("logRetention") || {}).value || "15", 10);
    launcherPrefs.port_policy = ($("portPolicy") || {}).value;
    launcherPrefs.single_instance = true;
    try { await invoke("set_launcher_prefs", { prefsJson: launcherPrefs }); }
    catch (e) { appendLog("保存偏好失败：" + e, "log-error"); }
  }

  function applyUiZoom() {
    const z = (launcherPrefs && typeof launcherPrefs.ui_zoom === "number" && launcherPrefs.ui_zoom > 0) ? launcherPrefs.ui_zoom : 1;
    document.documentElement.style.setProperty("--ui-zoom", String(z));
    const uz = $("uiZoom"); if (uz) uz.value = Math.round(z * 100);
    const uzv = $("uiZoomVal"); if (uzv) uzv.textContent = Math.round(z * 100) + "%";
    const locked = !!(launcherPrefs && launcherPrefs.ui_zoom_locked);
    setSwitch("swLockZoom", locked);
    if (uz) uz.disabled = locked;
  }

  function wireGeneral() {
    const uz = $("uiZoom");
    if (uz) {
      uz.addEventListener("input", function () {
        document.documentElement.style.setProperty("--ui-zoom", String(+this.value / 100));
        const v = $("uiZoomVal"); if (v) v.textContent = this.value + "%";
      });
      uz.addEventListener("change", function () { launcherPrefs.ui_zoom = +this.value / 100; saveLauncherPrefs(); });
    }
    const lock = $("swLockZoom");
    if (lock) lock.addEventListener("click", () => {
      const on = !isSwitchOn("swLockZoom");
      setSwitch("swLockZoom", on);
      const el = $("uiZoom"); if (el) el.disabled = on;
      launcherPrefs.ui_zoom_locked = on;
      saveLauncherPrefs();
    });
    const rz = $("btnResetZoom");
    if (rz) rz.addEventListener("click", () => {
      launcherPrefs.ui_zoom = 1;
      launcherPrefs.ui_zoom_locked = false;
      document.documentElement.style.setProperty("--ui-zoom", "1");
      applyUiZoom();
      saveLauncherPrefs();
      appendLog("[缩放] 已恢复默认 100%", "log-stop");
    });
    const wire = (id, fn) => { const el = $(id); if (el) el.addEventListener("change", fn); };
    wire("closeBehavior", saveLauncherPrefs);
    wire("launchBehavior", saveLauncherPrefs);
    wire("logRetention", saveLauncherPrefs);
    wire("portPolicy", saveLauncherPrefs);
    const clicks = [
      ["swAutoBrowser", () => { setSwitch("swAutoBrowser", !isSwitchOn("swAutoBrowser")); saveLauncherPrefs(); }],
      ["swRememberWin", () => { setSwitch("swRememberWin", !isSwitchOn("swRememberWin")); saveLauncherPrefs(); }],
      ["swSaveLog", () => { setSwitch("swSaveLog", !isSwitchOn("swSaveLog")); saveLauncherPrefs(); }],
      ["swAlwaysOnTop", async () => {
        const on = !isSwitchOn("swAlwaysOnTop");
        setSwitch("swAlwaysOnTop", on);
        launcherPrefs.always_on_top = on;
        try {
          await invoke("set_always_on_top", { enabled: on });
          appendLog(on ? "[启动器] 已开启窗口置顶" : "[启动器] 已关闭窗口置顶", "log-stop");
        } catch (e) { appendLog("设置窗口置顶失败：" + e, "log-error"); }
      }],
      ["swAutoStart", async () => {
        const on = !isSwitchOn("swAutoStart");
        setSwitch("swAutoStart", on);
        try {
          await invoke("set_autostart", { enabled: on });
          appendLog(on ? "[启动器] 已开启开机自启动" : "[启动器] 已关闭开机自启动", "log-ready");
        } catch (e) { appendLog("设置开机自启动失败：" + e, "log-error"); }
      }]
    ];
    clicks.forEach(([id, fn]) => { const el = $(id); if (el) el.addEventListener("click", fn); });
    const cc = $("btnClearCache");
    if (cc) cc.addEventListener("click", () => showConfirm("清空启动器缓存", "确定清空启动器缓存吗？会重置偏好并清理日志，之后界面刷新。", async () => {
      try {
        await invoke("clear_launcher_cache");
        localStorage.clear();
        appendLog("[缓存] 已清空，界面即将刷新", "log-stop");
        setTimeout(() => location.reload(), 500);
      } catch (e) { appendLog("清空失败：" + e, "log-error"); }
    }));
    const old = $("btnOpenLogDir");
    if (old) old.addEventListener("click", () => invoke("open_logs_dir"));
  }

  /* ================= 运行配置 ================= */
  async function loadDshSettings() {
    try { const el = $("dshSettingsText"); if (el) el.value = await invoke("get_dsh_settings"); }
    catch (e) { const el = $("dshSettingsText"); if (el) el.value = "读取失败：" + e; }
  }
  async function loadCordis() {
    try { const el = $("cordisPatchText"); if (el) el.value = await invoke("get_cordis_patch"); }
    catch (e) { const el = $("cordisPatchText"); if (el) el.value = "读取失败：" + e; }
  }
  function wireRuntime() {
    const rs = $("btnReloadDshSettings");
    if (rs) rs.addEventListener("click", loadDshSettings);
    const ss = $("btnSaveDshSettings");
    if (ss) ss.addEventListener("click", async () => {
      try {
        await invoke("set_dsh_settings", { text: $("dshSettingsText").value });
        appendLog("[配置] settings.yaml 已保存（已自动备份），重启 DSH 后生效", "log-ready");
      } catch (e) { appendLog("保存失败：" + e, "log-error"); }
    });
    const rc = $("btnReloadCordis");
    if (rc) rc.addEventListener("click", loadCordis);
    const sc = $("btnSaveCordis");
    if (sc) sc.addEventListener("click", async () => {
      try {
        await invoke("set_cordis_patch", { text: $("cordisPatchText").value });
        appendLog("[配置] cordis.patch.yml 已保存（已自动备份），重启 DSH 后生效", "log-ready");
      } catch (e) { appendLog("保存失败：" + e, "log-error"); }
    });
    const ru = $("btnRefreshUsage");
    if (ru) ru.addEventListener("click", refreshUsage);
    const eu = $("btnExportUsage");
    if (eu) eu.addEventListener("click", () => appendLog("[用量] 用量统计尚未接入，无可导出数据", "log-stop"));
  }
  function refreshUsage() {
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    set("usageToken", "待接入");
    set("usageSession", "待接入");
    set("usagePlugin", "待接入");
    const bars = [["barToken"], ["barSession"], ["barPlugin"]];
    bars.forEach(([id]) => { const el = $(id); if (el) el.style.width = "0%"; });
  }

  /* ================= 数据与维护 ================= */
  function wireMaintenance() {
    document.querySelectorAll(".action-grid button[data-open]").forEach(btn => {
      btn.onclick = () => {
        const map = {
          sessions: "打开 DSH 会话目录", plugins: "打开插件安装目录", settings: "打开 DSH 配置文件",
          logs: "打开启动器日志目录", dshhome: "打开 DSH_HOME", trash: "打开会话回收站"
        };
        const ep = DSH.endpoints ? DSH.endpoints.current() : null;
        appendLog(`[维护] ${map[btn.dataset.open]}（端：${ep ? ep.name : ""}）`, "log-stop");
        if (DSH.HAS_TAURI) invoke("open_path", { path: btn.dataset.open, endpoint_id: ep ? ep.id : "" });
      };
    });

    const exp = $("btnExportConfig");
    if (exp) exp.addEventListener("click", async () => {
      try {
        const incLauncher = ($("expLauncher") || {}).checked !== false;
        const incDsh = ($("expDsh") || {}).checked !== false;
        const incEndpoints = ($("expEndpoints") || {}).checked !== false;
        const out = { version: 2, exportedAt: new Date().toISOString() };
        if (incEndpoints) {
          out.local_prefs = {
            kanban: localStorage.getItem(KANBAN_KEY),
            endpoints: localStorage.getItem("dsh_launcher_endpoints"),
            drawer: localStorage.getItem("dsh_launcher_drawer_width")
          };
        }
        if (incLauncher) out.launcher_prefs = await invoke("get_launcher_prefs").catch(() => null);
        if (incDsh) {
          out.dsh_settings = await invoke("get_dsh_settings");
          out.cordis_patch = await invoke("get_cordis_patch").catch(() => null);
        }
        const data = JSON.stringify(out, null, 2);
        const p = await invoke("save_text_file", { defaultName: "dsh-launcher-config.json", content: data });
        if (p) appendLog("[维护] 配置已导出：" + p, "log-ready");
      } catch (e) { appendLog("导出失败：" + e, "log-error"); }
    });

    const imp = $("btnImportConfig");
    if (imp) imp.addEventListener("click", async () => {
      try {
        const content = await invoke("pick_and_read_config");
        if (!content) return;
        const data = JSON.parse(content);
        const incLauncher = ($("expLauncher") || {}).checked !== false;
        const incDsh = ($("expDsh") || {}).checked !== false;
        const incEndpoints = ($("expEndpoints") || {}).checked !== false;
        if (data.version >= 2) {
          if (incEndpoints && data.local_prefs) {
            if (data.local_prefs.kanban) localStorage.setItem(KANBAN_KEY, data.local_prefs.kanban);
            if (data.local_prefs.endpoints) localStorage.setItem("dsh_launcher_endpoints", data.local_prefs.endpoints);
            if (data.local_prefs.drawer) localStorage.setItem("dsh_launcher_drawer_width", data.local_prefs.drawer);
          }
          if (incLauncher && data.launcher_prefs && typeof data.launcher_prefs === "object") {
            await invoke("set_launcher_prefs", { prefsJson: data.launcher_prefs });
          }
        } else {
          if (incEndpoints && data.launcher_prefs) {
            if (data.launcher_prefs.kanban) localStorage.setItem(KANBAN_KEY, data.launcher_prefs.kanban);
            if (data.launcher_prefs.endpoints) localStorage.setItem("dsh_launcher_endpoints", data.launcher_prefs.endpoints);
            if (data.launcher_prefs.drawer) localStorage.setItem("dsh_launcher_drawer_width", data.launcher_prefs.drawer);
          }
        }
        if (incDsh && data.dsh_settings !== undefined) await invoke("set_dsh_settings", { text: data.dsh_settings });
        if (incDsh && data.cordis_patch !== undefined) await invoke("set_cordis_patch", { text: data.cordis_patch });
        appendLog("[维护] 配置已导入，界面即将刷新", "log-ready");
        setTimeout(() => location.reload(), 600);
      } catch (e) { appendLog("导入失败：" + e, "log-error"); }
    });

    const rui = $("btnResetUI");
    if (rui) rui.addEventListener("click", () => showConfirm("重置外观与偏好", "确定要重置启动器外观与偏好设置吗？看板娘、窗口、启动行为将恢复默认（多端列表保留）。", async () => {
      kanbanCfg = { ...DEFAULT_KANBAN }; saveKanban(); applyKanban();
      localStorage.removeItem("dsh_launcher_drawer_width");
      try { await invoke("set_launcher_prefs", { prefsJson: JSON.parse(JSON.stringify(DEFAULT_LAUNCHER_PREFS)) }); }
      catch (e) { appendLog("重置偏好失败：" + e, "log-error"); }
      appendLog("[维护] 外观与偏好已重置", "log-stop");
    }));
    const ren = $("btnResetEndpoints");
    if (ren) ren.addEventListener("click", () => showConfirm("重置多端列表", "确定要重置多端列表吗？将恢复默认的本地 Windows 端，其他端从列表移除（不删除端上的数据）。", () => {
      if (DSH.endpoints) {
        const eps = DSH.endpoints.all();
        eps.splice(0, eps.length, { id: "ep-win", name: "本地 Windows", type: "windows", path: "", port: 3080, workspace: "", dshHome: "", version: "", status: "stopped", active: true, ssh: "" });
        DSH.endpoints.save();
        DSH.endpoints.render();
        DSH.endpoints.updateUI();
      }
      appendLog("[维护] 多端列表已重置", "log-stop");
    }));
    const rd = $("btnResetDsh");
    if (rd) rd.addEventListener("click", () => showConfirm("重置当前端 DSH 配置", "确定要重置当前端 DSH 配置吗？settings.yaml 与 cordis.patch.yml 将恢复为默认，重启 DSH 后生效。", async () => {
      try {
        await invoke("reset_dsh_config");
        appendLog("[维护] settings.yaml 与 cordis.patch.yml 已重置为默认，重启 DSH 后生效", "log-ready");
      } catch (e) { appendLog("重置 DSH 配置失败：" + e, "log-error"); }
    }));
    const ra = $("btnResetAll");
    if (ra) ra.addEventListener("click", () => showConfirm("重置全部配置", "确定要重置全部配置吗？此操作不可撤销，所有设置将恢复默认，界面将刷新。", async () => {
      kanbanCfg = { ...DEFAULT_KANBAN }; saveKanban(); applyKanban();
      if (DSH.endpoints) {
        const eps = DSH.endpoints.all();
        eps.splice(0, eps.length, { id: "ep-win", name: "本地 Windows", type: "windows", path: "", port: 3080, workspace: "", dshHome: "", version: "", status: "stopped", active: true, ssh: "" });
        DSH.endpoints.save();
      }
      localStorage.removeItem("dsh_launcher_drawer_width");
      try { await invoke("set_launcher_prefs", { prefsJson: JSON.parse(JSON.stringify(DEFAULT_LAUNCHER_PREFS)) }); }
      catch (e) { appendLog("重置偏好失败：" + e, "log-error"); }
      try { await invoke("reset_dsh_config"); }
      catch (e) { appendLog("重置 DSH 配置失败：" + e, "log-error"); }
      location.reload();
    }));
  }

  /* ================= 防崩溃：备份 / 安全模式 ================= */
  async function loadBackupList() {
    const box = $("backupList");
    if (!box) return;
    try {
      const list = await invoke("list_config_backups");
      if (!list || list.length === 0) { box.innerHTML = '<div class="si-desc">暂无备份（修改配置时会自动备份）</div>'; return; }
      box.innerHTML = list.map(b => {
        const d = new Date(b.timestamp);
        const ts = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const tags = [];
        if (b.has_settings) tags.push("settings");
        if (b.has_patch) tags.push("patch");
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
          <span><b>${ts}</b> <span style="color:var(--text-secondary)">${escapeHtml(b.label)}</span> <span style="color:var(--text-secondary);font-size:11px">[${tags.join(",")}]</span></span>
          <button class="btn-small" data-restore="${b.timestamp}">恢复</button>
        </div>`;
      }).join("");
      box.querySelectorAll("button[data-restore]").forEach(btn => {
        btn.onclick = () => {
          const ts = btn.dataset.restore;
          showConfirm("恢复配置备份", "确定要恢复该备份吗？当前 settings.yaml 与 cordis.patch.yml 将被覆盖，重启 DSH 后生效。", async () => {
            try {
              await invoke("restore_config_backup", { timestamp: ts });
              appendLog("[防崩溃] 已恢复配置备份 " + ts, "log-ready");
              loadBackupList();
            } catch (e) { appendLog("[防崩溃] 恢复失败：" + e, "log-error"); }
          });
        };
      });
    } catch (e) { box.innerHTML = '<div class="si-desc">加载失败：' + escapeHtml(String(e)) + '</div>'; }
  }

  function wireCrashguard() {
    const bn = $("btnBackupNow");
    if (bn) bn.addEventListener("click", async () => {
      try {
        const ts = await invoke("backup_config_now", { label: "用户手动备份" });
        appendLog("[防崩溃] 已创建配置备份 " + ts, "log-ready");
        loadBackupList();
      } catch (e) { appendLog("[防崩溃] 备份失败：" + e, "log-error"); }
    });
    const sm = $("btnSafeMode");
    if (sm) sm.addEventListener("click", () => {
      showConfirm("安全模式启动", "安全模式会临时移走当前配置（settings.yaml / cordis.patch.yml），用默认空配置启动 DSH。原配置会保留，可随时「退出安全模式」恢复。确定继续吗？", async () => {
        try {
          await invoke("start_harness_safe", {});
          appendLog("[安全模式] 已用默认配置启动 DSH", "log-ready");
          const s = $("btnSafeMode"); if (s) s.style.display = "none";
          const e = $("btnExitSafeMode"); if (e) e.style.display = "";
        } catch (e2) { appendLog("[安全模式] 启动失败：" + e2, "log-error"); }
      });
    });
    const esm = $("btnExitSafeMode");
    if (esm) esm.addEventListener("click", () => {
      showConfirm("退出安全模式", "将恢复安全模式前的原有配置，重启 DSH 后生效。确定吗？", async () => {
        try {
          const r = await invoke("exit_safe_mode");
          appendLog(r ? "[安全模式] 已恢复原有配置，重启 DSH 后生效" : "[安全模式] 无待恢复的配置", "log-ready");
          const s = $("btnSafeMode"); if (s) s.style.display = "";
          const e = $("btnExitSafeMode"); if (e) e.style.display = "none";
        } catch (e2) { appendLog("[安全模式] 退出失败：" + e2, "log-error"); }
      });
    });
    const rb = $("btnRestoreBundleSnapshot");
    if (rb) rb.addEventListener("click", () => {
      showConfirm("回退 bundle 列表", "将把 profile 的 bundles 与依赖回退到最近一次启动自检通过的快照，重启 DSH 后生效。", async () => {
        try {
          const ok = await invoke("restore_bundle_snapshot");
          if (ok) appendLog("[维护] 已回退到上次可用 bundle 快照，重启 DSH 后生效", "log-ready");
          else appendLog("[维护] 没有可回退的 bundle 快照（与当前一致）", "log-stop");
        } catch (e) { appendLog("[维护] 回退失败：" + e, "log-error"); }
      });
    });
    // 初始化时检查是否处于安全模式
    (async () => {
      try {
        const safe = await invoke("is_safe_mode");
        if (safe) {
          const s = $("btnSafeMode"); if (s) s.style.display = "none";
          const e = $("btnExitSafeMode"); if (e) e.style.display = "";
        }
      } catch (e) { /* ignore */ }
    })();
  }

  /* ================= 关于 / 环境信息 ================= */
  async function loadEnvInfo() {
    const box = $("envInfo");
    if (!box) return;
    box.innerHTML = '<div class="si-desc">加载中...</div>';
    let info = {}, version = "";
    try { info = await invoke("get_env_info"); }
    catch (e) { box.innerHTML = '<div class="si-desc">读取环境信息失败：' + escapeHtml(String(e)) + '</div>'; return; }
    try { const v = await invoke("dsh_version"); version = v.version || ""; } catch (e) { }
    const rows = [
      { label: "DSH 路径", value: info.dsh_path || "未检测到", dir: null },
      { label: "DSH 版本", value: version || "未知", dir: null },
      { label: "DSH_HOME", value: info.dsh_home || "", dir: info.dsh_home || "" },
      { label: "安装目录", value: info.install_dir || "", dir: info.install_dir || "" },
      { label: "访问端口", value: String(info.port || 3080), dir: null },
      { label: "日志目录", value: info.logs_dir || "", dir: info.logs_dir || "" },
      { label: "会话目录", value: info.sessions_dir || "", dir: info.sessions_dir || "" },
      { label: "启动器程序", value: info.exe_path || "", dir: info.exe_path ? (info.exe_path.replace(/[\\/][^\\/]*$/, "")) : null }
    ];
    box.innerHTML = "";
    rows.forEach(r => {
      const row = document.createElement("div");
      row.className = "env-row";
      const label = document.createElement("div");
      label.className = "env-k";
      label.textContent = r.label;
      const val = document.createElement("div");
      val.className = "env-v";
      val.textContent = r.value;
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn-small";
      copyBtn.textContent = "复制";
      copyBtn.onclick = () => copyToClipboard(r.value, r.label);
      row.appendChild(label); row.appendChild(val); row.appendChild(copyBtn);
      if (r.dir) {
        const openBtn = document.createElement("button");
        openBtn.className = "btn-small";
        openBtn.textContent = "打开";
        openBtn.onclick = async () => {
          try { await invoke("open_dir", { path: r.dir }); }
          catch (e) { appendLog("打开失败：" + e, "log-error"); }
        };
        row.appendChild(openBtn);
      }
      box.appendChild(row);
    });
  }

  /* ================= 设置导航 / 抽屉开关 ================= */
  function switchSection(sec) {
    document.querySelectorAll(".set-nav .nav-item").forEach(n => n.classList.remove("active"));
    const nav = document.querySelector(`.set-nav .nav-item[data-sec="${sec}"]`);
    if (nav) nav.classList.add("active");
    document.querySelectorAll(".set-section").forEach(s => s.classList.remove("active"));
    const secEl = document.querySelector(`.set-section[data-sec="${sec}"]`);
    if (secEl) secEl.classList.add("active");
    if (sec === "runtime") { refreshUsage(); loadDshSettings(); loadCordis(); loadCurrentModel(); }
    if (sec === "maintenance") loadBackupList();
    if (sec === "about") loadEnvInfo();
  }

  function openSettings() {
    const mask = $("settingsMask");
    const drawer = $("settingsDrawer");
    if (mask) mask.classList.add("show");
    if (drawer) drawer.classList.add("show");
    // 打开时刷新当前分区数据
    const active = document.querySelector(".set-nav .nav-item.active");
    switchSection(active ? active.dataset.sec : "general");
    if (window.DSH.endpoints) DSH.endpoints.render();
  }
  function closeSettings() {
    const mask = $("settingsMask");
    const drawer = $("settingsDrawer");
    if (mask) mask.classList.remove("show");
    if (drawer) drawer.classList.remove("show");
  }

  function wireSettingsNav() {
    document.querySelectorAll(".set-nav .nav-item").forEach(item => {
      item.onclick = () => switchSection(item.dataset.sec);
    });
    const ob = $("btnOpenSettings");
    if (ob) ob.addEventListener("click", openSettings);
    const cb = $("settingsClose");
    if (cb) cb.addEventListener("click", closeSettings);
    const mk = $("settingsMask");
    if (mk) mk.addEventListener("click", closeSettings);
  }

  /* ================= 当前模型（来自 settings.yaml） ================= */
  async function loadCurrentModel() {
    const el = $("curModel");
    if (!el) return;
    try {
      const text = await invoke("get_dsh_settings") || "";
      const m = text.match(/agent-default-model:\s*\n\s*provider:\s*(\S+)\s*\n\s*model:\s*(\S+)/);
      if (m) el.textContent = `${m[1]} / ${m[2]}`;
      else el.textContent = "（未配置）";
    } catch (e) { el.textContent = "读取失败"; }
  }

  /* ================= 初始化 ================= */
  function init() {
    applyKanban();
    wireKanban();
    wireGeneral();
    wireRuntime();
    wireMaintenance();
    wireCrashguard();
    wireSettingsNav();
    loadLauncherPrefs();
    loadBackupList();
    loadEnvInfo();
  }

  window.DSH = Object.assign(window.DSH || {}, {
    settings: {
      init,
      onOpen: () => { loadEnvInfo(); },
      prefs
    }
  });
})();

/* ================= 应用启动 ================= */
window.DSH.boot();
