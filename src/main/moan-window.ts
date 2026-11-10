/**
 * 墨案窗口（从墨案导入）。
 *
 * 在软件里打开墨案网页（会话分区 persist:moan，登录保留，不与软件界面共用 Cookie）。老师照常登录、找到教案：
 * - 打开一份教案时，询问是否导入；也可用窗口菜单“导入 → 导入当前教案”；
 * - 进入某个文件夹看到教案列表后，可用“导入 → 导入当前文件夹的全部教案”。
 * 导入由 moan-import.ts 完成，生成的教学案保存在“教学案库\墨案导入”，单份导入后在主窗口打开。
 *
 * 预加载脚本 preload/moan.ts 记录网页的接口往来：其中 socket.io 帧用来得到服务器地址、登录令牌与当前文件夹
 * （core/import/moan/session.ts，只在内存中）；同时交给记录器，遇到问题时可从菜单保存“诊断文件”发给开发者
 * （凭证已隐去，见 capture-log.ts）。不保存就不写任何文件。
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CaptureRecorder, MOAN_START_URL, captureFileName, type PageRequest } from '@core/import/moan/capture-log'
import { createMoanSession, isMoanSessionReady, observeMoanFrame, teachingPlanIdFromUrl, type MoanSession } from '@core/import/moan/session'
import { MOAN_CAPTURE_CHANNEL } from '@shared/ipc'
import { getLibraryDir } from './library'
import { fetchMoanFolderPlans, importMoanPlan, MOAN_IMPORT_DIR, type MoanImportResult } from './moan-import'

export const MOAN_PARTITION = 'persist:moan'

interface WindowState {
  win: BrowserWindow
  recorder: CaptureRecorder
  session: MoanSession
  busy: boolean
  setStatus: (text: string) => void
}

let current: WindowState | null = null
const states = new Map<number, WindowState>()
let ipcRegistered = false

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on(MOAN_CAPTURE_CHANNEL, (event, payload: unknown) => {
    const st = states.get(event.sender.id)
    if (st === undefined || payload === null || typeof payload !== 'object') return
    const p = payload as { request?: PageRequest; note?: string }
    if (p.request !== undefined) {
      const r = p.request
      // 原始帧（含令牌）只用于更新内存中的会话信息；交给记录器的会被隐去凭证
      if (r.kind === 'ws') {
        if (r.method === 'WS-SEND' && typeof r.requestBody === 'string') observeMoanFrame(st.session, 'send', String(r.url), r.requestBody)
        if (r.method === 'WS-RECV' && typeof r.responseBody === 'string') observeMoanFrame(st.session, 'receive', String(r.url), r.responseBody)
      }
      st.recorder.addPageRequest(r)
    } else if (typeof p.note === 'string') {
      st.recorder.note(p.note)
    }
  })
}

/** 开发与测试时可用 MOAN_START_URL 环境变量改成本机的模拟页面 */
function startUrl(): string {
  const override = process.env['MOAN_START_URL']
  return !app.isPackaged && override !== undefined && override !== '' ? override : MOAN_START_URL
}

export interface MoanWindowHooks {
  /** 单份教案导入完成：在主窗口打开 */
  openInMain: (filePath: string) => void
  focusMain: () => void
}

