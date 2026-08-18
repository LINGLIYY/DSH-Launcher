# DSH 自定义与功能扩展路线图

> 本文是对「审查模式」之外的进一步推演：DSH（DeepSeek Harness）本身是一个 Cordis 插件运行时，DSH Launcher 在其上又叠加了一层桌面壳。绝大多数扩展不需要改核心，只需「加一个 preset / 加一个 skill / 加一个插件 / 加一个 patch」。下面按「投入产出比」排序给出可落地的方向。

## 0. 一个心智模型

DSH 的能力来自四层，每一层都是扩展点：

| 层 | 载体 | 改动成本 | 典型示例 |
| --- | --- | --- | --- |
| 工作模式（Agent preset） | `agent-presets/<id>/preset.yml` + `agent.cordis.yml` | 低（纯 YAML） | 审查模式、文档模式、运维模式 |
| 技能（Skill） | `SKILL.md`（preset 内或用户 `skills/`） | 低（纯 Markdown） | 代码审查清单、重构手册、合规检查 |
| 权限与沙箱 | `dsh-permission-presets` 组合 `sandbox/mode` + `approval/policy` | 低（配置） | `read-only`、按目录授权 |
| 插件（Cordis plugin） | `@deepseek-ai/dsh-*` 包或用户插件 | 中高（TS） | 新工具、新服务、MCP 接入、SSH |

关键是：**只加不改**。预设/技能/权限都可以在不触碰宿主组合（`base.cordis.yml` + `web.cordis.yml`）的前提下叠加，升级 DSH 时不会被覆盖（系统预设目录除外——新增系统预设走本仓库的 `scripts/install-agent-presets.mjs` 注入，见 `agent-presets/review/`）。

---

## 1. 更多工作模式（Agent preset）——推荐先做

审查模式已经证明这条路是通的。同构地可以再加一批，每个都只是 `preset.yml` + `agent.cordis.yml`：

| 模式 | 组合要点 | 解决什么 |
| --- | --- | --- |
| **文档模式** | 标准模式去 subagent/workflow，persona 改为「只写文档不写实现」，加 `documentation` skill | 从代码生成 README / API 文档 / 变更说明 |
| **测试模式** | 保留 shell + fs，加 `testing` skill（先写失败用例再实现） | TDD / 补测试 / 覆盖率驱动 |
| **重构模式** | 标准模式 + `refactoring` skill，persona 强制「行为不变、小步提交、先跑测试」 | 安全重构 |
| **运维模式（SSH）** | 标准模式 + `dsh-ssh` 插件工具 | 远程服务器排查、部署、隧道 |
| **数据分析模式** | 标准模式 + 数据/表格 skill，工具偏重读与脚本 | 报表、清洗、可视化 |
| **极速模式（改 minimal）** | 比 minimal 更省：单工具、无 skill | 简单问答、低 token 场景 |

**落地方式**：在 `agent-presets/` 下加目录即可，`install-agent-presets.mjs` 会自动打包进系统预设；也可以做成 `.dshpreset` 通过「导入预设」分发（见 `docs/preset-packages.md`）。

---

## 2. 技能（Skill）——单位成本最低的扩展

`dsh-skill-filesystem` + `dsh-tool-skill` 已把 skill 注册进每个 preset 的技能目录。skill 是纯 Markdown，能立刻改变 Agent 行为而无需发版。值得建的：

- **领域 playbook**：`code-review`（已随审查模式内置）、`refactoring`、`incident-response`、`database-migration`、`api-design`。
- **公司/团队规范**：命名约定、提交规范、目录结构、必须遵守的架构边界。
- **外部工作流 Skill**：像 `preset-square` 那样，把「发布/安装 preset」这类跨服务流程用在线 `SKILL.md` 交付（`docs/preset-square-mvp.md` 已论证），官网改流程、客户端不发版。

**落地方式**：preset 内 `skills/<name>/SKILL.md`（随模式走，如 cordis 的两个 skill），或用户全局 `$DSH_HOME/skills/`。

---

## 3. 权限预设（Permission presets）——审查模式的「硬只读」配套

