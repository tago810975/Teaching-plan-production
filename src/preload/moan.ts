/// <reference lib="dom" />
/**
 * 墨案采集窗口的预加载脚本。
 *
 * 在页面脚本运行之前，给页面里的 XMLHttpRequest 与 fetch 套一层记录：每次接口请求完成后，
 * 把地址、请求正文、状态与响应正文交给主进程。这与主进程用开发者协议的记录互为备份
 * （第一次实测开发者协议一条都没记到，原因待查，所以加了这一路）。
 * 只读取、不修改请求和响应；凭证在主进程写文件前隐去（core/import/moan/capture-log.ts）。
 */
import { contextBridge, ipcRenderer } from 'electron'

/**
 * 与 shared/ipc.ts 的 MOAN_CAPTURE_CHANNEL 相同。这里不能 import：两个预加载脚本共用模块时，
 * 打包会拆出公共 chunk 并 require 它，而沙箱中的预加载脚本只能 require('electron')，主窗口也会因此打不开。
 * test/moan-capture.test.ts 检查两处一致。
 */
const MOAN_CAPTURE_CHANNEL = 'moan-capture:report'

function send(entry: unknown): void {
  ipcRenderer.send(MOAN_CAPTURE_CHANNEL, entry)
}

/**
 * 在页面主环境中执行（不能引用本文件中的任何其他东西）。
 * sink 是经 contextBridge 传过来的函数，保存在闭包里，页面脚本拿不到也删不掉。
 */
function installHook(sink: (entry: unknown) => void): void {
  const MAX = 5_000_000
  const report = (entry: Record<string, unknown>): void => {
    try {
      sink({ request: entry })
    } catch {
      // 主进程不可用时忽略
    }
  }
  const bodyText = (body: unknown): string | undefined => {
    if (body === undefined || body === null) return undefined
    if (typeof body === 'string') return body
    if (body instanceof URLSearchParams) return body.toString()
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const parts: string[] = []
      body.forEach((v, k) => parts.push(`${encodeURIComponent(k)}=${typeof v === 'string' ? encodeURIComponent(v) : '[文件]'}`))
      return parts.join('&')
    }
    return '[非文本正文]'
  }
  const absolute = (u: unknown): string => {
    try {
      return new URL(String(u), location.href).href
    } catch {
      return String(u)
    }
  }

  // ---- XMLHttpRequest ----
  const XHR = XMLHttpRequest.prototype
  const origOpen = XHR.open
  const origSend = XHR.send
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>()
  XHR.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    meta.set(this, { method: String(method), url: absolute(url) })
    return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof XHR.open
  XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const m = meta.get(this)
    if (m !== undefined) {
      const requestBody = bodyText(body)
      this.addEventListener('loadend', () => {
        let responseBody: string | undefined
        try {
          if (this.responseType === '' || this.responseType === 'text') responseBody = this.responseText
          else if (this.responseType === 'json') responseBody = JSON.stringify(this.response)
          else responseBody = `[${this.responseType} 响应未记录]`
        } catch {
          responseBody = '[读取响应失败]'
        }
        if (responseBody !== undefined && responseBody.length > MAX) responseBody = responseBody.slice(0, MAX)
        report({
          kind: 'xhr',
          method: m.method,
          url: m.url,
          requestBody,
          status: this.status,
          mimeType: (this.getResponseHeader('content-type') ?? '').split(';')[0],
          responseBody
        })
      })
    }
    return origSend.call(this, body)
  }

  // ---- fetch ----
  const origFetch = window.fetch
  if (typeof origFetch === 'function') {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = input instanceof Request ? input : null
      const method = String(init?.method ?? req?.method ?? 'GET')
      const url = absolute(req !== null ? req.url : input)
      const requestBody = bodyText(init?.body)
      const p = origFetch.call(window, input as RequestInfo, init)
      p.then(
        (res: Response) => {
          const mimeType = (res.headers.get('content-type') ?? '').split(';')[0] ?? ''
          if (mimeType !== '' && !/json|text|xml|javascript/i.test(mimeType)) {
            report({ kind: 'fetch', method, url, requestBody, status: res.status, mimeType, responseBody: '[非文本响应未记录]' })
            return
          }
          res
            .clone()
            .text()
            .then((text: string) => report({ kind: 'fetch', method, url, requestBody, status: res.status, mimeType, responseBody: text.slice(0, MAX) }))
            .catch(() => report({ kind: 'fetch', method, url, requestBody, status: res.status, mimeType, error: '读取响应失败' }))
        },
        (err: unknown) => report({ kind: 'fetch', method, url, requestBody, error: `请求失败：${String(err)}` })
      )
      return p
    } as typeof window.fetch
  }
}

try {
  contextBridge.executeInMainWorld({ func: installHook, args: [send] })
} catch (err) {
  send({ note: `页面内记录安装失败：${String(err)}` })
}
