use crate::{default_dsh_home, HarnessState, LogLine};
use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(serde::Deserialize)]
pub struct EndpointSpec {
    #[serde(rename = "type")]
    pub etype: String,
    pub distro: Option<String>,
    pub path: String,
    pub workspace: Option<String>,
    #[serde(rename = "dshHome")]
    pub dsh_home: Option<String>,
}

pub fn find_dsh() -> Result<String> {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let cand = PathBuf::from(&appdata).join("npm").join("dsh.cmd");
        if cand.exists() {
            return Ok(cand.to_string_lossy().into_owned());
        }
    }
    if let Ok(out) = std::process::Command::new("where").arg("dsh").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Some(line) = s.lines().next() {
                return Ok(line.trim().to_string());
            }
        }
    }
    Err(anyhow!("未找到 dsh 命令，请先执行 npm install -g @deepseek-ai/dsh"))
}

fn http_ready(url: &str) -> bool {
    use std::io::Read;
    use std::net::TcpStream;

    let host_port = url.trim_start_matches("http://").trim_end_matches('/');
    let mut parts = host_port.split(':');
    let host = parts.next().unwrap_or("127.0.0.1");
    let port: u16 = parts
        .next()
        .and_then(|p| p.parse().ok())
        .unwrap_or(80);

    let mut stream = match TcpStream::connect((host, port)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let req = format!(
        "GET / HTTP/1.1\r\nHost: {host_port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    if stream.read_to_end(&mut buf).is_err() {
        return false;
    }
    String::from_utf8_lossy(&buf).contains("__DSH_BOOT__")
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn set_status(app: &AppHandle, status: &str, text: &str) {
    {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        inner.status = status.to_string();
    }
    let _ = app.emit(
        "harness-status",
        serde_json::json!({ "status": status, "text": text }),
    );
}

pub fn append_log(app: &AppHandle, level: &str, text: &str) {
    let line = LogLine {
        level: level.to_string(),
        text: text.to_string(),
    };
    {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        inner.logs.push_back(line.clone());
        if inner.logs.len() > 1200 {
            inner.logs.pop_front();
        }
        let save_log = app
            .try_state::<crate::PrefsState>()
            .map(|s| s.inner.lock().unwrap().save_log)
            .unwrap_or(true);
        if save_log {
            if let Some(parent) = inner.log_path.parent() {
                let _ = std::fs::create_dir_all(parent);
                // 超过 5MB 轮转：launcher.log -> launcher.log.1（覆盖旧轮转）
                if let Ok(meta) = std::fs::metadata(&inner.log_path) {
                    if meta.len() > 5 * 1024 * 1024 {
                        let rotated = inner.log_path.with_extension("log.1");
                        let _ = std::fs::rename(&inner.log_path, &rotated);
                    }
                }
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&inner.log_path)
                {
                    let _ = writeln!(f, "[{}] {}", level, text);
                }
            }
        }
    }
    let _ = app.emit(
        "harness-log",
        serde_json::json!({ "level": level, "text": text }),
    );
}

pub fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn open_path(path: &Path) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub async fn start(
    app: AppHandle,
    workspace: String,
    port: u16,
    endpoint: Option<EndpointSpec>,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    if endpoint.as_ref().map(|e| e.etype == "ssh").unwrap_or(false) {
        return Err("SSH 远程端点暂待开发".to_string());
    }
    let is_wsl = endpoint.as_ref().map(|e| e.etype == "wsl").unwrap_or(false);
    let distro = endpoint.as_ref().and_then(|e| e.distro.clone()).filter(|d| !d.is_empty());
    let ep_path = endpoint.as_ref().map(|e| e.path.clone()).unwrap_or_default();
    let ep_home = endpoint.as_ref().and_then(|e| e.dsh_home.clone()).filter(|h| !h.is_empty());

    let dsh_path = if is_wsl {
        if ep_path.is_empty() {
            return Err("WSL 端未检测到 dsh 路径，请先自动扫描或手动填写".to_string());
        }
        ep_path
    } else {
        tauri::async_runtime::spawn_blocking(find_dsh)
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
    };

    let dsh_home = if is_wsl { ep_home.unwrap_or_default() } else { default_dsh_home() };
    let workspace = if is_wsl {
        let w = endpoint.as_ref().and_then(|e| e.workspace.clone()).unwrap_or(workspace);
        if w.is_empty() { "~".to_string() } else { w }
    } else {
        workspace
    };

    let host = "127.0.0.1".to_string();
    let url = format!("http://{host}:{port}/");

    let already_ready = {
        let u = url.clone();
        tauri::async_runtime::spawn_blocking(move || http_ready(&u))
            .await
            .unwrap_or(false)
    };
    if already_ready {
        let policy = app
            .try_state::<crate::PrefsState>()
            .map(|s| s.inner.lock().unwrap().port_policy.clone())
            .unwrap_or_else(|| "takeover".to_string());
        if policy == "prompt" {
            set_status(&app, "error", "端口被占用");
            append_log(&app, "err", &format!("{url} 已被占用，请更换端口或停止现有实例"));
            return Err(format!("端口 {port} 已被占用"));
        }
        append_log(&app, "info", &format!("检测到 {url} 已有 DSH 实例，直接接管"));
        set_status(&app, "ready", "运行中");
        // 接管已有实例时同样遵守“DSH 启动后自动打开浏览器”
        let auto_open = app
            .try_state::<crate::PrefsState>()
            .map(|s| s.inner.lock().unwrap().auto_open_browser)
            .unwrap_or(false);
        if auto_open {
            let _ = open_url(&url);
        }
        return Ok(());
    }

    {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        inner.workspace = workspace.clone();
        inner.port = port;
        inner.host = host.clone();
        inner.dsh_path = dsh_path.clone();
        inner.dsh_home = dsh_home.clone();
        inner.status = "starting".to_string();
        inner.wsl_distro = if is_wsl { distro.clone() } else { None };
        inner.wsl_port = if is_wsl { Some(port) } else { None };
    }
    append_log(&app, "info", &format!("启动 Harness: {dsh_path} web --host {host} --port {port}"));
    append_log(&app, "info", &format!("工作区: {workspace}"));
    set_status(&app, "starting", "正在启动…");

    let (child, pid, stdout, stderr) = if is_wsl {
        let d = distro.clone().ok_or_else(|| "WSL 发行版名称为空".to_string())?;
        // WSL2 的 localhost 转发支持回环绑定，Windows 侧仍可经 127.0.0.1 访问；
        // 不绑 0.0.0.0，避免把服务暴露到 WSL 虚拟网卡/局域网。
        let bind_host = "127.0.0.1";
        let script = if workspace == "~" {
            format!("{} web --host {} --port {}", sh_quote(&dsh_path), bind_host, port)
        } else {
            format!(
                "cd {} && {} web --host {} --port {}",
                sh_quote(&workspace),
                sh_quote(&dsh_path),
                bind_host,
                port
            )
        };
        let mut cmd = std::process::Command::new("wsl");
        cmd.args(["-d", &d, "--", "bash", "-lc", &script]);
        if !dsh_home.is_empty() { cmd.env("DSH_HOME", &dsh_home); }
        cmd.env("NO_COLOR", "1");
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        (child, pid, stdout, stderr)
    } else {
        let _ = std::fs::create_dir_all(&dsh_home);
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", &dsh_path, "web", "--host", &host, "--port", &port.to_string()]);
        cmd.env("DSH_HOME", &dsh_home);
        cmd.env("NO_COLOR", "1");
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        (child, pid, stdout, stderr)
    };

    let gen = {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        inner.pid = Some(pid);
        inner.child = Some(child);
        inner.generation += 1;
        inner.generation
    };

    let mut reader_handles = Vec::new();
    if let Some(out) = stdout {
        reader_handles.push(spawn_reader(app.clone(), out, "info"));
    }
    if let Some(err) = stderr {
        reader_handles.push(spawn_reader(app.clone(), err, "err"));
    }
    {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        inner.readers.extend(reader_handles);
    }

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
        loop {
            // 已被 stop/重启（generation 变化）：静默退出，不覆盖新状态
            let stale = {
                let state = app2.state::<HarnessState>();
                let inner = state.inner.lock().unwrap();
                inner.generation != gen
            };
            if stale {
                return;
            }
            let u = {
                let state = app2.state::<HarnessState>();
                let inner = state.inner.lock().unwrap();
                format!("http://{}:{}/", inner.host, inner.port)
            };
            let ready = {
                let u2 = u.clone();
                tauri::async_runtime::spawn_blocking(move || http_ready(&u2))
                    .await
                    .unwrap_or(false)
            };
            if ready {
                // 启动成功：重置连续失败计数
                {
                    let state = app2.state::<crate::HarnessState>();
                    let mut inner = state.inner.lock().unwrap();
                    inner.consecutive_failures = 0;
                }
                append_log(&app2, "info", &format!("Harness 就绪: {u}"));
                set_status(&app2, "ready", "运行中");
                let auto_open = app2
                    .try_state::<crate::PrefsState>()
                    .map(|s| s.inner.lock().unwrap().auto_open_browser)
                    .unwrap_or(false);
                if auto_open {
                    let _ = open_url(&u);
                }
                return;
            }
            let exited = {
                let state = app2.state::<HarnessState>();
                let mut inner = state.inner.lock().unwrap();
                match inner.child.as_mut() {
                    Some(c) => matches!(c.try_wait(), Ok(Some(_))),
                    None => true,
                }
            };
            if exited {
                append_log(&app2, "err", "Harness 进程已退出");
                handle_start_failure(&app2, gen, "进程异常退出");
                return;
            }
            if tokio::time::Instant::now() >= deadline {
                append_log(&app2, "err", "等待超时：Harness 未在 120 秒内就绪");
                handle_start_failure(&app2, gen, "启动超时");
                return;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });

    Ok(())
}
fn spawn_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    reader: R,
    level: &'static str,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match buf.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => append_log(&app, level, line.trim_end()),
                Err(_) => break,
            }
        }
    })
}

