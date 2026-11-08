/**
 * MathType 公式（Equation.DSMT4 等 OLE 对象）→ LaTeX。
 *
 * OLE 对象是一个复合文件，其中的“Equation Native”流保存着 MTEF（MathType 公式格式）数据：
 * 28 字节的头部之后是 MTEF 第 5 版的记录序列。这里按 MTEF 5 规范解析出公式结构，
 * 再转为 LaTeX，导入后与软件中新建的公式一样可以编辑，导出时转为 Word 原生公式。
 *
 * 只支持 MTEF 5（MathType 5 及以后，国内题库文档基本都是这一版本）。
 * 无法解析时返回 null，调用方退回使用公式的预览图。
 */
import CFB from 'cfb'
import { escapeLatexText } from './latex-text'

// ---------------- OLE 复合文件 ----------------

/** 从 OLE 对象中取出 MTEF 数据；不是 MathType 公式时返回 null */
export function extractMtef(ole: Uint8Array): Uint8Array | null {
  let container
  try {
    container = CFB.read(ole, { type: 'array' })
  } catch {
    return null
  }
  const entry = CFB.find(container, 'Equation Native')
  const content = entry?.content
  if (content === undefined || content === null || content.length < 30) return null
  const bytes = content instanceof Uint8Array ? content : Uint8Array.from(content as ArrayLike<number>)
  // 头部第一个字段是头部长度（通常为 28）
  const headerLen = bytes[0]! | (bytes[1]! << 8)
  if (headerLen < 8 || headerLen >= bytes.length) return null
  return bytes.subarray(headerLen)
}

export function mathTypeToLatex(ole: Uint8Array): string | null {
  const mtef = extractMtef(ole)
  if (mtef === null) return null
  try {
    const eq = parseMtef(mtef)
    const latex = tidy(lineToLatex(eq))
    return latex === '' ? null : latex
  } catch {
    return null
  }
}

// ---------------- MTEF 结构 ----------------

export interface MtChar {
  kind: 'char'
  code: number
  typeface: number
  embells: number[]
}
export interface MtTmpl {
  kind: 'tmpl'
  selector: number
  variation: number
  /** 模板的子对象：若干槽位（line）与模板符号（char） */
  items: MtNode[]
}
export interface MtLine {
  kind: 'line'
  items: MtNode[]
  /** 空行（mtefOPT_LINE_NULL） */
  isNull: boolean
}
export interface MtPile {
  kind: 'pile'
  lines: MtLine[]
}
export interface MtMatrix {
  kind: 'matrix'
  rows: number
  cols: number
  cells: MtLine[]
}
export type MtNode = MtChar | MtTmpl | MtLine | MtPile | MtMatrix

const REC = {
  END: 0,
  LINE: 1,
  CHAR: 2,
  TMPL: 3,
  PILE: 4,
  MATRIX: 5,
  EMBELL: 6,
  RULER: 7,
  FONT_STYLE_DEF: 8,
  SIZE: 9,
  FULL: 10,
  SUB: 11,
  SUB2: 12,
  SYM: 13,
  SUBSYM: 14,
  COLOR: 15,
  COLOR_DEF: 16,
  FONT_DEF: 17,
  EQN_PREFS: 18,
  ENCODING_DEF: 19
} as const

const OPT = {
  NUDGE: 0x08,
  LINE_NULL: 0x01,
  LP_RULER: 0x02,
  LINE_LSPACE: 0x04,
  CHAR_EMBELL: 0x01,
  CHAR_ENC_CHAR_8: 0x04,
  CHAR_ENC_CHAR_16: 0x10,
  CHAR_ENC_NO_MTCODE: 0x20
} as const

class Reader {
  pos = 0
  constructor(private b: Uint8Array) {}
  get done(): boolean {
    return this.pos >= this.b.length
  }
  u8(): number {
    if (this.pos >= this.b.length) throw new Error('MTEF 数据意外结束')
    return this.b[this.pos++]!
  }
  u16(): number {
    const lo = this.u8()
    return lo | (this.u8() << 8)
  }
  /** MTEF 的可变长度无符号整数：小于 255 时占 1 字节，否则为 255 加 2 字节 */
  uint(): number {
    const b = this.u8()
    return b === 255 ? this.u16() : b
  }
  skip(n: number): void {
    this.pos += n
  }
  cstring(): string {
    let s = ''
    for (let c = this.u8(); c !== 0; c = this.u8()) s += String.fromCharCode(c)
    return s
  }
}

