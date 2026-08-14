/**
 * DSH Desktop — 主进程入口。
 *
 * 职责：单实例锁、设置存储、dsh web 服务器子进程管理、主窗口（加载官方
 * Harness Web UI）、设置窗口（桌面壳层配置）、托盘与应用菜单、退出生命周期。
 * 不修改官方 Web UI 的任何界面 —— 本应用只是它的桌面壳层。
 */
import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog } from 'electron'
import { join } from 'node:path'
import { createSettingsStore } from './settings.js'
import { ServerManager } from './server.js'
import { buildAppMenu } from './menu.js'
import { createTray } from './tray.js'
import { DSH_DESKTOP_VERSION } from './version.js'

/** 单实例：重复启动时唤起已有窗口。 */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  bootstrap()
}

async function bootstrap() {
  // 测试/多实例隔离：允许用环境变量覆盖 userData（设置文件与工作目录所在地）。
  if (process.env.DSH_DESKTOP_USERDATA) {
    app.setPath('userData', process.env.DSH_DESKTOP_USERDATA)
  }
  const settings = createSettingsStore(app)
  const server = new ServerManager({ settings, app })

  /** 主窗口：加载官方 Harness Web UI。 */
  let mainWindow = null
  /** 设置窗口：桌面壳层的启动级配置。 */
  let settingsWindow = null
  /** 真正退出中（区别于“关闭窗口→最小化到托盘”）。 */
  let isQuitting = false

  const openSettings = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus()
      return
    }
    settingsWindow = new BrowserWindow({
      width: 760,
      height: 720,
      title: 'DSH Desktop 设置',
      resizable: true,
      minimizable: true,
      maximizable: false,
      autoHideMenuBar: true,
      icon: appIcon(),
      webPreferences: {
        preload: join(app.getAppPath(), 'src', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    settingsWindow.loadFile(join(app.getAppPath(), 'src', 'renderer', 'settings.html'))
    settingsWindow.on('closed', () => { settingsWindow = null })
  }

  const createMainWindow = () => {
    const port = server.state().port ?? settings.get('preferredPort', 3080)
    mainWindow = new BrowserWindow({
      width: 1360,
      height: 900,
      title: 'DSH Desktop',
      autoHideMenuBar: false,
      icon: appIcon(),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    mainWindow.setMenu(buildAppMenu({ openSettings, onQuit: quit }))
    mainWindow.loadURL(`http://127.0.0.1:${port}`)
    mainWindow.webContents.on('did-finish-load', () => {
      console.log(`[window] 官方界面已加载: ${mainWindow.webContents.getURL()}`)
    })
    // 外部链接一律交给系统浏览器，绝不从窗口内导航走。
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    mainWindow.webContents.on('will-navigate', (event, url) => {
      const current = mainWindow.webContents.getURL()
      const sameOrigin = new URL(url).origin === new URL(current).origin
      if (!sameOrigin) {
        event.preventDefault()
        if (/^https?:/.test(url)) shell.openExternal(url)
      }
    })
    mainWindow.on('closed', () => { mainWindow = null })
    // 关闭窗口 → 最小化到托盘（服务器保持后台运行）；真正退出走菜单/托盘“退出”。
    mainWindow.on('close', (event) => {
      if (settings.get('closeToTray', true) && !isQuitting) {
        event.preventDefault()
        mainWindow.hide()
      }
    })
  }

  /** 服务器就绪后创建/刷新主窗口。 */
  const ensureWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
    else {
      const port = server.state().port
      if (port) mainWindow.loadURL(`http://127.0.0.1:${port}`)
    }
  }

  const quit = async () => {
    isQuitting = true
    await server.stop()
    app.quit()
  }

  // ── 服务器事件 → UI 状态同步 ──────────────────────────────
  server.on('status', (state) => broadcast('server:status', state))
  server.on('log', (entry) => broadcast('server:log', entry))

  const broadcast = (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  // ── IPC ──────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => settings.all())
  ipcMain.handle('settings:save', (_event, patch) => {
    settings.update(patch)
    return settings.all()
  })
  ipcMain.handle('app:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('server:state', () => server.state())
  ipcMain.handle('server:start', async () => { await server.start(); return server.state() })
  ipcMain.handle('server:stop', async () => { await server.stop(); return server.state() })
  ipcMain.handle('server:restart', async () => { await server.restart(); return server.state() })
  ipcMain.handle('server:logs', () => server.logs())
  ipcMain.handle('app:openExternal', (_e, url) => { if (/^https?:/.test(String(url))) shell.openExternal(String(url)) })
  ipcMain.handle('app:quit', async () => { await quit() })
  ipcMain.handle('app:openSettings', () => openSettings())
  ipcMain.handle('app:version', () => ({ app: DSH_DESKTOP_VERSION, electron: process.versions.electron, node: process.versions.node }))

  // ── 生命周期 ─────────────────────────────────────────────
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('before-quit', async (event) => {
    isQuitting = true
    if (!server.isStopped()) {
      event.preventDefault()
      await server.stop()
      app.quit()
    }
  })

  app.whenReady().then(async () => {
    createTray({ app, server, openSettings, ensureWindow, onQuit: quit })
    server.on('status', (state) => {
      if (state.running) ensureWindow()
    })
    await server.start()
    // 仅在服务器真正就绪时才打开主窗口，避免把连接失败页摆到用户面前。
    if (server.state().running) ensureWindow()
    // macOS 惯例：无窗口时保持应用存活。
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) ensureWindow() })
  })

  // 开发辅助：--log 打开主窗口 DevTools。
  if (process.argv.includes('--log')) {
    app.whenReady().then(() => {
      setTimeout(() => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.openDevTools({ mode: 'detach' })
        }
      }, 1500)
    })
  }
}

/** 应用图标：优先随包图标，其次用内嵌占位图标，避免无图标告警。 */
function appIcon() {
  const paths = [
    join(app.getAppPath(), 'build', 'icon.png'),
  ]
  for (const p of paths) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img
  }
  return undefined
}
