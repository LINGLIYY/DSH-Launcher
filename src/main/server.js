/**
 * 服务器管理器：拉起/复用 dsh web（官方 Harness Web UI）子进程。
 *
 * 启动配方（与官方 `dsh web` 等价）：
 *   node <runtime>/@deepseek-ai/dsh/lib/bin.js --profile web --host 127.0.0.1 --port <port>
 *
 * 运行时解析顺序：
 *   1) 打包后：<resourcesPath>/harness/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js
 *   2) 开发期：<app>/resources/harness/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js（postinstall 生成）
 *   3) 开发期回退：<app>/node_modules/@deepseek-ai/dsh/lib/bin.js
 *
 * 子进程用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE=1）启动，目标机器无需安装 Node。
 */
import { app } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import net from 'node:net'

/** 官方 Web UI 首页的可靠标记（只有 dsh web 会注入 window.__DSH_BOOT__）。 */
const DSH_WEB_MARKER = '__DSH_BOOT__'
/** 日志环形缓冲上限（行数）。 */
const MAX_LOG_LINES = 2000
/** 服务器就绪等待上限。 */
const READY_TIMEOUT_MS = 60_000
/** 优雅退出宽限后强制杀进程树。 */
const KILL_GRACE_MS = 3000

export class ServerManager extends EventEmitter {
  constructor({ settings }) {
    super()
    this.settings = settings
    this.child = null
    this._logs = []
    this._stopping = false
    this._starting = false
    this._state = { running: false, attached: false, port: null, pid: null, url: null, error: null, startedAt: null }
  }

  state() {
    return { ...this._state }
  }

  isStopped() {
    return !this._state.running
  }

  logs() {
    return [...this._logs]
  }

  // ── 运行时与启动 ─────────────────────────────────────────

