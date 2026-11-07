/**
 * 主进程入口。
 *
 * 职责：创建窗口、处理菜单与文件关联、执行磁盘读写。
 * 内容编辑与排版全部在渲染进程完成，主进程不持有工程数据。
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { basename, join } from 'node:path'
import { ProjectFileError } from '@core/project-file/codec'
import { DocxReadError } from '@core/import/docx-reader'
import { PROJECT_FILE_EXTENSION } from '@core/project-file/format'
import { IPC, type MenuCommand, type OpenedProject, type Result, type SaveRequest } from '@shared/ipc'
import { buildAppMenu } from './menu'
import { readTemplateDefaults } from './template-io'
import { importDocxFiles } from './import-io'
import {
  ensureProjectExtension,
  isProjectFilePath,
  readProjectFile,
  sanitizeFileName,
  writeProjectFile
} from './project-io'
import { addRecent, createProject, getLibraryDir, listProjects, removeRecent, setLibraryDir } from './library'

const APP_DISPLAY_NAME = '教学案制作'
const PROJECT_FILTER = { name: '教学案工程', extensions: [PROJECT_FILE_EXTENSION] }

let mainWindow: BrowserWindow | null = null
/** 启动时或窗口创建前收到的待打开文件 */
let pendingFile: string | null = findProjectArg(process.argv)
let windowDirty = false
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

  app.whenReady().then(() => {
    registerIpc()
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
    buildAppMenu((command: MenuCommand) => win.webContents.send(IPC.menuCommand, command))
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
    const response = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: '是否保存对当前教学案的修改？',
      detail: '如果不保存，所做的修改将会丢失。'
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

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.handle(IPC.getAppInfo, () => ({ version: app.getVersion(), platform: process.platform }))

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
    async (_event, req: { title: string; dir: string | null; templateId: string }) => {
      try {
        return { ok: true, value: await createProject(req.title, req.dir, req.templateId) }
      } catch (err) {
        return { ok: false, error: `新建教学案失败：${describeError(err)}` }
      }
    }
  )

  ipcMain.handle(IPC.removeRecent, (_event, filePath: string) => removeRecent(filePath))

  ipcMain.on(IPC.revealInFolder, (_event, filePath: string) => shell.showItemInFolder(filePath))

  ipcMain.handle(IPC.importDocx, async (event) => {
    const paths = await pickDocx(event.sender, true)
    if (paths.length === 0) return { ok: true, value: null }
    try {
      return { ok: true, value: await importDocxFiles(paths) }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })

  ipcMain.handle(IPC.createFromDocx, async (event, templateId: string) => {
    const paths = await pickDocx(event.sender, false)
    if (paths.length === 0) return { ok: true, value: null }
    try {
      const imported = await importDocxFiles(paths)
      const title = imported.firstTitle ?? basename(paths[0]!).replace(/\.docx$/i, '')
      const opened = await createProject(title, null, templateId, imported)
      return { ok: true, value: { opened, report: imported.report } }
    } catch (err) {
      return { ok: false, error: describeError(err) }
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

  ipcMain.on(IPC.setWindowState, (event, state: { title: string; dirty: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win === null) return
    windowDirty = state.dirty
    win.setTitle(`${state.dirty ? '● ' : ''}${state.title} - ${APP_DISPLAY_NAME}`)
    if (process.platform === 'darwin') win.setDocumentEdited(state.dirty)
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
  if (err instanceof ProjectFileError || err instanceof DocxReadError) return err.message
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
