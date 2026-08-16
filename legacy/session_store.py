#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH 会话管理：扫描 / 查看 / 删除（移入备份，可恢复）。

会话文件位于 %APPDATA%\\dsh-desktop\\harness\\sessions\\<workspace>\\<id>\\session.jsonl.zstd
删除时不会硬删，而是移动到 sessions_trash 备份目录。
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path


class SessionInfo:
    __slots__ = ("session_id", "workspace", "cwd", "dir_path", "size", "mtime", "title", "created")

    def __init__(self, session_id, workspace, cwd, dir_path, size, mtime, title, created):
        self.session_id = session_id
        self.workspace = workspace
        self.cwd = cwd
        self.dir_path = dir_path
        self.size = size
        self.mtime = mtime
        self.title = title
        self.created = created


def _open_text(path: Path):
    """优先用 zstandard 流式解压；失败时回退为普通文本。"""
    try:
        import zstandard
        return zstandard.open(str(path), "rt", encoding="utf-8", errors="replace")
    except ImportError:
        return None
    except Exception:
        try:
            return open(path, "r", encoding="utf-8", errors="replace")
        except OSError:
            return None


def scan(sessions_root: Path):
    """扫描会话目录，返回按 workspace 分组的 SessionInfo 列表。"""
    entries = []
    if not sessions_root.is_dir():
        return entries
    for ws_dir in sorted(sessions_root.iterdir()):
        if not ws_dir.is_dir():
            continue
        workspace = ws_dir.name
        for sid_dir in sorted(ws_dir.iterdir()):
            if not sid_dir.is_dir():
                continue
            data_file = sid_dir / "session.jsonl.zstd"
            if not data_file.exists():
                data_file = sid_dir / "session.jsonl"
            if not data_file.exists():
                continue
            try:
                st = data_file.stat()
            except OSError:
                continue
            title = None
            created = None
            handle = _open_text(data_file)
            if handle is not None:
                try:
                    for _ in range(80):
                        line = handle.readline()
                        if not line:
                            break
                        try:
                            rec = json.loads(line)
                        except Exception:
                            continue
                        t = rec.get("type")
                        if t == "session":
                            created = rec.get("createdAt")
                            cwd = rec.get("cwd")
                        elif t == "session/title" and title is None:
                            title = (rec.get("data") or {}).get("title")
                            break
                finally:
                    try:
                        handle.close()
                    except Exception:
                        pass
            entries.append(
                SessionInfo(
                    session_id=sid_dir.name,
                    workspace=workspace,
                    cwd=created and cwd or "",
                    dir_path=sid_dir,
                    size=st.st_size,
                    mtime=st.st_mtime,
                    title=title or "未命名会话",
                    created=created,
                )
            )
    return entries


def _blocks_text(blocks):
    if not isinstance(blocks, list):
        return ""
    parts = []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "text" and b.get("text"):
            parts.append(b["text"])
    return "\n".join(parts)


def render(path: Path):
    """把会话日志渲染成可读的 [(kind, text)] 列表。kind: user/assistant/tool/result/info/error"""
    handle = _open_text(path)
    if handle is None:
        return [("error", "无法读取会话文件（可能需要 pip install zstandard）")]
    out = []
    try:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            t = rec.get("type")
            d = rec.get("data") or {}
            if t == "user/message":
                text = _blocks_text(d.get("content"))
                if text and (
                    "<system-reminder>" in text
                    or text.startswith("Current runtime context.")
                    or text.startswith("You are an AI programming assistant")
                ):
                    text = ""
                if text:
                    out.append(("user", text))
            elif t == "assistant/message":
                blocks = ((d.get("message") or {}).get("content")) or []
                text = "\n".join(
                    b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text" and b.get("text")
                )
                if text:
                    out.append(("assistant", text))
            elif t == "tool/call":
                args = str(d.get("arguments", ""))
                if len(args) > 400:
                    args = args[:400] + "…"
                out.append(("tool", f"[工具] {d.get('name', '')}\n{args}"))
            elif t == "tool/result":
                blocks = ((d.get("message") or {}).get("content")) or []
                text = ""
                for b in blocks:
                    if not isinstance(b, dict) or b.get("type") != "tool-result":
                        continue
                    text = _blocks_text(b.get("content"))
                    break
                if text:
                    if len(text) > 600:
                        text = text[:600] + "\n…（结果已截断）"
                    out.append(("result", text))
    finally:
        try:
            handle.close()
        except Exception:
            pass
    if not out:
        out = [("info", "（空会话）")]
    return out


def delete(sid_dir: Path, trash_root: Path):
    """把会话目录移入备份目录，可恢复。返回备份路径。"""
    stamp = time.strftime("%Y%m%d_%H%M%S")
    dest = trash_root / f"{stamp}_{sid_dir.name}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(sid_dir), str(dest))
    return dest


def format_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.0f} KB"
    return f"{size / 1024 / 1024:.1f} MB"


def format_time(ts) -> str:
    if not ts:
        return ""
    try:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))
    except Exception:
        return ""