fn pid_alive(pid: u32) -> bool {
    let out = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()),
        Err(_) => false,
    }
}

fn kill_port_listener(port: u16) -> bool {
    let out = std::process::Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output();
    let Ok(out) = out else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut pids = std::collections::HashSet::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }
        if parts[3] == "LISTENING" && parts[1].ends_with(&format!(":{port}")) {
            if let Ok(pid) = parts[4].parse::<u32>() {
                pids.insert(pid);
            }
        }
    }
    let mut killed = false;
    for pid in pids {
        let r = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
        if r.map(|o| o.status.success()).unwrap_or(false) {
            killed = true;
        }
    }
    killed
}

pub async fn stop(app: AppHandle, force: bool) -> Result<(), String> {
    let (pid, distro, port) = {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        inner.child = None;
        inner.generation += 1; // 使旧的就绪轮询任务退出
        let pid = inner.pid.take();
        let distro = inner.wsl_distro.take();
        let port = inner.wsl_port.take();
        (pid, distro, port)
    };
    if let Some(pid) = pid {
        if let Some(distro) = distro {
            let port = port.unwrap_or(0);
            let _ = std::process::Command::new("wsl")
                .args([
                    "-d",
                    &distro,
                    "--",
                    "bash",
                    "-lc",
                    &format!("pkill -f 'dsh web --port {}' || true", port),
                ])
                .output();
        }
        // 先温和终止并等待，避免强杀打断 DSH 正在写入的会话文件
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .output();
        let mut alive = true;
        for _ in 0..10 {
            if !pid_alive(pid) {
                alive = false;
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        if alive {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output();
        }
    } else if distro.is_none() {
        // 未托管实例（端口接管场景）：探测端口，外部实例仍在运行就不假装“已停止”
        let url = {
            let state = app.state::<HarnessState>();
            let inner = state.inner.lock().unwrap();
            format!("http://{}:{}/", inner.host, inner.port)
        };
        let alive = tauri::async_runtime::spawn_blocking(move || http_ready(&url))
            .await
            .unwrap_or(false);
        if alive {
            if force {
                let port = {
                    let state = app.state::<HarnessState>();
                    let inner = state.inner.lock().unwrap();
                    inner.port
                };
                let killed =
                    tauri::async_runtime::spawn_blocking(move || kill_port_listener(port))
                        .await
                        .unwrap_or(false);
                if killed {
                    append_log(&app, "info", "已强制终止外部 DSH 实例（非本启动器托管）");
                    set_status(&app, "stopped", "已停止");
                    return Ok(());
                }
                append_log(&app, "err", "强制终止失败：未能定位端口上的监听进程");
                return Ok(());
            }
            append_log(
                &app,
                "info",
                "检测到外部实例仍在运行（非本启动器托管），未执行停止",
            );
            set_status(&app, "ready", "运行中（外部实例）");
            return Ok(());
        }
    }
    let readers = {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        std::mem::take(&mut inner.readers)
    };
    for r in readers {
        let _ = r.join();
    }
    append_log(&app, "info", "Harness 已停止");
    set_status(&app, "stopped", "已停止");
    Ok(())
}

/// 处理启动失败：递增连续失败计数，连续 2 次失败后自动恢复最近配置备份并重试一次。
fn handle_start_failure(app: &AppHandle, gen: u64, reason: &str) {
    let failures = {
        let state = app.state::<crate::HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        // 已被 stop/重启：不处理
        if inner.generation != gen {
            return;
        }
        inner.consecutive_failures += 1;
        inner.consecutive_failures
    };

    set_status(app, "error", &format!("启动失败（{reason}）"));

    if failures >= 2 {
        append_log(
            app,
            "err",
            &format!(
                "[防崩溃] 连续 {} 次启动失败，疑似配置损坏，正在自动恢复最近备份…",
                failures
            ),
        );
        // 自动恢复最近一份配置备份
        match crate::crashguard::latest_backup() {
            Some(ts) => {
                match crate::crashguard::restore_backup(&ts) {
                    Ok(_) => {
                        append_log(
                            app,
                            "info",
                            &format!("[防崩溃] 已恢复配置备份（{}），正在重试启动…", ts),
                        );
                        // 重置失败计数，避免重试时再次触发恢复
                        {
                            let state = app.state::<crate::HarnessState>();
                            let mut inner = state.inner.lock().unwrap();
                            inner.consecutive_failures = 0;
                        }
                        // 用当前保存的参数重试一次（Windows 本地模式）
                        let (ws, port) = {
                            let state = app.state::<crate::HarnessState>();
                            let inner = state.inner.lock().unwrap();
                            (inner.workspace.clone(), inner.port)
                        };
                        let app3 = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = start(app3, ws, port, None).await;
                        });
                    }
                    Err(e) => {
                        append_log(
                            app,
                            "err",
                            &format!("[防崩溃] 自动恢复失败：{}。建议使用「安全模式启动」", e),
                        );
                    }
                }
            }
            None => {
                append_log(
                    app,
                    "err",
                    "[防崩溃] 未找到配置备份。建议使用「安全模式启动」或手动重置配置",
                );
            }
        }
    } else {
        append_log(
            app,
            "info",
            &format!(
                "[防崩溃] 第 {} 次启动失败，再次失败将自动恢复最近配置备份",
                failures
            ),
        );
    }
}
