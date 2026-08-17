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

#[derive(Serialize)]
pub struct TrashInfo {
    pub id: String,
    pub workspace: String,
    pub title: String,
    pub deleted_ms: u64,
    pub size: u64,
}

#[derive(Serialize)]
pub struct SessionHit {
    pub id: String,
    pub workspace: String,
    pub title: String,
    pub mtime_ms: u64,
    pub snippet: String,
}

fn sessions_root() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\".to_string());
    PathBuf::from(base)
        .join("dsh-desktop")
        .join("harness")
        .join("sessions")
}

fn trash_root() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\".to_string());
    PathBuf::from(base)
        .join("dsh-desktop")
        .join("harness")
        .join("sessions_trash")
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

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains(':')
        && id.chars().all(|c| !c.is_control())
}

const MAX_SESSION_BYTES: u64 = 64 * 1024 * 1024;

fn decode(path: &Path) -> std::io::Result<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    if file.metadata()?.len() > MAX_SESSION_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "session file too large",
        ));
    }
    use std::io::Read;
    let decoder = zstd::stream::read::Decoder::new(file)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let mut out = Vec::new();
    decoder
        .take(MAX_SESSION_BYTES + 1)
        .read_to_end(&mut out)?;
    if out.len() as u64 > MAX_SESSION_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "session decoded too large",
        ));
    }
    Ok(out)
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

fn make_snippet(text: &str, byte_pos: usize) -> String {
    let mut safe = byte_pos.min(text.len());
    while safe > 0 && !text.is_char_boundary(safe) {
        safe -= 1;
    }
    let chars: Vec<char> = text.chars().collect();
    let match_idx = text[..safe].chars().count();
    let start = match_idx.saturating_sub(45);
    let end = (match_idx + 90).min(chars.len());
    let seg: String = chars[start..end].iter().collect();
    let mut s = seg.replace(['\n', '\r'], " ");
    if start > 0 {
        s = format!("…{s}");
    }
    if end < chars.len() {
        s.push('…');
    }
    s
}

pub fn search(query: &str, limit: usize) -> Vec<SessionHit> {
    let q = query.trim().to_lowercase();
    let mut out = Vec::new();
    if q.is_empty() {
        return out;
    }
    let root = sessions_root();
    if !root.is_dir() {
        return out;
    }
    'outer: for ws in std::fs::read_dir(&root).into_iter().flatten().flatten() {
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
            let Ok(bytes) = decode(&file) else {
                continue;
            };
            let text = String::from_utf8_lossy(&bytes).into_owned();
            let lower = text.to_lowercase();
            let Some(pos) = lower.find(&q) else {
                continue;
            };
            let (_, title) = header_and_title(&text);
            let mtime_ms = std::fs::metadata(&file)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(SessionHit {
                id: sid.file_name().to_string_lossy().into_owned(),
                workspace: ws_name.clone(),
                title: title.clone(),
                mtime_ms,
                snippet: make_snippet(&text, pos),
            });
            if out.len() >= limit.max(1) {
                break 'outer;
            }
        }
    }
    out.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    out
}

fn find_file_by_id(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("非法会话 ID".to_string());
    }
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
    if !valid_id(id) {
        return Err("非法会话 ID".to_string());
    }
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
    let trash = trash_root();
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let workspace = sid_dir
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = trash.join(format!("{}_{}", stamp, id));
    std::fs::rename(&sid_dir, &dest).map_err(|e| e.to_string())?;
    let meta = serde_json::json!({
        "id": id,
        "workspace": workspace,
        "deletedAt": stamp,
    });
    let _ = std::fs::write(
        dest.join("_trash_meta.json"),
        serde_json::to_string_pretty(&meta).unwrap_or_default(),
    );
    Ok(dest.to_string_lossy().into_owned())
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            total += dir_size(&p);
        } else if let Ok(m) = p.metadata() {
            total += m.len();
        }
    }
    total
}

fn read_trash_meta(dir: &Path) -> (String, String) {
    let mut id = String::new();
    let mut workspace = String::new();
    if let Ok(txt) = std::fs::read_to_string(dir.join("_trash_meta.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(x) = v.get("id").and_then(|x| x.as_str()) {
                id = x.to_string();
            }
            if let Some(x) = v.get("workspace").and_then(|x| x.as_str()) {
                workspace = x.to_string();
            }
        }
    }
    (id, workspace)
}

pub fn list_trash() -> Vec<TrashInfo> {
    let root = trash_root();
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&root) else {
        return out;
    };
    for entry in rd.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let (id, workspace) = read_trash_meta(&dir);
        let id = if id.is_empty() {
            // 兼容旧的命名方式：<stamp>_<id>
            entry
                .file_name()
                .to_string_lossy()
                .rsplit_once('_')
                .map(|(_, i)| i.to_string())
                .unwrap_or_else(|| entry.file_name().to_string_lossy().into_owned())
        } else {
            id
        };
        let title = data_file(&dir)
            .and_then(|f| decode(&f).ok())
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .map(|t| header_and_title(&t).1)
            .unwrap_or_else(|| "未命名会话".to_string());
        let deleted_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(TrashInfo {
            id,
            workspace,
            title,
            deleted_ms,
            size: dir_size(&dir),
        });
    }
    out.sort_by(|a, b| b.deleted_ms.cmp(&a.deleted_ms));
    out
}

fn find_trash_dir(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("非法会话 ID".to_string());
    }
    let root = trash_root();
    let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let (mid, _) = read_trash_meta(&dir);
        if mid == id {
            return Ok(dir);
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(&format!("_{id}")) {
            return Ok(dir);
        }
    }
    Err("回收站中未找到该会话".to_string())
}