export function parseMtef(data: Uint8Array): MtLine {
  const r = new Reader(data)
  const version = r.u8()
  if (version !== 5) throw new Error(`不支持的 MTEF 版本：${version}`)
  r.skip(4) // platform, product, product version, product subversion
  r.cstring() // application key，如 "DSMT6"
  r.u8() // equation options
  const items = readObjectList(r, true)
  // 公式由一个或多个 LINE 组成（通常是一个 PILE 或 LINE）
  const lines = items.filter((n): n is MtLine | MtPile => n.kind === 'line' || n.kind === 'pile')
  const first = lines[0]
  if (lines.length === 1 && first?.kind === 'line') return first
  return { kind: 'line', items: lines, isNull: false }
}

/** 读取对象列表直到 END；topLevel 时读到数据末尾也结束 */
function readObjectList(r: Reader, topLevel = false): MtNode[] {
  const out: MtNode[] = []
  while (!(topLevel && r.done)) {
    const tag = r.u8()
    switch (tag) {
      case REC.END:
        return out
      case REC.LINE:
        out.push(readLine(r))
        break
      case REC.CHAR:
        out.push(readChar(r))
        break
      case REC.TMPL:
        out.push(readTmpl(r))
        break
      case REC.PILE:
        out.push(readPile(r))
        break
      case REC.MATRIX:
        out.push(readMatrix(r))
        break
      case REC.RULER:
        readRuler(r)
        break
      case REC.FONT_STYLE_DEF:
        r.skip(2)
        break
      case REC.SIZE:
        readSize(r)
        break
      case REC.FULL:
      case REC.SUB:
      case REC.SUB2:
      case REC.SYM:
      case REC.SUBSYM:
        break
      case REC.COLOR:
        r.skip(1)
        break
      case REC.COLOR_DEF: {
        const opts = r.u8()
        r.skip((opts & 1 ? 4 : 3) * 2)
        if (opts & 4) r.cstring()
        break
      }
      case REC.FONT_DEF:
        r.u8()
        r.cstring()
        break
      case REC.EQN_PREFS:
        readEqnPrefs(r)
        break
      case REC.ENCODING_DEF:
        r.cstring()
        break
      default:
        if (tag >= 100) {
          // 扩展记录（如 MathType 保存的 LaTeX 输入源码）：带长度，直接跳过
          r.skip(r.uint())
          break
        }
        throw new Error(`未知的 MTEF 记录：${tag}`)
    }
  }
  return out
}

function readNudge(r: Reader, options: number): void {
  if ((options & OPT.NUDGE) === 0) return
  const dx = r.u8()
  const dy = r.u8()
  if (dx === 128 && dy === 128) r.skip(4)
}

function readLine(r: Reader): MtLine {
  const options = r.u8()
  readNudge(r, options)
  if (options & OPT.LINE_LSPACE) r.skip(2)
  if (options & OPT.LP_RULER) {
    r.u8() // RULER 标记
    readRuler(r)
  }
  if (options & OPT.LINE_NULL) return { kind: 'line', items: [], isNull: true }
  return { kind: 'line', items: readObjectList(r), isNull: false }
}

function readChar(r: Reader): MtChar {
  const options = r.u8()
  readNudge(r, options)
  const typeface = r.u8() - 128
  let code = 0
  if ((options & OPT.CHAR_ENC_NO_MTCODE) === 0) code = r.u16()
  if (options & OPT.CHAR_ENC_CHAR_8) {
    const c8 = r.u8()
    if (code === 0) code = c8
  }
  if (options & OPT.CHAR_ENC_CHAR_16) {
    const c16 = r.u16()
    if (code === 0) code = c16
  }
  const embells: number[] = []
  if (options & OPT.CHAR_EMBELL) {
    for (;;) {
      const tag = r.u8()
      if (tag === REC.END) break
      if (tag !== REC.EMBELL) throw new Error('修饰符列表格式错误')
      const eo = r.u8()
      readNudge(r, eo)
      embells.push(r.u8())
    }
  }
  return { kind: 'char', code, typeface, embells }
}

