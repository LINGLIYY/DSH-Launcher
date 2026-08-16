mod harness;
mod sessions;
mod capabilities;
mod prefs;

use serde::Serialize;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
pub struct LogLine {
    pub level: String,
    pub text: String,
}

pub struct HarnessInner {
    pub status: String,
    pub pid: Option<u32>,
    pub child: Option<std::process::Child>,
    pub host: String,
    pub port: u16,
    pub workspace: String,
    pub dsh_path: String,
    pub dsh_home: String,
    pub log_path: PathBuf,
    pub logs: VecDeque<LogLine>,
    pub wsl_distro: Option<String>,
    pub wsl_port: Option<u16>,
}

impl HarnessInner {
    fn new() -> Self {
        Self {
            status: "stopped".to_string(),
            pid: None,
            child: None,
            host: "127.0.0.1".to_string(),
            port: 7602,
            workspace: default_workspace(),
            dsh_path: String::new(),
            dsh_home: default_dsh_home(),
            log_path: PathBuf::from(default_logs_dir()).join("launcher.log"),
            logs: VecDeque::new(),
            wsl_distro: None,
            wsl_port: None,
        }
    }
}

pub struct HarnessState {
    pub inner: Mutex<HarnessInner>,
}

pub struct PrefsState {
    pub inner: Mutex<prefs::LauncherPrefs>,
}

fn default_dsh_home() -> String {
    std::env::var("APPDATA")
        .map(|a| format!("{}\\dsh-desktop\\harness", a))
        .unwrap_or_else(|_| "C:\\dsh-desktop\\harness".to_string())
}

fn default_logs_dir() -> String {
    std::env::var("APPDATA")
        .map(|a| format!("{}\\dsh-desktop\\logs", a))
        .unwrap_or_else(|_| "C:\\dsh-desktop\\logs".to_string())
}

fn default_workspace() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "C:\\".to_string())
}

#[tauri::command]
fn get_state(state: tauri::State<'_, HarnessState>) -> serde_json::Value {
    let inner = state.inner.lock().unwrap();
    serde_json::json!({
        "status": inner.status,
        "host": inner.host,
        "port": inner.port,
        "workspace": inner.workspace,
        "url": format!("http://{}:{}/", inner.host, inner.port),
        "dsh_home": inner.dsh_home,
        "dsh_path": inner.dsh_path,
    })
}

#[tauri::command]
async fn start_harness(
    app: AppHandle,
    workspace: Option<String>,
    port: Option<u16>,
    endpoint: Option<harness::EndpointSpec>,
) -> Result<serde_json::Value, String> {
    let ws = workspace.unwrap_or_else(default_workspace);
    let port = port.unwrap_or(7602);
    harness::start(app, ws, port, endpoint).await?;
    Ok(serde_json::json!({ "status": "starting" }))
}

#[tauri::command]
async fn stop_harness(app: AppHandle) -> Result<serde_json::Value, String> {
    harness::stop(app).await?;
    Ok(serde_json::json!({ "status": "stopped" }))
}

#[tauri::command]
fn open_browser(state: tauri::State<'_, HarnessState>) -> Result<(), String> {
    let url = {
        let inner = state.inner.lock().unwrap();
        format!("http://{}:{}/", inner.host, inner.port)
    };
    harness::open_url(&url)
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    harness::open_url(&url)
}

#[tauri::command]
fn open_logs_dir(state: tauri::State<'_, HarnessState>) -> Result<(), String> {
    let dir = {
        let inner = state.inner.lock().unwrap();
        inner
            .log_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from(default_logs_dir()))
    };
    harness::open_path(&dir)
}

#[tauri::command]
fn hide_to_tray(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn set_workspace(
    state: tauri::State<'_, HarnessState>,
    path: String,
) -> Result<serde_json::Value, String> {
    {
        let mut inner = state.inner.lock().unwrap();
        inner.workspace = path.clone();
    }
    Ok(serde_json::json!({ "workspace": path }))
}

#[tauri::command]
async fn pick_workspace(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned());
    Ok(picked)
}

