use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct KanbanPrefs {
    pub enabled: bool,
    pub width: u32,
    pub opacity: f64,
    pub position: String,
    pub avoid: bool,
    pub custom_src: String,
}

impl Default for KanbanPrefs {
    fn default() -> Self {
        Self {
            enabled: true,
            width: 340,
            opacity: 0.38,
            position: "rb".to_string(),
            avoid: false,
            custom_src: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct WindowPrefs {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: u32,
    pub height: u32,
}

impl Default for WindowPrefs {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: 960,
            height: 720,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct LauncherPrefs {
    pub kanban: KanbanPrefs,
    pub endpoints: serde_json::Value,
    pub drawer_width: u32,
    pub close_behavior: String,
    pub single_instance: bool,
    pub remember_window: bool,
    pub auto_start: bool,
    pub auto_open_browser: bool,
    pub port_policy: String,
    pub save_log: bool,
    pub log_retention_days: u32,
    pub window: WindowPrefs,
}

impl Default for LauncherPrefs {
    fn default() -> Self {
        Self {
            kanban: KanbanPrefs::default(),
            endpoints: serde_json::json!([]),
            drawer_width: 440,
            close_behavior: "tray".to_string(),
            single_instance: true,
            remember_window: true,
            auto_start: false,
            auto_open_browser: false,
            port_policy: "takeover".to_string(),
            save_log: true,
            log_retention_days: 15,
            window: WindowPrefs::default(),
        }
    }
}

fn base_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\".to_string());
    PathBuf::from(appdata).join("dsh-desktop")
}

pub fn prefs_path() -> PathBuf {
    base_dir().join("launcher-prefs.json")
}

pub fn log_dir() -> PathBuf {
    base_dir().join("logs")
}

pub fn load() -> LauncherPrefs {
    let path = prefs_path();
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => LauncherPrefs::default(),
    }
}

pub fn save(prefs: &LauncherPrefs) -> Result<(), String> {
    let path = prefs_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let text = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}