function readTmpl(r: Reader): MtTmpl {
  const options = r.u8()
  readNudge(r, options)
  const selector = r.u8()
  let variation = r.u8()
  if (variation & 0x80) variation = (variation & 0x7f) | (r.u8() << 8)
  r.u8() // 模板专用选项
  return { kind: 'tmpl', selector, variation, items: readObjectList(r) }
}

function readPile(r: Reader): MtPile {
  const options = r.u8()
  readNudge(r, options)
  r.skip(2) // halign, valign
  if (options & OPT.LP_RULER) {
    r.u8()
    readRuler(r)
  }
  const lines = readObjectList(r).filter((n): n is MtLine => n.kind === 'line')
  return { kind: 'pile', lines }
}

function readMatrix(r: Reader): MtMatrix {
  const options = r.u8()
  readNudge(r, options)
  r.skip(3) // valign, h_just, v_just
  const rows = r.u8()
  const cols = r.u8()
  r.skip(Math.ceil(((rows + 1) * 2) / 8))
  r.skip(Math.ceil(((cols + 1) * 2) / 8))
  const cells = readObjectList(r).filter((n): n is MtLine => n.kind === 'line')
  return { kind: 'matrix', rows, cols, cells }
}

function readRuler(r: Reader): void {
  const n = r.u8()
  r.skip(n * 3)
}

function readSize(r: Reader): void {
  const lsize = r.u8()
  if (lsize === 101) r.skip(2)
  else if (lsize === 100) r.skip(3)
  else r.skip(1)
}

/** EQN_PREFS：尺寸与间距数组以半字节编码，样式数组为若干字节对 */
function readEqnPrefs(r: Reader): void {
  r.u8() // options
  readDimensionArray(r)
  readDimensionArray(r)
  const styles = r.u8()
  for (let i = 0; i < styles; i++) {
    if (r.u8() !== 0) r.u8()
  }
}

function readDimensionArray(r: Reader): void {
  const count = r.u8()
  let ended = 0
  let high = true
  let byte = 0
  while (ended < count) {
    if (high) byte = r.u8()
    const nibble = high ? byte >> 4 : byte & 0x0f
    high = !high
    if (nibble === 0x0f) ended += 1
  }
}

// ---------------- 转为 LaTeX ----------------

/** MTEF 字体类型 */
const FN = {
  TEXT: 1,
  FUNCTION: 2,
  VARIABLE: 3,
  LCGREEK: 4,
  UCGREEK: 5,
  SYMBOL: 6,
  VECTOR: 7,
  NUMBER: 8,
  MTEXTRA: 11,
  TEXT_FE: 12
} as const

/** 模板选择符（MTEF 5） */
const TM = {
  ANGLE: 0,
  PAREN: 1,
  BRACE: 2,
  BRACK: 3,
  BAR: 4,
  DBAR: 5,
  FLOOR: 6,
  CEILING: 7,
  OBRACK: 8,
  INTERVAL: 9,
  ROOT: 10,
  FRACT: 11,
  UBAR: 12,
  OBAR: 13,
  ARROW: 14,
  INTEG: 15,
  SUM: 16,
  PROD: 17,
  COPROD: 18,
  UNION: 19,
  INTER: 20,
  INTOP: 21,
  SUMOP: 22,
  LIM: 23,
  HBRACE: 24,
  HBRACK: 25,
  LDIV: 26,
  SUB: 27,
  SUP: 28,
  SUBSUP: 29,
  DIRAC: 30,
  VEC: 31,
  TILDE: 32,
  HAT: 33,
  ARC: 34,
  JSTATUS: 35,
  STRIKE: 36,
  BOX: 37
} as const

