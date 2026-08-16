#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH Desktop 启动脚本（Python，替代安装包 / 打包程序）

用法：
    python launch.py                 # 启动 DSH web 并自动打开浏览器
    python launch.py --port 7602     # 指定端口
    python launch.py --workspace D:\\some\\dir   # 指定默认工作区
    python launch.py --no-browser    # 不自动打开浏览器

依赖：
    - Node.js + 官方全局安装的 dsh（npm install -g @deepseek-ai/dsh）
    - Python 3（本脚本只使用标准库）

数据目录（会话记忆/设置/凭据，卸载安装包时已保留）：
    %APPDATA%\\dsh-desktop\\harness
"""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "DSH Desktop"
HOST = "127.0.0.1"
DEFAULT_PORT = 7602
BOOT_MARKER = "__DSH_BOOT__"
SCRIPT_DIR = Path(__file__).resolve().parent


def default_dsh_home() -> str:
    """保持与旧打包版一致的数据目录，会话记忆不丢失。"""
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return os.path.join(base, "dsh-desktop", "harness")


def set_console_icon(ico_path: Path) -> None:
    """给控制台窗口设置自定义图标（保留 DSH Desktop 图标设计）。"""
    if os.name != "nt" or not ico_path.exists():
        return
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32 = ctypes.WinDLL("user32", use_last_error=True)

    kernel32.GetConsoleWindow.restype = wintypes.HWND
    hwnd = kernel32.GetConsoleWindow()
    if not hwnd:
        return

    user32.LoadImageW.restype = wintypes.HANDLE
    user32.LoadImageW.argtypes = [
        wintypes.HINSTANCE,
        wintypes.LPCWSTR,
        wintypes.UINT,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.SendMessageW.restype = wintypes.LRESULT
    user32.SendMessageW.argtypes = [
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    ]

    IMAGE_ICON = 1
    LR_LOADFROMFILE = 0x00000010
    WM_SETICON = 0x0080
    hicon = user32.LoadImageW(None, str(ico_path), IMAGE_ICON, 0, 0, LR_LOADFROMFILE)
    if hicon:
        user32.SendMessageW(hwnd, WM_SETICON, 0, hicon)  # 小图标
        user32.SendMessageW(hwnd, WM_SETICON, 1, hicon)  # 大图标


def find_dsh() -> str:
    """定位官方安装的 dsh 命令。"""
    exe = shutil.which("dsh")
    if exe:
        return exe
    candidates = [
        Path(os.environ.get("APPDATA", "")) / "npm" / "dsh.cmd",
        Path.home() / "AppData" / "Roaming" / "npm" / "dsh.cmd",
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "nodejs" / "dsh.cmd",
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "nodejs" / "dsh.cmd",
    ]
    for cand in candidates:
        if cand.exists():
            return str(cand)
    raise SystemExit(
        "未找到 dsh 命令。请先用官方命令安装：\n"
        "    npm install -g @deepseek-ai/dsh\n"
        "然后重试。"
    )


def http_ready(url: str, timeout: float = 3.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return False
            body = resp.read(4096).decode("utf-8", errors="replace")
            return BOOT_MARKER in body
    except Exception:
        return False


def wait_ready(url: str, timeout_s: float = 120.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if http_ready(url):
            return True
        time.sleep(1)
    return False


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    else:
        proc.terminate()


class TeeThread(threading.Thread):
    """把子进程输出同时打到控制台与日志文件。"""

    def __init__(self, stream, tag: str, log_file):
        super().__init__(daemon=True)
        self.stream = stream
        self.tag = tag
        self.log_file = log_file

    def run(self) -> None:
        for raw in self.stream:
            line = raw.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            print(f"[{self.tag}] {line}")
            try:
                self.log_file.write(f"[{self.tag}] {line}\n")
                self.log_file.flush()
            except OSError:
                pass


def main() -> int:
    # 控制台/管道下都逐行刷新输出，避免缓冲导致看不到日志
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(line_buffering=True)
        except Exception:
            pass

    parser = argparse.ArgumentParser(description=APP_NAME + " 启动脚本")
    parser.add_argument("--host", default=HOST, help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="端口（默认 7602）")
    parser.add_argument("--workspace", default=str(SCRIPT_DIR), help="默认工作区目录（默认脚本所在目录）")
    parser.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"
    workspace = os.path.abspath(args.workspace)
    dsh_home = os.environ.get("DSH_HOME") or default_dsh_home()

    log_dir = Path(os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")) / "dsh-desktop" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "launcher.log"
    log_file = open(log_path, "a", encoding="utf-8")

    print(f"{'=' * 56}")
    print(f"  {APP_NAME} 启动脚本")
    print(f"  URL      : {url}")
    print(f"  工作区   : {workspace}")
    print(f"  数据目录 : {dsh_home}")
    print(f"  日志     : {log_path}")
    print(f"{'=' * 56}")

    set_console_icon(SCRIPT_DIR / "build" / "icon.ico")

    # 端口上已有可用的 DSH 实例时，直接打开浏览器
    if http_ready(url):
        print("检测到 DSH 已在运行，直接打开浏览器。")
        if not args.no_browser:
            webbrowser.open(url)
        return 0

    dsh = find_dsh()
    os.makedirs(dsh_home, exist_ok=True)
    env = {
        **os.environ,
        "DSH_HOME": dsh_home,
        "NO_COLOR": "1",
    }

    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW

    print(f"启动 Harness：{dsh} web --host {args.host} --port {args.port}")
    log_file.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] starting dsh web on {url}\n")
    log_file.flush()

    proc = subprocess.Popen(
        [dsh, "web", "--host", args.host, "--port", str(args.port)],
        cwd=workspace,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=creationflags,
    )
    TeeThread(proc.stdout, "out", log_file).start()
    TeeThread(proc.stderr, "err", log_file).start()

    try:
        if wait_ready(url):
            print(f"Harness 就绪：{url}")
            log_file.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] ready {url}\n")
            log_file.flush()
            if not args.no_browser:
                webbrowser.open(url)
        else:
            print("等待超时：Harness 未在 120 秒内就绪，请查看上方日志。")

        print("按 Ctrl+C 停止。")
        while proc.poll() is None:
            time.sleep(1)
        code = proc.returncode
        print(f"Harness 已退出（code={code}）。")
        return code if code is not None else 0
    except KeyboardInterrupt:
        print("\n收到停止信号，正在关闭 Harness…")
        kill_tree(proc)
        print("已停止。")
        return 0
    finally:
        log_file.close()


if __name__ == "__main__":
    sys.exit(main())
