#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH Desktop 托盘 + 控制台窗口模式。

本模块不依赖 dsh 主程运行，只负责：启动/停止 Harness（后台静默执行）、
状态显示、日志、系统托盘、轻量控制台窗口、会话管理（浏览/搜索/查看/删除备份）。
由 launch.py 的 --tray 参数调用。
"""

from __future__ import annotations

import os
import queue
import subprocess
import threading
import time
import webbrowser
from pathlib import Path

APP_NAME = "DSH Desktop"
POLL_MS = 200

# 浅蓝 + 白主题（基于 Kimi 排版评审建议）
BG = "#F1F5F9"
PANEL = "#FFFFFF"
CARD = "#FFFFFF"
ELEVATED = "#EFF6FF"
INPUT_BG = "#F8FAFC"
BORDER = "#E2E8F0"
FG = "#1E293B"
MUT = "#64748B"
ACCENT = "#2563EB"
ACCENT_DARK = "#1D4ED8"
ACCENT_LIGHT = "#EFF6FF"
OK = "#059669"
WARN = "#D97706"
ERR = "#DC2626"
INFO = "#2563EB"
LOG_FG = "#334155"
STATUS_BG = "#E8EDF3"


class HarnessManager:
    """管理 dsh web 子进程的生命周期、状态与日志（线程安全，操作不阻塞 UI）。"""

    def __init__(self, helpers, dsh, host, port, workspace, dsh_home, log_path, notify):
        self.h = helpers
        self.dsh = dsh
        self.host = host
        self.port = port
        self.workspace = os.path.abspath(workspace)
        self.dsh_home = dsh_home
        self.log_path = Path(log_path)
        self.notify = notify
        self.url = f"http://{host}:{port}/"
        self.proc = None
        self.status = "stopped"
        self.busy = False
        self.lines = []
        self.count = 0
        self._lock = threading.Lock()

    def _log(self, line):
        line = line.rstrip()
        if not line:
            return
        with self._lock:
            self.lines.append(line)
            if len(self.lines) > 1200:
                del self.lines[: len(self.lines) - 1200]
            self.count += 1
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {line}\n")
        except OSError:
            pass
        self.notify("log")

    def _set_status(self, status):
        with self._lock:
            self.status = status
        self._log(f"状态: {status}")
        self.notify("status")

    def _set_busy(self, busy):
        with self._lock:
            self.busy = busy
        self.notify("status")

    def start(self, workspace=None):
        with self._lock:
            if self.proc is not None and self.proc.poll() is None:
                self._log("Harness 已在运行，无需重复启动")
                return
            if self.busy:
                self._log("正在执行其他操作，请稍候")
                return
            self.busy = True
        try:
            if workspace:
                self.workspace = os.path.abspath(workspace)
            if self.h["http_ready"](self.url):
                self._log(f"检测到 {self.url} 已有 DSH 实例，直接接管")
                self._set_status("ready")
                return
            os.makedirs(self.dsh_home, exist_ok=True)
            env = {**os.environ, "DSH_HOME": self.dsh_home, "NO_COLOR": "1"}
            creationflags = 0
            if os.name == "nt":
                creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
            self._log(f"启动 Harness: {self.dsh} web --host {self.host} --port {self.port}")
            self._log(f"工作区: {self.workspace}")
            self._set_status("starting")
            proc = subprocess.Popen(
                [self.dsh, "web", "--host", self.host, "--port", str(self.port)],
                cwd=self.workspace,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=creationflags,
            )
            with self._lock:
                self.proc = proc
            threading.Thread(target=self._pump, args=(proc.stdout, "out"), daemon=True).start()
            threading.Thread(target=self._pump, args=(proc.stderr, "err"), daemon=True).start()
            threading.Thread(target=self._wait_ready, args=(proc,), daemon=True).start()
        finally:
            self._set_busy(False)

    def _pump(self, stream, tag):
        try:
            for raw in stream:
                self._log(f"[{tag}] " + raw.decode("utf-8", errors="replace").rstrip())
        except Exception:
            pass

    def _wait_ready(self, proc):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            with self._lock:
                if self.proc is not proc or proc.poll() is not None:
                    if proc.poll() is not None:
                        self._log(f"Harness 进程已退出（code={proc.returncode}）")
                        self._set_status("error")
                    return
            if self.h["http_ready"](self.url):
                self._log(f"Harness 就绪: {self.url}")
                self._set_status("ready")
                return
            time.sleep(1)
        self._log("等待超时：Harness 未在 120 秒内就绪")
        self._set_status("error")

    def stop(self):
        with self._lock:
            proc, self.proc = self.proc, None
            if proc is None or self.busy:
                if proc is None:
                    self._log("Harness 未在运行")
                else:
                    self._log("正在执行其他操作，请稍候")
                return
            self.busy = True
        try:
            self._log("正在停止 Harness…")
            self.h["kill_tree"](proc)
            self._set_status("stopped")
        finally:
            self._set_busy(False)

    def is_running(self):
        with self._lock:
            return self.proc is not None and self.proc.poll() is None

    def open_browser(self):
        webbrowser.open(self.url)
        self._log(f"打开浏览器: {self.url}")


def _setup_styles(root):
    import tkinter as tk
    from tkinter import ttk

    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure(".", background=BG, foreground=FG, fieldbackground=PANEL, bordercolor=CARD)
    style.configure("TFrame", background=BG)
    style.configure("Card.TFrame", background=CARD)
    style.configure("TLabel", background=BG, foreground=FG)
    style.configure("Muted.TLabel", background=BG, foreground=MUT)
    style.configure("Card.TLabel", background=CARD, foreground=FG)
    style.configure("Info.TLabel", background=CARD, foreground=INFO)
    style.configure(
        "TButton",
        background=PANEL,
        foreground="#475569",
        bordercolor=BORDER,
        focuscolor=PANEL,
        padding=(14, 6),
        relief="flat",
    )
    style.map("TButton", background=[("active", BG), ("disabled", "#F8FAFC")])
    style.configure(
        "Accent.TButton",
        background=ACCENT,
        foreground="#ffffff",
        bordercolor=ACCENT,
        padding=(16, 6),
        relief="flat",
    )
    style.map("Accent.TButton", background=[("active", ACCENT_DARK), ("disabled", "#BFDBFE")])
    style.configure(
        "Danger.TButton",
        background=PANEL,
        foreground=ERR,
        bordercolor="#FECACA",
        padding=(14, 6),
        relief="flat",
    )
    style.map("Danger.TButton", background=[("active", "#FEF2F2"), ("disabled", "#F8FAFC")])
    style.configure("TEntry", fieldbackground=INPUT_BG, foreground=FG, insertcolor=FG, bordercolor=BORDER)
    style.configure(
        "TNotebook",
        background=BG,
        borderwidth=0,
        tabmargins=(8, 6, 8, 0),
    )
    style.configure(
        "TNotebook.Tab",
        background=BG,
        foreground=MUT,
        padding=(20, 8),
        borderwidth=0,
    )
    style.map("TNotebook.Tab", background=[("selected", CARD)], foreground=[("selected", ACCENT)])
    style.configure(
        "Treeview",
        background=CARD,
        fieldbackground=CARD,
        foreground=FG,
        bordercolor=CARD,
        rowheight=28,
    )
    style.configure(
        "Treeview.Heading",
        background="#F8FAFC",
        foreground=MUT,
        bordercolor=CARD,
        padding=(6, 4),
    )
    style.map("Treeview", background=[("selected", ACCENT_LIGHT)], foreground=[("selected", ACCENT)])


def _file_log(log_path, msg):
    """直接写日志文件（pystray 线程/早期阶段用，pythonw 无控制台）。"""
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except OSError:
        pass


class SessionsPanel:
    """会话管理页：按工作区分组浏览、搜索、查看内容、删除（移入备份）。"""

    def __init__(self, parent, store, sessions_root, trash_root, notify_log):
        import tkinter as tk
        from tkinter import ttk

        self.store = store
        self.sessions_root = sessions_root
        self.trash_root = trash_root
        self.notify_log = notify_log
        self.sessions = []
        self._key2info = {}

        frame = ttk.Frame(parent)
        toolbar = ttk.Frame(frame, padding=(8, 6))
        toolbar.pack(fill="x")
        ttk.Button(toolbar, text="刷新", command=self.refresh).pack(side="left")
        ttk.Button(toolbar, text="删除会话（进备份）", command=self._confirm_delete).pack(side="left", padx=(6, 0))
        ttk.Button(toolbar, text="打开备份目录", command=self._open_trash).pack(side="left", padx=(6, 0))
        self.search_var = tk.StringVar()
        search_entry = ttk.Entry(toolbar, textvariable=self.search_var, width=26)
        search_entry.pack(side="right")
        ttk.Label(toolbar, text="搜索").pack(side="right", padx=(0, 4))
        search_entry.bind("<Return>", lambda e: self.refresh())

        paned = ttk.Panedwindow(frame, orient="horizontal")
        paned.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        self.tree = ttk.Treeview(paned, columns=("time", "size"), show="tree headings")
        self.tree.heading("#0", text="会话")
        self.tree.heading("time", text="时间")
        self.tree.heading("size", text="大小")
        self.tree.column("#0", width=320, anchor="w")
        self.tree.column("time", width=130, anchor="w")
        self.tree.column("size", width=80, anchor="e")
        self.tree.bind("<<TreeviewSelect>>", self._on_select)
        self.tree.column("#0", minwidth=280, width=300)
        paned.add(self.tree, weight=1)

        self.view = tk.Text(paned, bg=CARD, fg=FG, wrap="word", relief="flat", padx=16, pady=12)
        self.view.tag_configure("user", foreground=INFO, spacing1=8)
        self.view.tag_configure("assistant", foreground=FG, spacing1=8)
        self.view.tag_configure("tool", foreground=WARN, spacing1=4)
        self.view.tag_configure("result", foreground=MUT, spacing1=4)
        self.view.tag_configure("error", foreground=ERR)
        self.view.tag_configure("h1", foreground=MUT, spacing1=2)
        sb = ttk.Scrollbar(self.view, command=self.view.yview)
        self.view.configure(yscrollcommand=sb.set)
        paned.add(self.view, weight=2)

        bottom = ttk.Frame(frame)
        bottom.pack(fill="x", padx=8, pady=(0, 8))
        self.stats_var = tk.StringVar(value="")
        ttk.Label(bottom, textvariable=self.stats_var, style="Muted.TLabel").pack(side="left")
        ttk.Label(bottom, text="双击/单击会话查看内容", style="Muted.TLabel").pack(side="right")

        self.menu = tk.Menu(frame, tearoff=0, bg=PANEL, fg=FG, activebackground=ELEVATED, activeforeground=FG)
        self.menu.add_command(label="删除会话（进备份）", command=self._confirm_delete)
        self.menu.add_command(label="复制会话 ID", command=self._copy_id)
        self.tree.bind("<Button-3>", self._on_right_click)

        search_entry.bind("<KeyRelease>", lambda e: self.refresh())
        self.refresh()
        frame.pack(fill="both", expand=True)

    def refresh(self):
        import session_store

        self.sessions = session_store.scan(self.sessions_root)
        keyword = self.search_var.get().strip().lower()
        self.tree.delete(*self.tree.get_children())
        self._key2info = {}
        by_ws = {}
        for info in self.sessions:
            if keyword and keyword not in (info.title + " " + info.workspace + " " + (info.cwd or "")).lower():
                continue
            by_ws.setdefault(info.workspace, []).append(info)
        for ws in sorted(by_ws):
            parent = self.tree.insert("", "end", iid="ws:" + ws, text=ws, open=True)
            for info in sorted(by_ws[ws], key=lambda i: i.mtime, reverse=True):
                iid = f"{ws}|{info.session_id}"
                self._key2info[iid] = info
                label = info.title
                if len(label) > 46:
                    label = label[:46] + "…"
                self.tree.insert(
                    parent,
                    "end",
                    iid=iid,
                    text=label,
                    values=(session_store.format_time(info.mtime), session_store.format_size(info.size)),
                )
        ws_count = len(by_ws)
        sess_count = sum(len(v) for v in by_ws.values())
        self.stats_var.set(f"共 {ws_count} 个工作区，{sess_count} 个会话")

    def _on_right_click(self, event):
        item = self.tree.identify_row(event.y)
        if item:
            self.tree.selection_set(item)
            self.menu.tk_popup(event.x_root, event.y_root)

    def _copy_id(self):
        import tkinter as tk

        sel = self.tree.selection()
        if not sel:
            return
        info = self._key2info.get(sel[0])
        if info is None:
            return
        self.view.clipboard_clear()
        self.view.clipboard_append(info.session_id)
        self.notify_log(f"已复制会话 ID: {info.session_id}")

    def _on_select(self, _event):
        sel = self.tree.selection()
        if not sel:
            return
        info = self._key2info.get(sel[0])
        if info is None:
            return
        self.view.config(state="normal")
        self.view.delete("1.0", "end")
        self.view.insert("end", f"正在加载：{info.session_id} …\n", "h1")
        self.view.config(state="disabled")
        threading.Thread(target=self._load, args=(info,), daemon=True).start()

    def _load(self, info):
        import session_store

        try:
            rendered = session_store.render(info.dir_path / "session.jsonl.zstd")
        except Exception as exc:
            rendered = [("error", f"读取失败：{exc}")]
        self.notify_log(("session_view", rendered))

    def apply_view(self, rendered):
        self.view.config(state="normal")
        self.view.delete("1.0", "end")
        for kind, text in rendered:
            prefix = {
                "user": "用户\n",
                "assistant": "助手\n",
                "tool": "工具调用\n",
                "result": "工具结果\n",
                "info": "",
                "error": "",
            }.get(kind, "")
            self.view.insert("end", prefix + text + "\n\n", kind)
        self.view.config(state="disabled")

    def _confirm_delete(self):
        import tkinter as tk
        from tkinter import messagebox
        import session_store

        sel = self.tree.selection()
        if not sel:
            return
        info = self._key2info.get(sel[0])
        if info is None:
            return
        ok = messagebox.askyesno(
            "删除会话",
            f"确定删除会话吗？\n\n{info.title}\n（{info.workspace}）\n\n不会彻底删除，会移入备份目录，可恢复。",
        )
        if not ok:
            return
        try:
            dest = session_store.delete(info.dir_path, self.trash_root)
            self.notify_log(f"会话已移入备份: {dest}")
        except Exception as exc:
            self.notify_log(f"删除失败: {exc}")
        self.refresh()

    def _open_trash(self):
        try:
            self.trash_root.mkdir(parents=True, exist_ok=True)
            os.startfile(str(self.trash_root))
        except OSError:
            pass


class ControlWindow:
    """主窗口：状态、启停（后台执行）、日志 + 会话管理页。关闭即隐藏到托盘。"""

    def __init__(self, mgr, ui_q=None, sessions_root=None, trash_root=None):
        import tkinter as tk
        from tkinter import ttk

        self.mgr = mgr
        self.q = ui_q if ui_q is not None else queue.Queue()
        self.tray = None
        self.auto_open = False
        self._shown = 0
        self.sessions_root = sessions_root
        self.trash_root = trash_root

        self.root = tk.Tk()
        self.root.title(APP_NAME)
        self.root.geometry("900x640")
        self.root.minsize(720, 480)
        self.root.configure(bg=BG)
        ico = Path(__file__).resolve().parent / "build" / "icon.ico"
        try:
            self.root.iconbitmap(default=str(ico))
        except Exception:
            pass
        _setup_styles(self.root)

        header = ttk.Frame(self.root, padding=(20, 14))
        header.pack(fill="x")
        ttk.Label(header, text="DSH Desktop", font=("Microsoft YaHei UI", 14, "bold")).pack(side="left")
        status_frame = ttk.Frame(header)
        status_frame.pack(side="right")
        self.status_dot = tk.Canvas(status_frame, width=10, height=10, bg=BG, highlightthickness=0)
        self.status_dot.pack(side="left", padx=(0, 6))
        self.status_var = tk.StringVar(value="已停止")
        self.status_label = ttk.Label(status_frame, textvariable=self.status_var, font=("Microsoft YaHei UI", 12))
        self.status_label.pack(side="left")
        self._paint_dot("stopped")

        strip = tk.Frame(self.root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        strip.pack(fill="x", padx=20, pady=(0, 16))
        tk.Label(strip, text="工作区", bg=CARD, fg=MUT, font=("Microsoft YaHei UI", 12)).pack(side="left", padx=(16, 8), pady=10)
        self.ws_label = tk.Label(strip, text=mgr.workspace, bg=CARD, fg=FG, font=("Microsoft YaHei UI", 12), anchor="w")
        self.ws_label.pack(side="left", fill="x", expand=True, pady=10)
        self.url_label = tk.Label(strip, text=mgr.url, bg=CARD, fg=INFO, font=("Microsoft YaHei UI", 12), cursor="hand2")
        self.url_label.pack(side="right", padx=16, pady=10)
        self.url_label.bind("<Button-1>", lambda e: self._do("open"))

        footer = tk.Frame(self.root, bg=STATUS_BG, height=28)
        footer.pack(fill="x", side="bottom", padx=20, pady=(12, 0))
        footer.pack_propagate(False)
        self.foot_var = tk.StringVar(value="")
        tk.Label(footer, textvariable=self.foot_var, bg=STATUS_BG, fg="#475569", font=("Microsoft YaHei UI", 11)).pack(
            side="left", padx=16
        )
        self.stats_var = tk.StringVar(value="")
        tk.Label(footer, textvariable=self.stats_var, bg=STATUS_BG, fg="#475569", font=("Microsoft YaHei UI", 11)).pack(
            side="right", padx=16
        )

        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill="both", expand=True, padx=20, pady=(0, 8))

        console_tab = ttk.Frame(self.notebook)
        self.notebook.add(console_tab, text="控制台")
        self._build_console_tab(console_tab)

        sessions_tab = ttk.Frame(self.notebook)
        self.notebook.add(sessions_tab, text="会话管理")
        if sessions_root is not None:
            self.sessions_panel = SessionsPanel(
                sessions_tab,
                store=None,
                sessions_root=sessions_root,
                trash_root=trash_root,
                notify_log=self._notify,
            )
        else:
            ttk.Label(sessions_tab, text="未指定会话目录").pack(pady=20)
            self.sessions_panel = None

        self.root.protocol("WM_DELETE_WINDOW", self.hide)
        self.root.after(POLL_MS, self._poll)
        self._set_status_style()

    def _paint_dot(self, status):
        import tkinter as tk

        color = {
            "ready": OK,
            "starting": WARN,
            "error": ERR,
            "stopped": "#94A3B8",
        }.get(status, "#94A3B8")
        self.status_dot.delete("dot")
        self.status_dot.create_oval(1, 1, 9, 9, fill=color, outline="", tags="dot")

    def _build_console_tab(self, parent):
        import tkinter as tk
        from tkinter import scrolledtext, ttk

        card = tk.Frame(parent, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        card.pack(fill="x", pady=(0, 16))
        card.columnconfigure(1, weight=1)

        tk.Label(card, text="工作区目录", bg=CARD, fg=MUT, font=("Microsoft YaHei UI", 12), anchor="e", width=10).grid(
            row=0, column=0, sticky="e", padx=(16, 12), pady=(14, 6)
        )
        self.workspace_var = tk.StringVar(value=self.mgr.workspace)
        tk.Entry(
            card,
            textvariable=self.workspace_var,
            bg=INPUT_BG,
            fg=FG,
            relief="flat",
            highlightbackground=BORDER,
            highlightthickness=1,
            font=("Microsoft YaHei UI", 12),
        ).grid(row=0, column=1, sticky="we", pady=(14, 6))
        ttk.Button(card, text="浏览…", command=self._browse_workspace).grid(row=0, column=2, padx=(10, 16), pady=(14, 6))

        tk.Label(card, text="地址", bg=CARD, fg=MUT, font=("Microsoft YaHei UI", 12), anchor="e", width=10).grid(
            row=1, column=0, sticky="e", padx=(16, 12), pady=(6, 8)
        )
        self.url_var = tk.StringVar(value=self.mgr.url)
        tk.Entry(
            card,
            textvariable=self.url_var,
            state="readonly",
            bg=INPUT_BG,
            fg=FG,
            relief="flat",
            highlightbackground=BORDER,
            highlightthickness=1,
            font=("Microsoft YaHei UI", 12),
        ).grid(row=1, column=1, sticky="we", pady=(6, 8))
        ttk.Button(card, text="打开", command=lambda: self._do("open")).grid(row=1, column=2, padx=(10, 16), pady=(6, 8))

        btns = tk.Frame(card, bg=CARD)
        btns.grid(row=2, column=0, columnspan=3, sticky="w", padx=16, pady=(10, 16))
        self.start_btn = ttk.Button(btns, text="启动 Harness", style="Accent.TButton", command=lambda: self._do("start"))
        self.start_btn.pack(side="left")
        self.stop_btn = ttk.Button(btns, text="停止 Harness", style="Danger.TButton", command=lambda: self._do("stop"))
        self.stop_btn.pack(side="left", padx=(16, 0))
        ttk.Button(btns, text="打开浏览器", command=lambda: self._do("open")).pack(side="left", padx=(16, 0))
        ttk.Button(btns, text="打开日志目录", command=lambda: self._do("logs")).pack(side="left", padx=(8, 0))
        ttk.Button(btns, text="隐藏到托盘", command=lambda: self._do("hide")).pack(side="left", padx=(8, 0))

        log_row = tk.Frame(parent, bg=BG)
        log_row.pack(fill="both", expand=True)
        log_card = tk.Frame(log_row, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        log_card.pack(side="left", fill="both", expand=True)
        self.log_text = scrolledtext.ScrolledText(
            log_card, bg=INPUT_BG, fg=LOG_FG, relief="flat", wrap="word", font=("Consolas", 11), padx=12, pady=12
        )
        self.log_text.tag_configure("ok", foreground=OK)
        self.log_text.tag_configure("warn", foreground=WARN)
        self.log_text.tag_configure("err", foreground=ERR)
        self.log_text.tag_configure("info", foreground="#64748B")
        self.log_text.pack(side="left", fill="both", expand=True, padx=(12, 0), pady=12)
        log_bar = tk.Frame(log_card, bg=CARD)
        log_bar.pack(side="bottom", fill="x", padx=12, pady=(0, 10))
        ttk.Button(log_bar, text="清空日志", command=self._clear_log).pack(side="left")
        self.log_count_var = tk.StringVar(value="")
        tk.Label(log_bar, textvariable=self.log_count_var, bg=CARD, fg=MUT, font=("Microsoft YaHei UI", 11)).pack(
            side="right"
        )

        kanban_photo = self._load_kanban()
        if kanban_photo is not None:
            self.kanban_photo = kanban_photo
            mascot = tk.Frame(log_row, bg=BG, width=160)
            mascot.pack(side="right", fill="y")
            mascot.pack_propagate(False)
            tk.Label(mascot, image=kanban_photo, bg=BG).place(relx=0.5, rely=1.0, anchor="s", y=-14)

    def _browse_workspace(self):
        import tkinter.filedialog as fd

        current = self.workspace_var.get() or os.getcwd()
        chosen = fd.askdirectory(initialdir=current, title="选择工作区目录")
        if chosen:
            self.workspace_var.set(chosen)

    def _clear_log(self):
        with self.mgr._lock:
            self.mgr.lines.clear()
        self._shown = 0
        self.log_text.config(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.config(state="disabled")
        self.log_count_var.set("")

    def _load_kanban(self):
        """加载看板娘图片，透明区域压平到窗口背景色，用于背景装饰列。"""
        candidates = [
            Path(os.environ.get("USERPROFILE", "")) / "Pictures" / "ai生成" / "Dsh启动器看板娘" / "看板娘.png",
            Path(os.environ.get("USERPROFILE", "")) / "Pictures" / "看板娘.png",
        ]
        path = next((p for p in candidates if p.exists()), None)
        if path is None:
            return None
        try:
            from PIL import Image, ImageTk

            img = Image.open(path).convert("RGBA")
            target_h = 240
            ratio = target_h / img.height
            img = img.resize((max(1, int(img.width * ratio)), target_h), Image.LANCZOS)
            rgb = tuple(int(BG[i : i + 2], 16) for i in (1, 3, 5)) + (255,)
            base = Image.new("RGBA", img.size, rgb)
            base.alpha_composite(img)
            return ImageTk.PhotoImage(base)
        except Exception:
            return None

    def _notify(self, payload):
        if isinstance(payload, tuple) and payload and payload[0] == "session_view":
            self.q.put(("event", payload))
        else:
            self.mgr._log(str(payload))

    def _do(self, name):
        self.q.put(("action", name))

    def enqueue(self, kind):
        self.q.put(("event", kind))

    def show(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def hide(self):
        self.root.withdraw()

    def _set_status_style(self):
        color = {
            "ready": OK,
            "starting": WARN,
            "error": ERR,
            "stopped": "#94A3B8",
        }.get(self.mgr.status, "#94A3B8")
        text = {
            "ready": "运行中",
            "starting": "正在启动…",
            "error": "异常 / 超时",
            "stopped": "已停止",
        }.get(self.mgr.status, self.mgr.status)
        self.status_var.set(text)
        self._paint_dot(self.mgr.status)
        self.status_label.configure(foreground=color)
        running = self.mgr.is_running() or self.mgr.status in ("starting", "ready")
        busy = self.mgr.busy
        self.start_btn.config(state="disabled" if running or busy else "normal")
        self.stop_btn.config(state="normal" if running and not busy else "disabled")
        self.ws_label.config(text=self.mgr.workspace)
        if self.sessions_panel is not None:
            self.stats_var.set(f"端口 {self.mgr.port}  |  会话 {len(self.sessions_panel.sessions)} 个")
        else:
            self.stats_var.set(f"端口 {self.mgr.port}")
        self.foot_var.set(f"数据目录 {self.mgr.dsh_home}  |  dsh {self.mgr.dsh}")

    def _refresh_log(self):
        def tag_for(line):
            low = line.lower()
            if any(s in low for s in ("error", "fatal", "失败", "超时", "异常")) or low.startswith("[err]"):
                return "err"
            if "就绪" in low or "ready" in low or "状态: ready" in low:
                return "ok"
            if any(s in low for s in ("启动", "starting", "开始")) or low.startswith("[out]"):
                return "warn"
            return "info"

        lines = self.mgr.lines
        if self._shown > len(lines):
            self._shown = 0
        new_lines = lines[self._shown :]
        if not new_lines:
            return
        self._shown = len(lines)
        self.log_text.config(state="normal")
        for line in new_lines:
            self.log_text.insert("end", line + "\n", tag_for(line))
        self.log_text.see("end")
        self.log_text.config(state="disabled")
        self.log_count_var.set(f"共 {len(lines)} 行")

    def _poll(self):
        try:
            while True:
                item = self.q.get_nowait()
                kind, payload = item
                if kind == "event":
                    if payload == "log":
                        self._refresh_log()
                    elif payload == "status":
                        self._set_status_style()
                        if self.mgr.status == "ready" and self.auto_open:
                            self.auto_open = False
                            self.mgr.open_browser()
                    elif isinstance(payload, tuple) and payload[0] == "session_view":
                        if self.sessions_panel is not None:
                            self.sessions_panel.apply_view(payload[1])
                elif kind == "action":
                    if payload == "start":
                        workspace = self.workspace_var.get() if hasattr(self, "workspace_var") else None
                        threading.Thread(target=self.mgr.start, args=(workspace,), daemon=True).start()
                    elif payload == "stop":
                        threading.Thread(target=self.mgr.stop, daemon=True).start()
                    elif payload == "open":
                        self.mgr.open_browser()
                    elif payload == "logs":
                        try:
                            os.startfile(str(self.mgr.log_path.parent))
                        except OSError:
                            pass
                    elif payload == "hide":
                        self.hide()
                    elif payload == "show":
                        self.show()
                    elif payload == "exit":
                        threading.Thread(target=self.mgr.stop, daemon=True).start()
                        if self.tray is not None:
                            self.tray.stop()
                        self.root.quit()
                        return
        except queue.Empty:
            pass
        self.root.after(POLL_MS, self._poll)


class TrayIcon:
    """系统托盘图标：显示/打开/启动/停止/退出。"""

    def __init__(self, mgr, window):
        import pystray
        from PIL import Image

        self.mgr = mgr
        self.window = window
        img_path = Path(__file__).resolve().parent / "build" / "icon.png"
        image = Image.open(img_path).convert("RGBA").resize((64, 64), Image.LANCZOS)
        menu = pystray.Menu(
            pystray.MenuItem("显示控制台", lambda: window.action("show"), default=True),
            pystray.MenuItem(
                "打开 DSH 界面",
                lambda: window.action("open"),
                enabled=lambda item: mgr.status == "ready",
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "启动 Harness",
                lambda: window.action("start"),
                visible=lambda item: not mgr.is_running() and mgr.status != "starting",
            ),
            pystray.MenuItem(
                "停止 Harness",
                lambda: window.action("stop"),
                visible=lambda item: mgr.is_running() or mgr.status == "starting",
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出", lambda: window.action("exit")),
        )
        self.icon = pystray.Icon("dsh-desktop", image, APP_NAME, menu)

    def run(self):
        """在主线程运行托盘消息循环；异常写日志（pythonw 无控制台，不能静默）。"""
        import threading

        _file_log(self.mgr.log_path, f"托盘线程启动: {threading.current_thread().name}")

        def probe():
            time.sleep(3)
            _file_log(
                self.mgr.log_path,
                f"托盘状态探针: running={getattr(self.icon, '_running', None)} visible={getattr(self.icon, 'visible', None)}",
            )

        threading.Thread(target=probe, daemon=True).start()
        try:
            self.icon.visible = True
            self.icon.run()
            _file_log(self.mgr.log_path, "托盘消息循环已退出")
        except Exception as exc:
            _file_log(self.mgr.log_path, f"托盘异常: {exc!r}")

    def stop(self):
        try:
            self.icon.stop()
        except Exception:
            pass


def run_tray(args, helpers):
    """--tray 入口：托盘（主线程）+ 控制台窗口（子线程），自动启动 Harness。"""
    import session_store

    dsh_home = helpers["default_dsh_home"]()
    sessions_root = Path(dsh_home) / "sessions"
    trash_root = Path(dsh_home) / "sessions_trash"
    log_dir = Path(os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")) / "dsh-desktop" / "logs"
    log_path = log_dir / "launcher.log"

    dsh = helpers["find_dsh"]()
    ui_q = queue.Queue()
    mgr = HarnessManager(
        helpers,
        dsh,
        args.host,
        args.port,
        args.workspace,
        dsh_home,
        log_path,
        notify=lambda kind: ui_q.put(("event", kind)),
    )
    tray_holder = {}
    window_ready = threading.Event()

    mgr._log(f"DSH Desktop 托盘已启动（数据目录 {dsh_home}）")
    mgr._log(f"使用 {dsh}")
    mgr._log(f"会话目录 {sessions_root}（备份目录 {trash_root}）")

    def tk_thread():
        try:
            window = ControlWindow(mgr, ui_q, sessions_root=sessions_root, trash_root=trash_root)
            tray_holder["window"] = window
            window.auto_open = not args.no_browser
            window.root.after(
                300,
                lambda: threading.Thread(target=mgr.start, args=(args.workspace,), daemon=True).start(),
            )
            window.show()
            window_ready.set()
            window.root.mainloop()
        except Exception as exc:
            _file_log(log_path, f"控制台窗口异常: {exc!r}")
            window_ready.set()
        finally:
            try:
                threading.Thread(target=mgr.stop, daemon=True).start()
            except Exception:
                pass

    threading.Thread(target=tk_thread, daemon=True).start()
    window_ready.wait(timeout=30)
    window = tray_holder.get("window")
    if window is None:
        _file_log(log_path, "控制台窗口创建失败，退出托盘模式")
        return 1

    tray = TrayIcon(mgr, window)
    window.tray = tray
    tray_holder["icon"] = tray
    tray.run()
    return 0
