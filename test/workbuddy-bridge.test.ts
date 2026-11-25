import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FORMAT_GUIDE, importText } from '@core/import/text-import'
import { startBridge, TOKEN_HEADER, type BridgeTask, type RedrawTask } from '../src/main/workbuddy-bridge'
import { REDRAW_GUIDE, validateSvg } from '@core/import/svg-redraw'

const SCRIPT = 'resources/mcp/teaching-plan-mcp.cjs'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** 像 WorkBuddy 一样运行 MCP 脚本，按顺序发请求、收回应 */
async function mcp(infoPath: string, requests: Array<{ method: string; params?: unknown }>): Promise<Array<Record<string, unknown>>> {
  const p = spawn(process.execPath, [SCRIPT], { env: { ...process.env, TEACHING_PLAN_BRIDGE: infoPath } })
  const out: Array<Record<string, unknown>> = []
  let buf = ''
  const done = new Promise<void>((resolve) => {
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        out.push(JSON.parse(buf.slice(0, i)))
        buf = buf.slice(i + 1)
        if (out.length === requests.length) resolve()
      }
    })
  })
  requests.forEach((r, k) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k + 1, ...r }) + '\n'))
  await done
  p.kill()
  return out.sort((a, b) => (a['id'] as number) - (b['id'] as number))
}
const toolText = (r: Record<string, unknown>): string => ((r['result'] as { content: Array<{ type: string; text?: string }> }).content.find((c) => c.type === 'text')?.text ?? '')
const callTool = (name: string, args: Record<string, unknown> = {}) => ({ method: 'tools/call', params: { name, arguments: args } })

