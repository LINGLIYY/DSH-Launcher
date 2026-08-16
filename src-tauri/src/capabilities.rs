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
    pub source: String,
    pub dir: Option<String>,
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
        Ok(o) if o.status.success() => {
            let p = decode_wsl(&o.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            // 过滤 Windows 通过 WSL PATH 互操作暴露的 npm shim（/mnt/...），
            // 只接受 WSL 内原生安装的 dsh。
            if p.starts_with("/mnt/")
                || p.contains('\\')
                || p.ends_with(".cmd")
                || p.ends_with(".exe")
                || p.ends_with(".ps1")
            {
                String::new()
            } else {
                p
            }
        }
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

pub fn ping(endpoint: &serde_json::Value) -> String {
    let etype = endpoint
        .get("type")
        .and_then(|x| x.as_str())
        .unwrap_or("windows");
    match etype {
        "wsl" => {
            let Some(distro) = endpoint.get("distro").and_then(|x| x.as_str()) else {
                return "error".to_string();
            };
            if distro.is_empty() {
                return "error".to_string();
            }
            let ok = std::process::Command::new("wsl")
                .args(["-d", distro, "--", "true"])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok { "stopped".to_string() } else { "error".to_string() }
        }
        "ssh" => "unknown".to_string(),
        _ => {
            let port = endpoint
                .get("port")
                .and_then(|x| x.as_u64())
                .unwrap_or(7602) as u16;
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                "running".to_string()
            } else {
                "stopped".to_string()
            }
        }
    }
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn plugin_entry(dest: &Path) -> String {
    let pkg = dest.join("package.json");
    if let Ok(txt) = std::fs::read_to_string(&pkg) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(main) = v.get("main").and_then(|x| x.as_str()) {
                return main.to_string();
            }
            if let Some(exp) = v.get("exports").and_then(|x| x.as_str()) {
                return exp.to_string();
            }
            if let Some(exp) = v.pointer("/exports/.").and_then(|x| x.as_str()) {
                return exp.to_string();
            }
        }
    }
    "index.js".to_string()
}

pub fn import_plugin(src: &str) -> Result<String, String> {
    let src = PathBuf::from(src);
    if !src.is_dir() {
        return Err("插件路径不是目录".to_string());
    }
    let name = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("plugin")
        .to_string();
    let dest = profile_dir().join("plugins").join(&name);
    if dest.exists() {
        return Err(format!("插件 {name} 已存在"));
    }
    copy_dir(&src, &dest)?;
    let entry = plugin_entry(&dest);
    let patch = profile_dir().join("cordis.patch.yml");
    let mut text = std::fs::read_to_string(&patch).unwrap_or_default();
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&format!(
        "- insert:\n    - id: {name}\n      name: ./plugins/{name}/{entry}\n"
    ));
    crate::prefs::atomic_write(&patch, &text)?;
    Ok(name)
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

fn read_pkg_meta(path: &Path) -> (String, String, String, String) {
    let mut name = String::new();
    let mut version = String::new();
    let mut author = String::new();
    let mut desc = String::new();
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
            if let Some(d) = v.get("description").and_then(|x| x.as_str()) {
                desc = d.to_string();
            }
        }
    }
    (name, version, author, desc)
}