const FENCES: Record<number, [string, string]> = {
  [TM.ANGLE]: ['\\langle ', '\\rangle '],
  [TM.PAREN]: ['(', ')'],
  [TM.BRACE]: ['\\{', '\\}'],
  [TM.BRACK]: ['[', ']'],
  [TM.BAR]: ['|', '|'],
  [TM.DBAR]: ['\\|', '\\|'],
  [TM.FLOOR]: ['\\lfloor ', '\\rfloor '],
  [TM.CEILING]: ['\\lceil ', '\\rceil '],
  [TM.OBRACK]: ['[\\![', ']\\!]']
}

function slots(t: MtTmpl): MtLine[] {
  return t.items.filter((n): n is MtLine => n.kind === 'line')
}

function slotLatex(t: MtTmpl, i: number): string {
  const s = slots(t)[i]
  return s === undefined ? '' : lineToLatex(s)
}

function lineToLatex(line: MtLine | MtPile): string {
  if (line.kind === 'pile') return pileToLatex(line)
  let out = ''
  let text = '' // 连续的正文字体文字合并为一个 \text{}
  let fn = '' // 连续的函数名字母
  const flushText = (): void => {
    if (text !== '') out += `\\text{${text}}`
    text = ''
  }
  const flushFn = (): void => {
    if (fn !== '') out += FUNCTIONS.has(fn) ? `\\${fn} ` : `\\mathrm{${fn}}`
    fn = ''
  }
  for (const node of line.items) {
    if (node.kind === 'char') {
      const isText = node.typeface === FN.TEXT || node.typeface === FN.TEXT_FE || isCjk(node.code)
      if (isText && node.embells.length === 0 && node.code !== 0x20) {
        flushFn()
        text += textChar(node.code)
        continue
      }
      flushText()
      if (node.typeface === FN.FUNCTION && /[A-Za-z]/.test(String.fromCharCode(node.code))) {
        fn += String.fromCharCode(node.code)
        continue
      }
      flushFn()
      out += charToLatex(node)
      continue
    }
    flushText()
    flushFn()
    if (node.kind === 'tmpl') out += tmplToLatex(node)
    else if (node.kind === 'pile') out += pileToLatex(node)
    else if (node.kind === 'matrix') out += matrixToLatex(node)
    else if (node.kind === 'line') out += lineToLatex(node)
  }
  flushText()
  flushFn()
  return out
}

function pileToLatex(p: MtPile): string {
  const rows = p.lines.map(lineToLatex)
  if (rows.length === 1) return rows[0]!
  return `\\begin{array}{l}${rows.join('\\\\')}\\end{array}`
}

function matrixToLatex(m: MtMatrix): string {
  const rows: string[] = []
  for (let i = 0; i < m.rows; i++) {
    rows.push(
      m.cells
        .slice(i * m.cols, (i + 1) * m.cols)
        .map(lineToLatex)
        .join('&')
    )
  }
  return `\\begin{matrix}${rows.join('\\\\')}\\end{matrix}`
}

