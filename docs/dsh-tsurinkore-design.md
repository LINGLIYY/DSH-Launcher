# dsh-tsurinkore 完整设计方案(统一优化插件)

> 版本:v2 草案 · 布局定稿 + Codex 对标 · 供评审

---

## 一、真实目标(通读全部上下文)

1. 之前拆掉的插件功能**全要回来**,拆掉不是功能不好,而是卡顿/冲突/错位/bug。
2. 一个自研插件**吸收全部功能**,统一排版,修掉问题,无卡顿。
3. 成本面板抄 `dsh-calculator` 设计(余额 + 当天全部会话累计 + 分模型 + 峰谷计价)。
4. **布局**:头部只留提示开关;任务/目标在左侧;其余内容进右侧侧边栏。
5. **对标 Codex**,复刻 DSH 缺失的相关能力(文件撤销/重做、斜杠命令、压缩、记忆等)。

---

## 二、布局总览(定稿)

```
┌──────────┬───────────────────────────────┬────────────────────┐
│ 左侧栏    │ 主对话区                        │ 右侧侧边栏(新)      │
│ ·任务看板 │  ·消息流 + 消息节点 chrome       │ ·成本/用量          │
│ ·目标     │    [编辑][重生成][分支][复制][删]│ ·Git 图            │
│ ·会话列表 │ ·输入区 composer               │ ·实时统计           │
│  (项菜单) │   [/斜杠][@提及][模型][↑↓历史]  │ ·SSH 终端           │
│          │                                │ ·AionUI 面板        │
│          │                                │ ·Codex 工具         │
└──────────┴───────────────────────────────┴────────────────────┘
  头部 utilities(唯一保留): [通知铃铛]   悬浮: [桌面宠物]
  设置页: [皮肤/外观] [通知偏好] [远程UI] [技能管理] [MCP管理] [插件总开关]
```

- **头部**:只留「提示开关」(通知铃铛)。成本胶囊**不再悬浮**,并入右侧栏。
- **左侧**:任务看板/目标(保留原工具箱插件设计)+ 会话列表(项菜单)。会话管理在左侧,不进右侧。
- **右侧侧边栏(新建)**:集成高频/随上下文/实时类内容,带 tab 切换。
- **设置页**:皮肤/外观、通知偏好、远程 UI、技能管理、MCP 管理、插件总开关。
- **悬浮**:桌面宠物。
- **布局原则**:右侧栏放「高频·随上下文·实时」(成本、git、统计、终端、工具动作);设置页放「低频·配置一次·全局偏好」(皮肤、通知偏好、远程 UI、技能/MCP 管理、插件开关)。

---

## 三、功能全景

### A. 右侧侧边栏 —— 集成面板(带 tab)

| Tab | 来源 | 内容 |
|---|---|---|
| 成本/用量 | 抄 dsh-calculator + live-stats | 余额 + **当天全部会话累计(总量)** + 当前会话(次要、可折叠)+ 分模型 + 峰谷计价 + 实时 token |
| Git 图 | 抄 git-graph(重排) | git 提交图(从输入区挪进右侧栏,治错位) |
| SSH 终端 | 抄 dsh-ssh | SSH 会话/终端(重依赖 ssh2,按需懒加载) |
| AionUI 面板 | 抄 aionui-panel | 右侧扩展面板 |
| Codex 工具 | 新增 | `/undo /redo /compact /model /cost /approvals` 等(见五) |

### B. 通知 —— 头部唯一保留

- Host 监听 `agent/status`(idle)→ 提示音 + Windows toast。
- Client 头部 `conversation.session.header.utilities` 铃铛(单击开关、右键设置)。

### C. 任务看板 / 目标 —— 左侧(保留原工具箱设计)

- 侧栏入口 + 多列 kanban,`session.prompt` 真实执行,本地持久化。

### D. 会话列表管理 —— 左侧

- 会话项菜单:重命名/归档/删除/置顶/导出;搜索框/Ctrl+K;resume。

### E. 统一设置 —— 设置页

