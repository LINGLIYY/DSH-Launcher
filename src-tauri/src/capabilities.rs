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
    pub kind: String,
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
        .join("dsh-launcher")
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
    // 兜底修复：把已安装且声明 dsh.bundle 的依赖同步进 bundle 层。
    // 覆盖历史遗留的“已安装但未生效”（旧版 launcher / 手动 pnpm 安装）场景。
    let _ = reconcile_bundles();
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
                            kind: if name.starts_with("@deepseek-ai/") {
                                "builtin".to_string()
                            } else {
                                "extension".to_string()
                            },
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
        let desc = if declares_bundle(name) {
            desc
        } else {
            format!("{desc}（未声明 dsh.bundle，仅为普通依赖，不会被 DSH 加载）")
        };
        out.push(PluginInfo {
            id: name.clone(),
            name: if pkg_name.is_empty() { name.clone() } else { pkg_name },
            version,
            author,
            desc,
            enabled: is_registered(&name),
            builtin: false,
            skills: vec![],
            source: "npm".to_string(),
            dir: Some(dir.to_string_lossy().into_owned()),
            kind: if name.starts_with("@deepseek-ai/") {
                "builtin".to_string()
            } else {
                "extension".to_string()
            },
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
                name: if name.is_empty() { dir_name.clone() } else { name },
                version,
                author,
                desc,
                // 注册态 = 已进入 bundles 或 cordis.patch.yml 的 insert 块
                enabled: is_registered(&dir_name),
                builtin: false,
                skills: vec![],
                source: "local".to_string(),
                dir: Some(dir.to_string_lossy().into_owned()),
                kind: "selfdev".to_string(),
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
            // WSL 开发中临时禁用的目录（disabled-*）不在 Windows 端展示
            if dir_name.starts_with("disabled-") {
                continue;
            }
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
                // harness 级插件没有 patch/bundle 注册态；enabled 仅表示它是否以
                // file: 依赖出现在 profile package.json 的 dependencies 中
                enabled: is_dep,
                builtin: false,
                skills: vec![],
                source: "harness".to_string(),
                dir: Some(dir.to_string_lossy().into_owned()),
                kind: "selfdev".to_string(),
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
                    kind: "extension".to_string(),
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

/// 实时执行 `dsh plugin --profile web <args>`：stdout/stderr 逐行写入启动器
/// 日志（前端日志区实时滚动显示安装进度），返回尾部摘要作为命令结果。
fn run_dsh_plugin_live(app: &tauri::AppHandle, args: &[&str]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::sync::{Arc, Mutex};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let dsh = crate::harness::find_dsh().map_err(|e| e.to_string())?;
    let home = dsh_home();
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/C", &dsh]);
    cmd.arg("plugin").arg("--profile").arg("web");
    for a in args {
        cmd.arg(a);
    }
    cmd.env("DSH_HOME", &home);
    cmd.env("NO_COLOR", "1");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let captured = Arc::new(Mutex::new(Vec::<String>::new()));

    if let Some(out) = child.stdout.take() {
        spawn_live_reader(app.clone(), out, "info", captured.clone());
    }
    if let Some(err) = child.stderr.take() {
        spawn_live_reader(app.clone(), err, "err", captured.clone());
    }
    let status = child.wait().map_err(|e| e.to_string())?;

    let all = captured.lock().map(|v| v.join("\n")).unwrap_or_default();
    let tail = {
        let lines: Vec<&str> = all.lines().collect();
        let n = lines.len();
        let start = n.saturating_sub(5);
        lines[start..].join("\n")
    };
    if status.success() {
        Ok(if tail.is_empty() { "ok".to_string() } else { tail })
    } else {
        // pnpm 构建白名单拦截：给出标记 + key，前端据此二次询问用户
        match extract_blocked_build_key(&all) {
            Some(key) => Err(format!("__BUILD_BLOCKED__:{key}\n{tail}")),
            None => Err(if tail.is_empty() {
                "命令执行失败".to_string()
            } else {
                tail
            }),
        }
    }
}

/// 从 pnpm 输出中提取被构建白名单（allowBuilds）拦截的包 key。
/// pnpm 11 格式："Ignored build scripts: misakanet. Run "pnpm approve-builds" ..."
fn extract_blocked_build_key(text: &str) -> Option<String> {
    const MARK: &str = "Ignored build scripts:";
    if let Some(idx) = text.find(MARK) {
        let rest = &text[idx + MARK.len()..];
        let first = rest
            .split(|c: char| c == ',' || c == '.' || c == '\n' || c == '\r')
            .next()
            .unwrap_or("")
            .trim();
        if !first.is_empty() {
            return Some(first.to_string());
        }
    }
    None
}

/// 逐行读取子进程输出流：实时写入启动器日志（前端日志区滚动显示），
/// 同时保留尾部若干行供命令结果摘要使用。
fn spawn_live_reader<R: std::io::Read + Send + 'static>(
    app: tauri::AppHandle,
    stream: R,
    level: &'static str,
    cap: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
) {
    const TAIL_CAP: usize = 300;
    std::thread::spawn(move || {
        use std::io::BufRead;
        let mut r = std::io::BufReader::new(stream);
        let mut line = String::new();
        loop {
            line.clear();
            match r.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let t = line.trim_end().to_string();
                    if t.is_empty() {
                        continue;
                    }
                    crate::harness::append_log(&app, level, &format!("[插件] {t}"));
                    if let Ok(mut v) = cap.lock() {
                        if v.len() >= TAIL_CAP {
                            v.remove(0);
                        }
                        v.push(t);
                    }
                }
                Err(_) => break,
            }
        }
    });
}

