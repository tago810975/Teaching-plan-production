/**
 * AI 自动识别与重绘（主进程）：本机服务、任务登记、写入 WorkBuddy / Antigravity（反重力）的 MCP 配置。
 *
 * - 启动时开启本机服务（workbuddy-bridge.ts），连接信息写到用户数据目录的 workbuddy-bridge.json；
 *   MCP 脚本（resources/mcp/teaching-plan-mcp.cjs）复制到用户数据目录的 mcp/（每次启动都更新）。
 * - 连接 MCP 客户端：在 ~/.workbuddy/mcp.json 或 ~/.gemini/config/mcp_config.json 的 mcpServers 中
 *   写入 teaching-plan 一项；其他连接器原样保留，第一次修改非空配置前先留备份。
 * - “从图片导入”窗口点“交给 AI 识别”登记任务（同一时间一个）；收到提交的结果时发给那个窗口。
 */
import { app, BrowserWindow, ipcMain, Notification, webContents, type WebContents } from 'electron'
import { copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { FORMAT_GUIDE, importText, KNOWLEDGE_GUIDE, type TextFigure } from '@core/import/text-import'
import { IPC, type McpClientId, type WorkBuddyStatus, type WorkBuddyTaskInput } from '@shared/ipc'
import { resourcesDir } from './template-io'
import { startBridge, type BridgeCheck, type BridgeTask, type RedrawTask } from './workbuddy-bridge'
import { REDRAW_GUIDE, validateSvg } from '@core/import/svg-redraw'
import {
  connectMcpClient,
  disconnectMcpClient,
  getMcpClientsStatus,
  isMcpClientId,
  SERVER_NAME,
  type McpClientOptions
} from './mcp-clients'

export { SERVER_NAME }

let task: (BridgeTask & { sender: number }) | null = null
let redraw: (RedrawTask & { sender: number }) | null = null
let seq = 0

const userData = (): string => app.getPath('userData')
const infoPath = (): string => join(userData(), 'workbuddy-bridge.json')
const scriptPath = (): string => join(userData(), 'mcp', 'teaching-plan-mcp.cjs')
const clientOpts = (): McpClientOptions => ({ homeDir: homedir(), scriptPath: scriptPath(), infoPath: infoPath() })

export async function workbuddyStatus(): Promise<WorkBuddyStatus> {
  return getMcpClientsStatus(clientOpts())
}

export async function workbuddyConnect(client: McpClientId = 'workbuddy'): Promise<WorkBuddyStatus> {
  await installScript()
  return connectMcpClient(client, clientOpts())
}

export async function workbuddyDisconnect(client: McpClientId = 'workbuddy'): Promise<WorkBuddyStatus> {
  return disconnectMcpClient(client, clientOpts())
}

/** 把 MCP 脚本复制到用户数据目录（路径不随软件安装位置、版本变化） */
async function installScript(): Promise<void> {
  await mkdir(join(userData(), 'mcp'), { recursive: true })
  await copyFile(join(resourcesDir(), 'mcp', 'teaching-plan-mcp.cjs'), scriptPath())
}

function notifyWindowAttention(wc: WebContents, title: string, body: string): void {
  const win = BrowserWindow.fromWebContents(wc)
  if (win === null || win.isDestroyed() || win.isFocused()) return
  win.flashFrame(true)
  win.once('focus', () => {
    if (!win.isDestroyed()) win.flashFrame(false)
  })
  if (Notification.isSupported()) {
    const n = new Notification({ title, body })
    n.on('click', () => {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.focus()
    })
    n.show()
  }
}

export async function startWorkBuddy(): Promise<void> {
  await installScript().catch((e) => console.error('复制 WorkBuddy 连接脚本失败', e))
  await startBridge(
    {
      pending: () => task,
      guide: (t) => (t?.kind === 'knowledge' ? KNOWLEDGE_GUIDE : FORMAT_GUIDE),
      check: (text, t) => {
        const figures = new Map<number, TextFigure>(
          Array.from({ length: t?.figureCount ?? 0 }, (_, i) => [i + 1, { asset: { id: `f${i + 1}`, mime: 'image/png', data: new Uint8Array() }, widthEmu: 1, heightEmu: 1 }])
        )
        const r = importText(text, { ...(t?.presetId !== undefined ? { presetId: t.presetId } : {}), ...(t?.kind === 'knowledge' ? { asKnowledge: true } : {}), figures })
        return { questionCount: r.questionCount, ...(r.knowledgeCount !== undefined ? { knowledgeCount: r.knowledgeCount } : {}), issues: r.issues }
      },
      submit: (taskId, text, check?: BridgeCheck) => {
        if (task === null || task.id !== taskId) return false
        const wc = webContents.fromId(task.sender)
        if (wc === undefined || wc.isDestroyed()) return false
        wc.send(IPC.workbuddyResult, { taskId, text })
        const count =
          check?.knowledgeCount !== undefined
            ? `${check.knowledgeCount} 个知识点${check.questionCount > 0 ? `、${check.questionCount} 道题` : ''}`
            : check !== undefined && check.questionCount > 0
              ? `${check.questionCount} 道题`
              : '识别结果'
        const issueNote = check !== undefined && check.issues.length > 0 ? `（有 ${check.issues.length} 处需要留意）` : ''
        notifyWindowAttention(wc, '教学案制作 · 已收到 AI 识别结果', `已收到 ${count}${issueNote}，点击回到软件查看并导入。`)
        return true
      },
      redrawPending: () => redraw,
      redrawGuide: () => REDRAW_GUIDE,
      redrawSubmit: (taskId, figure, svg) => {
        const remaining = (): number[] => (redraw === null ? [] : redraw.figures.map((f) => f.n).filter((n) => !redraw!.received.includes(n)))
        if (redraw === null || redraw.id !== taskId) return { ok: false, issues: ['任务已结束'], remaining: [] }
        if (!redraw.figures.some((f) => f.n === figure)) return { ok: false, issues: [`没有图${figure}，请用 get_figures_to_redraw 中的图号`], remaining: remaining() }
        const check = validateSvg(svg)
        if (!check.ok || check.svg === undefined) return { ok: false, issues: check.issues, remaining: remaining() }
        const wc = webContents.fromId(redraw.sender)
        if (wc === undefined || wc.isDestroyed()) return { ok: false, issues: ['教学案制作的窗口已关闭'], remaining: [] }
        wc.send(IPC.workbuddyRedrawResult, { taskId, figure, svg: check.svg })
        if (!redraw.received.includes(figure)) redraw.received.push(figure)
        const left = remaining()
        if (left.length === 0) {
          notifyWindowAttention(wc, '教学案制作 · 已收到 AI 重绘插图', `已收齐 ${redraw.figures.length} 张重绘 SVG，点击回到软件对照选用。`)
        }
        return { ok: true, issues: check.issues, remaining: left }
      }
    },
    infoPath()
  )
}

export function registerWorkBuddyIpc(): void {
  ipcMain.handle(IPC.workbuddyStatus, () => workbuddyStatus())
  ipcMain.handle(IPC.workbuddyConnect, async (_event, client?: unknown) => {
    try {
      return { ok: true, value: await workbuddyConnect(isMcpClientId(client) ? client : 'workbuddy') }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(IPC.workbuddyDisconnect, (_event, client?: unknown) =>
    workbuddyDisconnect(isMcpClientId(client) ? client : 'workbuddy')
  )
  ipcMain.handle(IPC.workbuddyStart, (event, input: WorkBuddyTaskInput) => {
    task = {
      id: `task-${Date.now()}-${++seq}`,
      images: input.images,
      figureCount: input.figureCount,
      ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      sender: event.sender.id
    }
    return task.id
  })
  ipcMain.handle(IPC.workbuddyUpdate, (_event, taskId: string, figureCount: number) => {
    if (task !== null && task.id === taskId) task = { ...task, figureCount }
  })
  ipcMain.handle(IPC.workbuddyCancel, (_event, taskId: string) => {
    if (task !== null && task.id === taskId) task = null
  })
  ipcMain.handle(IPC.workbuddyRedrawStart, (event, figures: RedrawTask['figures']) => {
    redraw = { id: `redraw-${Date.now()}-${++seq}`, figures, received: [], sender: event.sender.id }
    return redraw.id
  })
  ipcMain.handle(IPC.workbuddyRedrawCancel, (_event, taskId: string) => {
    if (redraw !== null && redraw.id === taskId) redraw = null
  })
}
