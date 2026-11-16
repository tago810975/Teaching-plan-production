/**
 * 墨案（老教学案系统）的富文本 HTML → 工程富文本（RichText）。
 *
 * 墨案的题干、解析、答案、知识点都是富文本编辑器产生的 HTML 片段：<p> 分段，
 * 公式写作 $…$（也见到 $$…$$、\(…\)、\[…\]），网页用 KaTeX 显示；另有加粗、颜色、上下标、图片、表格。
 * 这里不依赖浏览器 DOM：先用宽松的解析器建一棵简单的树，再转换。公式原样保存为 LaTeX。
 */
import { localName, mathmlToLatex, type MathmlLatex } from './mathml'
import type { ImageInline, Inline, ParagraphFormat, RichParagraph, RichText, TableCell, TableInline, TableRow, TextMarks } from '../../model/types'

// ---------- 简单的 HTML 树 ----------

export interface HtmlElement {
  kind: 'element'
  tag: string
  attrs: Record<string, string>
  children: HtmlNode[]
}
export interface HtmlText {
  kind: 'text'
  text: string
}
export type HtmlNode = HtmlElement | HtmlText

const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'wbr', 'source'])
/** 遇到这些开始标签时，未闭合的 <p> 自动结束（与浏览器一致） */
const CLOSES_P = new Set(['p', 'div', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr'])

const TOKEN = /<!--[\s\S]*?-->|<\/\s*([a-zA-Z][\w:.-]*)\s*>|<([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { kind: 'element', tag: '#root', attrs: {}, children: [] }
  const stack: HtmlElement[] = [root]
  const top = (): HtmlElement => stack[stack.length - 1]!
  for (const m of html.matchAll(TOKEN)) {
    const [whole, closeTag, openTag, attrText, selfClose] = m
    if (whole.startsWith('<!--')) continue
    if (closeTag !== undefined) {
      const tag = closeTag.toLowerCase()
      const at = stack.map((e) => e.tag).lastIndexOf(tag)
      if (at > 0) stack.length = at
      continue
    }
    if (openTag !== undefined) {
      const tag = openTag.toLowerCase()
      if (CLOSES_P.has(tag)) {
        const at = stack.map((e) => e.tag).lastIndexOf('p')
        if (at > 0) stack.length = at
      }
      if ((tag === 'td' || tag === 'th' || tag === 'tr') && stack.some((e) => e.tag === tag)) {
        // 未闭合的单元格 / 行：回到上一层
        const at = stack.map((e) => e.tag).lastIndexOf(tag)
        if (at > 0) stack.length = at
      }
      const el: HtmlElement = { kind: 'element', tag, attrs: parseAttrs(attrText ?? ''), children: [] }
      top().children.push(el)
      if (!VOID_TAGS.has(tag) && selfClose !== '/') stack.push(el)
      continue
    }
    top().children.push({ kind: 'text', text: whole })
  }
  return root
}

function parseAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase()
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0', ensp: ' ', emsp: ' ', thinsp: ' ',
  times: '×', divide: '÷', middot: '·', deg: '°', plusmn: '±', le: '≤', ge: '≥', ne: '≠', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', alpha: 'α', beta: 'β', pi: 'π'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10))
    return NAMED_ENTITIES[body] ?? whole
  })
}

