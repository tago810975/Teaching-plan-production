/**
 * 主进程入口。
 *
 * 职责：创建窗口、处理菜单与文件关联、执行磁盘读写。
 * 内容编辑与排版全部在渲染进程完成，主进程不持有工程数据。
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { basename, dirname, join } from 'node:path'
import { ProjectFileError } from '@core/project-file/codec'
import { DocxReadError } from '@core/import/docx-reader'
import { DocxExportError } from '@core/export/docx-writer'
import { PROJECT_FILE_EXTENSION } from '@core/project-file/format'
import { IPC, type FolderListing, type LocalPlace, type MenuCommand, type OpenedProject, type Result, type SaveRequest } from '@shared/ipc'
import type { ProjectBundle } from '@core/model/types'
import { listDrives, listFolder, listSubfolders, renameEntry } from './files'
import { buildAppMenu } from './menu'
import { openMoanWindow } from './moan-window'
import { readTemplateDefaults } from './template-io'
import { currentCatalog, deleteTemplateFolder, duplicateTemplate, exportTemplate, importTemplate, loadUserTemplates, userTemplateDir } from './user-templates'
import { importDocxFiles } from './import-io'
import { existingExportFiles, exportWord } from './export-io'
import type { ExportRequest } from '@shared/ipc'
import type { Variant } from '@core/model/types'
import {
  ensureProjectExtension,
  isProjectFilePath,
  readProjectFile,
  sanitizeFileName,
  writeProjectFile
} from './project-io'
import {
  addRecent,
  createProject,
  getDefaultPresetId,
  getExportPointsDefault,
  setExportPointsDefault,
  getOptionStopSchemes,
  getLibraryDir,
  listProjects,
  removeRecent,
  renameRecent,
  setDefaultPresetId,
  setOptionStopSchemes,
  setLibraryDir
} from './library'

const APP_DISPLAY_NAME = '教学案制作'
const PROJECT_FILTER = { name: '教学案工程', extensions: [PROJECT_FILE_EXTENSION] }

let mainWindow: BrowserWindow | null = null
/** 启动时或窗口创建前收到的待打开文件 */
let pendingFile: string | null = findProjectArg(process.argv)
let windowDirty = false
/** 未保存的教学案名称（所有标签页） */
let dirtyTitles: string[] = []
let closeConfirmed = false