pub fn list_plugins() -> Vec<PluginInfo> {
    let mut out = Vec::new();

    // 1. profile 内置组合包（bundles）
    let profile_pkg = profile_dir().join("package.json");
    let mut deps: Vec<(String, String)> = Vec::new();
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
                            version: String::new(),
                            author: "DeepSeek".to_string(),
                            desc: "DSH 内置组合包".to_string(),
                            enabled: true,
                            builtin: true,
                            skills: vec![],
                            source: "bundle".to_string(),
                            dir: None,
                        });
                    }
                }
            }
            if let Some(d) = v.get("dependencies").and_then(|x| x.as_object()) {
                for (k, val) in d {
                    deps.push((k.clone(), val.as_str().unwrap_or("").to_string()));
                }
            }
        }
    }

    // 2. 通过 pnpm 安装的 npm 插件（package.json dependencies）
    for (name, spec) in &deps {
        if spec.starts_with("file:") {
            continue;
        }
        let dir = node_modules_dir(name);
        let (pkg_name, version, author, desc) = read_pkg_meta(&dir.join("package.json"));
        out.push(PluginInfo {
            id: name.clone(),
            name: if pkg_name.is_empty() { name.clone() } else { pkg_name },
            version,
            author,
            desc,
            enabled: true,
            builtin: false,
            skills: vec![],
            source: "npm".to_string(),
            dir: Some(dir.to_string_lossy().into_owned()),
        });
    }

    // 3. profile 本地插件（profiles/web/plugins/*）
    let profile_plugins = profile_dir().join("plugins");
    if let Ok(rd) = std::fs::read_dir(&profile_plugins) {
        for entry in rd.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().into_owned();
            let (name, version, author, desc) = read_pkg_meta(&dir.join("package.json"));
            out.push(PluginInfo {
                id: dir_name.clone(),
                name: if name.is_empty() { dir_name } else { name },
                version,
                author,
                desc,
                enabled: true,
                builtin: false,
                skills: vec![],
                source: "local".to_string(),
                dir: Some(dir.to_string_lossy().into_owned()),
            });
        }
    }

    // 4. harness 级插件（file: 依赖指向的本地插件，或待用）
    let harness_plugins = dsh_home().join("plugins");
    if let Ok(rd) = std::fs::read_dir(&harness_plugins) {
        for entry in rd.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().into_owned();
            let is_dep = deps.iter().any(|(n, s)| {
                s.starts_with("file:") && (n == &dir_name || s.ends_with(&format!("/{dir_name}")))
            });
            let (name, version, author, desc) = read_pkg_meta(&dir.join("package.json"));
            out.push(PluginInfo {
                id: dir_name.clone(),
                name: if name.is_empty() { dir_name } else { name },
                version,
                author,
                desc,
                enabled: is_dep,
                builtin: false,
                skills: vec![],
                source: "harness".to_string(),
                dir: Some(dir.to_string_lossy().into_owned()),
            });
        }
    }

    // 5. Agent 预设（.agent-presets/*）
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
                    source: "preset".to_string(),
                    dir: None,
                });
            }
        }
    }

    // 去重（npm 依赖与本地目录可能指向同一插件）
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| seen.insert(p.id.clone()));
    out
}

fn node_modules_dir(name: &str) -> PathBuf {
    let base = profile_dir().join("node_modules");
    if name.starts_with('@') {
        if let Some((scope, pkg)) = name.split_once('/') {
            return base.join(scope).join(pkg);
        }
    }
    base.join(name)
}

fn parse_skill_meta(skill_md: &Path) -> (String, String) {
    let mut name = String::new();
    let mut desc = String::new();
    let Ok(text) = std::fs::read_to_string(skill_md) else {
        return (name, desc);
    };
    let mut lines = text.lines();
    if lines.next().map(|l| l.trim() != "---").unwrap_or(true) {
        return (name, desc);
    }
    let mut collecting = false;
    for raw in lines {
        if raw.trim() == "---" {
            break;
        }
        if collecting {
            let is_new_key = !raw.starts_with(' ')
                && !raw.starts_with('\t')
                && raw.contains(':');
            if is_new_key {
                collecting = false;
            } else {
                if !desc.is_empty() {
                    desc.push('\n');
                }
                desc.push_str(raw.trim());
                continue;
            }
        }
        let t = raw.trim();
        if let Some(v) = t.strip_prefix("name:") {
            name = v.trim().trim_matches('"').to_string();
        } else if let Some(v) = t.strip_prefix("description:") {
            let rest = v.trim();
            if rest.is_empty() || rest == "|" || rest == ">" || rest == "|-" || rest == ">-" {
                collecting = true;
            } else {
                desc = rest.trim_matches('"').to_string();
            }
        }
    }
    (name, desc.trim().to_string())
}

