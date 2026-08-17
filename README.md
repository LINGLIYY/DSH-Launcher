# DSH Desktop

A lightweight Windows desktop launcher for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

> Current version: **v1.0 (2026-08-17)**

It does **not** reimplement DSH and does **not** bundle Node/Electron. It wraps the globally installed `dsh` CLI into a friendlier entry point: async start/stop, system tray, logs, session management, plugin marketplace, and skill listing. See [项目介绍.md](项目介绍.md) for full details (Chinese).

## Stack

- Shell: Tauri 2 (Rust + system WebView2)
- Backend: Rust (process management, session parsing, tray)
- Frontend: vanilla HTML / CSS / JavaScript
- DSH runtime: globally installed `@deepseek-ai/dsh` (not bundled)

## Requirements

- Windows 10 / 11 with the Microsoft Edge WebView2 Runtime
- Rust (`x86_64-pc-windows-msvc`)
- Visual Studio 2022 Build Tools with the "Desktop development with C++" workload
- Node.js, with DSH installed globally:

```powershell
npm install -g @deepseek-ai/dsh
dsh --version
```

## Build

```powershell
cmd /c ""C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && cd /d D:\path\to\dsh-desktop\src-tauri && cargo build --release"
```

Artifact:

```text
src-tauri\target\release\dsh-desktop.exe
```

Double-click the exe to run it.

## Data directories

```text
%APPDATA%\dsh-desktop\harness\   sessions, settings, credentials, profile, plugins
%APPDATA%\dsh-desktop\logs\      launcher.log
```

Uninstalling or deleting the launcher directory does not affect session memory, settings, or credentials.

## License

[MIT License](LICENSE)