export function openMoanWindow(parent: BrowserWindow | null, hooks: MoanWindowHooks): void {
  if (current !== null && !current.win.isDestroyed()) {
    current.win.focus()
    return
  }
  registerIpc()
  const url = startUrl()
  const baseTitle = '墨案 — 从墨案导入'
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    title: baseTitle,
    ...(parent !== null ? { parent } : {}),
    webPreferences: {
      partition: MOAN_PARTITION,
      preload: join(__dirname, '../preload/moan.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  const wc = win.webContents

  let status = ''
  const updateTitle = (): void => {
    if (win.isDestroyed()) return
    win.setTitle(status !== '' ? `${baseTitle} — ${status}` : `${baseTitle}（登录后打开要迁移的教案，或进入教案所在的文件夹）`)
  }
  const st: WindowState = {
    win,
    recorder: new CaptureRecorder(url),
    session: createMoanSession(),
    busy: false,
    setStatus: (text) => {
      status = text
      updateTitle()
    }
  }
  current = st
  states.set(wc.id, st)

  win.setMenu(
    Menu.buildFromTemplate([
      {
        label: '导入',
        submenu: [
          { label: '导入当前教案', accelerator: 'CmdOrCtrl+I', click: () => void importCurrent(st, hooks) },
          { label: '导入当前文件夹的全部教案…', accelerator: 'CmdOrCtrl+Shift+I', click: () => void importFolder(st) },
          { type: 'separator' },
          { label: '打开“墨案导入”文件夹', click: () => void openImportDir() },
          { type: 'separator' },
          { label: '保存诊断文件（导入出问题时发给开发者）', click: () => void saveDiagnostics(st) },
          { type: 'separator' },
          { label: '关闭', accelerator: 'CmdOrCtrl+W', click: () => win.close() }
        ]
      },
      {
        label: '页面',
        submenu: [
          { label: '后退', accelerator: 'Alt+Left', click: () => wc.navigationHistory.goBack() },
          { label: '刷新', accelerator: 'F5', role: 'reload' }
        ]
      }
    ])
  )
  // 网页自己的标题不覆盖导入提示
  win.on('page-title-updated', (event) => event.preventDefault())

  // 墨案内部的新窗口在同一窗口打开；其他网站交给系统浏览器
  wc.setWindowOpenHandler(({ url: target }) => {
    if (sameSite(target, url)) void wc.loadURL(target)
    else if (target.startsWith('https://') || target.startsWith('http://')) void shell.openExternal(target)
    return { action: 'deny' }
  })

  // 打开教案时询问是否导入（每份教案只问一次）
  const asked = new Set<number>()
  const onPage = (u: string): void => {
    if (u.startsWith('about:')) return
    st.recorder.pageVisited(u)
    const id = teachingPlanIdFromUrl(u)
    if (id === null || asked.has(id) || st.busy) return
    asked.add(id)
    // 等网页连上服务器（拿到令牌）再问
    setTimeout(() => {
      if (win.isDestroyed() || st.busy || teachingPlanIdFromUrl(wc.getURL()) !== id) return
      void dialog
        .showMessageBox(win, {
          type: 'question',
          buttons: ['导入', '稍后'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          message: '导入这份教案吗？',
          detail: `软件会读取整份教案（题目、答案、解析、图片），在“教学案库\\${MOAN_IMPORT_DIR}”里生成教学案并打开，通常十几秒。\n\n以后也可以从窗口顶部菜单“导入 → 导入当前教案”（Ctrl+I）开始。`
        })
        .then(({ response }) => {
          if (response === 0) void importCurrent(st, hooks)
        })
    }, 2000)
  }
  wc.on('did-navigate', (_e, u) => onPage(u))
  wc.on('did-navigate-in-page', (_e, u) => onPage(u))

  win.on('close', (event) => {
    if (!st.busy) return
    event.preventDefault()
    void dialog.showMessageBox(win, { type: 'info', message: '正在导入，请等它完成后再关闭窗口。', buttons: ['好'] })
  })
  win.on('closed', () => {
    states.delete(wc.id)
    if (current === st) current = null
  })

  // 开发时供自动测试调用（窗口菜单无法从外部点击）；打包后不存在
  if (!app.isPackaged) {
    const g = globalThis as Record<string, unknown>
    g['__moanImportCurrent'] = () => importCurrent(st, hooks)
    g['__moanImportFolder'] = () => importFolder(st)
    g['__moanSaveDiagnostics'] = () => saveDiagnostics(st)
  }

  updateTitle()
  void wc.loadURL(url)
}

function sameSite(target: string, base: string): boolean {
  try {
    return new URL(target).host === new URL(base).host
  } catch {
    return false
  }
}

/** 网页刚打开时还没连上服务器：最多等几秒 */
async function waitForSession(st: WindowState): Promise<boolean> {
  for (let i = 0; i < 30 && !isMoanSessionReady(st.session); i++) await new Promise((r) => setTimeout(r, 200))
  return isMoanSessionReady(st.session)
}

async function notReady(st: WindowState): Promise<void> {
  await dialog.showMessageBox(st.win, {
    type: 'info',
    buttons: ['好'],
    message: '还没有连上墨案',
    detail: '请先在窗口中登录墨案，等页面加载完成后再导入。如果已经登录，可以按 F5 刷新页面后重试。'
  })
}

async function importCurrent(st: WindowState, hooks: MoanWindowHooks): Promise<void> {
  if (st.busy || st.win.isDestroyed()) return
  const planId = teachingPlanIdFromUrl(st.win.webContents.getURL())
  if (planId === null) {
    await dialog.showMessageBox(st.win, {
      type: 'info',
      buttons: ['好'],
      message: '请先打开一份教案',
      detail: '在墨案的教案列表里点开要迁移的教案（进入教案编辑页面），再点“导入 → 导入当前教案”。\n要一次导入整个文件夹，请用“导入 → 导入当前文件夹的全部教案”。'
    })
    return
  }
  if (!(await waitForSession(st))) return notReady(st)
  st.busy = true
  let result: MoanImportResult
  try {
    result = await importMoanPlan(st.win.webContents, st.session, planId, { onStatus: st.setStatus })
  } catch (err) {
    st.busy = false
    st.setStatus('')
    await dialog.showMessageBox(st.win, {
      type: 'error',
      buttons: ['好'],
      message: '导入失败',
      detail: `${err instanceof Error ? err.message : String(err)}\n\n如果一直失败，可以点“导入 → 保存诊断文件”发给开发者。`
    })
    return
  }
  st.busy = false
  st.setStatus('')
  hooks.openInMain(result.filePath)
  const { response } = await dialog.showMessageBox(st.win, {
    type: result.warnings.length > 0 ? 'warning' : 'info',
    buttons: ['查看', '继续导入其他教案'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: `已导入“${result.title}”（${result.questionCount} 道题），已在主窗口打开`,
    detail: `${result.filePath}${warningText(result.warnings)}`
  })
  if (response === 0) hooks.focusMain()
}

async function importFolder(st: WindowState): Promise<void> {
  if (st.busy || st.win.isDestroyed()) return
  if (!(await waitForSession(st))) return notReady(st)
  const folderId = st.session.folderId
  if (folderId === undefined) {
    await dialog.showMessageBox(st.win, {
      type: 'info',
      buttons: ['好'],
      message: '请先进入教案所在的文件夹',
      detail: '在墨案的教案页面左侧点开文件夹，让右边列出其中的教案，再点“导入 → 导入当前文件夹的全部教案”。'
    })
    return
  }
  const wc = st.win.webContents
  const folderName = st.session.folderNames.get(folderId) ?? `文件夹 ${folderId}`
  st.busy = true
  try {
    st.setStatus('正在读取文件夹中的教案…')
    const plans = await fetchMoanFolderPlans(wc, st.session, folderId)
    st.setStatus('')
    st.busy = false
    if (plans.length === 0) {
      await dialog.showMessageBox(st.win, { type: 'info', buttons: ['好'], message: `“${folderName}”中没有教案` })
      return
    }
    const { response } = await dialog.showMessageBox(st.win, {
      type: 'question',
      buttons: [`导入 ${plans.length} 份教案`, '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `导入“${folderName}”中的全部 ${plans.length} 份教案吗？`,
      detail: `${plans.slice(0, 12).map((p) => `· ${p.name}`).join('\n')}${plans.length > 12 ? `\n……共 ${plans.length} 份` : ''}\n\n将保存到“教学案库\\${MOAN_IMPORT_DIR}\\${folderName}”。期间请不要关闭窗口。`
    })
    if (response !== 0) return
    st.busy = true
    const done: MoanImportResult[] = []
    const failed: string[] = []
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i]!
      try {
        done.push(
          await importMoanPlan(wc, st.session, plan.id, {
            subDir: folderName,
            onStatus: (text) => st.setStatus(`导入 ${i + 1}/${plans.length}“${plan.name}”：${text}`)
          })
        )
      } catch (err) {
        failed.push(`${plan.name}：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    st.busy = false
    st.setStatus('')
    const warnings = done.flatMap((r) => r.warnings.map((w) => `${r.title}：${w}`))
    const questions = done.reduce((n, r) => n + r.questionCount, 0)
    const dir = done[0] !== undefined ? dirname(done[0].filePath) : undefined
    const result = await dialog.showMessageBox(st.win, {
      type: failed.length > 0 || warnings.length > 0 ? 'warning' : 'info',
      buttons: dir !== undefined ? ['打开文件夹', '好'] : ['好'],
      defaultId: 0,
      noLink: true,
      message: `已导入 ${done.length} 份教案（共 ${questions} 道题）${failed.length > 0 ? `，${failed.length} 份失败` : ''}`,
      detail: `${dir ?? ''}${failed.length > 0 ? `\n\n失败：\n${failed.slice(0, 10).join('\n')}` : ''}${warningText(warnings)}`
    })
    if (dir !== undefined && result.response === 0) void shell.openPath(dir)
  } catch (err) {
    st.busy = false
    st.setStatus('')
    await dialog.showMessageBox(st.win, { type: 'error', buttons: ['好'], message: '导入失败', detail: err instanceof Error ? err.message : String(err) })
  }
}

function warningText(warnings: string[]): string {
  if (warnings.length === 0) return ''
  return `\n\n提示（${warnings.length} 条）：\n${warnings.slice(0, 8).join('\n')}${warnings.length > 8 ? '\n……' : ''}`
}

async function openImportDir(): Promise<void> {
  const dir = join(await getLibraryDir(), MOAN_IMPORT_DIR)
  await mkdir(dir, { recursive: true })
  void shell.openPath(dir)
}

/** 诊断文件：接口往来（凭证已隐去）与当前页面快照，导入出问题时发给开发者 */
async function saveDiagnostics(st: WindowState): Promise<void> {
  const wc = st.win.webContents
  let finalPage: { url: string; html: string } | undefined
  try {
    finalPage = { url: wc.getURL(), html: (await wc.executeJavaScript('document.documentElement.outerHTML', true)) as string }
  } catch {
    // 页面不可用时只保存接口记录
  }
  const data = st.recorder.finish(`${app.getName()} ${app.getVersion()}`, finalPage)
  try {
    const dir = join(await getLibraryDir(), '墨案采集')
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, captureFileName(new Date()))
    await writeFile(filePath, JSON.stringify(data, null, 1), 'utf8')
    const { response } = await dialog.showMessageBox(st.win, {
      type: 'info',
      buttons: ['在文件夹中显示', '好'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `已保存诊断文件（${data.entries.length} 条记录）`,
      detail: `${filePath}\n\n登录凭证、账号与手机号已从文件中隐去。`
    })
    if (response === 0) shell.showItemInFolder(filePath)
  } catch (err) {
    dialog.showErrorBox('保存诊断文件失败', String(err))
  }
}
