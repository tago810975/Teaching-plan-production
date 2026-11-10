/**
 * 墨案（老教学案系统）数据采集：记录格式与隐私处理。
 *
 * 采集窗口（src/main/moan-capture.ts）记录墨案网页与服务器之间的接口往来，保存成一个 JSON 文件，
 * 用来弄清教案、题目、答案、解析分别来自哪个接口、是什么格式，以便编写正式的导入器。
 * 文件会交给开发者查看，所以登录凭证（Cookie、Token、密码）在写入前一律隐去：
 * 只保留“有这一项”，不保留它的值。本文件是纯逻辑，不依赖 Electron，可直接测试。
 */

export const MOAN_ORIGIN = 'https://moan.modijiaoyu.com'
export const MOAN_START_URL = `${MOAN_ORIGIN}/#/teach/standard_content`

export const REDACTED = '[已隐去]'

/** 采集文件的格式版本 */
export const CAPTURE_FORMAT = 'moan-capture/1'

/** 单条响应正文的上限（字符）。教案详情一般只有几十 KB，超过的多半是静态资源 */
export const MAX_BODY_CHARS = 5_000_000
/** 最多记录的条数，防止窗口开很久时文件无限变大 */
export const MAX_ENTRIES = 3000

export interface CaptureEntry {
  /** 记录顺序，从 1 开始 */
  seq: number
  /** 请求发出时间（ISO） */
  time: string
  method: string
  url: string
  /** XHR / Fetch 等 */
  resourceType: string
  requestHeaders: Record<string, string>
  requestBody?: string
  status?: number
  mimeType?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  /** 正文过大、为二进制或读取失败时的说明 */
  note?: string
  /** 请求发出时页面所在的地址（可看出是在哪个页面上点了什么） */
  pageUrl?: string
}

export interface CaptureFile {
  format: typeof CAPTURE_FORMAT
  app: string
  startedAt: string
  finishedAt: string
  startUrl: string
  /** 页面依次经过的地址 */
  pages: { time: string; url: string }[]
  entries: CaptureEntry[]
  /** 关闭窗口时页面的完整 HTML（含已展开的详情） */
  finalPage?: { url: string; html: string }
  /** 记录被截断等提示 */
  notes: string[]
}

// ---------- 隐去凭证 ----------

/**
 * 名称里含这些词的字段视为凭证或个人信息：请求头、查询参数、JSON 字段、表单字段。
 * 账号与手机号也隐去（登录表单、用户信息接口里会有），教案内容不会用这些字段名。
 */
const SECRET_NAME = /(cookie|authori[sz]ation|token|ticket|session|passw(or)?d|^pwd$|^pass$|secret|sign(ature)?$|credential|captcha|verify_?code|sms_?code|^user_?name$|^account$|^login_?name$|phone|mobile|id_?card)/i

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name)
}

export function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers === undefined) return out
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSecretName(name) ? REDACTED : String(value)
  }
  return out
}

/** 隐去地址查询参数里的凭证（包括 hash 路由里的查询参数） */
export function redactUrl(url: string): string {
  return url.replace(/([?&])([^=&#]+)=([^&#]*)/g, (whole, sep: string, name: string) =>
    isSecretName(safeDecode(name)) ? `${sep}${name}=${REDACTED}` : whole
  )
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 递归隐去 JSON 中名称像凭证的字段的值 */
export function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretName(k) && (typeof v === 'string' || typeof v === 'number') ? REDACTED : redactJsonValue(v)
    }
    return out
  }
  return value
}

/**
 * 隐去正文中的凭证：JSON 按字段处理，表单（a=1&b=2）按字段处理，
 * 其他文本中若出现像 JWT 的长串也替换掉。
 */
export function redactBody(body: string): string {
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactJsonValue(JSON.parse(trimmed)))
    } catch {
      // 不是合法 JSON，按普通文本处理
    }
  }
  if (/^[^\s=&]+=[^&]*(&[^\s=&]+=[^&]*)*$/.test(trimmed)) {
    return trimmed
      .split('&')
      .map((pair) => {
        const i = pair.indexOf('=')
        const name = pair.slice(0, i)
        return isSecretName(safeDecode(name)) ? `${name}=${REDACTED}` : pair
      })
      .join('&')
  }
  return body.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, REDACTED)
}

// ---------- 筛选 ----------

/** 只记录网页脚本发出的接口请求（XHR / Fetch），不记录图片、样式、脚本文件 */
export function shouldRecord(resourceType: string | undefined): boolean {
  return resourceType === 'XHR' || resourceType === 'Fetch'
}

/** 响应是否为文本（JSON、HTML、纯文本等），二进制不读正文 */
export function isTextMime(mimeType: string | undefined): boolean {
  if (mimeType === undefined || mimeType === '') return true
  return /^(text\/|application\/(json|.*\+json|javascript|x-www-form-urlencoded|xml))/i.test(mimeType)
}