/// 把包 key 加入 pnpm-workspace.yaml 的 allowBuilds 白名单（放行其构建脚本）。
/// git 源插件带 prepare 构建脚本，pnpm 默认拦截，需要用户确认后放行。
pub fn allow_builds(pkg: &str) -> Result<(), String> {
    let pkg = pkg.trim();
    if pkg.is_empty()
        || pkg.contains("..")
        || !pkg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '/' | '-' | '_' | '.'))
    {
        return Err("非法的包名".to_string());
    }
    let f = profile_dir().join("pnpm-workspace.yaml");
    let mut text = std::fs::read_to_string(&f).unwrap_or_default();
    let entry = format!("  {pkg}: true");
    if text.lines().any(|l| l.trim() == format!("{pkg}: true")) {
        return Ok(());
    }
    if !text.ends_with('\n') {
        text.push('\n');
    }
    if let Some(idx) = text.lines().position(|l| l.trim() == "allowBuilds:") {
        // 已有 allowBuilds 块：插到块内最后一个条目之后
        let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
        let mut insert_at = idx + 1;
        for (i, l) in lines.iter().enumerate().skip(idx + 1) {
            if l.starts_with(' ') || l.starts_with('\t') {
                insert_at = i + 1;
            } else {
                break;
            }
        }
        lines.insert(insert_at, entry.clone());
        text = lines.join("\n") + "\n";
    } else {
        text.push_str(&format!("allowBuilds:\n{entry}\n"));
    }
    crate::prefs::atomic_write(&f, &text)
}

pub fn install_market_plugin(app: &tauri::AppHandle, target: &str) -> Result<String, String> {
    if !safe_target(target.trim()) {
        return Err("非法的安装目标".to_string());
    }
    let target = target.trim();
    crate::harness::append_log(
        app,
        "info",
        &format!("[插件] 开始安装 {target}（下载依赖中，日志会实时显示进度）"),
    );
    let msg = run_dsh_plugin_live(app, &["add", target])?;
    // DSH 官方机制：`dsh plugin add` 之后会把“声明了 dsh.bundle 的依赖”自动
    // 同步进 package.json 的 dsh.profile.bundles（bundle 层）才能被加载。
    // 这里再兜底复刻一次 reconcile：兼容旧版 dsh（无自动 reconcile）或
    // 手动 pnpm 安装的情况，避免“已安装但不生效”。
    crate::harness::append_log(app, "info", "[插件] 依赖安装完成，正在同步 bundle 层…");
    let added = reconcile_bundles()?;
    if !added.is_empty() {
        if !boot_probe_ok() {
            for id in &added {
                let _ = update_bundles(id, false);
            }
            return Err(format!(
                "安装成功，但插件会导致 DSH 启动失败，已自动回滚注册：{}",
                added.join(", ")
            ));
        }
        return Ok(format!(
            "{msg}\n已注册 bundle 层：{}（已通过启动自检），重启 DSH 后生效",
            added.join(", ")
        ));
    }
    Ok(msg)
}