// ---------- 单实例：再次双击 .tplan 文件时交给已打开的窗口 ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const file = findProjectArg(argv)
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (file !== null) mainWindow.webContents.send(IPC.openFileRequest, file)
    }
  })

  // macOS 通过 open-file 事件传递要打开的文件（可能早于 ready）
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (mainWindow !== null) mainWindow.webContents.send(IPC.openFileRequest, filePath)
    else pendingFile = filePath
  })

  app.whenReady().then(async () => {
    registerIpc()
    // 先读取用户模板（“教学案库\模板”），新建、打开教学案时才找得到自制的预设
    try {
      await loadUserTemplates()
    } catch (err) {
      console.error('读取用户模板失败', err)
    }
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

// ---------- 窗口 ----------

function createWindow(): void {
  windowDirty = false
  closeConfirmed = false

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: APP_DISPLAY_NAME,
    show: false,
    backgroundColor: '#e9ecef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  Menu.setApplicationMenu(
    buildAppMenu((command: MenuCommand) => win.webContents.send(IPC.menuCommand, command), {
      moanImport: () => openMoan(win)
    })
  )

  win.once('ready-to-show', () => win.show())

  // 禁止页面跳转和弹出新窗口；外部链接交给系统浏览器
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('close', (event) => {
    if (!windowDirty || closeConfirmed) return
    event.preventDefault()
    const many = dirtyTitles.length > 1
    const response = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [many ? '全部保存' : '保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: many ? `有 ${dirtyTitles.length} 个教学案未保存，是否保存？` : `是否保存对“${dirtyTitles[0] ?? '当前教学案'}”的修改？`,
      detail: `${many ? dirtyTitles.map((t) => `· ${t}`).join('\n') + '\n\n' : ''}如果不保存，所做的修改将会丢失。`
    })
    if (response === 0) {
      win.webContents.send(IPC.saveBeforeClose)
    } else if (response === 1) {
      closeConfirmed = true
      win.close()
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl !== undefined) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 墨案窗口：导入完成后在主窗口打开 */
function openMoan(win: BrowserWindow): void {
  openMoanWindow(win, {
    openInMain: (filePath) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.openFileRequest, filePath)
    },
    focusMain: () => {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.handle(IPC.getAppInfo, () => ({ version: app.getVersion(), platform: process.platform }))

  ipcMain.on(IPC.openMoanImport, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win !== null) openMoan(win)
  })

  ipcMain.handle(IPC.getTemplateDefaults, async (_event, templateId: string) => {
    try {
      return { ok: true, value: await readTemplateDefaults(templateId) }
    } catch (err) {
      return { ok: false, error: `读取模板“${templateId}”失败：${describeError(err)}` }
    }
  })

  ipcMain.handle(IPC.getStartupFile, () => {
    const file = pendingFile
    pendingFile = null
    return file
  })

  ipcMain.handle(IPC.openProject, async (event): Promise<Result<OpenedProject | null>> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '打开教学案',
      filters: [PROJECT_FILTER],
      properties: ['openFile' as const]
    }
    const picked = win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const filePath = picked.filePaths[0]
    if (picked.canceled || filePath === undefined) return { ok: true, value: null }
    return openAt(filePath)
  })

  ipcMain.handle(IPC.openProjectAt, (_event, filePath: string) => openAt(filePath))

  ipcMain.handle(IPC.listProjects, async () => {
    try {
      return { ok: true, value: await listProjects() }
    } catch (err) {
      return { ok: false, error: `读取教学案列表失败：${describeError(err)}` }
    }
  })

  ipcMain.handle(IPC.chooseLibraryDir, async (event) => {
    const dir = await pickFolder(event.sender, '选择教学案库文件夹', await getLibraryDir())
    if (dir === null) return { ok: true, value: null }
    try {
      await setLibraryDir(dir)
      // 用户模板跟着教学案库走
      await loadUserTemplates()
      return { ok: true, value: dir }
    } catch (err) {
      return { ok: false, error: `无法使用该文件夹：${describeError(err)}` }
    }
  })

  ipcMain.handle(IPC.chooseFolder, (event, defaultPath: string) =>
    pickFolder(event.sender, '选择保存位置', defaultPath)
  )

  ipcMain.handle(
    IPC.createProject,
    async (_event, req: { title: string; dir: string | null; templateId: string; presetId: string }) => {
      try {
        return { ok: true, value: await createProject(req.title, req.dir, req.templateId, undefined, req.presetId) }
      } catch (err) {
        return { ok: false, error: `新建教学案失败：${describeError(err)}` }
      }
    }
  )

  ipcMain.handle(IPC.getDefaultPreset, () => getDefaultPresetId())
  ipcMain.handle(IPC.setDefaultPreset, (_event, presetId: string) => setDefaultPresetId(presetId))
  ipcMain.handle(IPC.getOptionStopSchemes, () => getOptionStopSchemes())
  ipcMain.handle(IPC.setOptionStopSchemes, (_event, schemes: unknown) => setOptionStopSchemes(schemes))

  ipcMain.handle(IPC.removeRecent, (_event, filePath: string) => removeRecent(filePath))

  ipcMain.on(IPC.revealInFolder, (_event, filePath: string) => shell.showItemInFolder(filePath))

  ipcMain.handle(IPC.importDocx, async (event, presetId: string) => {
    const paths = await pickDocx(event.sender, true)
    if (paths.length === 0) return { ok: true, value: null }
    try {
      return { ok: true, value: await importDocxFiles(paths, presetId) }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })

  ipcMain.handle(IPC.defaultExportDir, async (_event, projectPath: string | null) =>
    projectPath === null ? getLibraryDir() : dirname(projectPath)
  )

  ipcMain.handle(IPC.exportCheck, (_event, dir: string, baseName: string, variants: Variant[], points?: boolean) =>
    existingExportFiles(dir, baseName, variants, points === true)
  )
  ipcMain.handle(IPC.getExportPointsDefault, () => getExportPointsDefault())
  ipcMain.handle(IPC.setExportPointsDefault, (_event, on: boolean) => setExportPointsDefault(on === true))

  ipcMain.handle(IPC.exportWord, async (_event, req: ExportRequest) => {
    try {
      return { ok: true, value: await exportWord(req) }
    } catch (err) {
      return { ok: false, error: `导出失败：${describeError(err)}` }
    }
  })

  // ---- 模板 ----
  ipcMain.handle(IPC.listTemplates, () => currentCatalog())
  ipcMain.handle(IPC.reloadTemplates, () => loadUserTemplates())
  ipcMain.handle(IPC.importTemplate, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: '导入模板', filters: [{ name: '模板压缩包', extensions: ['zip'] }], properties: ['openFile' as const] }
    const picked = win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const zipPath = picked.filePaths[0]
    if (picked.canceled || zipPath === undefined) return { ok: true, value: null }
    try {
      await importTemplate(zipPath)
      return { ok: true, value: await loadUserTemplates() }
    } catch (err) {
      return { ok: false, error: `导入模板失败：${describeError(err)}` }
    }
  })
  ipcMain.handle(IPC.exportTemplate, async (event, presetId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const name = currentCatalog().user.find((u) => u.id === presetId)?.name ?? currentCatalog().builtin.find((b) => b.id === presetId)?.name ?? presetId
    const options = {
      title: '导出模板',
      defaultPath: join(app.getPath('desktop'), `模板-${name.replace(/[\\/:*?"<>|]/g, '_')}.zip`),
      filters: [{ name: '模板压缩包', extensions: ['zip'] }]
    }
    const picked = win !== null ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || picked.filePath === undefined) return { ok: true, value: null }
    try {
      await exportTemplate(presetId, picked.filePath)
      return { ok: true, value: picked.filePath }
    } catch (err) {
      return { ok: false, error: `导出模板失败：${describeError(err)}` }
    }
  })
  ipcMain.handle(IPC.duplicateTemplate, async (_event, presetId: string) => {
    try {
      await duplicateTemplate(presetId)
      return { ok: true, value: await loadUserTemplates() }
    } catch (err) {
      return { ok: false, error: `复制模板失败：${describeError(err)}` }
    }
  })
  ipcMain.handle(IPC.deleteTemplate, async (_event, presetId: string) => {
    try {
      await deleteTemplateFolder(userTemplateDir(presetId))
      return { ok: true, value: await loadUserTemplates() }
    } catch (err) {
      return { ok: false, error: `删除模板失败：${describeError(err)}` }
    }
  })

  ipcMain.handle(IPC.openPath, async (_event, path: string) => {
    const error = await shell.openPath(path)
    return error === '' ? null : error
  })

  ipcMain.handle(IPC.createFromDocx, async (event, templateId: string, presetId: string) => {
    const paths = await pickDocx(event.sender, false)
    if (paths.length === 0) return { ok: true, value: null }
    try {
      const imported = await importDocxFiles(paths, presetId)
      const title = imported.firstTitle ?? basename(paths[0]!).replace(/\.docx$/i, '')
      const opened = await createProject(title, null, templateId, imported, presetId)
      return { ok: true, value: { opened, report: imported.report } }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })

  // 以首页中选中的 Word 文档新建（不弹出选择文件的对话框）
  ipcMain.handle(IPC.createFromDocxAt, async (_event, filePath: string, templateId: string, presetId: string) => {
    try {
      const imported = await importDocxFiles([filePath], presetId)
      const title = imported.firstTitle ?? basename(filePath).replace(/\.docx$/i, '')
      const opened = await createProject(title, null, templateId, imported, presetId)
      return { ok: true, value: { opened, report: imported.report } }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })

  // ---------- 首页：本地文件 ----------
  ipcMain.handle(IPC.getLocalPlaces, async (): Promise<LocalPlace[]> => {
    const places: LocalPlace[] = []
    for (const [label, name, kind] of [
      ['桌面', 'desktop', 'desktop'],
      ['文档', 'documents', 'documents'],
      ['下载', 'downloads', 'downloads']
    ] as const) {
      try {
        places.push({ label, path: app.getPath(name), kind })
      } catch {
        // 该位置不存在时跳过
      }
    }
    for (const d of await listDrives()) {
      places.push({ label: process.platform === 'win32' ? `本地磁盘 (${d.slice(0, 2)})` : '本机', path: d, kind: 'drive' })
    }
    return places
  })
  ipcMain.handle(IPC.listFolder, async (_event, dir: string): Promise<Result<FolderListing>> => {
    try {
      return { ok: true, value: await listFolder(dir) }
    } catch (err) {
      return { ok: false, error: `无法打开文件夹：${describeError(err)}` }
    }
  })
  ipcMain.handle(IPC.listSubfolders, (_event, dir: string) => listSubfolders(dir))
  ipcMain.handle(IPC.renameFile, async (_event, filePath: string, newStem: string): Promise<Result<string>> => {
    try {
      const target = await renameEntry(filePath, newStem, app.getVersion())
      await renameRecent(filePath, target)
      return { ok: true, value: target }
    } catch (err) {
      return { ok: false, error: `重命名失败：${describeError(err)}` }
    }
  })
  ipcMain.handle(IPC.trashFile, async (_event, filePath: string): Promise<Result<null>> => {
    try {
      await shell.trashItem(filePath)
      await removeRecent(filePath)
      return { ok: true, value: null }
    } catch (err) {
      return { ok: false, error: `删除失败：${describeError(err)}` }
    }
  })
  ipcMain.handle(IPC.readProject, async (_event, filePath: string): Promise<Result<ProjectBundle>> => {
    try {
      return { ok: true, value: await readProjectFile(filePath) }
    } catch (err) {
      return { ok: false, error: `无法读取教学案：${describeError(err)}` }
    }
  })

  ipcMain.handle(IPC.saveProject, async (event, req: SaveRequest): Promise<Result<string | null>> => {
    let target = req.filePath
    if (target === null || req.saveAs) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: '保存教学案',
        defaultPath:
          req.filePath ??
          join(await getLibraryDir(), `${sanitizeFileName(req.suggestedName)}.${PROJECT_FILE_EXTENSION}`),
        filters: [PROJECT_FILTER]
      }
      const picked = win !== null ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (picked.canceled || picked.filePath === undefined || picked.filePath === '') {
        return { ok: true, value: null }
      }
      target = ensureProjectExtension(picked.filePath)
    }
    try {
      await writeProjectFile(target, req.bundle, app.getVersion())
      await addRecent(target)
      return { ok: true, value: target }
    } catch (err) {
      return { ok: false, error: `保存失败：${describeError(err)}` }
    }
  })

  ipcMain.on(IPC.setWindowState, (event, state: { title: string; dirty: boolean; dirtyTitles: string[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win === null) return
    // 窗口关闭时要检查所有标签页；标题栏只显示当前标签页的“未保存”标记
    dirtyTitles = state.dirtyTitles
    windowDirty = dirtyTitles.length > 0
    win.setTitle(`${state.dirty ? '● ' : ''}${state.title} - ${APP_DISPLAY_NAME}`)
    if (process.platform === 'darwin') win.setDocumentEdited(state.dirty)
  })

  // 关闭某个有未保存修改的标签页时询问
  ipcMain.handle(IPC.askSaveChanges, async (event, title: string): Promise<'save' | 'discard' | 'cancel'> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'question' as const,
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: `是否保存对“${title}”的修改？`,
      detail: '如果不保存，所做的修改将会丢失。'
    }
    const { response } = win !== null ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
  })

  ipcMain.on(IPC.confirmClose, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    closeConfirmed = true
    win?.close()
  })
}