/** 去掉标签后的纯文字（用于判断标题、选项等） */
export function htmlPlainText(html: string): string {
  const out: string[] = []
  const walk = (n: HtmlNode): void => {
    if (n.kind === 'text') out.push(decodeEntities(n.text))
    else {
      if (n.tag === 'br' || n.tag === 'p' || n.tag === 'div') out.push('\n')
      n.children.forEach(walk)
    }
  }
  walk(parseHtml(html))
  return out.join('').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

/** 墨案富文本中常见、能正确处理的 HTML 标签 */
const KNOWN_TAGS = new Set([
  'p', 'div', 'span', 'br', 'img', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'caption',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'font', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'small', 'big', 'mark', 'label',
  'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'center', 'o:p', 'script', 'style'
])

// ---------- 公式 ----------

/** 把一段文字按公式分隔符拆开：$$…$$、\[…\] 为行间公式；$…$、\(…\) 为行内公式 */
export function splitMath(text: string): Array<{ text: string } | { latex: string; display: boolean }> {
  const out: Array<{ text: string } | { latex: string; display: boolean }> = []
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$((?:\\\$|[^$])+?)\$/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    const display = m[1] !== undefined || m[2] !== undefined
    const latex = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (latex !== '') out.push({ latex, display })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

// ---------- 转换 ----------

export interface HtmlConvertOptions {
  /** 图片：由调用方根据地址给出已下载的资源；返回 null 表示没有（会记一条提示） */
  image?: (src: string, attrs: Record<string, string>) => ImageInline | null
  /** 转换中的提示（图片缺失、无法识别的内容等） */
  warn?: (message: string) => void
}

interface Ctx {
  marks: TextMarks
  options: HtmlConvertOptions
}

/** HTML 片段 → 富文本。首尾的空段落去掉，中间的保留（墨案里常用空段落隔开“审题”“讲解提要”） */
export function htmlToRich(html: string, options: HtmlConvertOptions = {}): RichText {
  if (html.trim() === '') return []
  const root = parseHtml(html)
  const paras: RichParagraph[] = []
  let current: RichParagraph | null = null
  const ctx0: Ctx = { marks: {}, options }
  const warned = new Set<string>()

  const cur = (format?: ParagraphFormat): RichParagraph => {
    if (current === null) {
      current = { inlines: [], ...(format !== undefined && Object.keys(format).length > 0 ? { format } : {}) }
      paras.push(current)
    }
    return current
  }
  const flush = (): void => {
    current = null
  }

  const visit = (node: HtmlNode, ctx: Ctx, format: ParagraphFormat | undefined): void => {
    if (node.kind === 'text') {
      const text = decodeEntities(node.text).replace(/[\r\n\t ]+/g, ' ').replace(/\u00a0/g, ' ')
      if (text === '') return
      addText(cur(format), text, ctx.marks)
      return
    }
    const tag = node.tag
    // 公式：MathML（从 Word 粘贴）、KaTeX / MathJax 渲染后的 HTML
    const formula = formulaOf(node)
    if (formula !== null) {
      if (formula.unknown.length > 0) ctx.options.warn?.(`公式中有未识别的结构（${formula.unknown.join('、')}），已按文字导入：${formula.latex}`)
      if (formula.latex !== '') addMath(cur(format), formula.latex, formula.display, ctx.marks)
      return
    }
    if (tag === 'script' || tag === 'style') return
    if (tag === 'br') {
      // 换行：另起一段（工程的段落里没有软换行）。<p><br></p> 由所在段落处理成空段落
      if (current !== null && current.inlines.length > 0) flush()
      else cur(format)
      return
    }
    if (tag === 'img') {
      const src = node.attrs['data-href'] || node.attrs['src'] || ''
      const img = src !== '' && ctx.options.image !== undefined ? ctx.options.image(src, node.attrs) : null
      if (img !== null) cur(format).inlines.push(img)
      else ctx.options.warn?.(`图片未能导入：${src === '' ? '（无地址）' : src}`)
      return
    }
    if (tag === 'table') {
      flush()
      const table = convertTable(node, ctx)
      if (table !== null) paras.push({ inlines: [table] })
      flush()
      return
    }
    // 不认识的标签（多半是某种公式或特殊排版）：按文字导入，并提示一次，便于发现转换遗漏
    if (!KNOWN_TAGS.has(tag) && !warned.has(tag)) {
      warned.add(tag)
      ctx.options.warn?.(`有未识别的标签 <${tag}>，其中的内容按普通文字导入，可能丢失格式（如分数、根号）`)
    }
    const block = tag === 'p' || tag === 'div' || tag === 'li' || /^h[1-6]$/.test(tag) || tag === 'blockquote' || tag === 'pre'
    const marks = { ...ctx.marks, ...marksOf(node) }
    const childCtx: Ctx = { ...ctx, marks }
    if (block) {
      flush()
      const f = { ...(format ?? {}), ...formatOf(node) }
      const start = paras.length
      for (const ch of node.children) visit(ch, childCtx, f)
      // 空的 <p></p> 或 <p><br></p> 也占一段
      if (paras.length === start) cur(f)
      flush()
      return
    }
    for (const ch of node.children) visit(ch, childCtx, format)
  }

  for (const ch of root.children) visit(ch, ctx0, undefined)
  return tidy(paras)
}

/**
 * 认出一个元素是否整个是一条公式：
 * - <math>（MathML，可带命名空间前缀）；
 * - KaTeX 渲染结果 <span class="katex">：取其中 MathML 的 TeX 注释；
 * - MathJax：<script type="math/tex">、<mjx-container>（取其中的 MathML）。
 */
function formulaOf(node: HtmlElement): MathmlLatex | null {
  const name = localName(node.tag)
  if (name === 'math') return mathmlToLatex(node, decodeEntities)
  const cls = ` ${node.attrs['class'] ?? ''} `
  if (node.tag === 'script' && /math\/tex/i.test(node.attrs['type'] ?? '')) {
    const latex = decodeEntities(node.children.map((c) => (c.kind === 'text' ? c.text : '')).join('')).trim()
    return { latex, display: /mode=display/i.test(node.attrs['type'] ?? ''), unknown: [] }
  }
  if (/ katex(-display)? /.test(cls) || node.tag === 'mjx-container') {
    const math = findMath(node)
    if (math !== null) return { ...mathmlToLatex(math, decodeEntities), ...(/katex-display/.test(cls) || node.attrs['display'] === 'true' ? { display: true } : {}) }
  }
  return null
}

function findMath(node: HtmlElement): HtmlElement | null {
  for (const c of node.children) {
    if (c.kind !== 'element') continue
    if (localName(c.tag) === 'math') return c
    const found = findMath(c)
    if (found !== null) return found
  }
  return null
}

function addMath(p: RichParagraph, latex: string, display: boolean, marks: TextMarks): void {
  const m: Inline = { type: 'math', latex, ...(display ? { display: true } : {}) }
  if (marks.bold === true) m.bold = true
  if (marks.underline === true) m.underline = true
  if (marks.color !== undefined) m.color = marks.color
  p.inlines.push(m)
}

function addText(p: RichParagraph, text: string, marks: TextMarks): void {
  for (const part of splitMath(text)) {
    if ('latex' in part) addMath(p, part.latex, part.display, marks)
    else if (part.text !== '') {
      const prev = p.inlines[p.inlines.length - 1]
      if (prev !== undefined && prev.type === 'text' && sameMarks(prev.marks, marks)) prev.text += part.text
      else p.inlines.push({ type: 'text', text: part.text, ...(Object.keys(marks).length > 0 ? { marks: { ...marks } } : {}) })
    }
  }
}

function sameMarks(a: TextMarks | undefined, b: TextMarks): boolean {
  const ka = a ?? {}
  const keys = new Set([...Object.keys(ka), ...Object.keys(b)]) as Set<keyof TextMarks>
  for (const k of keys) if (ka[k] !== b[k]) return false
  return true
}

/** 段落首尾空白去掉；首尾的空段落去掉 */
function tidy(paras: RichParagraph[]): RichText {
  for (const p of paras) {
    const first = p.inlines[0]
    if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '')
    const last = p.inlines[p.inlines.length - 1]
    if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '')
    p.inlines = p.inlines.filter((i) => i.type !== 'text' || i.text !== '')
  }
  const empty = (p: RichParagraph): boolean => p.inlines.length === 0
  let a = 0
  let b = paras.length
  while (a < b && empty(paras[a]!)) a++
  while (b > a && empty(paras[b - 1]!)) b--
  return paras.slice(a, b)
}