pub fn uninstall_market_plugin(app: &tauri::AppHandle, target: &str) -> Result<String, String> {
    if !safe_target(target.trim()) {
        return Err("非法的卸载目标".to_string());
    }
    let target = target.trim();
    crate::harness::append_log(
        app,
        "info",
        &format!("[插件] 开始卸载 {target}（日志会实时显示进度）"),
    );
    let msg = run_dsh_plugin_live(app, &["remove", target])?;
    let _ = remove_insert_entry(target);
    let _ = remove_disable_entry(target);
    Ok(msg)
}

pub fn register_plugin(id: &str) -> Result<String, String> {
    if !valid_plugin_id(id) {
        return Err("非法插件 ID".to_string());
    }
    if !dep_keys().iter().any(|k| k == id) {
        return Err("该插件不是已安装的依赖，无法注册".to_string());
    }
    if is_registered(id) {
        return Ok("插件已注册".to_string());
    }
    if !declares_bundle(id) {
        return Err(format!(
            "插件 {id} 未声明 dsh.bundle，DSH 不会把它作为插件加载（它只是普通依赖）"
        ));
    }
    let pkg = profile_dir().join("package.json");
    let before = std::fs::read_to_string(&pkg).unwrap_or_default();
    if let Err(e) = update_bundles(id, true) {
        return Err(e);
    }
    if !boot_probe_ok() {
        let _ = update_bundles(id, false);
        let _ = crate::prefs::atomic_write(&pkg, &before);
        return Err(format!("插件 {id} 会导致 DSH 启动失败，已回滚注册"));
    }
    Ok(format!("插件 {id} 已注册（bundle 层，已通过启动自检），重启 DSH 后生效"))
}

fn patch_path() -> PathBuf {
    profile_dir().join("cordis.patch.yml")
}

fn dep_keys() -> Vec<String> {
    let pkg = profile_dir().join("package.json");
    std::fs::read_to_string(&pkg)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("dependencies").and_then(|d| d.as_object()).cloned())
        .map(|d| d.keys().cloned().collect())
        .unwrap_or_default()
}

