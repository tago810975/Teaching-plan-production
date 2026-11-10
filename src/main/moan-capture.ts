/**
 * 墨案（老教学案系统）数据采集窗口。
 *
 * 在软件里打开墨案网页，老师照常登录、打开教案、点开“详情”；关闭窗口时把这期间网页与服务器的
 * 接口往来（通过 Chrome 开发者协议读取）和页面快照保存成一个 JSON 文件，供编写正式导入器时分析。
 * 登录状态保存在独立的会话分区（persist:moan），下次打开不用重新登录，也不与软件界面共用 Cookie。
 * 记录整理与凭证隐去见 core/import/moan/capture-log.ts。
 */
import { app, BrowserWindow, dialog, shell, type WebContents } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CaptureRecorder, MOAN_START_URL, captureFileName } from '@core/import/moan/capture-log'
import { getLibraryDir } from './library'

export const MOAN_PARTITION = 'persist:moan'

let captureWindow: BrowserWindow | null = null

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
  const url = startUrl()
  const recorder = new CaptureRecorder(url)
  const baseTitle = '墨案 — 数据采集中'

  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    title: baseTitle,
    autoHideMenuBar: true,
    ...(parent !== null ? { parent } : {}),
    webPreferences: {
      partition: MOAN_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  captureWindow = win
  win.setMenu(null)

  const updateTitle = (): void => {
    if (!win.isDestroyed()) win.setTitle(`${baseTitle}（已记录 ${recorder.count} 条，关闭窗口即保存）`)
  }
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
    saving = true
    void finishCapture(win, recorder).finally(() => {
      captureWindow = null
      if (!win.isDestroyed()) win.destroy()
    })
  })

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
  } catch (err) {
    console.error('墨案采集：无法连接开发者协议', err)
    return
  }
  void dbg.sendCommand('Network.enable', { maxTotalBufferSize: 200_000_000, maxResourceBufferSize: 20_000_000 })

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

async function finishCapture(win: BrowserWindow, recorder: CaptureRecorder): Promise<void> {
  const wc = win.webContents
  let finalPage: { url: string; html: string } | undefined
  try {
    // 等正在读取的响应正文落定
    await new Promise((resolve) => setTimeout(resolve, 300))
    const html = (await wc.executeJavaScript('document.documentElement.outerHTML', true)) as string
    finalPage = { url: wc.getURL(), html }
  } catch (err) {
    console.error('墨案采集：读取页面快照失败', err)
  }
  try {
    if (wc.debugger.isAttached()) wc.debugger.detach()
  } catch {
    // 已断开
  }

  if (recorder.count === 0 && finalPage === undefined) return

  const data = recorder.finish(`${app.getName()} ${app.getVersion()}`, finalPage)
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
      message: `已保存墨案采集文件（${data.entries.length} 条记录）`,
      detail: `${filePath}\n\n登录凭证（Cookie、Token、密码）已从文件中隐去，可以放心发送。`
    }
    const { response } = parent !== null ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (response === 0) shell.showItemInFolder(filePath)
  } catch (err) {
    dialog.showErrorBox('保存墨案采集文件失败', String(err))
  }
}
