/**
 * 预加载脚本：在隔离环境中把有限的 API 暴露给渲染进程（window.api）。
 * 渲染进程无法直接使用 Node 或 Electron 的能力。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type MenuCommand, type RendererApi } from '@shared/ipc'

function subscribe<T extends unknown[]>(
  channel: string,
  handler: (...args: T) => void
): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => handler(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: RendererApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  getTemplateDefaults: (templateId) => ipcRenderer.invoke(IPC.getTemplateDefaults, templateId),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  openProjectAt: (filePath) => ipcRenderer.invoke(IPC.openProjectAt, filePath),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  chooseLibraryDir: () => ipcRenderer.invoke(IPC.chooseLibraryDir),
  chooseFolder: (defaultPath) => ipcRenderer.invoke(IPC.chooseFolder, defaultPath),
  createProject: (request) => ipcRenderer.invoke(IPC.createProject, request),
  removeRecent: (filePath) => ipcRenderer.invoke(IPC.removeRecent, filePath),
  revealInFolder: (filePath) => ipcRenderer.send(IPC.revealInFolder, filePath),
  importDocx: (presetId) => ipcRenderer.invoke(IPC.importDocx, presetId),
  createFromDocx: (templateId, presetId) => ipcRenderer.invoke(IPC.createFromDocx, templateId, presetId),
  getDefaultPreset: () => ipcRenderer.invoke(IPC.getDefaultPreset),
  setDefaultPreset: (presetId) => ipcRenderer.invoke(IPC.setDefaultPreset, presetId),
  defaultExportDir: (projectPath) => ipcRenderer.invoke(IPC.defaultExportDir, projectPath),
  exportCheck: (dir, baseName, variants) => ipcRenderer.invoke(IPC.exportCheck, dir, baseName, variants),
  exportWord: (request) => ipcRenderer.invoke(IPC.exportWord, request),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  saveProject: (request) => ipcRenderer.invoke(IPC.saveProject, request),
  getStartupFile: () => ipcRenderer.invoke(IPC.getStartupFile),
  setWindowState: (state) => ipcRenderer.send(IPC.setWindowState, state),
  confirmClose: () => ipcRenderer.send(IPC.confirmClose),
  onMenuCommand: (handler) => subscribe<[MenuCommand]>(IPC.menuCommand, handler),
  onSaveBeforeClose: (handler) => subscribe<[]>(IPC.saveBeforeClose, handler),
  onOpenFileRequest: (handler) => subscribe<[string]>(IPC.openFileRequest, handler)
}

contextBridge.exposeInMainWorld('api', api)
