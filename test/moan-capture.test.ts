import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOAN_CAPTURE_CHANNEL } from '@shared/ipc'
import {
  CaptureRecorder,
  REDACTED,
  captureFileName,
  isTextMime,
  shouldRecord,
  redactBody,
  redactHeaders,
  redactPageHtml,
  redactUrl
} from '@core/import/moan/capture-log'

describe('墨案采集：隐去凭证', () => {
  it('请求头中的 Cookie、Authorization、Token 只保留名称', () => {
    const h = redactHeaders({ Cookie: 'sid=abc', Authorization: 'Bearer xyz', 'X-Access-Token': 't', Accept: 'application/json' })
    expect(h).toEqual({ Cookie: REDACTED, Authorization: REDACTED, 'X-Access-Token': REDACTED, Accept: 'application/json' })
  })

  it('地址里的 token 参数隐去，其他参数保留（含 hash 路由）', () => {
    expect(redactUrl('https://x.com/api/plan?id=3829&token=abc&type=t')).toBe(`https://x.com/api/plan?id=3829&token=${REDACTED}&type=t`)
    expect(redactUrl('https://x.com/#/teach/edit?type=teachingPlan&access_token=q')).toBe(
      `https://x.com/#/teach/edit?type=teachingPlan&access_token=${REDACTED}`
    )
  })

  it('JSON 正文递归隐去凭证字段，内容字段不动', () => {
    const body = JSON.stringify({
      code: 0,
      data: { token: 'eyJabc', user: { name: '王老师', password: '123' }, list: [{ sessionId: 9, content: '$\\frac{1}{2}$' }] }
    })
    const out = JSON.parse(redactBody(body))
    expect(out.data.token).toBe(REDACTED)
    expect(out.data.user).toEqual({ name: '王老师', password: REDACTED })
    expect(out.data.list[0]).toEqual({ sessionId: REDACTED, content: '$\\frac{1}{2}$' })
  })

  it('表单正文隐去密码与验证码', () => {
    expect(redactBody('username=wang&password=123456&captcha=8a8b')).toBe(`username=${REDACTED}&password=${REDACTED}&captcha=${REDACTED}`)
    expect(JSON.parse(redactBody('{"mobile":"13800000000","title":"直线方程"}'))).toEqual({ mobile: REDACTED, title: '直线方程' })
  })

  it('普通文本中的 JWT 长串替换掉', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpM'
    expect(redactBody(`token is ${jwt}`)).toBe(`token is ${REDACTED}`)
  })

  it('页面快照中的密码框值隐去', () => {
    expect(redactPageHtml('<input type="password" value="secret">')).toBe(`<input type="password" value="${REDACTED}">`)
  })
})

describe('墨案采集：记录器', () => {
  const clock = (): Date => new Date('2026-11-10T04:00:00Z')

  it('只记录 XHR / Fetch，按顺序整理请求与响应', () => {
    const r = new CaptureRecorder('https://moan.modijiaoyu.com/', clock)
    r.pageVisited('https://moan.modijiaoyu.com/#/teach/edit_teachingPlan/3829')
    r.requestWillBeSent({ requestId: '1', type: 'Image', request: { url: 'https://cdn/x.png', method: 'GET' } })
    r.requestWillBeSent({
      requestId: '2',
      type: 'XHR',
      request: { url: 'https://moan.modijiaoyu.com/api/plan/3829', method: 'GET', headers: { Authorization: 'Bearer q' } }
    })
    r.requestExtraInfo({ requestId: '2', headers: { Cookie: 'sid=1', Host: 'moan' } })
    r.responseReceived({ requestId: '2', response: { status: 200, mimeType: 'application/json', headers: { 'Set-Cookie': 'a' } } })
    expect(r.wantsBody('2')).toBe(true)
    r.setBody('2', '{"data":{"stem":"已知直线"}}', false)
    expect(r.count).toBe(1)

    const file = r.finish('测试')
    expect(file.entries).toHaveLength(1)
    const e = file.entries[0]!
    expect(e.seq).toBe(1)
    expect(e.status).toBe(200)
    expect(e.requestHeaders).toEqual({ Authorization: REDACTED, Cookie: REDACTED, Host: 'moan' })
    expect(e.responseHeaders).toEqual({ 'Set-Cookie': REDACTED })
    expect(JSON.parse(e.responseBody!)).toEqual({ data: { stem: '已知直线' } })
    expect(e.pageUrl).toBe('https://moan.modijiaoyu.com/#/teach/edit_teachingPlan/3829')
    expect(file.pages).toHaveLength(1)
  })

  it('二进制、失败与未完成的请求留下说明', () => {
    const r = new CaptureRecorder('s', clock)
    for (const id of ['a', 'b', 'c']) r.requestWillBeSent({ requestId: id, type: 'Fetch', request: { url: `u${id}`, method: 'GET' } })
    r.responseReceived({ requestId: 'a', response: { status: 200, mimeType: 'image/png' } })
    expect(r.wantsBody('a')).toBe(false)
    r.fail('a', '响应不是文本，未记录正文')
    r.fail('b', '请求失败：net::ERR_FAILED')
    const file = r.finish('测试')
    expect(file.entries.map((e) => e.note)).toEqual(['响应不是文本，未记录正文', '请求失败：net::ERR_FAILED', '窗口关闭时尚未收到响应'])
  })

  it('同一地址连续访问只记一次', () => {
    const r = new CaptureRecorder('s', clock)
    r.pageVisited('https://a/#/x')
    r.pageVisited('https://a/#/x')
    r.pageVisited('https://a/#/y')
    expect(r.finish('t').pages.map((p) => p.url)).toEqual(['https://a/#/x', 'https://a/#/y'])
  })
})

