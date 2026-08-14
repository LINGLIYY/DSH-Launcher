# DSH Desktop — 基于 DeepSeek Harness 的个人桌面客户端

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方 Web UI
（`dsh web`）封装成 Windows 桌面应用：**界面零改动**，官方 Harness 界面原样呈现，
桌面壳层负责拉起/托管服务器、托盘、启动级配置与日志查看。

> 封装，而不是重写：模型、会话、主题、代理人格、工具等一切都在官方 Web UI 里完成。

## 功能

- 🖥️ **自带运行时**：应用自动拉起 `dsh web` 子进程（`--profile web`），
  用 Electron 自带的 Node 启动，**目标机器无需安装 Node/pnpm**。
- 🔌 **复用检测**：`127.0.0.1:3080` 上已有官方实例时直接复用，不重复启动；
  端口被其他程序占用时自动顺延找空闲端口。
- 🗔 **托盘常驻**：关闭窗口最小化到托盘，服务器保持后台运行；
  托盘菜单可一键显示窗口 / 在浏览器打开 / 重启 / 停止 / 退出。
- ⚙️ **壳层设置页**（非官方界面）：API Key、Base URL、`DSH_HOME`、工作目录、
  端口、附加模式、遥测开关、`DSH_TOOLS_MODE`。
- 📜 **实时日志面板**：子进程 stdout/stderr 环形缓冲 + 设置页实时滚动。
- 🛡️ **安全**：主窗口与官方页面隔离（`contextIsolation` + `sandbox`），
  外部链接一律交给系统浏览器；退出时优雅停止并清理整个子进程树。

## 快速开始

```sh
# 1. 安装依赖（postinstall 会自动把官方 Harness runtime 装进 resources/harness）
npm install

# 2. 启动桌面应用（会自动拉起 dsh web 并打开官方界面窗口）
npm start

# 3.（可选）打开主窗口 DevTools 观察启动细节
npm run start:log
```

第一次使用前，请先在官方界面或本应用设置页里填入 `DEEPSEEK_API_KEY`。

## 打包 Windows 应用

```sh
npm run dist           # 产出 portable 单文件 exe + NSIS 安装包（dist/ 目录）
npm run dist:portable  # 只产出便携版 exe
```

打包产物自带 Harness runtime（`extraResources → resources/harness`），
拷到别的 Windows 机器即可运行，无需安装 Node。

## 设置项

| 设置 | 含义 | 默认 |
|---|---|---|
| `preferredPort` | 首选端口；被 dsh web 占用则复用，被其他程序占用则顺延 | `3080` |
| `attachMode` | `auto`：复用已运行的官方实例；`always-spawn`：总是自启 | `auto` |
| `apiKey` | `DEEPSEEK_API_KEY`，注入子进程环境 | 空 |
| `baseUrl` | `DEEPSEEK_BASE_URL`（可选） | 空 |
| `dshHome` | `DSH_HOME` 数据目录（会话/存储），留空用默认 `~/.dsh` | 空 |
| `workspace` | 子进程 cwd（影响 system prompt 的 `{{cwd}}` 与文件工具根） | `<userData>/workspace` |
| `toolsMode` | `DSH_TOOLS_MODE`：`native` / `code` / `both` | 空 |
| `disableTelemetry` | 设 `DSH_TELEMETRY_DISABLED=1` | 开 |
| `closeToTray` | 关闭窗口最小化到托盘 | 开 |

设置保存在 `%APPDATA%/DSH Desktop/settings.json`。

## 工作原理

桌面壳层等价于执行：

```sh
node <runtime>/@deepseek-ai/dsh/lib/bin.js \
  --profile web --host 127.0.0.1 --port <port>
```

- 运行时解析：打包后取 `resources/harness/runtime`（extraResources），开发期取
  `resources/harness/runtime` 或 `node_modules/@deepseek-ai/dsh`。
- 子进程通过 `ELECTRON_RUN_AS_NODE=1` + `--expose-internals` 复用 Electron 自带的 Node
  （`--expose-internals` 是 HMR 服务读取 Node 内部模块所需）。
- 就绪检测：轮询 `http://127.0.0.1:<port>/`，以首页是否包含官方注入的
  `__DSH_BOOT__` 标记判定（该标记只有 `dsh web` 才会注入）。
- 退出：SIGTERM → 宽限 3s → Windows 下 `taskkill /T /F` 清理整棵进程树。

## 目录结构

```
dsh-desktop/
├── src/
│   ├── main/            # Electron 主进程
│   │   ├── index.js     #   入口：窗口/生命周期/IPC
│   │   ├── server.js    #   dsh web 子进程管理器（端口/就绪/日志/清理）
│   │   ├── settings.js  #   设置存储
│   │   ├── menu.js      #   应用菜单
│   │   ├── tray.js      #   系统托盘
│   │   └── version.js
│   ├── preload/         # 设置窗口 IPC 桥（官方页面不加载）
│   └── renderer/        # 壳层设置页（HTML/CSS/JS）
├── scripts/
│   └── install-harness.mjs   # postinstall：安装 Harness runtime 到 resources/harness/runtime
├── resources/harness/runtime/ # 自带 Harness runtime（postinstall 生成，不入库）
└── package.json              # electron-builder 配置（portable + nsis）
```

## 常见问题

- **设置页显示“未找到 dsh web 运行时”** → 项目里执行 `npm run postinstall`
  或 `node scripts/install-harness.mjs`。
- **端口被占用** → 应用会自动顺延；也可在设置里改首选端口或切换附加模式。
- **没配 API Key** → 在官方界面（设置 → 模型/凭据）或本应用设置页填入
  `DEEPSEEK_API_KEY`，保存后重启服务器。
- **想要全新会话数据** → 设置页把 `DSH_HOME` 指向新目录。
- **异常退出后残留 electron 进程** → 在普通终端执行
  `taskkill /F /IM electron.exe`（会连带清理残留的 dsh web 子进程），再重新启动。

## 许可

- 本壳层：MIT（见 LICENSE）。
- 官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：MIT。