  resolveBin() {
    const candidates = []
    if (process.resourcesPath) {
      candidates.push(join(process.resourcesPath, 'harness', 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    }
    candidates.push(join(app.getAppPath(), 'resources', 'harness', 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    candidates.push(join(app.getAppPath(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    return null
  }

  /** 探测某端口是否已在跑 dsh web。 */
  async probeDshWeb(port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) })
      if (res.status !== 200) return false
      const body = await res.text()
      return body.includes(DSH_WEB_MARKER)
    } catch {
      return false
    }
  }

  /** 从 start 起找第一个可绑定的端口。 */
  nextFreePort(start) {
    return new Promise((resolve, reject) => {
      const tryPort = (port) => {
        if (port > start + 100) return reject(new Error(`找不到空闲端口（从 ${start} 起 100 个端口都被占用）`))
        const srv = net.createServer()
        srv.once('error', () => { srv.close(); tryPort(port + 1) })
        srv.listen({ port, host: '127.0.0.1' }, () => { srv.close(() => resolve(port)) })
      }
      tryPort(start)
    })
  }

  buildEnv() {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    const apiKey = this.settings.get('apiKey', '')
    const baseUrl = this.settings.get('baseUrl', '')
    const dshHome = this.settings.get('dshHome', '')
    const toolsMode = this.settings.get('toolsMode', '')
    if (apiKey) env.DEEPSEEK_API_KEY = apiKey
    if (baseUrl) env.DEEPSEEK_BASE_URL = baseUrl
    if (dshHome) env.DSH_HOME = dshHome
    if (toolsMode) env.DSH_TOOLS_MODE = toolsMode
    if (this.settings.get('disableTelemetry', true)) env.DSH_TELEMETRY_DISABLED = '1'
    return env
  }

  workspaceDir() {
    const configured = this.settings.get('workspace', '')
    if (configured) return configured
    return join(app.getPath('userData'), 'workspace')
  }

  pushLog(stream, chunk) {
    const text = chunk.toString('utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      const entry = { ts: Date.now(), stream, text: line }
      this._logs.push(entry)
      this.emit('log', entry)
    }
    if (this._logs.length > MAX_LOG_LINES) this._logs.splice(0, this._logs.length - MAX_LOG_LINES)
  }

  // ── 生命周期 ─────────────────────────────────────────────

  async start() {
    if (this._state.running) return this._state
    if (this._starting) return this._state
    this._starting = true
    try {
      return await this.#startInner()
    } finally {
      this._starting = false
    }
  }

  async #startInner() {

    const preferred = Number(this.settings.get('preferredPort', 3080)) || 3080
    const attachMode = this.settings.get('attachMode', 'auto')

    // 复用已在跑的官方实例（比如用户手动启动的 dsh web）。
    if (attachMode === 'auto' && (await this.probeDshWeb(preferred))) {
      this._state = {
        running: true,
        attached: true,
        port: preferred,
        pid: null,
        url: `http://127.0.0.1:${preferred}`,
        error: null,
        startedAt: Date.now(),
      }
      this.emit('status', this._state)
      return this._state
    }

    const bin = this.resolveBin()
    if (!bin) {
      this._state = { ...this._state, running: false, error: '未找到 dsh web 运行时，请先运行 npm install（postinstall 会安装 Harness runtime）' }
      this.emit('status', this._state)
      return this._state
    }

    let port
    try {
      port = await this.nextFreePort(preferred)
    } catch (error) {
      this._state = { ...this._state, running: false, error: error.message }
      this.emit('status', this._state)
      return this._state
    }

    // 确保工作目录存在，子进程以此为 cwd（影响 system prompt 中的 {{cwd}} 与文件工具根）。
    const workspace = this.workspaceDir()
    try { mkdirSync(workspace, { recursive: true }) } catch { /* 交给子进程报错 */ }

    this._stopping = false
    // --expose-internals：HMR 服务需要访问 Node 内部模块；electron-as-node 下
    // 原生插件 node-addon-require-builtin 的 ABI 与 Electron 不一致，必须走该
    // 纯 JS 路径（等价于官方 `dsh web` 的启动方式）。
    const child = spawn(process.execPath, ['--expose-internals', bin, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port)], {
      env: this.buildEnv(),
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child

    const state = {
      running: false,
      attached: false,
      port,
      pid: child.pid,
      url: `http://127.0.0.1:${port}`,
      error: null,
      startedAt: null,
    }
    this._state = state
    this.emit('status', this._state)

    child.stdout.on('data', (chunk) => this.pushLog('out', chunk))
    child.stderr.on('data', (chunk) => this.pushLog('err', chunk))
    child.on('error', (error) => {
      this.pushLog('err', Buffer.from(`启动失败: ${error.message}`))
      this._state = { ...this._state, running: false, error: error.message }
      this.emit('status', this._state)
    })
    child.on('exit', (code, signal) => {
      this.child = null
      if (!this._stopping) {
        this.pushLog('err', Buffer.from(`dsh web 进程退出 code=${code} signal=${signal ?? ''}`))
        this._state = { ...this._state, running: false, error: `dsh web 进程退出（code=${code}）` }
        this.emit('status', this._state)
      }
    })

    // 就绪等待：轮询首页出现 dsh web 标记。
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.child === null || child.exitCode !== null) break
      if (await this.probeDshWeb(port)) {
        this._state = { ...state, running: true, startedAt: Date.now() }
        this.emit('status', this._state)
        return this._state
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (this.child !== null && child.exitCode === null) {
      this._state = { ...this._state, running: true, startedAt: Date.now(), error: null }
      this.emit('status', this._state)
      return this._state
    }
    // 子进程已退出时，exit 处理器已写入更准确的错误。
    const reason = this._state.error ?? '等待 dsh web 就绪超时'
    this._state = { ...this._state, running: false, error: reason }
    this.emit('status', this._state)
    return this._state
  }

  async stop() {
    const child = this.child
    this._stopping = true
    if (child) {
      const exited = new Promise((resolve) => child.once('exit', resolve))
      try { child.kill('SIGTERM') } catch { /* 已退出 */ }
      const timedOut = await Promise.race([
        exited.then(() => false),
        new Promise((resolve) => setTimeout(() => resolve(true), KILL_GRACE_MS)),
      ])
      if (timedOut && process.platform === 'win32') {
        // 强制杀整棵进程树（含 dsh web 派生的子代理进程）。
        try {
          spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
        } catch { /* 尽力而为 */ }
      } else if (timedOut) {
        try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      }
    }
    this.child = null
    this._state = { running: false, attached: false, port: null, pid: null, url: null, error: null, startedAt: null }
    this.emit('status', this._state)
  }

  async restart() {
    await this.stop()
    return this.start()
  }
}
