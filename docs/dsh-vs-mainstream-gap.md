# DSH 能力 vs 主流 Agent 功能差距 + 形式判定(信息文档)

> 目的:一次性把"DSH 有什么、缺什么、每个缺的功能该用什么形式补(插件/技能/MCP)、可抄哪个社区插件"记下来,避免每次联网重查。
> 依据:DSH 运行时服务目录(cordis_inspect)+ 官方文档 + 社区 awesome-dsh-plugin 清单 + 主流 agent 调研。

---

## 一、DSH 现有能力清单(运行时已确认)

### 会话 / Agent
| 能力 | 服务 | 说明 |
|---|---|---|
| 会话分叉 | `sessions.fork(source, boundary)` | 按事件 seq 分叉,**消息编辑/重来的地基** |
| Agent 创建/续跑 | `agentLoop.create / resume / createAgent` | 创建、恢复 agent |
| 子代理 | `subagents` / `agents` | 多 agent 委派、continuable child |
| 目标 | `goals` | 长期目标 create/edit/pause/resume/complete |
| 会话搜索 | `sessionQuery.searchSessions / searchEvents` | SQLite FTS5 全文检索 |
| 会话重命名 | `sessionTitle.rename` | 标题改 |
| 归档 | `workspaceRegistry.archiveSession` | 软删除 |
| 检查点/回滚 | `sessionProjections.checkpoint / restore` | 投影状态回滚(可用于 /undo) |
| 压缩 | `compaction.compactNow / compactRegion` | 上下文压缩 |
| 持久化 | `sessionPersistence` | append-only 存储 |

### 工具 / 执行
| 能力 | 服务 |
|---|---|
| 文件读写 | `fs`(readText/writeText/editText) |
| Shell | `shell` / `bash` / `pwsh` / `subprocess` / `terminals` |
| 联网 | `web.search / fetch` |
| 工作流 | `workflowEngine` |
| LSP | `lsp` |

### LLM / 模型
| 能力 | 服务 |
|---|---|
| 模型调用 | `llm.stream` |
| 模型路由/提供方 | `llm.registerAdapter / listProviders` |
| 默认模型 | `agentDefaultModel.currentSelection` |
| Token 计量 | `tokenMeter.measure` + `sessionProjections` 的 `tokenUsage` 投影 |

### 权限 / 沙箱
| 能力 | 服务 |
|---|---|
| 审批 | `approval` + `approval.request` |
| 权限预设 | `permissionPresets` |
| 沙箱 | `sandbox` / `sandboxPolicy` |

### 技能 / 命令 / MCP / 存储
| 能力 | 服务 | 现状 |
|---|---|---|
| 技能 | `skills.register / list / get` | 有技能系统,**无图形化管理 UI** |
| 命令 | `commands.register` | 有命令注册,**无斜杠命令面板 UI** |
| MCP | `dsh-mcp-client`(包) | 有 MCP 客户端,**无 MCP server 管理 UI** |
| 插件管理 | `dsh-client-ui-settings-plugin-inventory` | **已有**(设置→插件页) |
| 存储 | `storage` / `settings` / `storageDomain` | 本地持久化 |

### 客户端 UI(Slot 体系)
- 头部:`conversation.session.header.utilities`(右侧工具)、`header.actions`(动作)
- 消息:`conversation.chat.node`(keyed)、`chat.assistant-actions`、`chat.turnTail`
- 输入:`conversation.composer.bar`、`input.dock`、`input.selector.context`
- 弹层:`shell.overlay`
- 侧栏:`sidebar`、`sidebar.workspaces`、`sidebar.footer.action`、`details`(右侧详情)
- 设置:`settings.section`、`settings.general.item`、`settings.plugins.tab`

---

## 二、主流 Agent 功能清单(已调研,带对标)

(完整版见之前调研,这里提炼关键差距)

| 维度 | 关键功能 |
|---|---|
| 消息编辑 | 原位编辑用户消息→重生成(ChatGPT/Claude/Cursor) |
| 分支/版本 | i/N 版本翻页、从任意消息重来/分叉 |
| 文件撤销 | /undo /redo(Claude Code checkpoint 影子仓库、Codex) |
| 消息操作 | 复制/删除/重跑/收藏 |
| 会话管理 | 重命名/归档/删除/搜索/书签/导出/resume |
| 输入框 | ↑↓历史、斜杠命令、@提及 |
| 代码块 | 复制/应用为 diff/新窗口 |
| 用量显示 | token/成本/上下文(Claude /cost、Codex /cost /usage) |
| 其他 | 停止、压缩、临时会话、项目记忆(AGENTS.md/Memory)、审批/计划模式 |

---

## 三、差距表(DSH vs 主流)

| 功能 | DSH 现状 | 差距 |
|---|---|---|
| 消息编辑+重生成 | 有 `sessions.fork`,无 UI | **缺 UI** |
| 分支/版本翻页 | 有 fork,无 UI | **缺 UI** |
| 文件撤销/重做 | 有 `sessionProjections.checkpoint/restore`,无入口 | **缺 UI + 影子仓库策略** |
| 消息复制/删除 | 有复制,无删除/收藏 | 部分缺 |
| 会话管理 | 有 rename/archive 服务,无 UI 菜单 | **缺 UI** |
| ↑↓历史/斜杠/@提及 | 有 `commands`/`sessionReferenceResolver`,无面板 | **缺 UI** |
| 代码块应用 diff | 有变更面板,无消息内 Apply | **缺入口** |
| 用量显示 | 有 `tokenMeter`,正在做成本面板 | 进行中 |
| 停止/压缩 | 有服务,无用户入口 | **缺入口** |
| 项目记忆(AGENTS.md) | 无 | **缺** |
| 技能管理 UI | 有技能系统 | **缺 UI** |
| MCP 管理 UI | 有 mcp-client | **缺 UI** |

