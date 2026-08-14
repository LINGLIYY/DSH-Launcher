/**
 * 预加载脚本：只给设置窗口注入最小 IPC 桥（官方 Web UI 主窗口不加载本脚本，
 * 保持页面纯净）。
 */
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickDirectory: (title) => ipcRenderer.invoke('app:pickDirectory', title),

  // 服务器
  serverState: () => ipcRenderer.invoke('server:state'),
  serverStart: () => ipcRenderer.invoke('server:start'),
  serverStop: () => ipcRenderer.invoke('server:stop'),
  serverRestart: () => ipcRenderer.invoke('server:restart'),
  serverLogs: () => ipcRenderer.invoke('server:logs'),

  // 事件订阅（返回退订函数）
  onServerStatus: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('server:status', listener)
    return () => ipcRenderer.removeListener('server:status', listener)
  },
  onServerLog: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('server:log', listener)
    return () => ipcRenderer.removeListener('server:log', listener)
  },

  // 应用
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  quit: () => ipcRenderer.invoke('app:quit'),
  version: () => ipcRenderer.invoke('app:version'),
}

contextBridge.exposeInMainWorld('dshDesktop', api)