#[tauri::command]
async fn pick_file(app: AppHandle, _filters: Option<serde_json::Value>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    Ok(app
        .dialog()
        .file()
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn save_text_file(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file();
    if let Some(fp) = picked {
        if let Ok(path) = fp.into_path() {
            std::fs::write(&path, content).map_err(|e| e.to_string())?;
            return Ok(Some(path.to_string_lossy().into_owned()));
        }
    }
    Ok(None)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let home = default_dsh_home();
    let dir = match path.as_str() {
        "sessions" => format!("{}\\sessions", home),
        "plugins" => format!("{}\\profiles\\web\\plugins", home),
        "logs" => default_logs_dir(),
        "trash" => format!("{}\\sessions_trash", home),
        // settings / dshhome / 其他：统一打开 DSH_HOME 根目录
        _ => home.clone(),
    };
    harness::open_path(std::path::Path::new(&dir))
}

#[tauri::command]
fn list_sessions(filter: Option<String>) -> Result<Vec<sessions::SessionInfo>, String> {
    Ok(sessions::list(filter.unwrap_or_default().as_str()))
}

#[tauri::command]
fn list_plugins() -> Vec<capabilities::PluginInfo> {
    capabilities::list_plugins()
}

#[tauri::command]
fn list_skills() -> Vec<capabilities::SkillInfo> {
    capabilities::list_skills()
}

#[tauri::command]
fn list_mcp() -> Vec<capabilities::McpInfo> {
    capabilities::list_mcp()
}

#[tauri::command]
fn scan_wsl() -> Vec<capabilities::WslInfo> {
    capabilities::scan_wsl()
}

#[tauri::command]
fn ping_endpoint(endpoint: serde_json::Value) -> String {
    capabilities::ping(&endpoint)
}

#[tauri::command]
fn import_plugin(path: String) -> Result<String, String> {
    capabilities::import_plugin(&path)
}

#[tauri::command]
async fn install_market_plugin(target: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capabilities::install_market_plugin(&target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn uninstall_market_plugin(target: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capabilities::uninstall_market_plugin(&target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_plugin(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capabilities::remove_plugin(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_plugin_enabled(id: String, enabled: bool) -> Result<(), String> {
    capabilities::set_plugin_enabled(&id, enabled)
}

#[tauri::command]
fn open_plugin_folder(id: String) -> Result<(), String> {
    capabilities::open_plugin_folder(&id)
}

#[tauri::command]
fn get_dsh_settings() -> Result<String, String> {
    let p = std::path::Path::new(&default_dsh_home()).join("settings.yaml");
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_dsh_settings(text: String) -> Result<(), String> {
    let p = std::path::Path::new(&default_dsh_home()).join("settings.yaml");
    std::fs::write(&p, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_launcher_prefs(state: tauri::State<'_, PrefsState>) -> prefs::LauncherPrefs {
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn set_launcher_prefs(
    state: tauri::State<'_, PrefsState>,
    prefs_json: prefs::LauncherPrefs,
) -> Result<(), String> {
    *state.inner.lock().unwrap() = prefs_json.clone();
    prefs::save(&prefs_json)
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy().into_owned();
    let status = if enabled {
        std::process::Command::new("reg")
            .args([
                "add",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v",
                "DSH Desktop",
                "/t",
                "REG_SZ",
                "/d",
                &exe,
                "/f",
            ])
            .status()
    } else {
        std::process::Command::new("reg")
            .args([
                "delete",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v",
                "DSH Desktop",
                "/f",
            ])
            .status()
    };
    status.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_launcher_cache(state: tauri::State<'_, PrefsState>) -> Result<(), String> {
    let def = prefs::LauncherPrefs::default();
    *state.inner.lock().unwrap() = def.clone();
    prefs::save(&def)?;
    let _ = std::fs::remove_file(prefs::log_dir().join("launcher.log"));
    Ok(())
}

#[tauri::command]
fn get_session(id: String) -> Result<Vec<sessions::Block>, String> {
    sessions::render_by_id(&id)
}

#[tauri::command]
fn delete_session(id: String) -> Result<String, String> {
    sessions::delete_by_id(&id)
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, "show", "显示控制台", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "打开 DSH 界面", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "启动 Harness", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止 Harness", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &open, &start, &stop, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("DSH Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "open" => {
                let url = {
                    let state = app.state::<HarnessState>();
                    let inner = state.inner.lock().unwrap();
                    format!("http://{}:{}/", inner.host, inner.port)
                };
                let _ = harness::open_url(&url);
            }
            "start" => {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    let (ws, port) = {
                        let state = app2.state::<HarnessState>();
                        let inner = state.inner.lock().unwrap();
                        (inner.workspace.clone(), inner.port)
                    };
                    let _ = harness::start(app2, ws, port, None).await;
                });
            }
            "stop" => {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = harness::stop(app2).await;
                });
            }
            "quit" => {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = harness::stop(app2.clone()).await;
                    app2.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState};
            let show_window = |tray: &tauri::tray::TrayIcon| {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            };
            match event {
                tauri::tray::TrayIconEvent::DoubleClick { .. } => show_window(tray),
                tauri::tray::TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => show_window(tray),
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let loaded_prefs = prefs::load();
    let startup_prefs = loaded_prefs.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(HarnessState {
            inner: Mutex::new(HarnessInner::new()),
        })
        .manage(PrefsState {
            inner: Mutex::new(loaded_prefs),
        })
        .setup(move |app| {
            setup_tray(app.handle())?;

            if let Some(w) = app.get_webview_window("main") {
                if startup_prefs.remember_window {
                    let wp = &startup_prefs.window;
                    if let (Some(x), Some(y)) = (wp.x, wp.y) {
                        if x >= 0 && y >= 0 && wp.width <= 3000 && wp.height <= 2000 {
                            let _ = w.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition::new(x, y),
                            ));
                            let _ = w.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                                wp.width,
                                wp.height,
                            )));
                        }
                    }
                }
            }

            // 日志保留期清理
            if startup_prefs.log_retention_days > 0 {
                let days = startup_prefs.log_retention_days as u64;
                let deadline = std::time::SystemTime::now()
                    - std::time::Duration::from_secs(days * 24 * 3600);
                if let Ok(meta) = std::fs::metadata(prefs::log_dir().join("launcher.log")) {
                    if let Ok(m) = meta.modified() {
                        if m < deadline {
                            let _ = std::fs::remove_file(prefs::log_dir().join("launcher.log"));
                        }
                    }
                }
            }

            if startup_prefs.auto_start {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let (ws, port) = {
                        let state = handle.state::<HarnessState>();
                        let inner = state.inner.lock().unwrap();
                        (inner.workspace.clone(), inner.port)
                    };
                    let _ = harness::start(handle, ws, port, None).await;
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                let state = app.state::<PrefsState>();
                let p = state.inner.lock().unwrap().clone();
                if p.remember_window {
                    let maximized = window.is_maximized().unwrap_or(false);
                    if !maximized {
                        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
                            if pos.x >= 0 && pos.y >= 0 && size.width <= 3000 && size.height <= 2000 {
                                let mut np = p.clone();
                                np.window.x = Some(pos.x);
                                np.window.y = Some(pos.y);
                                np.window.width = size.width;
                                np.window.height = size.height;
                                *state.inner.lock().unwrap() = np.clone();
                                let _ = prefs::save(&np);
                            }
                        }
                    }
                }
                if p.close_behavior == "quit" {
                    let app2 = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = harness::stop(app2.clone()).await;
                        app2.exit(0);
                    });
                } else {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            start_harness,
            stop_harness,
            open_browser,
            open_external,
            open_logs_dir,
            hide_to_tray,
            set_workspace,
            pick_workspace,
            pick_file,
            save_text_file,
            read_text_file,
            open_path,
            list_sessions,
            get_session,
            delete_session,
            list_plugins,
            list_skills,
            list_mcp,
            scan_wsl,
            ping_endpoint,
            import_plugin,
            install_market_plugin,
            uninstall_market_plugin,
            remove_plugin,
            set_plugin_enabled,
            open_plugin_folder,
            get_dsh_settings,
            set_dsh_settings,
            get_launcher_prefs,
            set_launcher_prefs,
            set_autostart,
            clear_launcher_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DSH Desktop");
}