describe('墨案采集：记录哪些请求', () => {
  it('接口请求都记，静态资源不记', () => {
    expect(shouldRecord('XHR', 'https://a/api/x')).toBe(true)
    expect(shouldRecord('Fetch', 'https://a/api/x')).toBe(true)
    expect(shouldRecord('EventSource', 'https://a/sse')).toBe(true)
    expect(shouldRecord('Other', 'https://a/api/x')).toBe(true)
    expect(shouldRecord('Image', 'https://a/x.png')).toBe(false)
    expect(shouldRecord('Stylesheet', 'https://a/x.css')).toBe(false)
    expect(shouldRecord('Document', 'https://a/')).toBe(false)
  })

  it('脚本只记 JSONP 之类的动态请求', () => {
    expect(shouldRecord('Script', 'https://a/js/chunk-vendors.c8c910de.js')).toBe(false)
    expect(shouldRecord('Script', 'https://a/api/plan?id=1&callback=jsonp_1')).toBe(true)
    expect(shouldRecord('Script', 'https://a/api/plan?id=1')).toBe(true)
  })

  it('WebSocket 每一帧记一条', () => {
    const r = new CaptureRecorder('s')
    r.webSocketCreated({ requestId: 'w', url: 'wss://a/ws?token=1' })
    r.webSocketFrame({ requestId: 'w', response: { opcode: 1, payloadData: '{"cmd":"getPlan","id":3829}' } }, 'send')
    r.webSocketFrame({ requestId: 'w', response: { opcode: 1, payloadData: '{"token":"t","stem":"已知"}' } }, 'receive')
    const f = r.finish('t')
    expect(f.entries.map((e) => [e.method, e.url])).toEqual([
      ['WS-SEND', `wss://a/ws?token=${REDACTED}`],
      ['WS-RECV', `wss://a/ws?token=${REDACTED}`]
    ])
    expect(JSON.parse(f.entries[1]!.responseBody!)).toEqual({ token: REDACTED, stem: '已知' })
    expect(f.diagnostics.cdpTypeCounts['WebSocket']).toBe(1)
  })
})

describe('墨案采集：其他', () => {
  it('判断文本响应', () => {
    expect(isTextMime('application/json')).toBe(true)
    expect(isTextMime('application/vnd.api+json')).toBe(true)
    expect(isTextMime('text/html')).toBe(true)
    expect(isTextMime('image/png')).toBe(false)
    expect(isTextMime('application/octet-stream')).toBe(false)
  })

  it('文件名带日期时间', () => {
    expect(captureFileName(new Date(2026, 10, 10, 12, 8, 5))).toBe('墨案采集_20261110-120805.json')
  })
})

describe('墨案采集：预加载脚本', () => {
  it('通道名与 shared/ipc.ts 一致，且不 import 其他模块（沙箱预加载只能 require electron）', () => {
    const src = readFileSync('src/preload/moan.ts', 'utf8')
    expect(src).toContain(`const MOAN_CAPTURE_CHANNEL = '${MOAN_CAPTURE_CHANNEL}'`)
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    expect(imports).toEqual(['electron'])
  })
})