fn scan_skills_dir(root: &Path, plugin: &str, out: &mut Vec<SkillInfo>) {
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    for entry in rd.flatten() {
        let dir = entry.path();
        if dir.is_dir() {
            let skill_md = dir.join("SKILL.md");
            if skill_md.exists() {
                let id = entry.file_name().to_string_lossy().into_owned();
                let (meta_name, meta_desc) = parse_skill_meta(&skill_md);
                out.push(SkillInfo {
                    id: id.clone(),
                    name: if meta_name.is_empty() { id } else { meta_name },
                    plugin: plugin.to_string(),
                    enabled: true,
                    calls: 0,
                    desc: meta_desc,
                    params: String::new(),
                    returns: String::new(),
                });
            }
        }
    }
}

pub fn list_skills() -> Vec<SkillInfo> {
    let mut out = Vec::new();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("C:\\"));
    // 项目根（含 .git 的最近祖先，简化取 cwd 即可）
    scan_skills_dir(&cwd.join(".dsh").join("skills"), "项目 .dsh", &mut out);
    scan_skills_dir(&cwd.join(".agents").join("skills"), "项目 .agents", &mut out);
    // 用户 DSH 根目录
    scan_skills_dir(&dsh_home().join("skills"), "用户 DSH", &mut out);
    // 用户 agents 根目录
    let agents_home = std::env::var("DSH_AGENTS_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users".to_string());
            PathBuf::from(profile).join(".agents")
        });
    scan_skills_dir(&agents_home.join("skills"), "用户 agents", &mut out);
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
    let mut seen = std::collections::HashSet::new();
    out.retain(|s| seen.insert(s.id.clone()));
    out
}

pub fn list_mcp() -> Vec<McpInfo> {
    // 当前未接入 DSH 原生 MCP 配置读取，返回空列表（真实状态）
    Vec::new()
}

fn valid_plugin_id(id: &str) -> bool {
    if id.is_empty() || id == "." || id == ".." {
        return false;
    }
    let mut parts = id.split('/');
    let first = parts.next().unwrap_or("");
    let second = parts.next();
    if parts.next().is_some() {
        return false;
    }
    for s in id.split('/') {
        if s.is_empty() || s == "." || s == ".." {
            return false;
        }
        if !s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '-' | '_' | '.'))
        {
            return false;
        }
    }
    if first.starts_with('@') {
        second.is_some()
    } else {
        second.is_none()
    }
}

fn safe_target(t: &str) -> bool {
    if t.is_empty() || t.starts_with('-') {
        return false;
    }
    if !t
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '/' | '-' | '_' | '.' | ':'))
    {
        return false;
    }
    let body = t.split_once(':').map(|(_, b)| b).unwrap_or(t);
    body.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

fn run_dsh_plugin(args: &[&str]) -> Result<String, String> {
    let dsh = crate::harness::find_dsh().map_err(|e| e.to_string())?;
    let home = dsh_home();
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/C", &dsh]);
    cmd.arg("plugin").arg("--profile").arg("web");
    for a in args {
        cmd.arg(a);
    }
    cmd.env("DSH_HOME", &home);
    cmd.env("NO_COLOR", "1");
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if out.status.success() {
        let mut msg = stdout.trim().to_string();
        if msg.is_empty() {
            msg = stderr.trim().to_string();
        }
        Ok(if msg.is_empty() { "ok".to_string() } else { msg })
    } else {
        let mut msg = stderr.trim().to_string();
        if msg.is_empty() {
            msg = stdout.trim().to_string();
        }
        Err(if msg.is_empty() { "命令执行失败".to_string() } else { msg })
    }
}

pub fn install_market_plugin(target: &str) -> Result<String, String> {
    if !safe_target(target.trim()) {
        return Err("非法的安装目标".to_string());
    }
    run_dsh_plugin(&["add", target.trim()])
}

