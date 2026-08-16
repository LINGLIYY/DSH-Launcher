use crate::{default_dsh_home, HarnessState, LogLine};
use anyhow::{anyhow, Result};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

fn find_dsh() -> Result<String> {
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

fn append_log(app: &AppHandle, level: &str, text: &str) {
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
        if let Some(parent) = inner.log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&inner.log_path)
            {
                let _ = writeln!(f, "[{}] {}", level, text);
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

pub async fn start(app: AppHandle, workspace: String, port: u16) -> Result<(), String> {
    let dsh_path = tauri::async_runtime::spawn_blocking(find_dsh)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let dsh_home = default_dsh_home();
    let host = "127.0.0.1".to_string();
    let url = format!("http://{host}:{port}/");

    let already_ready = {
        let u = url.clone();
        tauri::async_runtime::spawn_blocking(move || http_ready(&u))
            .await
            .unwrap_or(false)
    };
    if already_ready {
        append_log(&app, "info", &format!("检测到 {url} 已有 DSH 实例，直接接管"));
        set_status(&app, "ready", "运行中");
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
    }
    append_log(&app, "info", &format!("启动 Harness: {dsh_path} web --host {host} --port {port}"));
    append_log(&app, "info", &format!("工作区: {workspace}"));
    set_status(&app, "starting", "正在启动…");

    let _ = std::fs::create_dir_all(&dsh_home);

    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut cmd = std::process::Command::new("cmd");
    cmd.args([
        "/C",
        &dsh_path,
        "web",
        "--host",
        &host,
        "--port",
        &port.to_string(),
    ]);
    cmd.current_dir(&workspace);
    cmd.env("DSH_HOME", &dsh_home);
    cmd.env("NO_COLOR", "1");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        inner.pid = Some(pid);
        inner.child = Some(child);
    }

    if let Some(out) = stdout {
        spawn_reader(app.clone(), out, "info");
    }
    if let Some(err) = stderr {
        spawn_reader(app.clone(), err, "err");
    }

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
        loop {
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
                append_log(&app2, "info", &format!("Harness 就绪: {u}"));
                set_status(&app2, "ready", "运行中");
                let _ = open_url(&u);
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
                set_status(&app2, "error", "异常 / 超时");
                return;
            }

            if tokio::time::Instant::now() >= deadline {
                append_log(&app2, "err", "等待超时：Harness 未在 120 秒内就绪");
                set_status(&app2, "error", "异常 / 超时");
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
) {
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
    });
}

pub async fn stop(app: AppHandle) -> Result<(), String> {
    let pid = {
        let state = app.state::<HarnessState>();
        let mut inner = state.inner.lock().unwrap();
        inner.child = None;
        inner.pid.take()
    };
    if let Some(pid) = pid {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    append_log(&app, "info", "Harness 已停止");
    set_status(&app, "stopped", "已停止");
    Ok(())
}
