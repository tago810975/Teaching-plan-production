/**
 * 墨案（老教学案系统）数据采集窗口。
 *
 * 在软件里打开墨案网页，老师照常登录、打开教案、点开“详情”；关闭窗口时把这期间网页与服务器的
 * 接口往来（通过 Chrome 开发者协议读取）和页面快照保存成一个 JSON 文件，供编写正式导入器时分析。
 * 登录状态保存在独立的会话分区（persist:moan），下次打开不用重新登录，也不与软件界面共用 Cookie。
 * 记录整理与凭证隐去见 core/import/moan/capture-log.ts。
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type WebContents } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CaptureRecorder,
  MOAN_START_URL,
  captureFileName,
  type CaptureExtracts,
  type DetailExtract,
  type PageRequest
} from '@core/import/moan/capture-log'
import { MOAN_CAPTURE_CHANNEL } from '@shared/ipc'
import { getLibraryDir } from './library'
import { COLLECT_DETAILS, COLLECT_PREVIEW, DUMP_VUE_STATE, isTeachingPlanEditUrl } from './moan-page-scripts'

export const MOAN_PARTITION = 'persist:moan'

let captureWindow: BrowserWindow | null = null
/** 采集窗口的页面 id → 记录器（预加载脚本的报告按发送者分发） */
const recorders = new Map<number, CaptureRecorder>()
let ipcRegistered = false

function registerCaptureIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on(MOAN_CAPTURE_CHANNEL, (event, payload: unknown) => {
    const recorder = recorders.get(event.sender.id)
    if (recorder === undefined || payload === null || typeof payload !== 'object') return
    const p = payload as { request?: PageRequest; note?: string }
    if (p.request !== undefined) {
      recorder.addPageRequest(p.request)
      refreshTitle.get(event.sender.id)?.()
    } else if (typeof p.note === 'string') {
      recorder.note(p.note)
    }
  })
}
const refreshTitle = new Map<number, () => void>()

interface CaptureSession {
  recorder: CaptureRecorder
  extracts: CaptureExtracts | undefined
  busy: boolean
}

/** 开发与测试时可用 MOAN_START_URL 环境变量改成本机的模拟页面 */
function startUrl(): string {
  const override = process.env['MOAN_START_URL']
  return !app.isPackaged && override !== undefined && override !== '' ? override : MOAN_START_URL
}

