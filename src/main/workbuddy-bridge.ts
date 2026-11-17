/**
 * 与 WorkBuddy 的连接（本机服务部分，不依赖 Electron，可单独测试）。
 *
 * WorkBuddy 运行 resources/mcp/teaching-plan-mcp.cjs（MCP 服务，stdio），它通过这里的本机 HTTP 服务与正在运行的
 * 教学案制作通信：取待识别的图片与格式说明 → AI 识别 → 检查（AI 据此修正）→ 提交（结果进入“从图片导入”窗口）。
 *
 * 安全：只监听 127.0.0.1；每次启动随机端口与口令，写在用户数据目录的连接信息文件中（MCP 脚本从那里读取）；
 * 每个请求都要带口令。只能读取老师交出的这批图片、只能把文字交回窗口——不能读写工程或其他文件，导入仍需老师确认。
 */
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'

export interface BridgeImage {
  name: string
  mime: string
  /** base64 */
  data: string
}

/** 待识别的一批图片（来自“从图片导入”窗口的“交给 WorkBuddy 识别”） */
export interface BridgeTask {
  id: string
  images: BridgeImage[]
  /** 窗口中框选的插图数（检查 [图N] 是否对得上） */
  figureCount: number
  presetId?: string
  /** 导入知识点（格式说明与检查按知识点） */
  kind?: 'questions' | 'knowledge'
}

/** 待重绘为 SVG 的插图（来自“从图片导入”窗口的“让 WorkBuddy 重绘插图”） */
export interface RedrawTask {
  id: string
  figures: Array<{ n: number; mime: string; data: string; width: number; height: number; fontSize?: number; stroke?: number; thin?: number }>
  /** 已收到的图号 */
  received: number[]
}

export interface RedrawResult {
  ok: boolean
  issues: string[]
  /** 还没交的图号 */
  remaining: number[]
}

export interface BridgeCheck {
  questionCount: number
  /** 导入知识点时：知识点的个数 */
  knowledgeCount?: number
  issues: string[]
}

export interface BridgeHandlers {
  /** 当前待识别的任务；没有时为 null */
  pending: () => BridgeTask | null
  /** 交给 AI 的格式说明（按当前任务是题目还是知识点） */
  guide: (task: BridgeTask | null) => string
  check: (text: string, task: BridgeTask | null) => BridgeCheck
  /** 把识别结果交回窗口；任务已不在（窗口关了、取消了）时返回 false */
  submit: (taskId: string, text: string) => boolean
  /** 重绘插图：当前任务、重绘说明、提交一张（检查后交回窗口） */
  redrawPending?: () => RedrawTask | null
  redrawGuide?: () => string
  redrawSubmit?: (taskId: string, figure: number, svg: string) => RedrawResult
}

export interface BridgeInfo {
  port: number
  token: string
  pid: number
  app: string
}

export const TOKEN_HEADER = 'x-teaching-plan-token'
const MAX_BODY = 2 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('请求太大'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 启动本机服务，并把连接信息写到 infoPath */
export async function startBridge(handlers: BridgeHandlers, infoPath: string): Promise<{ info: BridgeInfo; close: () => Promise<void> }> {
  const token = randomBytes(24).toString('hex')
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    if (req.headers[TOKEN_HEADER] !== token) return send(403, { error: '口令不对' })
    if (req.method !== 'POST') return send(405, { error: '只接受 POST' })
    void readBody(req)
      .then((raw) => {
        const body = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>)
        switch (req.url) {
          case '/pending': {
            const task = handlers.pending()
            return send(200, { task, guide: handlers.guide(task) })
          }
          case '/check': {
            const text = typeof body['text'] === 'string' ? body['text'] : ''
            return send(200, handlers.check(text, handlers.pending()))
          }
          case '/submit': {
            const text = typeof body['text'] === 'string' ? body['text'] : ''
            const task = handlers.pending()
            const taskId = typeof body['taskId'] === 'string' ? body['taskId'] : (task?.id ?? '')
            if (task === null || task.id !== taskId) return send(200, { ok: false, reason: 'no-task' })
            const check = handlers.check(text, task)
            const ok = handlers.submit(taskId, text)
            return send(200, { ok, ...check })
          }
          case '/redraw/pending':
            return send(200, { task: handlers.redrawPending?.() ?? null, guide: handlers.redrawGuide?.() ?? '' })
          case '/redraw/submit': {
            const task = handlers.redrawPending?.() ?? null
            if (task === null || handlers.redrawSubmit === undefined) return send(200, { ok: false, reason: 'no-task' })
            const figure = Number(body['figure'])
            const svg = typeof body['svg'] === 'string' ? body['svg'] : ''
            return send(200, handlers.redrawSubmit(task.id, figure, svg))
          }
          default:
            return send(404, { error: '没有这个接口' })
        }
      })
      .catch((e: unknown) => send(400, { error: e instanceof Error ? e.message : String(e) }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const info: BridgeInfo = { port, token, pid: process.pid, app: '教学案制作' }
  await writeFile(infoPath, JSON.stringify(info, null, 2), { encoding: 'utf8', mode: 0o600 })
  return { info, close: () => new Promise((resolve) => server.close(() => resolve())) }
}