fn bundle_names() -> Vec<String> {
    let pkg = profile_dir().join("package.json");
    std::fs::read_to_string(&pkg)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.pointer("/dsh/profile/bundles").and_then(|b| b.as_array()).cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|b| b.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// 检查一个已安装的 npm 依赖是否声明 `dsh.bundle` —— DSH 官方插件生效机制：
/// 只有声明了 `dsh.bundle.patch` 的包才能作为 bundle 层被加载。
fn declares_bundle(name: &str) -> bool {
    let pkg = node_modules_dir(name).join("package.json");
    let Ok(txt) = std::fs::read_to_string(pkg) else {
        return false;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) else {
        return false;
    };
    v.pointer("/dsh/bundle/patch")
        .and_then(|p| p.as_str())
        .is_some()
}

/// 复刻 DSH 官方 `dsh plugin` 的 reconcile：遍历已安装依赖，把声明了
/// `dsh.bundle` 但尚未进入 `dsh.profile.bundles` 的包追加进 bundle 层。
/// 幂等；返回本次实际新增的包名列表。
fn reconcile_bundles() -> Result<Vec<String>, String> {
    let pkg = profile_dir().join("package.json");
    let text = std::fs::read_to_string(&pkg).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let deps: Vec<String> = v
        .pointer("/dependencies")
        .and_then(|d| d.as_object())
        .map(|d| d.keys().cloned().collect())
        .unwrap_or_default();
    let mut bundles: Vec<String> = v
        .pointer("/dsh/profile/bundles")
        .and_then(|b| b.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let mut added = Vec::new();
    for name in deps {
        if declares_bundle(&name) && !bundles.contains(&name) {
            bundles.push(name.clone());
            added.push(name);
        }
    }
    if !added.is_empty() {
        if let Some(b) = v.pointer_mut("/dsh/profile/bundles") {
            *b = serde_json::Value::Array(
                bundles.into_iter().map(serde_json::Value::String).collect(),
            );
        }
        crate::prefs::atomic_write(
            &pkg,
            &serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(added)
}

/// 把某个已安装的 bundle 插件加入/移出 `dsh.profile.bundles`（注册、启用、禁用）。
/// 仅当列表实际变化时写盘。
fn update_bundles(id: &str, add: bool) -> Result<(), String> {
    let pkg = profile_dir().join("package.json");
    let text = std::fs::read_to_string(&pkg).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let bundles = v
        .pointer_mut("/dsh/profile/bundles")
        .and_then(|b| b.as_array_mut())
        .ok_or_else(|| "profile manifest 缺少 dsh.profile.bundles".to_string())?;
    let before = bundles.len();
    if add {
        if !bundles.iter().any(|b| b.as_str() == Some(id)) {
            bundles.push(serde_json::Value::String(id.to_string()));
        }
    } else {
        bundles.retain(|b| b.as_str() != Some(id));
    }
    if bundles.len() != before {
        crate::prefs::atomic_write(
            &pkg,
            &serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(())
}

fn is_registered(id: &str) -> bool {
    if bundle_names().iter().any(|b| b == id) {
        return true;
    }
    if let Ok(text) = std::fs::read_to_string(patch_path()) {
        if text.lines().any(|l| {
            let t = l.trim();
            t == format!("- id: {id}") || t == format!("- id: \"{id}\"")
        }) {
            return true;
        }
    }
    false
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

fn remove_patch_entry(id: &str, block_key: &str) -> Result<(), String> {
    let patch = patch_path();
    let text = std::fs::read_to_string(&patch).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut i = 0;
    while i < lines.len() {
        let t = lines[i].trim();
        if t == format!("- id: {id}") || t == format!("- id: \"{id}\"") {
            lines.remove(i);
            if block_key == "insert"
                && i < lines.len()
                && lines[i].trim_start().starts_with("name:")
            {
                lines.remove(i);
            }
            continue;
        }
        i += 1;
    }
    // 清理因此变成空壳的 "- <block_key>:" 行
    let block_line = format!("- {block_key}:");
    let mut cleaned: Vec<String> = Vec::new();
    let mut idx = 0;
    while idx < lines.len() {
        let t = lines[idx].trim();
        if t == block_line {
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

fn remove_insert_entry(id: &str) -> Result<(), String> {
    remove_patch_entry(id, "insert")
}

fn remove_disable_entry(id: &str) -> Result<(), String> {
    remove_patch_entry(id, "disable")
}

fn append_insert_entry(id: &str, entry: &str) -> Result<(), String> {
    let patch = patch_path();
    let mut text = std::fs::read_to_string(&patch).unwrap_or_default();
    if let Some(idx) = text.lines().position(|l| l.trim() == "- insert:") {
        // 已有 insert 块：在块头之后插入 id 行与 name 行，避免重复块头
        let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
        lines.insert(idx + 1, format!("      name: ./plugins/{id}/{entry}"));
        lines.insert(idx + 1, format!("    - id: {id}"));
        text = lines.join("\n");
    } else {
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&format!(
            "- insert:\n    - id: {id}\n      name: ./plugins/{id}/{entry}\n"
        ));
    }
    if !text.ends_with('\n') {
        text.push('\n');
    }
    crate::prefs::atomic_write(&patch, &text)?;
    Ok(())
}

fn append_disable_entry(id: &str) -> Result<(), String> {
    let patch = patch_path();
    let mut text = std::fs::read_to_string(&patch).unwrap_or_default();
    if let Some(idx) = text.lines().position(|l| l.trim() == "- disable:") {
        // 已有 disable 块：在块头之后插入条目行，避免重复块头
        let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
        lines.insert(idx + 1, format!("    - id: {id}"));
        text = lines.join("\n");
    } else {
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&format!("- disable:\n    - id: {id}\n"));
    }
    if !text.ends_with('\n') {
        text.push('\n');
    }
    crate::prefs::atomic_write(&patch, &text)?;
    Ok(())
}

fn patch_has_disable(id: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(patch_path()) else {
        return false;
    };
    let mut in_disable = false;
    for l in text.lines() {
        let t = l.trim();
        if t == "- disable:" {
            in_disable = true;
            continue;
        }
        if in_disable {
            if t == format!("- id: {id}") || t == format!("- id: \"{id}\"") {
                return true;
            }
            if t.starts_with("- ") && !t.starts_with("- id:") {
                in_disable = false;
            }
        }
    }
    false
}

fn verify_profile() -> Result<(), String> {
    let dsh = crate::harness::find_dsh().map_err(|e| e.to_string())?;
    let home = dsh_home();
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("cmd")
        .args(["/C", &dsh, "--profile", "web", "--dump-config"])
        .env("DSH_HOME", &home)
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "DSH 配置校验失败：{}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// 真实拉起一次 `dsh web`（随机端口），确认插件树能成功加载。
/// 25 秒内未崩溃 = 已就绪（返回 true）；提前退出 = 加载失败（返回 false）。
fn boot_probe_ok() -> bool {
    let Ok(dsh) = crate::harness::find_dsh() else {
        return false;
    };
    let home = dsh_home();
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(mut child) = std::process::Command::new("cmd")
        .args(["/C", &dsh, "web", "--host", "127.0.0.1", "--port", "0"])
        .env("DSH_HOME", &home)
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    else {
        return false;
    };
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.as_mut().map(|o| o.read_to_string(&mut s));
        s
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
    let mut alive = true;
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            alive = false;
            break;
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    if alive {
        let _ = child.kill();
    }
    let _ = child.wait();
    let _ = err.as_mut().map(|e| e.read_to_string(&mut String::new()));
    let _ = reader.join();
    alive
}

pub fn set_plugin_enabled(id: &str, enabled: bool) -> Result<(), String> {
    if !valid_plugin_id(id) {
        return Err("非法插件 ID".to_string());
    }
    // 本地自研插件（./plugins insert 注册）
    let dir = profile_dir().join("plugins").join(id);
    if dir.is_dir() {
        let entry = plugin_entry(&dir);
        let patch = patch_path();
        let before = std::fs::read_to_string(&patch).unwrap_or_default();
        if enabled {
            if !patch_has_insert(id) {
                append_insert_entry(id, &entry)?;
            }
        } else {
            remove_insert_entry(id)?;
        }
        if let Err(e) = verify_profile() {
            let _ = crate::prefs::atomic_write(&patch, &before);
            return Err(e);
        }
        return Ok(());
    }
    // 扩展（npm 依赖）：bundle 型通过 dsh.profile.bundles 启停；非 bundle 无法加载
    if dep_keys().iter().any(|k| k == id) {
        if !declares_bundle(id) {
            return Err(format!(
                "插件 {id} 未声明 dsh.bundle，DSH 不会加载它；它只是普通依赖"
            ));
        }
        let pkg = profile_dir().join("package.json");
        let before = std::fs::read_to_string(&pkg).unwrap_or_default();
        if let Err(e) = update_bundles(id, enabled) {
            return Err(e);
        }
        // 清理旧版 launcher 可能写下的无效 patch 残留（insert/disable 对 npm bundle 无效）
        let _ = remove_insert_entry(id);
        let _ = remove_disable_entry(id);
        if let Err(e) = verify_profile() {
            let _ = crate::prefs::atomic_write(&pkg, &before);
            return Err(e);
        }
        return Ok(());
    }
    // 内置本家 / 模板 bundle：通过 disable 条目控制
    if id.starts_with("@deepseek-ai/") || bundle_names().iter().any(|b| b == id) {
        let patch = patch_path();
        let before = std::fs::read_to_string(&patch).unwrap_or_default();
        let apply = || -> Result<(), String> {
            if enabled {
                if patch_has_disable(id) {
                    remove_disable_entry(id)?;
                }
            } else if !patch_has_disable(id) {
                append_disable_entry(id)?;
            }
            Ok(())
        };
        if let Err(e) = apply() {
            return Err(e);
        }
        if let Err(e) = verify_profile() {
            let _ = crate::prefs::atomic_write(&patch, &before);
            return Err(e);
        }
        return Ok(());
    }
    Err("未找到该插件".to_string())
}

pub fn remove_plugin(app: &tauri::AppHandle, id: &str) -> Result<String, String> {
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
    let mut in_bundles = false;
    let mut is_dep = false;
    if let Ok(txt) = std::fs::read_to_string(&pkg) {
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(arr) = v
                .pointer_mut("/dsh/profile/bundles")
                .and_then(|x| x.as_array_mut())
            {
                let before = arr.len();
                arr.retain(|b| b.as_str() != Some(id));
                in_bundles = arr.len() < before;
            }
            if in_bundles {
                let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
                crate::prefs::atomic_write(&pkg, &text)?;
            }
            if let Some(d) = v.get("dependencies").and_then(|x| x.as_object()) {
                is_dep = d.contains_key(id);
            }
        }
    }
    if in_bundles || is_dep {
        let _ = remove_insert_entry(id);
        let _ = remove_disable_entry(id);
        let mut msgs = Vec::new();
        if in_bundles {
            msgs.push("已从 bundles 注册中移除".to_string());
        }
        if is_dep {
            crate::harness::append_log(
                app,
                "info",
                &format!("[插件] 正在卸载依赖 {id}（日志会实时显示进度）"),
            );
            let r = run_dsh_plugin_live(app, &["remove", id])?;
            msgs.push(r);
        }
        return Ok(msgs.join("；"));
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