pub fn restore_by_id(id: &str) -> Result<String, String> {
    let trash_dir = find_trash_dir(id)?;
    let (_, workspace) = read_trash_meta(&trash_dir);
    let mut workspace = if workspace.is_empty() {
        "--restored--".to_string()
    } else {
        workspace
    };
    if !valid_id(&workspace) {
        workspace = "--restored--".to_string();
    }
    let root = sessions_root();
    let target = root.join(&workspace).join(id);
    if target.exists() {
        return Err(format!("会话 {id} 已存在，无法恢复"));
    }
    std::fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::rename(&trash_dir, &target).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(target.join("_trash_meta.json"));
    Ok(target.to_string_lossy().into_owned())
}

pub fn purge_by_id(id: &str) -> Result<(), String> {
    let dir = find_trash_dir(id)?;
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

pub fn empty_trash() -> Result<usize, String> {
    let root = trash_root();
    let mut count = 0;
    if let Ok(rd) = std::fs::read_dir(&root) {
        for entry in rd.flatten() {
            if entry.path().is_dir() {
                std::fs::remove_dir_all(entry.path()).map_err(|e| e.to_string())?;
                count += 1;
            }
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_id_rejects_bad_ids() {
        assert!(!valid_id(""));
        assert!(!valid_id("."));
        assert!(!valid_id(".."));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("a\\b"));
        assert!(!valid_id("a:b"));
        assert!(!valid_id("a\u{1}b"));
    }

    #[test]
    fn valid_id_accepts_normal_id() {
        assert!(valid_id("abc-123"));
    }

    #[test]
    fn truncate_chars_short_text_unchanged() {
        assert_eq!(truncate_chars("abc", 5), "abc");
        assert_eq!(truncate_chars("你好", 4), "你好");
        assert_eq!(truncate_chars("你好世界", 4), "你好世界");
    }

    #[test]
    fn truncate_chars_appends_ellipsis() {
        let s = truncate_chars("你好世界", 3);
        assert_eq!(s, "你好世…");
        assert!(s.ends_with('…'));
        assert_eq!(s.chars().last(), Some('…'));
    }

    #[test]
    fn make_snippet_keeps_original_case_and_handles_non_boundary() {
        let text = "Hello 世界 World";
        // byte 10 lands inside "界" (bytes 9..=11), so it exercises the
        // char-boundary walk-back and must not panic.
        let snippet = make_snippet(text, 10);
        assert!(snippet.contains('W'), "snippet lost original case: {snippet}");
        assert!(snippet.contains("Hello"), "snippet: {snippet}");
        assert!(snippet.contains("世界"), "snippet: {snippet}");
        assert!(!snippet.contains("hello"), "snippet was lowercased: {snippet}");
    }

    #[test]
    fn header_and_title_extracts_cwd_and_title() {
        let text = "{\"type\":\"session\",\"cwd\":\"C:\\\\work\"}\n\
                    {\"type\":\"session/title\",\"data\":{\"title\":\"我的会话\"}}\n";
        let (cwd, title) = header_and_title(text);
        assert_eq!(cwd, "C:\\work");
        assert_eq!(title, "我的会话");
    }

    #[test]
    fn header_and_title_defaults_when_no_title() {
        let text = "{\"type\":\"session\",\"cwd\":\"C:\\\\work\"}\n";
        let (cwd, title) = header_and_title(text);
        assert_eq!(cwd, "C:\\work");
        assert_eq!(title, "未命名会话");
    }

    #[test]
    fn render_text_builds_blocks_in_order() {
        let text = concat!(
            "{\"type\":\"user/message\",\"data\":{\"content\":[{\"type\":\"text\",\"text\":\"你好\"}]}}\n",
            "{\"type\":\"assistant/message\",\"data\":{\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"有什么可以帮你？\"}]}}}\n",
            "{\"type\":\"tool/call\",\"data\":{\"name\":\"read_file\",\"arguments\":\"read file\"}}\n",
            "{\"type\":\"tool/result\",\"data\":{\"message\":{\"content\":[{\"type\":\"tool-result\",\"content\":[{\"type\":\"text\",\"text\":\"file contents\"}]}]}}}\n",
        );
        let blocks = render_text(text);
        let kinds: Vec<&str> = blocks.iter().map(|b| b.kind.as_str()).collect();
        assert_eq!(kinds, vec!["user", "assistant", "tool", "result"]);
        assert_eq!(blocks[0].text, "你好");
        assert_eq!(blocks[1].text, "有什么可以帮你？");
        assert_eq!(blocks[2].text, "工具调用\nread_file\nread file");
        assert_eq!(blocks[3].text, "file contents");
    }

    #[test]
    fn render_text_filters_system_reminder() {
        let text = concat!(
            "{\"type\":\"user/message\",\"data\":{\"content\":[{\"type\":\"text\",\"text\":\"<system-reminder>忽略我</system-reminder>\"}]}}\n",
            "{\"type\":\"user/message\",\"data\":{\"content\":[{\"type\":\"text\",\"text\":\"正常提问\"}]}}\n",
        );
        let blocks = render_text(text);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, "user");
        assert_eq!(blocks[0].text, "正常提问");
    }

    #[test]
    fn render_text_empty_input_returns_info_block() {
        let blocks = render_text("");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].kind, "info");
        assert_eq!(blocks[0].text, "（空会话）");
    }
}