async function openAt(filePath: string): Promise<Result<OpenedProject>> {
  try {
    const bundle = await readProjectFile(filePath)
    await addRecent(filePath)
    return { ok: true, value: { filePath, bundle } }
  } catch (err) {
    return { ok: false, error: `无法打开“${basename(filePath)}”：${describeError(err)}` }
  }
}

function describeError(err: unknown): string {
  if (err instanceof ProjectFileError || err instanceof DocxReadError || err instanceof DocxExportError) return err.message
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  switch (code) {
    case 'ENOENT':
      return '文件不存在，可能已被移动或删除。'
    case 'EACCES':
    case 'EPERM':
      return '没有访问该文件的权限，或文件正被其他程序占用。'
    case 'ENOSPC':
      return '磁盘空间不足。'
    default:
      return err instanceof Error ? err.message : String(err)
  }
}

function findProjectArg(argv: readonly string[]): string | null {
  // 打包后 argv[0] 是程序本身；开发时还有 electron 和脚本路径，统一按扩展名查找
  return argv.slice(1).find(isProjectFilePath) ?? null
}

async function pickFolder(sender: Electron.WebContents, title: string, defaultPath: string): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(sender)
  const options = { title, defaultPath, properties: ['openDirectory' as const, 'createDirectory' as const] }
  const picked = win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return picked.canceled ? null : (picked.filePaths[0] ?? null)
}

async function pickDocx(sender: Electron.WebContents, multiple: boolean): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(sender)
  const options: Electron.OpenDialogOptions = {
    title: '选择 Word 题目文档',
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile']
  }
  const picked = win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return picked.canceled ? [] : picked.filePaths
}
