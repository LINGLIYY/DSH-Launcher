/** 主窗口应用菜单。 */
import { app, shell, Menu } from 'electron'
import { DSH_DESKTOP_VERSION } from './version.js'

export function buildAppMenu({ openSettings, onQuit }) {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac
      ? [{ role: 'appMenu', label: 'DSH Desktop' }]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { label: '退出', accelerator: 'Alt+F4', click: onQuit },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'DeepSeek Harness 仓库',
          click: () => shell.openExternal('https://github.com/deepseek-ai/deepseek-harness'),
        },
        {
          label: '关于 DSH Desktop',
          click: () => {
            app.showAboutPanel?.()
          },
        },
      ],
    },
  ]
  const menu = Menu.buildFromTemplate(template)
  app.setAboutPanelOptions?.({
    applicationName: 'DSH Desktop',
    applicationVersion: DSH_DESKTOP_VERSION,
    copyright: '基于 DeepSeek Harness（MIT License）',
  })
  return menu
}
