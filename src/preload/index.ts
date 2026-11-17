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
  openMoanImport: () => ipcRenderer.send(IPC.openMoanImport),
  getTemplateDefaults: (templateId) => ipcRenderer.invoke(IPC.getTemplateDefaults, templateId),
  listTemplates: () => ipcRenderer.invoke(IPC.listTemplates),
  reloadTemplates: () => ipcRenderer.invoke(IPC.reloadTemplates),
  importTemplate: () => ipcRenderer.invoke(IPC.importTemplate),
  exportTemplate: (presetId) => ipcRenderer.invoke(IPC.exportTemplate, presetId),
  duplicateTemplate: (presetId) => ipcRenderer.invoke(IPC.duplicateTemplate, presetId),
  deleteTemplate: (presetId) => ipcRenderer.invoke(IPC.deleteTemplate, presetId),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  openProjectAt: (filePath) => ipcRenderer.invoke(IPC.openProjectAt, filePath),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  chooseLibraryDir: () => ipcRenderer.invoke(IPC.chooseLibraryDir),
  chooseFolder: (defaultPath) => ipcRenderer.invoke(IPC.chooseFolder, defaultPath),
  createProject: (request) => ipcRenderer.invoke(IPC.createProject, request),
  removeRecent: (filePath) => ipcRenderer.invoke(IPC.removeRecent, filePath),
  revealInFolder: (filePath) => ipcRenderer.send(IPC.revealInFolder, filePath),
  importDocx: (presetId, asKnowledge) => ipcRenderer.invoke(IPC.importDocx, presetId, asKnowledge === true),
  createFromDocx: (templateId, presetId) => ipcRenderer.invoke(IPC.createFromDocx, templateId, presetId),
  getDefaultPreset: () => ipcRenderer.invoke(IPC.getDefaultPreset),
  setDefaultPreset: (presetId) => ipcRenderer.invoke(IPC.setDefaultPreset, presetId),
  getOptionStopSchemes: () => ipcRenderer.invoke(IPC.getOptionStopSchemes),
  getLocalPlaces: () => ipcRenderer.invoke(IPC.getLocalPlaces),
  listFolder: (dir) => ipcRenderer.invoke(IPC.listFolder, dir),
  listSubfolders: (dir) => ipcRenderer.invoke(IPC.listSubfolders, dir),
  renameFile: (filePath, newStem) => ipcRenderer.invoke(IPC.renameFile, filePath, newStem),
  trashFile: (filePath) => ipcRenderer.invoke(IPC.trashFile, filePath),
  readProject: (filePath) => ipcRenderer.invoke(IPC.readProject, filePath),
  createFromDocxAt: (filePath, templateId, presetId) => ipcRenderer.invoke(IPC.createFromDocxAt, filePath, templateId, presetId),
  setOptionStopSchemes: (schemes) => ipcRenderer.invoke(IPC.setOptionStopSchemes, schemes),
  defaultExportDir: (projectPath) => ipcRenderer.invoke(IPC.defaultExportDir, projectPath),
  exportCheck: (dir, baseName, variants, points) => ipcRenderer.invoke(IPC.exportCheck, dir, baseName, variants, points),
  getExportPointsDefault: () => ipcRenderer.invoke(IPC.getExportPointsDefault),
  getMathUpright: () => ipcRenderer.invoke(IPC.getMathUpright),
  workbuddyStatus: () => ipcRenderer.invoke(IPC.workbuddyStatus),
  workbuddyConnect: () => ipcRenderer.invoke(IPC.workbuddyConnect),
  workbuddyDisconnect: () => ipcRenderer.invoke(IPC.workbuddyDisconnect),
  workbuddyStart: (input) => ipcRenderer.invoke(IPC.workbuddyStart, input),
  workbuddyUpdate: (taskId, figureCount) => ipcRenderer.invoke(IPC.workbuddyUpdate, taskId, figureCount),
  workbuddyCancel: (taskId) => ipcRenderer.invoke(IPC.workbuddyCancel, taskId),
  onWorkbuddyResult: (handler) => subscribe<[{ taskId: string; text: string }]>(IPC.workbuddyResult, handler),
  workbuddyRedrawStart: (figures) => ipcRenderer.invoke(IPC.workbuddyRedrawStart, figures),
  workbuddyRedrawCancel: (taskId) => ipcRenderer.invoke(IPC.workbuddyRedrawCancel, taskId),
  onWorkbuddyRedrawResult: (handler) => subscribe<[{ taskId: string; figure: number; svg: string }]>(IPC.workbuddyRedrawResult, handler),
  setMathUpright: (on) => ipcRenderer.invoke(IPC.setMathUpright, on),
  setExportPointsDefault: (on) => ipcRenderer.invoke(IPC.setExportPointsDefault, on),
  getTheme: () => ipcRenderer.invoke(IPC.getTheme),
  setTheme: (id) => ipcRenderer.invoke(IPC.setTheme, id),
  getThemeEffectsOff: () => ipcRenderer.invoke(IPC.getThemeEffectsOff),
  setThemeEffectsOff: (value) => ipcRenderer.invoke(IPC.setThemeEffectsOff, value),
  exportWord: (request) => ipcRenderer.invoke(IPC.exportWord, request),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  saveProject: (request) => ipcRenderer.invoke(IPC.saveProject, request),
  getStartupFile: () => ipcRenderer.invoke(IPC.getStartupFile),
  setWindowState: (state) => ipcRenderer.send(IPC.setWindowState, state),
  confirmClose: () => ipcRenderer.send(IPC.confirmClose),
  askSaveChanges: (title) => ipcRenderer.invoke(IPC.askSaveChanges, title),
  onMenuCommand: (handler) => subscribe<[MenuCommand]>(IPC.menuCommand, handler),
  onSaveBeforeClose: (handler) => subscribe<[]>(IPC.saveBeforeClose, handler),
  onOpenFileRequest: (handler) => subscribe<[string]>(IPC.openFileRequest, handler)
}

contextBridge.exposeInMainWorld('api', api)