function tmplToLatex(t: MtTmpl): string {
  const fence = FENCES[t.selector]
  if (fence !== undefined) {
    // 变体：bit0 有左括号，bit1 有右括号
    const left = t.variation & 1 ? fence[0] : '.'
    const right = t.variation & 2 ? fence[1] : '.'
    const inner = slotLatex(t, 0)
    // 只有左花括号、内部是多行 → 方程组
    if (t.selector === TM.BRACE && right === '.' && inner.startsWith('\\begin{array}{l}')) {
      return inner.replace('\\begin{array}{l}', '\\begin{cases}').replace(/\\end\{array\}$/, '\\end{cases}')
    }
    return `\\left${left}${inner}\\right${right}`
  }
  switch (t.selector) {
    case TM.INTERVAL: {
      const l = t.items.find((n): n is MtChar => n.kind === 'char')
      const r = t.items.filter((n): n is MtChar => n.kind === 'char')[1]
      return `\\left${fenceChar(l)}${slotLatex(t, 0)}\\right${fenceChar(r)}`
    }
    case TM.ROOT: {
      // 槽位：被开方数、根指数
      const radicand = slotLatex(t, 0)
      const index = slotLatex(t, 1)
      return t.variation === 1 && index !== '' ? `\\sqrt[${index}]{${radicand}}` : `\\sqrt{${radicand}}`
    }
    case TM.FRACT:
      return `\\frac{${slotLatex(t, 0)}}{${slotLatex(t, 1)}}`
    case TM.UBAR:
      return `\\underline{${slotLatex(t, 0)}}`
    case TM.OBAR:
      return `\\overline{${slotLatex(t, 0)}}`
    case TM.ARROW: {
      const top = slotLatex(t, 0)
      const bottom = slotLatex(t, 1)
      return `\\xrightarrow[${bottom}]{${top}}`
    }
    case TM.INTEG:
    case TM.INTOP: {
      const sym = symbolOf(t) ?? '\\int'
      return `${sym}${limits(t)}{${slotLatex(t, 0)}}`
    }
    case TM.SUM:
    case TM.PROD:
    case TM.COPROD:
    case TM.UNION:
    case TM.INTER:
    case TM.SUMOP: {
      const fallback = { [TM.SUM]: '\\sum', [TM.PROD]: '\\prod', [TM.COPROD]: '\\coprod', [TM.UNION]: '\\bigcup', [TM.INTER]: '\\bigcap' }[t.selector as 16]
      const sym = symbolOf(t) ?? fallback ?? '\\sum'
      return `${sym}${limits(t)}{${slotLatex(t, 0)}}`
    }
    case TM.LIM: {
      const main = slotLatex(t, 0)
      const lower = slotLatex(t, 1)
      const upper = slotLatex(t, 2)
      const op = /^\\(lim|max|min)\s*$/.test(main) || main === '\\mathrm{lim}' ? '\\lim' : `\\operatorname{${main}}`
      return `${op}${lower !== '' ? `_{${lower}}` : ''}${upper !== '' ? `^{${upper}}` : ''}`
    }
    case TM.HBRACE: {
      const main = slotLatex(t, 0)
      const label = slotLatex(t, 1)
      return t.variation & 1 ? `\\overbrace{${main}}^{${label}}` : `\\underbrace{${main}}_{${label}}`
    }
    case TM.HBRACK:
      return t.variation & 1 ? `\\overline{${slotLatex(t, 0)}}` : `\\underline{${slotLatex(t, 0)}}`
    case TM.SUB:
    case TM.SUP:
    case TM.SUBSUP: {
      // 槽位：下标、上标；不存在的一侧为空行
      const sub = slotLatex(t, 0)
      const sup = inSuperscript(slotLatex(t, 1))
      return `${sub !== '' ? `_{${sub}}` : ''}${sup !== '' ? `^{${sup}}` : ''}` || '{}'
    }
    case TM.VEC: {
      // 变体：bit0 左箭头，bit1 右箭头，bit2 两侧（双向），bit3 箭头在下方
      const base = slotLatex(t, 0)
      if (t.variation & 8) return `\\underrightarrow{${base}}`
      if ((t.variation & 3) === 3 || t.variation & 4) return `\\overleftrightarrow{${base}}`
      if (t.variation & 1) return `\\overleftarrow{${base}}`
      return /^.$|^\\[A-Za-z]+\s?$/.test(base) ? `\\vec{${base}}` : `\\overrightarrow{${base}}`
    }
    case TM.TILDE:
      return `\\tilde{${slotLatex(t, 0)}}`
    case TM.HAT:
      return `\\hat{${slotLatex(t, 0)}}`
    case TM.ARC:
      return `\\overset{\\frown}{${slotLatex(t, 0)}}`
    case TM.STRIKE:
      return `\\cancel{${slotLatex(t, 0)}}`
    case TM.BOX:
      return `\\boxed{${slotLatex(t, 0)}}`
    case TM.DIRAC:
      return `\\left\\langle ${slots(t).map(lineToLatex).join('\\middle|')}\\right\\rangle `
    default:
      // 不认识的模板：保留其中的内容
      return slots(t).map(lineToLatex).join('')
  }
}

