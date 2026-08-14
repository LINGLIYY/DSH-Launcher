/** 系统托盘：最小化到托盘、快速开关服务器、在浏览器打开。 */
import { Tray, Menu, nativeImage, shell } from 'electron'
import { join } from 'node:path'

export function createTray({ app, server, openSettings, ensureWindow, onQuit }) {
  let tray = null

  const iconPath = join(app.getAppPath(), 'build', 'icon.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    // 兜底：1x1 透明像素，保证托盘创建不失败。
    icon = nativeImage.createEmpty()
  } else {
    icon = icon.resize({ width: 16, height: 16 })
  }

  const rebuildMenu = () => {
    const state = server.state()
    const url = state.url
    const menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: ensureWindow },
      { label: '设置…', click: openSettings },
      { type: 'separator' },
      {
        label: state.running ? `服务器运行中${state.attached ? '（复用外部实例）' : `（端口 ${state.port}）`}` : '服务器未运行',
        enabled: false,
      },
      ...(url ? [{ label: '在浏览器打开', click: () => shell.openExternal(url) }] : []),
      {
        label: state.running ? '重启服务器' : '启动服务器',
        click: () => { if (state.running) server.restart().catch(() => {}); else server.start().catch(() => {}) },
      },
      ...(state.running && !state.attached ? [{ label: '停止服务器', click: () => server.stop().catch(() => {}) }] : []),
      { type: 'separator' },
      { label: '退出', click: onQuit },
    ])
    tray.setContextMenu(menu)
    tray.setToolTip(`DSH Desktop${state.running ? ` — ${state.url ?? ''}` : ' — 服务器未运行'}`)
  }

  tray = new Tray(icon)
  tray.on('click', () => { ensureWindow() })
  rebuildMenu()
  server.on('status', rebuildMenu)
  return tray
}