export function openMoanCapture(parent: BrowserWindow | null): void {
  if (captureWindow !== null && !captureWindow.isDestroyed()) {
    captureWindow.focus()
    return
  }
  registerCaptureIpc()
  const url = startUrl()
  const recorder = new CaptureRecorder(url)
  const session: CaptureSession = { recorder, extracts: undefined, busy: false }
  const baseTitle = '墨案 — 数据采集中'

  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    title: baseTitle,
    autoHideMenuBar: true,
    ...(parent !== null ? { parent } : {}),
    webPreferences: {
      partition: MOAN_PARTITION,
      preload: join(__dirname, '../preload/moan.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  captureWindow = win
  const wcId = win.webContents.id
  recorders.set(wcId, recorder)

  let status = ''
  const updateTitle = (): void => {
    if (win.isDestroyed()) return
    win.setTitle(status !== '' ? `${baseTitle} — ${status}` : `${baseTitle}（已记录 ${recorder.count} 条；打开教案后点“采集 → 一键采集本教案”）`)
  }
  refreshTitle.set(wcId, updateTitle)
  const setStatus = (text: string): void => {
    status = text
    updateTitle()
  }

  win.setMenu(
    Menu.buildFromTemplate([
      {
        label: '采集',
        submenu: [
          {
            label: '一键采集本教案（自动点开全部详情与预览）',
            accelerator: 'CmdOrCtrl+Shift+A',
            click: () => void runOneClick(win, session, setStatus)
          },
          { type: 'separator' },
          { label: '保存并关闭', accelerator: 'CmdOrCtrl+S', click: () => win.close() }
        ]
      },
      {
        label: '页面',
        submenu: [
          { label: '后退', accelerator: 'Alt+Left', click: () => win.webContents.navigationHistory.goBack() },
          { label: '刷新', accelerator: 'F5', role: 'reload' }
        ]
      }
    ])
  )
  // 网页自己的标题不覆盖采集提示
  win.on('page-title-updated', (event) => event.preventDefault())

  const wc = win.webContents
  // 墨案内部的新窗口（如预览、导出）在同一窗口打开，以便一并记录；其他网站交给系统浏览器
  wc.setWindowOpenHandler(({ url: target }) => {
    if (sameSite(target, url)) void wc.loadURL(target)
    else if (target.startsWith('https://') || target.startsWith('http://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  wc.on('did-navigate', (_e, u) => recorder.pageVisited(u))
  wc.on('did-navigate-in-page', (_e, u) => recorder.pageVisited(u))

  attachNetworkRecorder(wc, recorder, updateTitle)
  updateTitle()

  let saving = false
  win.on('close', (event) => {
    if (saving) return
    event.preventDefault()
    if (session.busy) {
      void dialog.showMessageBox(win, { type: 'info', message: '正在自动采集，请等它完成后再关闭窗口。', buttons: ['好'] })
      return
    }
    saving = true
    setStatus('正在保存…')
    void finishCapture(win, session).finally(() => {
      captureWindow = null
      recorders.delete(wcId)
      refreshTitle.delete(wcId)
      if (!win.isDestroyed()) win.destroy()
    })
  })

  // 开发时供自动测试触发一键采集（窗口菜单无法从外部点击）；打包后不存在
  if (!app.isPackaged) {
    ;(globalThis as Record<string, unknown>)['__moanOneClick'] = () => runOneClick(win, session, setStatus)
  }

  void wc.loadURL(url)
}

function sameSite(target: string, base: string): boolean {
  try {
    return new URL(target).host === new URL(base).host
  } catch {
    return false
  }
}

function attachNetworkRecorder(wc: WebContents, recorder: CaptureRecorder, onChange: () => void): void {
  const dbg = wc.debugger
  try {
    dbg.attach('1.3')
    recorder.note('开发者协议：已连接')
  } catch (err) {
    recorder.note(`开发者协议：连接失败（${String(err)}），只靠页面内记录`)
    return
  }
  dbg.on('detach', (_event, reason: string) => recorder.note(`开发者协议：已断开（${reason}）`))
  dbg
    .sendCommand('Network.enable', { maxTotalBufferSize: 200_000_000, maxResourceBufferSize: 20_000_000 })
    .then(() => recorder.note('开发者协议：Network 已启用'))
    .catch((err: unknown) => recorder.note(`开发者协议：Network 启用失败（${String(err)}）`))

  dbg.on('message', (_event, method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'Network.requestWillBeSent': {
        const before = recorder.count
        recorder.requestWillBeSent(params as Parameters<CaptureRecorder['requestWillBeSent']>[0])
        if (recorder.count !== before) onChange()
        break
      }
      case 'Network.requestWillBeSentExtraInfo':
        recorder.requestExtraInfo(params as Parameters<CaptureRecorder['requestExtraInfo']>[0])
        break
      case 'Network.responseReceived':
        recorder.responseReceived(params as Parameters<CaptureRecorder['responseReceived']>[0])
        break
      case 'Network.loadingFinished': {
        const requestId = params['requestId'] as string
        if (!recorder.wantsBody(requestId)) {
          recorder.fail(requestId, '响应不是文本，未记录正文')
          break
        }
        dbg
          .sendCommand('Network.getResponseBody', { requestId })
          .then((r: { body: string; base64Encoded: boolean }) => recorder.setBody(requestId, r.body, r.base64Encoded))
          .catch((err: unknown) => recorder.fail(requestId, `读取正文失败：${String(err)}`))
        break
      }
      case 'Network.loadingFailed':
        recorder.fail(params['requestId'] as string, `请求失败：${String(params['errorText'] ?? '')}`)
        break
    }
  })
}

/** 在页面里执行脚本并解析返回的 JSON */
async function runInPage<T>(wc: WebContents, script: string): Promise<T> {
  const text = (await wc.executeJavaScript(script, true)) as string
  return JSON.parse(text) as T
}

/** 一键采集：读取页面数据、依次点开每道题的“详情”、打开“预览教案”，完成后保存并关闭窗口 */
async function runOneClick(win: BrowserWindow, session: CaptureSession, setStatus: (text: string) => void): Promise<void> {
  if (session.busy || win.isDestroyed()) return
  const wc = win.webContents
  if (!isTeachingPlanEditUrl(wc.getURL())) {
    await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['好'],
      message: '请先打开一份教案',
      detail: '在教案列表里点开要迁移的教案（进入教案编辑页面），再点“采集 → 一键采集本教案”。'
    })
    return
  }
  session.busy = true
  const log: string[] = []
  const extracts: CaptureExtracts = { log }
  try {
    setStatus('正在依次点开每道题的详情，请勿操作窗口…')
    const details = await runInPage<DetailExtract[]>(wc, COLLECT_DETAILS)
    extracts.details = details
    const failed = details.filter((d) => d.note !== undefined).length
    log.push(`详情：共 ${details.length} 个，${failed} 个有提示`)

    setStatus('正在打开预览教案…')
    const preview = await runInPage<{ html: string | null; note?: string }>(wc, COLLECT_PREVIEW)
    if (preview.html !== null) extracts.preview = preview.html
    if (preview.note !== undefined) log.push(`预览：${preview.note}`)

    setStatus('正在读取页面数据…')
    await new Promise((resolve) => setTimeout(resolve, 800))
    extracts.vueState = await runInPage<unknown>(wc, DUMP_VUE_STATE)
  } catch (err) {
    log.push(`一键采集出错：${String(err)}`)
  } finally {
    session.busy = false
  }
  session.extracts = extracts
  setStatus('采集完成，正在保存…')
  if (!win.isDestroyed()) win.close()
}

async function finishCapture(win: BrowserWindow, session: CaptureSession): Promise<void> {
  const { recorder } = session
  const wc = win.webContents
  let finalPage: { url: string; html: string } | undefined
  const extracts: CaptureExtracts = session.extracts ?? {}
  try {
    // 等正在读取的响应正文落定
    await new Promise((resolve) => setTimeout(resolve, 300))
    const html = (await wc.executeJavaScript('document.documentElement.outerHTML', true)) as string
    finalPage = { url: wc.getURL(), html }
    // 没有做一键采集时也读一次页面数据，开销很小
    if (extracts.vueState === undefined) extracts.vueState = await runInPage<unknown>(wc, DUMP_VUE_STATE)
  } catch (err) {
    recorder.note(`读取页面快照或页面数据失败：${String(err)}`)
  }
  try {
    if (wc.debugger.isAttached()) wc.debugger.detach()
  } catch {
    // 已断开
  }

  if (recorder.count === 0 && finalPage === undefined) return

  const data = recorder.finish(`${app.getName()} ${app.getVersion()}`, finalPage, extracts)
  const detailCount = data.extracts?.details?.length ?? 0
  try {
    const dir = join(await getLibraryDir(), '墨案采集')
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, captureFileName(new Date()))
    await writeFile(filePath, JSON.stringify(data, null, 1), 'utf8')
    const parent = win.getParentWindow()
    const options = {
      type: 'info' as const,
      buttons: ['在文件夹中显示', '好'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `已保存墨案采集文件（${data.entries.length} 条接口记录${detailCount > 0 ? `，${detailCount} 道题的详情` : ''}）`,
      detail: `${filePath}\n\n登录凭证（Cookie、Token、密码）、账号与手机号已从文件中隐去，可以放心发送。`
    }
    const { response } = parent !== null ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (response === 0) shell.showItemInFolder(filePath)
  } catch (err) {
    dialog.showErrorBox('保存墨案采集文件失败', String(err))
  }
}