`dsh-permission-presets` 把 `sandbox/mode`（`read-only` / `workspace-write` / `danger-full-access`）和 `approval/policy`（`ask` / `never`）组合成用户可选的一档。当前出厂只有 `workspace-write` 和 `danger-full-access` 两档。

**建议新增**：

- `read-only`（`read-only` + `ask`）：让任意模式（尤其审查模式）真正在沙箱层拒绝一切写操作，而不是只靠 prompt 约束。
- `workspace-no-approval`（`workspace-write` + `never`）：信任工作区、免审批，适合脚本化批量任务。
- 未来可扩展 `PresetSpec` 把「agent preset + 权限」绑成一体，让「审查模式」默认自带只读沙箱。

落地时注意 README 的约束：`custom` 只能推导不能选中，被引用的 preset 不能从表中删除。

---

## 4. 自定义命令（Slash command）

`dsh-commands` + `dsh-command-*` 已经提供 `/plan`、`/goal`、`/compact`、`/permissionPresets` 等命令。可以加：

- `/review`：把当前会话切入审查模式/加载审查 skill。
- `/audit <path>`：对指定路径做安全审计。
- `/diff`：总结当前工作区的改动。
- `/standup`、`/changelog`：生成日报/变更日志。

命令是纯配置/小插件，适合高频、易记的团队习惯。

---

## 5. 自定义工具（Cordis plugin）

需要新能力时写插件注册到 `ctx.tools`。仓库里 `dsh-ssh`（远程运维）就是现成例子。可加：

- **Git/SCM 工具**：`git_diff`、`git_stage`、`git_commit` 作为一等工具（现在靠 shell），带结构化输出与审批钩子。
- **数据库工具**：`db_query`（只读）+ 隧道，配合 SSH。
- **浏览器/网页工具**：受控 fetch（现在 `tool-web` 默认 `fetch:false`）。
- **MCP 客户端接入**：`dsh-mcp-client` 已在依赖清单里，把外部 MCP server 的工具映射进来。
- **通知/回调**：任务完成后发 Webhook / 桌面通知。

插件是「中高成本」，适合沉淀高频且 shell 难以可靠表达的操作。

---

## 6. 模型供应商与路由

DSH Launcher 已支持 DeepSeek / OpenAI / Anthropic / Gemini / OpenRouter 等（Settings → Models）。可进一步：

- 按任务路由模型：审查用强推理模型、摘要用廉价模型（`dsh-agent-default-model` + 路由策略）。
- 子代理指定不同 provider/model（`tool-subagent` 的 `provider`/`model` 已支持覆盖）。
- 暴露 codex / claude-code 子代理 provider（`standard` 预设里已 `disabled:true`，复制预设后打开即可）。

---

## 7. 定时与自动化

- `dsh-schedule` 是 harness 侧的调度能力（比浏览器端任务看板更可靠，不依赖标签页常开）。
- 结合 `/goal` 与 workflow，可实现「每日自动跑测试并生成报告」这类常驻任务。
- 会话 checkpoint（`dsh-session-checkpoint-policy`）可用于断点续跑长任务。

---

## 8. Web UI 定制（DSH Launcher 特有）

DSH Launcher 已用 `patch-package` 定制侧边栏、布局、模型设置、交付物与 preset 导入导出（见 `patches/`）。同路线可加：

- 预设选择器的分组/置顶/图标（审查模式想突出显示就在 `dsh-client-ui-agent-preset` 里加分组）。
- 一键切换「模式 + 权限 + 模型」的快捷入口。
- 结果交付物（`dsh-client-ui-deliverables`）的新渲染器。

注意：UI patch 依赖 pin 的 DSH 版本，升级时要按 `README.md` 的「Upstream version and patches」流程重放。

---

## 9. 优先级建议

1. **权限预设 `read-only`**（配套审查模式，成本最低、安全收益最大）
2. **2~4 个高频 skill**（code-review 之外补 refactoring / testing / api-design）
3. **`/review`、`/audit` 命令**（把新模式用起来）
4. **Git/SCM 或 DB 一等工具插件**（补 shell 的结构化短板）
5. **Preset 广场上线**（`docs/preset-square-mvp.md` 已有完整方案，把自定义模式做成可分享生态）

每一步都能独立交付、独立回滚，且不破坏既有内置模式与宿主组合。
