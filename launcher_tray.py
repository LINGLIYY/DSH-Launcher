#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH Desktop 托盘 + 控制台窗口模式。

本模块不依赖 dsh 主程运行，只负责：启动/停止 Harness、状态显示、日志、
系统托盘、轻量控制台窗口。由 launch.py 的 --tray 参数调用。
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


class HarnessManager:
    """管理 dsh web 子进程的生命周期、状态与日志。"""

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
        self.status = status
        self._log(f"状态: {status}")
        self.notify("status")

    def start(self, workspace=None):
        with self._lock:
            if self.proc is not None and self.proc.poll() is None:
                self._log("Harness 已在运行，无需重复启动")
                return
        if workspace:
            self.workspace = os.path.abspath(workspace)
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
        if proc is None:
            self._log("Harness 未在运行")
            return
        self._log("正在停止 Harness…")
        self.h["kill_tree"](proc)
        self._set_status("stopped")

    def is_running(self):
        with self._lock:
            return self.proc is not None and self.proc.poll() is None

    def open_browser(self):
        webbrowser.open(self.url)
        self._log(f"打开浏览器: {self.url}")


class ControlWindow:
    """轻量控制台窗口：状态、工作区、启动/停止、日志。关闭即隐藏到托盘。"""

    def __init__(self, mgr, ui_q=None):
        import tkinter as tk
        from tkinter import scrolledtext

        self.mgr = mgr
        self.q = ui_q if ui_q is not None else queue.Queue()
        self.tray = None
        self.auto_open = False
        self._shown = 0

        self.root = tk.Tk()
        self.root.title(APP_NAME)
        self.root.geometry("580x440")
        self.root.minsize(500, 320)
        ico = Path(__file__).resolve().parent / "build" / "icon.ico"
        try:
            self.root.iconbitmap(default=str(ico))
        except Exception:
            pass

        self.status_var = tk.StringVar(value="已停止")
        self.url_var = tk.StringVar(value=mgr.url)
        self.workspace_var = tk.StringVar(value=mgr.workspace)

        frame = tk.Frame(self.root, padx=12, pady=10)
        frame.pack(fill=tk.X)

        tk.Label(frame, text="状态").grid(row=0, column=0, sticky="w")
        self.status_label = tk.Label(frame, textvariable=self.status_var, font=("Microsoft YaHei UI", 11, "bold"))
        self.status_label.grid(row=0, column=1, sticky="w", padx=(8, 0))

        tk.Label(frame, text="地址").grid(row=1, column=0, sticky="w", pady=(6, 0))
        tk.Entry(frame, textvariable=self.url_var, state="readonly", width=42).grid(
            row=1, column=1, sticky="we", padx=(8, 0), pady=(6, 0)
        )

        tk.Label(frame, text="工作区").grid(row=2, column=0, sticky="w", pady=(6, 0))
        tk.Entry(frame, textvariable=self.workspace_var, width=42).grid(
            row=2, column=1, sticky="we", padx=(8, 0), pady=(6, 0)
        )

        btns = tk.Frame(self.root, padx=12)
        btns.pack(fill=tk.X, pady=(8, 4))
        self.start_btn = tk.Button(btns, text="启动 Harness", command=lambda: self.q.put(("action", "start")))
        self.start_btn.pack(side=tk.LEFT, padx=(0, 6))
        self.stop_btn = tk.Button(btns, text="停止 Harness", command=lambda: self.q.put(("action", "stop")))
        self.stop_btn.pack(side=tk.LEFT, padx=(0, 6))
        tk.Button(btns, text="打开浏览器", command=lambda: self.q.put(("action", "open"))).pack(side=tk.LEFT, padx=(0, 6))
        tk.Button(btns, text="打开日志目录", command=lambda: self.q.put(("action", "logs"))).pack(side=tk.LEFT, padx=(0, 6))
        tk.Button(btns, text="隐藏到托盘", command=lambda: self.q.put(("action", "hide"))).pack(side=tk.RIGHT)

        log_frame = tk.Frame(self.root, padx=12, pady=10)
        log_frame.pack(fill=tk.BOTH, expand=True)
        self.log_text = scrolledtext.ScrolledText(log_frame, state="disabled", height=14, wrap="word")
        self.log_text.pack(fill=tk.BOTH, expand=True)

        self.root.protocol("WM_DELETE_WINDOW", self.hide)
        self.root.after(POLL_MS, self._poll)

    def enqueue(self, kind):
        self.q.put(("event", kind))

    def action(self, name):
        self.q.put(("action", name))

    def show(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def hide(self):
        self.root.withdraw()

    def _set_status_style(self):
        color = {
            "ready": "#1a7f37",
            "starting": "#9a6700",
            "error": "#cf222e",
            "stopped": "#57606a",
        }.get(self.mgr.status, "#57606a")
        text = {
            "ready": "运行中（就绪）",
            "starting": "正在启动…",
            "error": "异常 / 超时",
            "stopped": "已停止",
        }.get(self.mgr.status, self.mgr.status)
        self.status_var.set(text)
        self.status_label.config(fg=color)
        running = self.mgr.is_running() or self.mgr.status in ("starting", "ready")
        self.start_btn.config(state="disabled" if running else "normal")
        self.stop_btn.config(state="normal" if running else "disabled")

    def _refresh_log(self):
        lines = self.mgr.lines
        if self._shown > len(lines):
            self._shown = 0
        new_lines = lines[self._shown :]
        if not new_lines:
            return
        self._shown = len(lines)
        self.log_text.config(state="normal")
        self.log_text.insert("end", "\n".join(new_lines) + "\n")
        self.log_text.see("end")
        self.log_text.config(state="disabled")

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
                elif kind == "action":
                    if payload == "start":
                        self.mgr.start(self.workspace_var.get())
                    elif payload == "stop":
                        self.mgr.stop()
                    elif payload == "open":
                        self.mgr.open_browser()
                    elif payload == "logs":
                        log_dir = self.mgr.log_path.parent
                        try:
                            os.startfile(str(log_dir))
                        except OSError:
                            pass
                    elif payload == "hide":
                        self.hide()
                    elif payload == "show":
                        self.show()
                    elif payload == "exit":
                        self.mgr.stop()
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

    def run_detached(self):
        self.icon.run_detached()

    def stop(self):
        try:
            self.icon.stop()
        except Exception:
            pass


def run_tray(args, helpers):
    """--tray 入口：托盘 + 控制台窗口，自动启动 Harness。"""
    script_dir = Path(__file__).resolve().parent
    dsh_home = helpers["default_dsh_home"]()
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
    window = ControlWindow(mgr, ui_q)

    tray = TrayIcon(mgr, window)
    window.tray = tray

    mgr._log(f"DSH Desktop 托盘已启动（数据目录 {dsh_home}）")
    mgr._log(f"使用 {dsh}")
    window.auto_open = not args.no_browser

    tray.run_detached()
    window.root.after(300, lambda: mgr.start(args.workspace))
    window.show()

    try:
        window.root.mainloop()
    finally:
        mgr.stop()
        tray.stop()
    return 0
