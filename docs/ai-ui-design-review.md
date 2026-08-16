# 网页 AI 辅助 UI 设计：判定机制与等待流程

## 背景

用网页 AI 评审/设计本启动器界面时，不同 AI 擅长的领域差异很大：

- **DeepSeek（chat.deepseek.com）**：推理与文字分析强，但前端/UI 设计能力一般，**不用于界面设计任务**。
- **Kimi（kimi.com）**、**GLM（chatglm.cn）**、**豆包（doubao.com）**、**Qwen（chat.qwen.ai）**：更适合前端设计评审。

因此引入两层机制：**AI 适配判定** + **等待计算（超时轮询）**，避免盲等或误用。

## 一、AI 适配判定

| 判定项 | 规则 |
| --- | --- |
| 任务类型 | 界面/排版/配色 → 设计型 AI（Kimi/GLM/豆包/Qwen）；代码逻辑/文字分析 → 可用 DeepSeek |
| 登录态 | 优先用已登录的 AI（CDP 复用 Default profile 登录态）；未登录的让用户在该调试窗口补登 |
| 图片上传 | 点击“文件和图片/上传”按钮 → 出现 `input[type=file]` → `agent-browser upload` → 验证附件区出现图片 → 再补文字并点发送 |
| 结果采纳 | 用下方评分表打分，总分 >= 8/12 才采纳，否则带反馈重试一次 |

### 方案评分表（0-2 分/项）

1. 主色为浅蓝 + 白，无黑色大面积背景
2. 无 emoji
3. 布局结构清晰（标题/信息条/页签/内容/状态栏分层）
4. 间距与留白符合 8px 网格
5. 信息层级明确（主次按钮、状态指示）
6. 看板娘与内容不互相遮挡、融合自然

## 二、等待计算（统一超时与轮询）

所有网页操作都要等待，且不能死等：

| 阶段 | 等待 |
| --- | --- |
| 打开页面 | 6s（`agent-browser wait 6000`） |
| 点击后出现新元素 | 1.5-2.5s |
| 图片上传 | 3.5s 后验证附件区 |
| 生成完成轮询 | 每 30s 检查一次，单轮上限 300s |
| 整体重试 | 失败最多重试 2 次，每次附带反馈 |

轮询判据（通用）：

```js
(() => { const t=document.body.innerText; return /停止|思考中/.test(t) ? 'STILL' : 'DONE'; })()
```

## 三、标准流程（含等待）

```powershell
# 1. 探测并启动 CDP Chrome（Chrome 未运行时安全）
node ~/.codex/skills/browser-cdp/scripts/setup-cdp-chrome.js 9222 --detect-only
node ~/.codex/skills/browser-cdp/scripts/setup-cdp-chrome.js 9222 --yes

# 2. 打开目标 AI 并确认登录态
agent-browser --cdp 9222 open "https://www.kimi.com/"
agent-browser --cdp 9222 wait 6000

# 3. 上传截图（点“文件和图片”后出现文件输入框）
agent-browser --cdp 9222 eval "document.querySelector('[contenteditable=true]') && document.querySelector('[contenteditable=true]').focus()"
agent-browser --cdp 9222 press "Control+a"
agent-browser --cdp 9222 keyboard type "请分析我上传的截图，给出排版建议…"
agent-browser --cdp 9222 eval "(() => { const c=document.querySelector('.send-button-container'); (c.querySelector('button')||c).click(); })()"

# 4. 等待生成完成（用 webai-flow.ps1 的 Wait-GenerationDone）
```

## 四、实施记录

- 2026-08-16：Kimi（已登录）完成 DSH Desktop 窗口截图排版评审，P0 项（看板娘与日志分离、按钮分级、状态栏分隔）已落地。