pub fn uninstall_market_plugin(target: &str) -> Result<String, String> {
    if !safe_target(target.trim()) {
        return Err("非法的卸载目标".to_string());
    }
    run_dsh_plugin(&["remove", target.trim()])
}

fn patch_path() -> PathBuf {
    profile_dir().join("cordis.patch.yml")
}

fn patch_has_insert(id: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(patch_path()) else {
        return false;
    };
    text.lines().any(|l| {
        let t = l.trim();
        t == format!("- id: {id}") || t == format!("- id: \"{id}\"")
    })
}

fn remove_insert_entry(id: &str) -> Result<(), String> {
    let patch = patch_path();
    let text = std::fs::read_to_string(&patch).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut i = 0;
    while i < lines.len() {
        let t = lines[i].trim();
        if t == format!("- id: {id}") || t == format!("- id: \"{id}\"") {
            lines.remove(i);
            if i < lines.len() && lines[i].trim_start().starts_with("name:") {
                lines.remove(i);
            }
            continue;
        }
        i += 1;
    }
    // 清理因此变成空壳的 "- insert:" 行
    let mut cleaned: Vec<String> = Vec::new();
    let mut idx = 0;
    while idx < lines.len() {
        let t = lines[idx].trim();
        if t == "- insert:" {
            let mut next = idx + 1;
            while next < lines.len() && lines[next].trim().is_empty() {
                next += 1;
            }
            let has_entry = next < lines.len() && lines[next].trim_start().starts_with("- id:");
            if has_entry {
                cleaned.push(lines[idx].clone());
            }
        } else {
            cleaned.push(lines[idx].clone());
        }
        idx += 1;
    }
    crate::prefs::atomic_write(&patch, &(cleaned.join("\n") + "\n"))?;
    Ok(())
}

fn append_insert_entry(id: &str, entry: &str) -> Result<(), String> {
    let patch = patch_path();
    let mut text = std::fs::read_to_string(&patch).unwrap_or_default();
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&format!(
        "- insert:\n    - id: {id}\n      name: ./plugins/{id}/{entry}\n"
    ));
    crate::prefs::atomic_write(&patch, &text)?;
    Ok(())
}

pub fn set_plugin_enabled(id: &str, enabled: bool) -> Result<(), String> {
    if !valid_plugin_id(id) {
        return Err("非法插件 ID".to_string());
    }
    let dir = profile_dir().join("plugins").join(id);
    if !dir.is_dir() {
        return Err("仅支持启用/禁用「本地导入」插件；npm 插件请使用市场卸载".to_string());
    }
    let entry = plugin_entry(&dir);
    if enabled {
        if !patch_has_insert(id) {
            append_insert_entry(id, &entry)?;
        }
    } else {
        remove_insert_entry(id)?;
    }
    Ok(())
}

pub fn remove_plugin(id: &str) -> Result<String, String> {
    if !valid_plugin_id(id) {
        return Err("非法插件 ID".to_string());
    }
    let local = profile_dir().join("plugins").join(id);
    if local.is_dir() {
        remove_insert_entry(id)?;
        std::fs::remove_dir_all(&local).map_err(|e| e.to_string())?;
        return Ok(format!("已卸载本地插件 {id}"));
    }
    let pkg = profile_dir().join("package.json");
    let is_dep = std::fs::read_to_string(&pkg)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("dependencies").cloned())
        .and_then(|d| d.as_object().cloned())
        .map(|d| d.contains_key(id))
        .unwrap_or(false);
    if is_dep {
        return run_dsh_plugin(&["remove", id]);
    }
    Err("未找到可卸载的插件".to_string())
}

pub fn open_plugin_folder(id: &str) -> Result<(), String> {
    if !valid_plugin_id(id) {
        return Err("非法插件 ID".to_string());
    }
    let candidates = [
        profile_dir().join("plugins").join(id),
        dsh_home().join("plugins").join(id),
        node_modules_dir(id),
    ];
    for c in candidates {
        if c.exists() {
            return crate::harness::open_path(&c);
        }
    }
    Err("未找到插件目录".to_string())
}
