/**
 * 设置存储：桌面壳层的启动级配置，持久化在
 * `<userData>/settings.json`（Windows 默认 `%APPDATA%/DSH Desktop/settings.json`）。
 *
 * 只存壳层需要的启动参数（服务器端口、凭据、DSH_HOME 等）；
 * 模型、代理人格、主题等会话级偏好一律留在官方 Web UI 自己的设置里。
 */
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const DEFAULTS = {
  /** 首选端口；被占用且是 dsh web 时复用，否则顺延找空闲端口。 */
  preferredPort: 3080,
  /**
   * 附加模式：
   *  - 'auto'            首选端口上已有 dsh web → 直接复用（不重复启动）
   *  - 'always-spawn'    总是启动自己的实例
   */
  attachMode: 'auto',
  /** DEEPSEEK_API_KEY（可选；也可在官方 UI 的设置里配置凭据）。 */
  apiKey: '',
  /** DEEPSEEK_BASE_URL（可选）。 */
  baseUrl: '',
  /** DSH_HOME（可选；留空则用 Harness 默认值 ~/.dsh）。 */
  dshHome: '',
  /** DSH_TOOLS_MODE：native | code | both（可选）。 */
  toolsMode: '',
  /** 工作目录（子进程 cwd，影响 system prompt 的 {{cwd}} 与文件工具根；留空用 <userData>/workspace）。 */
  workspace: '',
  /** 关闭遥测（DSH_TELEMETRY_DISABLED=1）。 */
  disableTelemetry: true,
  /** 关闭窗口时最小化到托盘而不是退出（服务器保持运行）。 */
  closeToTray: true,
}

export function createSettingsStore(appInstance) {
  const file = join(appInstance.getPath('userData'), 'settings.json')
  let data = { ...DEFAULTS }

  try {
    const raw = readFileSync(file, 'utf8')
    // 兼容带 UTF-8 BOM 的写入（部分编辑器/工具会加 BOM，JSON.parse 不接受）。
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (parsed && typeof parsed === 'object') data = { ...DEFAULTS, ...parsed }
  } catch {
    // 首次启动或损坏文件：使用默认值，稍后写回。
  }

  const persist = () => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
    } catch (error) {
      console.error('[settings] 写入失败:', error.message)
    }
  }

  return {
    file,
    all: () => ({ ...data }),
    get: (key, fallback) => (key in data ? data[key] : fallback),
    /** 合并更新并落盘。 */
    update(patch) {
      data = { ...data, ...patch }
      persist()
      return { ...data }
    },
  }
}