- 上述全部功能的开关/配置并入插件设置页(`settings.section`)。
- **皮肤/外观**:皮肤试穿 + 应用(抄 skins/skin-center,**修 `~/.dsh` → `$DSH_HOME`);亮/暗主题、背景透明度。
- **通知偏好**:提示音开关、音量、音效文件、气泡通知开关(铃铛右键也有快捷入口)。
- **技能管理**(双端插件):`settings.section`「技能」页。读 `api.skills.list`/`ctx.skills.list`;写文件级 CRUD(`$DSH_HOME/skills/<name>/SKILL.md`),删除进回收站,原生 watcher 热生效无需重启。可抄 `liqichen/dsh-plugin-manager`。
- **MCP 管理**(双端插件):`settings.section`「MCP」页。读状态抄 `PerryLink/dsh-mcp-panel`(loader 行 + `mcp__<server>__` 工具分组);写 = 编辑 `cordis.patch.yml` 行(开关 `disabled:true`/删整条/新增插行),写前备份 + 原子写。可抄 `liqichen` + `LX2000WASD/dsh-web-plugin-manager`。
- **远程 UI**:远程访问开关 + 隧道配置(cloudflared)。

### F. 保留项(不再砍)

### F. 状态宠物 + 附加侧边抽屉(Shadow-DOM 隔离 UI,借鉴豆包方案)

- **状态宠物**(不是纯玩具):悬浮右下角可拖拽,显示后端状态:
  😶 空闲 / 🔍 识图中(Ollama)/ ☁️ 云端降级 / ⚠️ 额度告警 / ❌ 工具出错 / 📝 思考中。
- **附加侧边抽屉**(不替换 DSH 原生侧边栏):320px 悬浮面板,显示视觉后端状态、免费额度剩余、缓存命中、Token 统计、开关(自动切付费/缓存)。
- **实现**:Shadow-DOM 注入(不碰 DSH React 内部),原生 DOM + SVG,postMessage 双向通信;z-index 足够大防被盖住;TUI 模式自动不加载。
- 其余保留项(AionUI / SSH / 远程 UI)已并入右侧栏或设置页(见 A / E)。

### G. 本地视觉桥接(识图路由,伪多模态)—— 一个工具,三级自动降级

- **形式**:Host 侧模型 Tool「识图」(agent 无感知调用)。
- **工具形态(借鉴豆包 visual_analyze)**:注册为 `visual_analyze` Tool,参数 `{imagePath, query}`;执行时经 postMessage 推状态给前端 UI(vision_running → idle/error),宠物/抽屉实时显示。
- **背景**:DeepSeek 纯文本,靠桥接补视觉(伪多模态)。
- **路由(识图,两级免费,自动判断):**
  1. **本地**:探测 Ollama(`qwen2.5vl:7b` 进程 + 模型)→ 可用走本地;
  2. **网页**:本地不可用 → 浏览器自动化(agent-browser CDP)进免费站点识图(DeepSeek 识图模式 / Kimi / 豆包,免登录/免费)。
- **百炼免费额度不含识图模型**(实测:免费列表 34 个模型里 Vision 全是生图/生视频,qwen-vl 收费)。百炼免费额度只用于:文本 1M token、生图/生视频 10-100 次、音频 TTS/ASR——**不作识图兜底**。
- **免费站点自动化**:见知识库 `C:\知识库\创作\小说\通用规范\免费AI站点自动化流程指南.md`(实测 DeepSeek/Kimi/豆包三家识图可用,免登录优先 DeepSeek)。
- **✅ 网页识图端到端验证通过(2026-08)**:CDP 上传测试图 → DeepSeek 识图模式 → 准确识别「橙矩形/蓝圆/绿三角 + 文字」。伪多模态已有可用路径。
- **默认不走浏览器沙盒**:沙盒/独立调试 profile 会丢失登录态(每次都要重新登录),所以网页识图默认直接复用专用 Chrome 的登录态 profile(DeepSeek/Kimi/豆包已登录)。
- **浏览器工具链(已验证)**:`agent-browser` v0.33.2 + CDP 专用 Chrome(端口 9222)+ 登录态 profile,DSH 经 shell 调用;DSH 无原生浏览器服务,不依赖。
- **集成**:并入本插件(一个产品),不做独立技能/独立插件。

