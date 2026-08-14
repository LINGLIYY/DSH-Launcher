/**
 * postinstall：把官方 Harness runtime（@deepseek-ai/dsh）安装到
 * resources/harness，作为打包进桌面的自带运行时（extraResources）。
 *
 * 子进程用 Electron 自带的 Node 启动（ELECTRON_RUN_AS_NODE=1），
 * 目标机器无需安装 Node 或 pnpm。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
// node_modules 装在 runtime 子目录（而非 resources/harness 根）——
// electron-builder 的 extraResources 过滤器会硬编码排除 from 根级别的
// node_modules，只有嵌套的子 node_modules 会被打包进来。
const TARGET = join(ROOT, 'resources', 'harness', 'runtime')
const DSH_VERSION = '0.1.0-rc.6'

// 已在目标里且存在 bin.js → 跳过（避免每次 npm install 都重装）。
const marker = join(TARGET, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (existsSync(marker)) {
  console.log('[install-harness] 已存在 Harness runtime，跳过安装。')
  process.exit(0)
}

mkdirSync(TARGET, { recursive: true })
const cacheDir = join(ROOT, '.npm-cache')
mkdirSync(cacheDir, { recursive: true })

// 直接以 node 运行系统 npm 的 cli，绕开 npm.cmd 的本地前缀 shim：
// 从项目目录（含 node_modules）里调用 npm.cmd 会被 npm-prefix.js 解析到
// 项目内的假 npm-cli 路径而失败。
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const args = [
  npmCli,
  'install',
  '--prefix', TARGET,
  '--no-save',
  '--no-package-lock',
  '--cache', cacheDir,
  '--loglevel', 'error',
  `@deepseek-ai/dsh@${DSH_VERSION}`,
]

console.log(`[install-harness] 安装 @deepseek-ai/dsh@${DSH_VERSION} → ${TARGET}`)
try {
  execFileSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  })
  if (!existsSync(marker)) throw new Error('安装完成但未找到 dsh bin.js')
  console.log('[install-harness] 完成。')
} catch (error) {
  console.error('[install-harness] 失败:', error.message)
  console.error('可手动执行: npm install --prefix resources/harness/runtime --no-save --no-package-lock @deepseek-ai/dsh@' + DSH_VERSION)
  process.exit(1)
}
