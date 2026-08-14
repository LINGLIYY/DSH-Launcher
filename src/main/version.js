/** 应用版本：读取项目 package.json（打包后位于 app.asar 内，Electron 可读）。 */
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function readVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const DSH_DESKTOP_VERSION = readVersion()