**结论**:DSH 底层能力极强(服务几乎全齐),**差距主要是「缺 UI/入口」**,不是缺能力。自研插件的工作量 = 给现有服务补 UI + 少量新逻辑(如文件撤销的影子仓库策略)。

---

## 四、形式判定(每个功能用插件 / 技能 / MCP)

**判定原则:**
- **插件(bundle)** = 需要运行时 UI、后台事件、注册工具/服务。绝大多数功能属此类。
- **技能(SKILL.md)** = "怎么做 X"的流程指导,agent 按需读,不做 UI、不做常驻逻辑。
- **MCP** = 接外部工具服务器(浏览器、DB、第三方)。

| 功能 | 形式 | 理由 |
|---|---|---|
| 右侧侧边栏(成本/git/皮肤/统计) | **插件** | UI + 事件/服务 |
| 通知铃铛 | **插件** | UI + agent/status 事件 |
| 任务看板 | **插件** | UI + session.prompt |
| 会话管理(重命名/归档/删除/置顶/导出) | **插件** | UI + 服务调用 |
| 消息编辑/分支/重生成 | **插件** | UI + sessions.fork |
| 文件撤销/重做 | **插件** | checkpoint + UI(可配合影子 git) |
| 斜杠命令面板 | **插件** | UI + commands.register |
| @提及 | **插件** | UI + sessionReferenceResolver |
| 项目记忆(AGENTS.md) | **插件** | 读取/注入规则文件 |
| 技能管理 UI | **插件** | UI + skills 服务 |
| MCP 管理 UI | **插件** | UI + mcp-client 服务 |
| 第三方工具接入(浏览器/DB等) | **MCP** | 外部工具走 MCP server,插件只做管理 UI |
| "发布 preset 到广场"流程 | **技能** | 一次性流程指导(如 preset-square SKILL.md) |
| "调试某问题"流程 | **技能** | 指导型 |

**结论**:本插件要做的功能 **几乎全是「插件」形式**;「技能」只用于流程指导类(非本插件核心);「MCP」只用于接外部工具(插件提供管理 UI,工具本身是 MCP)。

---

## 五、社区可抄清单(优先抄,不重复造)

| 目标功能 | 可抄社区插件 |
|---|---|
| 成本面板 | `bobcat848/dsh-calculator`(设计已抄) |
| 通知 | `CAOGGL/dsh-ding`(设计已抄) |
| 任务看板 | `@linxin666/dsh-client-ui-task-board` |
| Git 图 | `@linxin666/dsh-client-ui-git-graph` |
| 皮肤 | `@linxin666/dsh-skins` + `dsh-client-ui-skin-center` |
| MCP 管理 | `PerryLink/dsh-mcp-panel`(读状态)、`liqichen/dsh-plugin-manager`(写配置)、`LX2000WASD/dsh-web-plugin-manager`(健壮编辑) |
| 技能管理 | `liqichen/dsh-plugin-manager`(回收站+浏览)、`Jesse-njx/dsh-skillport`(第三方库导入) |
| 消息编辑/分支 | `cindyguyuehu123/dsh-webchatlike`(原位编辑+版本翻页)、`Anionex/dsh-turn-rewind`(回退) |
| 文件撤销 | `lire1131/dsh-undo-plugin`(配置撤销,可参考 checkpoint 做法) |
| 斜杠命令 | `omdsh-dev/dsh-toolkit` 等自带命令的插件(参考 commands 用法) |

---

## 六、本插件功能 → 形式 → 可抄(汇总)

| 功能 | 形式 | 槽位 | 可抄 |
|---|---|---|---|
| 成本/用量 tab | 插件 | 右侧栏 | dsh-calculator |
| Git 图 tab | 插件 | 右侧栏 | dsh-client-ui-git-graph |
| 皮肤 tab | 插件 | 右侧栏/设置 | dsh-skins + skin-center |
| 实时统计 | 插件 | 右侧栏成本 tab 内 | live-stats |
| Codex 工具(undo/redo/compact/model/approvals) | 插件 | 右侧栏 tab | —(自研,复用 checkpoint/compaction/approval) |
| 通知铃铛 | 插件 | header utilities | dsh-ding |
| 任务看板 | 插件 | 左侧栏 | dsh-client-ui-task-board |
| 会话管理 | 插件 | 左侧会话列表菜单 | —(复用 sessionTitle/workspaceRegistry) |
| 技能管理 UI | 插件 | 设置页 `settings.section` | liqichen/dsh-plugin-manager(文件 CRUD + 回收站) |
| MCP 管理 UI | 插件 | 设置页 `settings.section` | PerryLink/dsh-mcp-panel(读)+ liqichen/LX2000WASD(写 cordis.patch.yml) |
| 消息编辑/分支 | 插件 | chat.node | dsh-webchatlike |
| 斜杠命令/@提及 | 插件 | composer | —(复用 commands/sessionReferenceResolver) |
| 项目记忆 | 插件 | 设置 + 注入 | — |
| 第三方工具 | MCP | — | 只做管理 UI |

---

> 关键事实(子代理已确认):① MCP 配置 = `cordis.patch.yml` 组合行,不是 settings namespace;② skill = `$DSH_HOME/skills` 文件,改文件热生效无需重启;③ dsh-mcp-client 无连接状态事件(状态只能 derived);④ 第三方 settings namespace 写入受 `WEB_SETTINGS_NAMESPACES` 白名单限制,绕开 = 直接文件/loader 路线。
