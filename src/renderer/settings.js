/**
 * 设置页逻辑：读写设置、控制服务器、实时日志。仅壳层配置 ——
 * 官方界面里的模型/主题/代理人格等设置原样保留。
 */
const api = window.dshDesktop

const $ = (id) => document.getElementById(id)
const els = {
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  statusMeta: $('statusMeta'),
  attachMode: $('attachMode'),
  preferredPort: $('preferredPort'),
  apiKey: $('apiKey'),
  baseUrl: $('baseUrl'),
  dshHome: $('dshHome'),
  workspace: $('workspace'),
  toolsMode: $('toolsMode'),
  disableTelemetry: $('disableTelemetry'),
  closeToTray: $('closeToTray'),
  log: $('log'),
  toast: $('toast'),
  ver: $('ver'),
  foot: $('foot'),
}

let settings = {}

function toast(msg) {
  els.toast.textContent = msg
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { els.toast.textContent = '' }, 2500)
}

function renderStatus(state) {
  const cls = state.running ? (state.attached ? 'attached' : 'running') : (state.error ? 'error' : 'idle')
  els.statusDot.className = `dot ${cls}`
  if (state.running) {
    els.statusText.textContent = state.attached ? '运行中（复用外部实例）' : '运行中（本应用实例）'
    els.statusMeta.textContent = state.attached
      ? `外部实例 @ ${state.url}`
      : `端口 ${state.port} · PID ${state.pid} · ${state.url}`
  } else if (state.error) {
    els.statusText.textContent = '错误'
    els.statusMeta.textContent = state.error
  } else {
    els.statusText.textContent = '未运行'
    els.statusMeta.textContent = ''
  }
}

function fillForm(data) {
  settings = data
  els.attachMode.value = data.attachMode ?? 'auto'
  els.preferredPort.value = data.preferredPort ?? 3080
  els.apiKey.value = data.apiKey ?? ''
  els.baseUrl.value = data.baseUrl ?? ''
  els.dshHome.value = data.dshHome ?? ''
  els.workspace.value = data.workspace ?? ''
  els.toolsMode.value = data.toolsMode ?? ''
  els.disableTelemetry.checked = data.disableTelemetry ?? true
  els.closeToTray.checked = data.closeToTray ?? true
}

function collectForm() {
  return {
    attachMode: els.attachMode.value,
    preferredPort: Number(els.preferredPort.value) || 3080,
    apiKey: els.apiKey.value.trim(),
    baseUrl: els.baseUrl.value.trim(),
    dshHome: els.dshHome.value.trim(),
    workspace: els.workspace.value.trim(),
    toolsMode: els.toolsMode.value,
    disableTelemetry: els.disableTelemetry.checked,
    closeToTray: els.closeToTray.checked,
  }
}

function appendLog(entry) {
  const line = document.createElement('div')
  line.className = entry.stream === 'err' ? 'err' : 'out'
  const t = new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })
  line.textContent = `[${t}] ${entry.text}`
  els.log.appendChild(line)
  // 限制 DOM 行数，避免长时间运行卡顿。
  while (els.log.childElementCount > 3000) els.log.removeChild(els.log.firstChild)
  els.log.scrollTop = els.log.scrollHeight
}

async function init() {
  fillForm(await api.getSettings())
  renderStatus(await api.serverState())
  for (const entry of await api.serverLogs()) appendLog(entry)
  const ver = await api.version()
  els.ver.textContent = `v${ver.app}`
  els.foot.textContent = `Electron ${ver.electron} · Node ${ver.node} · 官方 Harness Web UI 由 @deepseek-ai/dsh 提供`

  api.onServerStatus(renderStatus)
  api.onServerLog(appendLog)
}

$('btnSave').addEventListener('click', async () => {
  settings = await api.saveSettings(collectForm())
  toast('已保存 ✓（端口/环境变更后请重启服务器）')
})

$('btnStart').addEventListener('click', async () => { renderStatus(await api.serverStart()) })
$('btnRestart').addEventListener('click', async () => { renderStatus(await api.serverRestart()) })
$('btnStop').addEventListener('click', async () => { renderStatus(await api.serverStop()) })
$('btnOpen').addEventListener('click', async () => {
  const s = await api.serverState()
  if (s.url) api.openExternal(s.url)
})

$('btnDshHome').addEventListener('click', async () => {
  const dir = await api.pickDirectory('选择 DSH_HOME 数据目录')
  if (dir) els.dshHome.value = dir
})
$('btnWorkspace').addEventListener('click', async () => {
  const dir = await api.pickDirectory('选择工作目录')
  if (dir) els.workspace.value = dir
})

$('btnCopy').addEventListener('click', async () => {
  const text = [...els.log.children].map((el) => el.textContent).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toast('日志已复制 ✓')
  } catch {
    toast('复制失败')
  }
})
$('btnClear').addEventListener('click', () => { els.log.textContent = '' })

init()
