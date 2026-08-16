use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub workspace: String,
    pub cwd: String,
    pub title: String,
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Serialize)]
pub struct Block {
    pub kind: String,
    pub text: String,
}

fn sessions_root() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\".to_string());
    PathBuf::from(base)
        .join("dsh-desktop")
        .join("harness")
        .join("sessions")
}

fn data_file(session_dir: &Path) -> Option<PathBuf> {
    for name in ["session.jsonl.zstd", "session.jsonl"] {
        let p = session_dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn decode(path: &Path) -> std::io::Result<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    zstd::stream::decode_all(file)
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

fn header_and_title(text: &str) -> (String, String) {
    let mut cwd = String::new();
    let mut title = String::new();
    for line in text.lines().take(200) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            match v.get("type").and_then(|t| t.as_str()) {
                Some("session") => {
                    if let Some(c) = v.pointer("/cwd").and_then(|c| c.as_str()) {
                        cwd = c.to_string();
                    }
                }
                Some("session/title") => {
                    if let Some(t) = v.pointer("/data/title").and_then(|t| t.as_str()) {
                        title = t.to_string();
                    }
                    break;
                }
                _ => {}
            }
        }
    }
    if title.is_empty() {
        title = "未命名会话".to_string();
    }
    (cwd, title)
}

pub fn list(filter: &str) -> Vec<SessionInfo> {
    let root = sessions_root();
    let mut out = Vec::new();
    if !root.is_dir() {
        return out;
    }
    for ws in std::fs::read_dir(&root).into_iter().flatten().flatten() {
        let ws_dir = ws.path();
        if !ws_dir.is_dir() {
            continue;
        }
        let ws_name = ws.file_name().to_string_lossy().into_owned();
        for sid in std::fs::read_dir(&ws_dir).into_iter().flatten().flatten() {
            let sid_dir = sid.path();
            if !sid_dir.is_dir() {
                continue;
            }
            let Some(file) = data_file(&sid_dir) else {
                continue;
            };
            let Ok(meta) = std::fs::metadata(&file) else {
                continue;
            };
            let bytes = match decode(&file) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let text = String::from_utf8_lossy(&bytes);
            let (cwd, title) = header_and_title(&text);
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let info = SessionInfo {
                id: sid.file_name().to_string_lossy().into_owned(),
                workspace: ws_name.clone(),
                cwd: cwd.clone(),
                title: title.clone(),
                mtime_ms,
                size: meta.len(),
            };
            let hay = format!("{} {} {}", title, ws_name, cwd).to_lowercase();
            if filter.is_empty() || hay.contains(&filter.to_lowercase()) {
                out.push(info);
            }
        }
    }
    out.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    out
}

fn find_file_by_id(id: &str) -> Result<PathBuf, String> {
    let root = sessions_root();
    let entries =
        std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for ws in entries.flatten() {
        let sid = ws.path().join(id);
        if sid.is_dir() {
            if let Some(f) = data_file(&sid) {
                return Ok(f);
            }
        }
    }
    Err("会话不存在".to_string())
}

fn find_dir_by_id(id: &str) -> Result<PathBuf, String> {
    let root = sessions_root();
    let entries =
        std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for ws in entries.flatten() {
        let sid = ws.path().join(id);
        if sid.is_dir() {
            return Ok(sid);
        }
    }
    Err("会话不存在".to_string())
}

fn blocks_text(blocks: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(arr) = blocks.as_array() {
        for b in arr {
            if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                    parts.push(t);
                }
            }
        }
    }
    parts.join("\n")
}

fn is_system_reminder(text: &str) -> bool {
    text.contains("<system-reminder>")
        || text.starts_with("Current runtime context.")
        || text.starts_with("You are an AI programming assistant")
}

fn render_text(text: &str) -> Vec<Block> {
    let mut out = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(t) = v.get("type").and_then(|t| t.as_str()) else {
            continue;
        };
        match t {
            "user/message" => {
                let t = blocks_text(&v["data"]["content"]);
                if !t.is_empty() && !is_system_reminder(&t) {
                    out.push(Block {
                        kind: "user".to_string(),
                        text: t,
                    });
                }
            }
            "assistant/message" => {
                let t = blocks_text(&v["data"]["message"]["content"]);
                if !t.is_empty() {
                    out.push(Block {
                        kind: "assistant".to_string(),
                        text: t,
                    });
                }
            }
            "tool/call" => {
                let name = v["data"]["name"].as_str().unwrap_or("");
                let args = v["data"]["arguments"].as_str().unwrap_or("");
                let s = format!("工具调用\n{}\n{}", name, truncate_chars(args, 400));
                out.push(Block {
                    kind: "tool".to_string(),
                    text: s,
                });
            }
            "tool/result" => {
                let content = &v["data"]["message"]["content"];
                let t = if let Some(arr) = content.as_array() {
                    arr.iter()
                        .filter_map(|b| {
                            if b.get("type").and_then(|t| t.as_str()) == Some("tool-result") {
                                Some(blocks_text(&b["content"]))
                            } else {
                                None
                            }
                        })
                        .next()
                        .unwrap_or_default()
                } else {
                    String::new()
                };
                if !t.is_empty() {
                    out.push(Block {
                        kind: "result".to_string(),
                        text: truncate_chars(&t, 600),
                    });
                }
            }
            _ => {}
        }
    }
    if out.is_empty() {
        out.push(Block {
            kind: "info".to_string(),
            text: "（空会话）".to_string(),
        });
    }
    out
}

pub fn render_by_id(id: &str) -> Result<Vec<Block>, String> {
    let file = find_file_by_id(id)?;
    let bytes = decode(&file).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(render_text(&text))
}

pub fn delete_by_id(id: &str) -> Result<String, String> {
    let sid_dir = find_dir_by_id(id)?;
    let root = sessions_root();
    let trash = root
        .parent()
        .map(|p| p.join("sessions_trash"))
        .unwrap_or_else(|| root.join("sessions_trash"));
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = trash.join(format!("{}_{}", stamp, id));
    std::fs::rename(&sid_dir, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}
