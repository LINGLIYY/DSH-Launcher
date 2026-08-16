use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub desc: String,
    pub enabled: bool,
    pub builtin: bool,
    pub skills: Vec<String>,
}

#[derive(Serialize)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub plugin: String,
    pub enabled: bool,
    pub calls: u64,
    pub desc: String,
    pub params: String,
    pub returns: String,
}

#[derive(Serialize)]
pub struct McpInfo {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub status: String,
    pub port: String,
    pub desc: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct WslInfo {
    pub name: String,
    pub distro: String,
    pub path: String,
    pub version: String,
    pub state: String,
}

fn wsl_dsh_path(distro: &str) -> String {
    let out = std::process::Command::new("wsl")
        .args([
            "-d",
            distro,
            "--",
            "bash",
            "-lc",
            "command -v dsh 2>/dev/null || command -v dsh.cmd 2>/dev/null",
        ])
        .output();
    match out {
        Ok(o) if o.status.success() => decode_wsl(&o.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string(),
        _ => String::new(),
    }
}

fn decode_wsl(bytes: &[u8]) -> String {
    let nul_count = bytes.iter().filter(|&&b| b == 0).count();
    if nul_count > bytes.len() / 3 {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

pub fn scan_wsl() -> Vec<WslInfo> {
    let mut out = Vec::new();
    let Ok(proc) = std::process::Command::new("wsl").args(["-l", "-v"]).output() else {
        return out;
    };
    if !proc.status.success() {
        return out;
    }
    let text = decode_wsl(&proc.stdout);
    for line in text.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        let (distro, state, version) = if parts.first() == Some(&"*") {
            let d = parts.get(1).unwrap_or(&"").to_string();
            let s = parts.get(2).unwrap_or(&"").to_string();
            let v = parts.get(3).unwrap_or(&"").to_string();
            (d, s, v)
        } else {
            (
                parts.first().unwrap_or(&"").to_string(),
                parts.get(1).unwrap_or(&"").to_string(),
                parts.get(2).unwrap_or(&"").to_string(),
            )
        };
        if distro.is_empty() || distro.eq_ignore_ascii_case("NAME") {
            continue;
        }
        let path = wsl_dsh_path(&distro);
        out.push(WslInfo {
            name: distro.clone(),
            distro,
            path,
            version,
            state,
        });
    }
    out
}

fn dsh_home() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\".to_string());
    PathBuf::from(base)
        .join("dsh-desktop")
        .join("harness")
}

fn profile_dir() -> PathBuf {
    dsh_home().join("profiles").join("web")
}

fn read_pkg_meta(path: &Path) -> (String, String, String) {
    let mut name = String::new();
    let mut version = String::new();
    let mut author = String::new();
    if let Ok(txt) = std::fs::read_to_string(path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(n) = v.get("name").and_then(|x| x.as_str()) {
                name = n.to_string();
            }
            if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                version = ver.to_string();
            }
            if let Some(a) = v.get("author") {
                author = match a {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Object(o) => o
                        .get("name")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    _ => String::new(),
                };
            }
        }
    }
    (name, version, author)
}

pub fn list_plugins() -> Vec<PluginInfo> {
    let mut out = Vec::new();

    // 1. profile 内置组合包（bundles）
    let profile_pkg = profile_dir().join("package.json");
    if let Ok(txt) = std::fs::read_to_string(&profile_pkg) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(arr) = v
                .pointer("/dsh/profile/bundles")
                .and_then(|x| x.as_array())
            {
                for b in arr {
                    if let Some(name) = b.as_str() {
                        out.push(PluginInfo {
                            id: name.to_string(),
                            name: name.to_string(),
                            version: "0.1.0-rc.6".to_string(),
                            author: "DeepSeek".to_string(),
                            desc: "DSH 内置组合包".to_string(),
                            enabled: true,
                            builtin: true,
                            skills: vec![],
                        });
                    }
                }
            }
        }
    }

    // 2. profile 用户插件（profiles/web/plugins/*）
    let profile_plugins = profile_dir().join("plugins");
    if let Ok(rd) = std::fs::read_dir(&profile_plugins) {
        for entry in rd.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().into_owned();
            let (name, version, author) = read_pkg_meta(&dir.join("package.json"));
            out.push(PluginInfo {
                id: dir_name.clone(),
                name: if name.is_empty() { dir_name } else { name },
                version,
                author,
                desc: String::new(),
                enabled: true,
                builtin: false,
                skills: vec![],
            });
        }
    }

    // 3. harness 级插件（已禁用或待用）
    let harness_plugins = dsh_home().join("plugins");
    if let Ok(rd) = std::fs::read_dir(&harness_plugins) {
        for entry in rd.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().into_owned();
            let (name, version, author) = read_pkg_meta(&dir.join("package.json"));
            out.push(PluginInfo {
                id: dir_name.clone(),
                name: if name.is_empty() { dir_name } else { name },
                version,
                author,
                desc: String::new(),
                enabled: false,
                builtin: false,
                skills: vec![],
            });
        }
    }

    // 4. Agent 预设（.agent-presets/*）
    let presets = dsh_home().join(".agent-presets");
    if let Ok(rd) = std::fs::read_dir(&presets) {
        for entry in rd.flatten() {
            if entry.path().is_dir() {
                let id = entry.file_name().to_string_lossy().into_owned();
                out.push(PluginInfo {
                    id: id.clone(),
                    name: id,
                    version: String::new(),
                    author: String::new(),
                    desc: "Agent 预设".to_string(),
                    enabled: true,
                    builtin: false,
                    skills: vec![],
                });
            }
        }
    }

    out
}

fn scan_skills_dir(root: &Path, plugin: &str, out: &mut Vec<SkillInfo>) {
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    for entry in rd.flatten() {
        let dir = entry.path();
        if dir.is_dir() && dir.join("SKILL.md").exists() {
            let id = entry.file_name().to_string_lossy().into_owned();
            out.push(SkillInfo {
                id: id.clone(),
                name: id,
                plugin: plugin.to_string(),
                enabled: true,
                calls: 0,
                desc: String::new(),
                params: String::new(),
                returns: String::new(),
            });
        }
    }
}

pub fn list_skills() -> Vec<SkillInfo> {
    let mut out = Vec::new();
    // 各预设目录下的 skills/ 子目录
    let presets = dsh_home().join(".agent-presets");
    if let Ok(rd) = std::fs::read_dir(&presets) {
        for entry in rd.flatten() {
            if entry.path().is_dir() {
                let plugin = entry.file_name().to_string_lossy().into_owned();
                scan_skills_dir(&entry.path().join("skills"), &plugin, &mut out);
            }
        }
    }
    // 全局 skills 目录
    scan_skills_dir(&dsh_home().join("skills"), "全局", &mut out);
    // profile 用户插件的 skills 目录
    let profile_plugins = profile_dir().join("plugins");
    if let Ok(rd) = std::fs::read_dir(&profile_plugins) {
        for entry in rd.flatten() {
            if entry.path().is_dir() {
                let plugin = entry.file_name().to_string_lossy().into_owned();
                scan_skills_dir(&entry.path().join("skills"), &plugin, &mut out);
            }
        }
    }
    out
}

pub fn list_mcp() -> Vec<McpInfo> {
    // 当前未接入 DSH 原生 MCP 配置读取，返回空列表（真实状态）
    Vec::new()
}
