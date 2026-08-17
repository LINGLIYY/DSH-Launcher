# DSH Launcher

面向 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的 Windows 轻量桌面启动器。

> 当前版本：**v1.0（2026-08-17）**

它**不重新实现 DSH**，也不打包 Node/Electron，而是把官方命令全局安装好的 `dsh` 包装成更好用的入口：异步启动/停止、系统托盘、日志、会话管理、插件市场与技能列表等。详细功能说明见 [项目介绍.md](项目介绍.md)。

## 技术栈

- 桌面壳：Tauri 2（Rust + 系统 WebView2）
- 后端：Rust（进程管理、会话解析、托盘）
- 前端：原生 HTML / CSS / JavaScript（无框架）
- DSH 本体：全局安装的 `@deepseek-ai/dsh`（不在启动器内打包）

## 环境要求

- Windows 10 / 11，已安装 Microsoft Edge WebView2 Runtime
- Rust（`x86_64-pc-windows-msvc`）
- Visual Studio 2022 Build Tools，勾选“使用 C++ 的桌面开发”
- Node.js，并用官方命令安装 DSH：

```powershell
npm install -g @deepseek-ai/dsh
dsh --version
```

## 构建

```powershell
cmd /c ""C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && cd /d D:\path\to\dsh-desktop\src-tauri && cargo build --release"
```

产物：

```text
src-tauri\target\release\dsh-desktop.exe
```

直接双击即可运行。

## 数据目录

```text
%APPDATA%\dsh-desktop\harness\   会话、设置、凭据、profile、插件
%APPDATA%\dsh-desktop\logs\      launcher.log
```

卸载或删除启动器目录不会影响会话记忆、设置与登录凭据。

## 许可证

[MIT License](LICENSE)