describe('与 WorkBuddy 的连接：MCP 脚本 + 本机服务（模拟 WorkBuddy）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tp-bridge-'))
  const infoPath = join(dir, 'workbuddy-bridge.json')
  let task: BridgeTask | null = null
  const submitted: Array<{ taskId: string; text: string; questionCount?: number }> = []
  let redraw: RedrawTask | null = null
  const svgs: Array<{ figure: number; svg: string }> = []
  let bridge: Awaited<ReturnType<typeof startBridge>>

  beforeAll(async () => {
    bridge = await startBridge(
      {
        pending: () => task,
        guide: () => FORMAT_GUIDE,
        check: (text, t) => {
          const figures = new Map(Array.from({ length: t?.figureCount ?? 0 }, (_, i) => [i + 1, { asset: { id: `f${i}`, mime: 'image/png', data: new Uint8Array() }, widthEmu: 1, heightEmu: 1 }]))
          const r = importText(text, { figures })
          return { questionCount: r.questionCount, issues: r.issues }
        },
        submit: (taskId, text, check) => {
          submitted.push({ taskId, text, ...(check !== undefined ? { questionCount: check.questionCount } : {}) })
          return true
        },
        redrawPending: () => redraw,
        redrawGuide: () => REDRAW_GUIDE,
        redrawSubmit: (_taskId, figure, svg) => {
          const remaining = () => (redraw === null ? [] : redraw.figures.map((f) => f.n).filter((n) => !redraw!.received.includes(n)))
          if (redraw === null || !redraw.figures.some((f) => f.n === figure)) return { ok: false, issues: [`没有图${figure}，请用 get_figures_to_redraw 中的图号`], remaining: remaining() }
          const c = validateSvg(svg)
          if (!c.ok) return { ok: false, issues: c.issues, remaining: remaining() }
          svgs.push({ figure, svg: c.svg! })
          redraw.received.push(figure)
          return { ok: true, issues: c.issues, remaining: remaining() }
        }
      },
      infoPath
    )
  })
  afterAll(async () => {
    await bridge.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('初始化与工具列表', async () => {
    const [init, list] = await mcp(infoPath, [{ method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }, { method: 'tools/list' }])
    expect((init!['result'] as { serverInfo: { name: string } }).serverInfo.name).toBe('teaching-plan')
    expect((list!['result'] as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).toEqual(['get_pending_images', 'check_questions', 'get_figures_to_redraw', 'submit_svg', 'submit_questions'])
  })

  it('没有待识别的图片时，提示老师先在软件中交出图片', async () => {
    task = null
    const [r] = await mcp(infoPath, [callTool('get_pending_images')])
    expect(toolText(r!)).toContain('没有等待识别的图片')
  })

  it('有待识别的图片：返回格式说明、本次任务说明（插图数）与图片', async () => {
    task = { id: 't1', images: [{ name: 'a.png', mime: 'image/png', data: PNG }], figureCount: 2 }
    const [r] = await mcp(infoPath, [callTool('get_pending_images')])
    const content = (r!['result'] as { content: Array<{ type: string; text?: string; data?: string }> }).content
    expect(content[0]!.text).toContain('逐字转写')
    expect(content[0]!.text).toContain('[图1]～[图2]')
    expect(content.filter((c) => c.type === 'image').map((c) => c.data)).toEqual([PNG])
  })

  it('检查：报告题数与问题（无法转换的公式、插图编号对不上）', async () => {
    const [ok, bad] = await mcp(infoPath, [
      callTool('check_questions', { text: '1．如图所示\n[图1]\nA．甲　　B．乙\n2．求 $v_0$\n[图2]' }),
      callTool('check_questions', { text: '1．求 $\\unknowncmd{x}$\n[图3]' })
    ])
    expect(toolText(ok!)).toBe('识别到 2 道题，没有发现问题。')
    expect(toolText(bad!)).toMatch(/无法转换为 Word 公式[\s\S]*\[图3\]/)
  })

  it('提交：结果交给软件；任务不在时提示', async () => {
    const [r] = await mcp(infoPath, [callTool('submit_questions', { text: '1．题目\nA．甲　　B．乙' })])
    expect(toolText(r!)).toContain('已交给教学案制作：识别到 1 道题')
    expect(submitted).toEqual([{ taskId: 't1', text: '1．题目\nA．甲　　B．乙', questionCount: 1 }])
    task = null
    const [again] = await mcp(infoPath, [callTool('submit_questions', { text: 'x' })])
    expect(toolText(again!)).toContain('没有等待识别的图片')
  })

  it('口令不对的请求被拒绝；软件没有运行时提示先打开软件', async () => {
    const status = await new Promise<number>((resolve) => {
      const req = request({ host: '127.0.0.1', port: bridge.info.port, path: '/pending', method: 'POST', headers: { [TOKEN_HEADER]: 'wrong' } }, (res) => resolve(res.statusCode ?? 0))
      req.end('{}')
    })
    expect(status).toBe(403)
    const [r] = await mcp(join(dir, 'missing.json'), [callTool('get_pending_images')])
    expect(toolText(r!)).toContain('没有在运行')
  })

  it('重绘插图：取图（说明、图号、图片）→ 提交 SVG（检查、还差几张）→ 不合格退回原因', async () => {
    redraw = null
    const [none] = await mcp(infoPath, [callTool('get_figures_to_redraw')])
    expect(toolText(none!)).toContain('没有等待重绘的插图')
    redraw = {
      id: 'r1',
      figures: [
        { n: 1, mime: 'image/png', data: PNG, width: 300, height: 200 },
        { n: 2, mime: 'image/png', data: PNG, width: 100, height: 100, fontSize: 42, stroke: 4, thin: 2.5, arrowWidth: 24, arrowHeight: 16 }
      ],
      received: []
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect x="1" y="1" width="9" height="9" stroke="#000"/></svg>'
    const [got, bad, wrongNo, ok1, ok2] = await mcp(infoPath, [
      callTool('get_figures_to_redraw'),
      callTool('submit_svg', { figure: 1, svg: '<svg><rect></svg>' }),
      callTool('submit_svg', { figure: 5, svg }),
      callTool('submit_svg', { figure: 1, svg }),
      callTool('submit_svg', { figure: 2, svg: '```svg\n' + svg + '\n```' })
    ])
    const content = (got!['result'] as { content: Array<{ type: string; text?: string }> }).content
    expect(content[0]!.text).toMatch(/第一要求是忠实还原[\s\S]*共 2 张插图：图1、图2/)
    expect(content.filter((c) => c.type === 'image')).toHaveLength(2)
    expect(content.some((c) => c.text === '图1（原图 300×200 像素，宽高比 1.50）：')).toBe(true)
    expect(content.some((c) => c.text === '图2（原图 100×100 像素，宽高比 1.00；viewBox 宽 600 时字号 42、主线宽 4、细线宽 2.5、箭头 24×16）：')).toBe(true)
    expect(toolText(bad!)).toMatch(/图1 没有收下[\s\S]*不是合法的 XML/)
    expect(toolText(wrongNo!)).toContain('没有图5')
    expect(toolText(ok1!)).toBe('图1 已收到。还差：图2。')
    expect(toolText(ok2!)).toBe('图2 已收到。全部插图都已交齐。')
    expect(svgs.map((x) => x.figure)).toEqual([1, 2])
  })
})
