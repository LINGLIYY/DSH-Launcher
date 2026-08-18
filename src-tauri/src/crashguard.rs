//! 防崩溃机制：配置自动备份、启动失败检测、安全模式启动。
//!
//! 核心思路：
//! 1. 每次修改 settings.yaml / cordis.patch.yml 前自动备份（保留最近 5 份）
//! 2. 启动 DSH 时连续失败 2 次，自动恢复最近一份可用备份并重试
//! 3. 提供安全模式启动：临时用空配置启动，不破坏用户原有配置

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone)]
pub struct ConfigBackup {
    pub timestamp: u64,
    pub label: String,
    pub has_settings: bool,
    pub has_patch: bool,
    pub size: u64,
}

fn dsh_home() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\".to_string());
    PathBuf::from(base)
        .join("dsh-desktop")
        .join("harness")
}

fn backup_dir() -> PathBuf {
    dsh_home().join("config-backups")
}

fn crash_backup_dir() -> PathBuf {
    dsh_home().join("config-crash-backup")
}

fn settings_path() -> PathBuf {
    dsh_home().join("settings.yaml")
}

fn patch_path() -> PathBuf {
    dsh_home()
        .join("profiles")
        .join("web")
        .join("cordis.patch.yml")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 备份当前配置到 backup_dir/<timestamp>/，保留最近 MAX_BACKUPS 份。
/// 返回备份目录名（时间戳字符串）。
pub fn backup_current(label: &str) -> Result<String, String> {
    let ts = now_ms();
    let dir = backup_dir().join(ts.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let settings = settings_path();
    let patch = patch_path();
    let mut any = false;

    if settings.exists() {
        std::fs::copy(&settings, dir.join("settings.yaml")).map_err(|e| e.to_string())?;
        any = true;
    }
    if patch.exists() {
        // 确保目标目录存在
        if let Some(parent) = dir.join("cordis.patch.yml").parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&patch, dir.join("cordis.patch.yml")).map_err(|e| e.to_string())?;
        any = true;
    }

    // 写入标签
    let label_file = dir.join("label.txt");
    std::fs::write(&label_file, label).map_err(|e| e.to_string())?;

    if !any {
        // 没有配置文件可备份，仍创建空目录标记
        let _ = std::fs::write(dir.join("empty"), "");
    }

    // 清理旧备份，只保留最近 5 份
    cleanup_old_backups(5)?;

    Ok(ts.to_string())
}

fn cleanup_old_backups(keep: usize) -> Result<(), String> {
    let dir = backup_dir();
    if !dir.is_dir() {
        return Ok(());
    }
    let mut entries: Vec<(u64, PathBuf)> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(ts) = entry.file_name().to_string_lossy().parse::<u64>() {
                entries.push((ts, path));
            }
        }
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0)); // 最新在前
    for (_, p) in entries.into_iter().skip(keep) {
        let _ = std::fs::remove_dir_all(&p);
    }
    Ok(())
}

/// 列出所有配置备份，按时间倒序。
pub fn list_backups() -> Vec<ConfigBackup> {
    let dir = backup_dir();
    let mut out = Vec::new();
    if !dir.is_dir() {
        return out;
    }
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let ts = entry.file_name().to_string_lossy().parse::<u64>().unwrap_or(0);
        let label = std::fs::read_to_string(path.join("label.txt"))
            .unwrap_or_else(|_| "手动备份".to_string());
        let has_settings = path.join("settings.yaml").exists();
        let has_patch = path.join("cordis.patch.yml").exists();
        let size = total_dir_size(&path);
        out.push(ConfigBackup {
            timestamp: ts,
            label,
            has_settings,
            has_patch,
            size,
        });
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    out
}

fn total_dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(rd) = std::fs::read_dir(path) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_file() {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            } else if p.is_dir() {
                total += total_dir_size(&p);
            }
        }
    }
    total
}

/// 恢复指定时间戳的备份。
pub fn restore_backup(timestamp: &str) -> Result<(), String> {
    let src = backup_dir().join(timestamp);
    if !src.is_dir() {
        return Err(format!("备份 {timestamp} 不存在"));
    }
    let settings = src.join("settings.yaml");
    let patch = src.join("cordis.patch.yml");

    if settings.exists() {
        if let Some(parent) = settings_path().parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&settings, settings_path()).map_err(|e| e.to_string())?;
    }
    if patch.exists() {
        if let Some(parent) = patch_path().parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&patch, patch_path()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 获取最近一份备份的时间戳（如果有）。
pub fn latest_backup() -> Option<String> {
    list_backups().first().map(|b| b.timestamp.to_string())
}

/// 将当前配置移动到 crash-backup 目录（安全模式用），返回是否移动了文件。
/// 不删除，只是重命名，方便恢复。
pub fn stash_current_for_safe_mode() -> Result<bool, String> {
    let crash_dir = crash_backup_dir();
    // 清理旧的 crash backup
    if crash_dir.exists() {
        let _ = std::fs::remove_dir_all(&crash_dir);
    }
    std::fs::create_dir_all(&crash_dir).map_err(|e| e.to_string())?;

    let mut moved = false;
    let settings = settings_path();
    let patch = patch_path();

    if settings.exists() {
        std::fs::copy(&settings, crash_dir.join("settings.yaml")).map_err(|e| e.to_string())?;
        std::fs::remove_file(&settings).map_err(|e| e.to_string())?;
        moved = true;
    }
    if patch.exists() {
        if let Some(parent) = crash_dir.join("cordis.patch.yml").parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&patch, crash_dir.join("cordis.patch.yml")).map_err(|e| e.to_string())?;
        std::fs::remove_file(&patch).map_err(|e| e.to_string())?;
        moved = true;
    }

    // 写入空 settings.yaml（DSH 按默认值运行）
    crate::prefs::atomic_write(&settings, "")?;
    // 写入默认 cordis.patch.yml
    let template = "# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n";
    if let Some(parent) = patch_path().parent() {
        std::fs::create_dir_all(parent).ok();
    }
    crate::prefs::atomic_write(&patch, template)?;

    Ok(moved)
}

/// 从 crash-backup 恢复原有配置（安全模式退出后调用）。
pub fn restore_from_crash_backup() -> Result<bool, String> {
    let crash_dir = crash_backup_dir();
    if !crash_dir.is_dir() {
        return Ok(false);
    }
    let mut restored = false;
    let settings = crash_dir.join("settings.yaml");
    let patch = crash_dir.join("cordis.patch.yml");

    if settings.exists() {
        if let Some(parent) = settings_path().parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&settings, settings_path()).map_err(|e| e.to_string())?;
        restored = true;
    }
    if patch.exists() {
        if let Some(parent) = patch_path().parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::copy(&patch, patch_path()).map_err(|e| e.to_string())?;
        restored = true;
    }
    // 清理 crash backup
    let _ = std::fs::remove_dir_all(&crash_dir);
    Ok(restored)
}

/// 检查 crash-backup 是否存在（即当前是否处于安全模式）。
pub fn is_in_safe_mode() -> bool {
    crash_backup_dir().is_dir()
}