---

## 四、架构

```
dsh-tsurinkore/
├── package.json        # dsh.bundle.patch + dsh.client
├── cordis.patch.yml
├── lib/
│   ├── index.js        # Host:统计、通知、皮肤 apply、git、看板、undo/redo、fork/编辑 RPC
│   ├── client.js       # Client:右侧栏 + 左侧看板 + 头部铃铛(单 bundle < 500KB)
│   └── notify.ps1
├── skins/  assets/
```

**四条铁律:**
1. 单 client bundle,只解析一次;ssh 类重依赖按需懒加载。
2. 统计永不启动回填;跨会话总量按需计算 + 缓存。
3. 路径一律 `process.env.DSH_HOME`。
4. **自包含、可卸载还原**:只改 profile 的 bundle/依赖/自身数据,不修改 DSH 本体;`dsh plugin remove` 后一切恢复原状。

---

## 五、Codex 功能对标(复刻 DSH 缺失的)

| Codex 能力 | Codex 入口 | DSH 现状 | 复刻方案 |
|---|---|---|---|
| 文件撤销/重做 | `/undo` `/redo`(checkpoint 影子仓库) | **缺失**(有 `sessionProjections.checkpoint/restore` 但无用户入口) | 右侧栏「Codex 工具」加 /undo /redo,复用 `sessionProjections.checkpoint/restore` |
| 回退对话上下文 | `/rewind` | 有 `sessions.fork`,无 UI | 消息节点「从此重来」 |
| 编辑上条消息 | `/edit` | **缺失** | 消息节点「编辑」+ fork |
| 上下文压缩 | `/compact` `/clear` | 有 `compaction` 服务,无用户入口 | 右侧栏 /compact 按钮 |
| 模型切换 | `/model` | 有模型选择器 | composer 常驻模型下拉 |
| 用量/成本 | `/cost` `/usage` `/context` | 正在做(成本面板) | 右侧栏成本 tab + /cost 命令 |
| 审批/权限 | `/approvals` `/permissions` | 有审批栈 + permission presets | 右侧栏审批面板 |
| 会话恢复 | `/resume -l` `/new` | 有会话历史 | 侧栏搜索 + resume |
| 斜杠命令体系 | 45+ 命令 | 有 `commands.register` | composer `/` 命令面板,可扩展 |
| 项目记忆/规则 | AGENTS.md / memory | **缺失** | 项目级规则文件注入(类似 AGENTS.md) |
| 多 agent 委派 | 子 agent | 有 subagents | 保留,不重复造 |
| 沙箱 | sandbox | 有 sandbox | 保留 |

---

## 六、实施阶段

| 阶段 | 内容 |
|---|---|
| P1 骨架 | 包结构 + 单 bundle 跑通 `dsh plugin add` |
| P2 右侧栏骨架 + 成本/通知 | 右侧侧边栏(tab 框架)+ 成本面板(抄 dsh-calculator)+ 头部铃铛 |
| P3 吸收工具组 | Git 图(重排进右侧栏)+ 皮肤(修 home)+ 任务看板(左侧)+ 会话管理 |
| P4 Codex 对标 + 编辑组 | /undo /redo /compact /model /cost /approvals + 消息编辑/分支 + 斜杠命令 + @提及 + 记忆 |

---

## 七、已拍板(评审结论)

| 项 | 结论 |
|---|---|
| 总量口径 | **当天全部会话累计**(dsh-calculator 原设计) |
| 当前会话展示 | **保留,可折叠**(次要) |
| 右侧栏实现形式 | 待定(实现时优先复用官方 `details` 扩 tab,侵入性最小;不行再自建) |
| Codex 对标 | **抄社区绝大部分现有实现**(细节由实施者按专业判断,用户不指定) |
| skill/MCP 管理 | **并入本插件**(双端插件,设置页,可抄 liqichen,需适配 Windows) |
| 界面显示细节(全部流等) | **待定**(实现时给出界面再确认) |

**状态:方案已定稿,暂不开工。** 待用户明确「开始」后再实施。