// ---------- 记录器 ----------

interface Pending {
  entry: CaptureEntry
}

/**
 * 按 Chrome 开发者协议（CDP）的 Network 事件整理记录。
 * 采集窗口把事件原样交给它；读取响应正文是异步的，由调用方完成后调用 setBody。
 */
export class CaptureRecorder {
  private readonly pending = new Map<string, Pending>()
  private readonly entries: CaptureEntry[] = []
  private readonly pages: { time: string; url: string }[] = []
  private readonly notes: string[] = []
  private seq = 0
  private currentPage = ''
  private truncated = false
  readonly startedAt: string

  constructor(
    readonly startUrl: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.startedAt = this.now().toISOString()
  }

  get count(): number {
    return this.entries.length
  }

  pageVisited(url: string): void {
    const clean = redactUrl(url)
    if (clean === this.currentPage) return
    this.currentPage = clean
    this.pages.push({ time: this.now().toISOString(), url: clean })
  }

  /** Network.requestWillBeSent */
  requestWillBeSent(params: {
    requestId: string
    type?: string
    request: { url: string; method: string; headers?: Record<string, unknown>; postData?: string }
  }): void {
    if (!shouldRecord(params.type)) return
    if (this.entries.length >= MAX_ENTRIES) {
      if (!this.truncated) {
        this.truncated = true
        this.notes.push(`记录已达 ${MAX_ENTRIES} 条上限，之后的请求未记录`)
      }
      return
    }
    const req = params.request
    const entry: CaptureEntry = {
      seq: ++this.seq,
      time: this.now().toISOString(),
      method: req.method,
      url: redactUrl(req.url),
      resourceType: params.type ?? '',
      requestHeaders: redactHeaders(req.headers),
      pageUrl: this.currentPage
    }
    if (req.postData !== undefined) entry.requestBody = redactBody(req.postData)
    this.entries.push(entry)
    this.pending.set(params.requestId, { entry })
  }

  /** Network.requestWillBeSentExtraInfo：带有浏览器自动加上的请求头（Cookie 等），只为看出鉴权方式 */
  requestExtraInfo(params: { requestId: string; headers?: Record<string, unknown> }): void {
    const p = this.pending.get(params.requestId)
    if (p === undefined || params.headers === undefined) return
    p.entry.requestHeaders = { ...redactHeaders(params.headers), ...p.entry.requestHeaders }
  }

  /** Network.responseReceived */
  responseReceived(params: {
    requestId: string
    response: { status: number; mimeType?: string; headers?: Record<string, unknown> }
  }): void {
    const p = this.pending.get(params.requestId)
    if (p === undefined) return
    p.entry.status = params.response.status
    if (params.response.mimeType !== undefined) p.entry.mimeType = params.response.mimeType
    p.entry.responseHeaders = redactHeaders(params.response.headers)
  }

  /** 是否需要读取这条请求的响应正文（Network.loadingFinished 时调用） */
  wantsBody(requestId: string): boolean {
    const p = this.pending.get(requestId)
    return p !== undefined && isTextMime(p.entry.mimeType)
  }

  setBody(requestId: string, body: string, base64Encoded: boolean): void {
    const p = this.pending.get(requestId)
    if (p === undefined) return
    this.pending.delete(requestId)
    if (base64Encoded) {
      p.entry.note = '响应为二进制，未记录正文'
      return
    }
    if (body.length > MAX_BODY_CHARS) {
      p.entry.note = `响应正文 ${body.length} 字符，超过上限未记录`
      return
    }
    p.entry.responseBody = redactBody(body)
  }

  fail(requestId: string, reason: string): void {
    const p = this.pending.get(requestId)
    if (p === undefined) return
    this.pending.delete(requestId)
    p.entry.note = reason
  }

  finish(app: string, finalPage?: { url: string; html: string }): CaptureFile {
    for (const p of this.pending.values()) p.entry.note ??= '窗口关闭时尚未收到响应'
    this.pending.clear()
    const file: CaptureFile = {
      format: CAPTURE_FORMAT,
      app,
      startedAt: this.startedAt,
      finishedAt: this.now().toISOString(),
      startUrl: this.startUrl,
      pages: [...this.pages],
      entries: [...this.entries],
      notes: [...this.notes]
    }
    if (finalPage !== undefined) file.finalPage = { url: redactUrl(finalPage.url), html: redactPageHtml(finalPage.html) }
    return file
  }
}

/** 页面快照里可能出现的凭证：输入框的值（密码框）与像 JWT 的长串 */
export function redactPageHtml(html: string): string {
  return html
    .replace(/(<input\b[^>]*type=["']?password["']?[^>]*\bvalue=)("[^"]*"|'[^']*')/gi, `$1"${REDACTED}"`)
    .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, REDACTED)
}

/** 采集文件名：墨案采集_20261110-121800.json */
export function captureFileName(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `墨案采集_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.json`
}