function styleMap(node: HtmlElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of (node.attrs['style'] ?? '').split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim().toLowerCase()
  }
  return out
}

function marksOf(node: HtmlElement): TextMarks {
  const m: TextMarks = {}
  switch (node.tag) {
    case 'strong':
    case 'b':
      m.bold = true
      break
    case 'em':
    case 'i':
      m.italic = true
      break
    case 'u':
    case 'ins':
      m.underline = true
      break
    case 'sub':
      m.script = 'sub'
      break
    case 'sup':
      m.script = 'sup'
      break
  }
  const st = styleMap(node)
  if (st['font-weight'] === 'bold' || Number(st['font-weight']) >= 600) m.bold = true
  if (st['font-style'] === 'italic') m.italic = true
  if ((st['text-decoration'] ?? st['text-decoration-line'] ?? '').includes('underline')) m.underline = true
  const color = parseColor(st['color'] ?? node.attrs['color'])
  if (color !== undefined) m.color = color
  return m
}

function formatOf(node: HtmlElement): ParagraphFormat {
  const st = styleMap(node)
  const align = st['text-align'] ?? node.attrs['align']
  return align === 'center' ? { align: 'center' } : align === 'right' ? { align: 'right' } : {}
}

/**
 * CSS 颜色 → 十六进制（不含 #）。接近黑色的（编辑器默认的深灰字色）视为没有颜色。
 */
