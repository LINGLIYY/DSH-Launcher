import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
  type MessageBoxOptions
} from 'electron'
import { HarnessRuntime } from './runtime/harness-runtime'
import { secureWindow } from './security'
import { ensureLaunchRoot } from './state/launch-root'
import { shouldLoadHarnessUrl } from './window-navigation'
import {
  checkForUpdates,
  registerUpdateHandlers,
  startUpdateManager,
  stopUpdateManager
} from './update/update-manager'
import type { RuntimeSnapshot } from '../shared/contracts'

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let runtime: HarnessRuntime
let launchDirectory: string
let quitting = false
let failureDialogVisible = false

async function syncNativeTheme(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return

  // The sidebar already reserves enough room for macOS traffic lights. Read
  // Harness's resolved theme before showing the window so the native surface
  // matches the first rendered frame without injecting a second titlebar.
  const isDark = await window.webContents.executeJavaScript(
    "document.body.hasAttribute('data-ds-dark-theme')"
  )
  window.setBackgroundColor(isDark ? '#141416' : '#ffffff')
}

function dshEntryPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app',
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'lib',
      'bin.js'
    )
  }
  return join(app.getAppPath(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

function desktopIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'app-icon.png')
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: '',
    icon: desktopIconPath(),
    frame: process.platform !== 'darwin',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141416' : '#f8f8f6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      webSecurity: true
    }
  })
  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(true)
    window.setWindowButtonPosition({ x: 12, y: 9 })
  }
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle('')
  })
  secureWindow(window)
  window.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  mainWindow = window
  return window
}

async function openHarness(url: string): Promise<void> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  if (shouldLoadHarnessUrl(window.webContents.getURL(), url)) {
    await window.loadURL(url)
  }
  if (runtime.snapshot().url !== url || window.isDestroyed()) return
  await syncNativeTheme(window)
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function launchHarness(): Promise<void> {
  mainWindow?.hide()
  await runtime.start(launchDirectory)
}

async function showMainWindow(): Promise<void> {
  const snapshot = runtime?.snapshot()
  if (snapshot?.phase === 'ready' && snapshot.url) {
    await openHarness(snapshot.url)
  } else if (snapshot?.phase === 'idle') {
    await launchHarness()
  }
}

async function quitApp(): Promise<void> {
  if (quitting) return
  quitting = true
  stopUpdateManager()
  await runtime?.stop()
  app.quit()
}

function createTray(): void {
  const image = nativeImage.createFromPath(desktopIconPath())
  const trayImage = image.isEmpty() ? image : image.resize({ width: 16, height: 16 })
  tray = new Tray(trayImage)
  tray.setToolTip('DSH Desktop')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 DSH Desktop',
        click: () => void showMainWindow().catch(showUnexpectedError)
      },
      {
        label: '重启 Harness',
        click: () => void launchHarness().catch(showUnexpectedError)
      },
      {
        label: '显示 Harness 日志',
        click: () => shell.showItemInFolder(join(app.getPath('logs'), 'harness.log'))
      },
      { type: 'separator' },
      { label: '退出', click: () => void quitApp() }
    ])
  )
  tray.on('double-click', () => void showMainWindow().catch(showUnexpectedError))
}

function showUnexpectedError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  dialog.showErrorBox('DSH Desktop 遇到错误', message)
}

async function showRuntimeFailure(snapshot: RuntimeSnapshot): Promise<void> {
  if (failureDialogVisible || quitting) return
  failureDialogVisible = true

  try {
    while (!quitting && runtime.snapshot().phase === 'failed') {
      const options: MessageBoxOptions = {
        type: 'error',
        title: 'Harness 无法启动',
        message: snapshot.message,
        detail: snapshot.launchDirectory
          ? `启动目录：${snapshot.launchDirectory}\n\n你可以重试，或查看 Harness 日志。`
          : '你可以重试，或查看 Harness 日志。',
        buttons: ['重试', '显示日志', '退出'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      }
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)

      if (result.response === 0) {
        await launchHarness()
      } else if (result.response === 1) {
        shell.showItemInFolder(join(app.getPath('logs'), 'harness.log'))
        continue
      } else {
        app.quit()
      }

      if (runtime.snapshot().phase !== 'failed') return
      snapshot = runtime.snapshot()
    }
  } catch (error) {
    showUnexpectedError(error)
  } finally {
    failureDialogVisible = false
  }
}

function installMenu(): void {
  const checkForUpdatesLabel = app.getLocale().toLowerCase().startsWith('zh')
    ? '检查更新…'
    : 'Check for Updates…'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              {
                label: checkForUpdatesLabel,
                accelerator: 'CmdOrCtrl+U',
                click: () => void checkForUpdates(true).catch(showUnexpectedError)
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'Harness',
      submenu: [
        {
          label: '重启 Harness',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => void launchHarness().catch(showUnexpectedError)
        },
        {
          label: '显示 Harness 日志',
          click: () => shell.showItemInFolder(join(app.getPath('logs'), 'harness.log'))
        },
        ...(process.platform === 'darwin'
          ? []
          : [
              { type: 'separator' as const },
              {
                label: checkForUpdatesLabel,
                accelerator: 'CmdOrCtrl+U',
                click: () => void checkForUpdates(true).catch(showUnexpectedError)
              }
            ]),
        ...(process.platform === 'darwin'
          ? []
          : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function bootstrap(): Promise<void> {
  if (process.platform === 'darwin') app.dock?.setIcon(desktopIconPath())
  launchDirectory = await ensureLaunchRoot(app.getPath('userData'))
  registerUpdateHandlers()
  createWindow()
  runtime = new HarnessRuntime({
    dshEntryPath: dshEntryPath(),
    dshHome: join(app.getPath('userData'), 'harness'),
    logPath: join(app.getPath('logs'), 'harness.log'),
    nodeExecutable: process.execPath,
    onChanged: (snapshot) => {
      if (snapshot.phase === 'ready' && snapshot.url) {
        void openHarness(snapshot.url).catch(showUnexpectedError)
      } else if (snapshot.phase === 'failed') {
        void showRuntimeFailure(snapshot)
      }
    }
  })
  installMenu()
  createTray()
  await launchHarness()
  startUpdateManager({
    prepareToInstall: async () => {
      await runtime.stop()
      quitting = true
      stopUpdateManager()
    }
  })
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.setName('DSH Desktop')
  app.commandLine.appendSwitch('lang', 'zh-CN')
  process.env.LANG = 'zh_CN.UTF-8'
  app.on('second-instance', () => {
    const snapshot = runtime?.snapshot()
    if (snapshot?.phase === 'ready' && snapshot.url) {
      void openHarness(snapshot.url).catch(showUnexpectedError)
    } else if (snapshot?.phase === 'idle') {
      void launchHarness().catch(showUnexpectedError)
    }
  })
  app.whenReady().then(bootstrap).catch((error: unknown) => {
    showUnexpectedError(error)
    app.quit()
  })
  app.on('activate', () => {
    const snapshot = runtime?.snapshot()
    if (snapshot?.phase === 'ready' && snapshot.url) {
      void openHarness(snapshot.url).catch(showUnexpectedError)
    } else if (snapshot?.phase === 'idle') {
      void launchHarness().catch(showUnexpectedError)
    }
  })
  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitting || !runtime) return
    event.preventDefault()
    quitting = true
    stopUpdateManager()
    void runtime.stop().finally(() => app.quit())
  })
}