/** 已经在上标里时，度数符号不再嵌套一层上标（否则“360°”的“°”会缩得很小） */
export function inSuperscript(latex: string): string {
  return latex.replace(/\^\{\\circ\}/g, '\\circ ')
}

/** 积分、求和等：槽位为 被积式、下限、上限 */
function limits(t: MtTmpl): string {
  const lower = slotLatex(t, 1)
  const upper = slotLatex(t, 2)
  return `${lower !== '' ? `_{${lower}}` : ''}${upper !== '' ? `^{${upper}}` : ''}`
}

/** 模板自带的运算符号（如 ∫、∑） */
function symbolOf(t: MtTmpl): string | undefined {
  const c = t.items.find((n): n is MtChar => n.kind === 'char')
  if (c === undefined) return undefined
  return BIG_OPS[c.code]
}

const BIG_OPS: Record<number, string> = {
  0x222b: '\\int',
  0x222c: '\\iint',
  0x222d: '\\iiint',
  0x222e: '\\oint',
  0x2211: '\\sum',
  0x220f: '\\prod',
  0x2210: '\\coprod',
  0x22c3: '\\bigcup',
  0x22c2: '\\bigcap'
}

function fenceChar(c: MtChar | undefined): string {
  if (c === undefined) return '.'
  const ch = String.fromCharCode(c.code)
  return { '{': '\\{', '}': '\\}', '⟨': '\\langle ', '⟩': '\\rangle ', '〈': '\\langle ', '〉': '\\rangle ' }[ch] ?? ch
}

/** 单个字符（含修饰符：点、撇、横线、箭头等） */
function charToLatex(c: MtChar): string {
  let s = c.typeface === FN.VECTOR ? `\\boldsymbol{${baseChar(c)}}` : baseChar(c)
  for (const e of c.embells) s = embellish(s, e)
  return s
}

function baseChar(c: MtChar): string {
  const code = c.code
  // MT Extra 等私用区字符：常见的间距与符号
  if (code >= 0xe000 && code <= 0xf8ff) return PRIVATE[code] ?? ''
  const ch = String.fromCodePoint(code)
  if (c.typeface === FN.NUMBER || /[0-9]/.test(ch)) return ch
  return escapeLatexText(ch)
}

function embellish(s: string, e: number): string {
  switch (e) {
    case 2:
      return `\\dot{${s}}`
    case 3:
      return `\\ddot{${s}}`
    case 4:
      return `\\dddot{${s}}`
    case 5:
      return `${s}'`
    case 6:
      return `${s}''`
    case 7:
      return `{}'${s}`
    case 8:
      return `\\tilde{${s}}`
    case 9:
      return `\\hat{${s}}`
    case 10:
      return `\\not${s}`
    case 11:
      return `\\vec{${s}}`
    case 12:
      return `\\overleftarrow{${s}}`
    case 13:
      return `\\overleftrightarrow{${s}}`
    case 17:
      return `\\bar{${s}}`
    case 18:
      return `${s}'''`
    case 19:
      return `\\overset{\\frown}{${s}}`
    default:
      return s
  }
}

function textChar(code: number): string {
  const ch = String.fromCodePoint(code)
  return ch === '{' || ch === '}' ? `\\${ch}` : ch === '\\' ? '\\backslash ' : ch
}

function isCjk(code: number): boolean {
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef)
}

const PRIVATE: Record<number, string> = {
  0xef01: '\\,',
  0xef02: '\\;',
  0xef03: '\\quad ',
  0xef04: '\\,',
  0xef05: '',
  0xef08: '\\!',
  0xec0e: '\\to ',
  0xeb05: '\\cdots '
}

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'ln', 'lg', 'log', 'exp', 'lim', 'max', 'min', 'det'
])

/** 去掉多余空格；合并相邻的 \text{} */
function tidy(s: string): string {
  return s
    .replace(/\\text\{([^{}]*)\}\\text\{([^{}]*)\}/g, '\\text{$1$2}')
    .replace(/ +(?=[}^_)\]|,.;:!?=+\-*/&\\])/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}