export function parseColor(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  let r: number, g: number, b: number
  const v = value.trim().toLowerCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v)
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (rgb !== null) {
    ;[r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  } else if (hex !== null) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!
    ;[r, g, b] = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  } else {
    const named: Record<string, string> = { red: 'FF0000', blue: '0000FF', green: '008000' }
    return named[v]
  }
  if (Math.max(r, g, b) < 80) return undefined
  return [r, g, b].map((x) => Math.min(255, x).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function convertTable(node: HtmlElement, ctx: Ctx): TableInline | null {
  const rows: TableRow[] = []
  const collectRows = (n: HtmlElement): void => {
    for (const ch of n.children) {
      if (ch.kind !== 'element') continue
      if (ch.tag === 'tr') {
        const cells: TableCell[] = []
        for (const c of ch.children) {
          if (c.kind !== 'element' || (c.tag !== 'td' && c.tag !== 'th')) continue
          const inner = c.children.map(serialize).join('')
          const content = htmlToRich(c.tag === 'th' ? `<strong>${inner}</strong>` : inner, ctx.options)
          const cell: TableCell = { content: content.length > 0 ? content : [{ inlines: [] }] }
          const cs = Number(c.attrs['colspan'] ?? 1)
          const rs = Number(c.attrs['rowspan'] ?? 1)
          if (cs > 1) cell.colSpan = cs
          if (rs > 1) cell.rowSpan = rs
          const bg = parseColor(styleMap(c)['background-color'] ?? c.attrs['bgcolor'])
          if (bg !== undefined) cell.shading = bg
          cells.push(cell)
        }
        if (cells.length > 0) rows.push({ cells })
      } else if (ch.tag === 'thead' || ch.tag === 'tbody' || ch.tag === 'tfoot') {
        collectRows(ch)
      }
    }
  }
  collectRows(node)
  if (rows.length === 0) return null
  return { type: 'table', rows }
}

/** 把树中的节点还原成 HTML（转换表格单元格时复用 htmlToRich） */
function serialize(n: HtmlNode): string {
  if (n.kind === 'text') return n.text
  const attrs = Object.entries(n.attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .join('')
  if (VOID_TAGS.has(n.tag)) return `<${n.tag}${attrs}>`
  return `<${n.tag}${attrs}>${n.children.map(serialize).join('')}</${n.tag}>`
}
