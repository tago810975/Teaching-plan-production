/**
 * 墨案 HTML 中的 MathML 公式 → LaTeX。
 *
 * 墨案的公式大多写作 $…$，但从 Word 粘贴进去的题目（尤其是物理）里，公式是 <math> 元素：
 * 分数 <mfrac>、根式 <msqrt>、上标 <msup> 等。原来的转换不认识这些元素，只取出其中的文字，
 * 于是 π/2·I 变成“π2I”、√2 变成“2”、10⁻³ 变成“10−3”。这里把它们还原为 LaTeX 公式。
 *
 * 在 HtmlElement 树上工作（不依赖浏览器 DOM）。带 TeX 注释（<annotation encoding="application/x-tex">）时直接用注释。
 * 不认识的元素按其子元素继续转换，不会丢失文字；未知元素的名字记入 unknown，供诊断。
 */
import { escapeChar, fence, FUNCTIONS, NARY, textCmd, tidy } from '../../math/omml-to-latex'
import type { HtmlElement, HtmlNode } from './html'

export interface MathmlLatex {
  latex: string
  display: boolean
  /** 不认识的 MathML 元素（按文字转换了） */
  unknown: string[]
}

/** 去掉命名空间前缀：<m:mfrac> 与 <mfrac> 同样处理 */
export function localName(tag: string): string {
  const i = tag.indexOf(':')
  return i === -1 ? tag : tag.slice(i + 1)
}

export function mathmlToLatex(math: HtmlElement, decode: (s: string) => string = (s) => s): MathmlLatex {
  const unknown = new Set<string>()
  const ctx: Ctx = { decode, unknown }
  const display = math.attrs['display'] === 'block' || math.attrs['mode'] === 'display'
  return { latex: tidy(seq(math.children, ctx)), display, unknown: [...unknown] }
}

interface Ctx {
  decode: (s: string) => string
  unknown: Set<string>
}

const elements = (nodes: readonly HtmlNode[]): HtmlElement[] => nodes.filter((n): n is HtmlElement => n.kind === 'element')

function textOf(el: HtmlNode, ctx: Ctx): string {
  if (el.kind === 'text') return ctx.decode(el.text)
  return el.children.map((c) => textOf(c, ctx)).join('')
}

/** 一串兄弟元素：依次转换后拼接（命令名后紧跟字母时补空格） */
function seq(nodes: readonly HtmlNode[], ctx: Ctx): string {
  let out = ''
  for (const el of elements(nodes)) {
    const part = node(el, ctx)
    if (part === '') continue
    if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(part)) out += ' '
    out += part
  }
  return out
}

/** 作为分数、上下标等的一个参数：一个元素或 <mrow> */
function arg(el: HtmlElement | undefined, ctx: Ctx): string {
  return el === undefined ? '' : node(el, ctx)
}

/** 上下标的底数：多于一个字符时加花括号 */
function base(el: HtmlElement | undefined, ctx: Ctx): string {
  const s = arg(el, ctx)
  return s.length <= 1 || /^\\[A-Za-z]+ ?$/.test(s) ? s : `{${s}}`
}

function node(el: HtmlElement, ctx: Ctx): string {
  const name = localName(el.tag)
  const kids = elements(el.children)
  switch (name) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'merror':
    case 'mtd':
      return seq(el.children, ctx)
    case 'semantics': {
      // 带 TeX 注释时直接用注释
      const tex = kids.find((k) => localName(k.tag) === 'annotation' && /tex/i.test(k.attrs['encoding'] ?? ''))
      if (tex !== undefined) return textOf(tex, ctx).trim()
      return kids.length > 0 ? node(kids[0]!, ctx) : ''
    }
    case 'annotation':
    case 'annotation-xml':
    case 'none':
    case 'mprescripts':
    case 'malignmark':
    case 'maligngroup':
      return ''
    case 'mphantom':
      return `\\phantom{${seq(el.children, ctx)}}`
    case 'mi':
      return identifier(textOf(el, ctx).trim(), el.attrs['mathvariant'])
    case 'mn':
      return [...textOf(el, ctx).trim()].map(escapeChar).join('')
    case 'mo':
      return operator(textOf(el, ctx).trim())
    case 'mtext':
    case 'ms': {
      const t = textOf(el, ctx)
      return t.trim() === '' ? '\\ ' : textCmd(t)
    }
    case 'mspace':
      return '\\,'
    case 'mfrac': {
      const thin = el.attrs['linethickness'] === '0' || el.attrs['linethickness'] === '0px'
      return thin ? `\\genfrac{}{}{0pt}{}{${arg(kids[0], ctx)}}{${arg(kids[1], ctx)}}` : `\\frac{${arg(kids[0], ctx)}}{${arg(kids[1], ctx)}}`
    }
    case 'msqrt':
      return `\\sqrt{${seq(el.children, ctx)}}`
    case 'mroot':
      return `\\sqrt[${arg(kids[1], ctx)}]{${arg(kids[0], ctx)}}`
    case 'msup':
      return `${base(kids[0], ctx)}^{${arg(kids[1], ctx)}}`
    case 'msub':
      return `${base(kids[0], ctx)}_{${arg(kids[1], ctx)}}`
    case 'msubsup':
      return `${base(kids[0], ctx)}_{${arg(kids[1], ctx)}}^{${arg(kids[2], ctx)}}`
    case 'mmultiscripts': {
      // 只处理最常见的“底数 + 右侧上下标”
      const [b, sub, sup] = kids
      const s = arg(sub, ctx)
      const p = arg(sup, ctx)
      return base(b, ctx) + (s !== '' ? `_{${s}}` : '') + (p !== '' ? `^{${p}}` : '')
    }
    case 'munder':
      return under(kids[0], kids[1], ctx)
    case 'mover':
      return over(kids[0], kids[1], ctx)
    case 'munderover': {
      const b = textOf(kids[0] ?? el, ctx).trim()
      const big = NARY[b] ?? (b === 'lim' ? '\\lim' : undefined)
      if (big !== undefined) return `${big}_{${arg(kids[1], ctx)}}^{${arg(kids[2], ctx)}}`
      return over(undefined, kids[2], ctx, under(kids[0], kids[1], ctx))
    }
    case 'mfenced': {
      const open = el.attrs['open'] ?? '('
      const close = el.attrs['close'] ?? ')'
      const sep = (el.attrs['separators'] ?? ',').trim()
      const parts = kids.map((k) => node(k, ctx))
      const joined = parts.map((p, i) => (i === 0 ? p : (sep[Math.min(i - 1, sep.length - 1)] ?? '') + p)).join('')
      return `\\left${fence(open)}${joined}\\right${fence(close)}`
    }
    case 'menclose': {
      const inner = seq(el.children, ctx)
      const notation = el.attrs['notation'] ?? 'longdiv'
      if (/radical/.test(notation)) return `\\sqrt{${inner}}`
      if (/box|roundedbox/.test(notation)) return `\\boxed{${inner}}`
      if (/updiagonalstrike|downdiagonalstrike|horizontalstrike/.test(notation)) return `\\cancel{${inner}}`
      return inner
    }
    case 'mtable': {
      const rows = kids.filter((k) => /^m(labeled)?tr$/.test(localName(k.tag)))
      const body = rows.map((r) => elements(r.children).map((c) => node(c, ctx)).join(' & ')).join(' \\\\ ')
      return `\\begin{matrix}${body}\\end{matrix}`
    }
    case 'mtr':
    case 'mlabeledtr':
      return kids.map((c) => node(c, ctx)).join(' & ')
    default:
      ctx.unknown.add(name)
      return kids.length > 0 ? seq(el.children, ctx) : textCmd(textOf(el, ctx).trim())
  }
}

/** 标识符：单个字母为斜体变量；函数名（sin、lg……）用命令；其他多字母、正体字母用 \mathrm */
function identifier(text: string, variant: string | undefined): string {
  if (text === '') return ''
  if (FUNCTIONS.has(text)) return `\\${text} `
  if (/^[A-Za-z]$/.test(text)) {
    if (variant === 'normal') return `\\mathrm{${text}}`
    if (variant === 'bold') return `\\mathbf{${text}}`
    if (variant === 'bold-italic') return `\\boldsymbol{${text}}`
    return text
  }
  if (/^[A-Za-z]+$/.test(text)) return variant === 'bold' ? `\\mathbf{${text}}` : `\\mathrm{${text}}`
  if (/[\u4e00-\u9fff]/.test(text)) return textCmd(text)
  return [...text].map(escapeChar).join('')
}

function operator(text: string): string {
  if (text === '') return ''
  if (text === '\u2061' || text === '\u2062' || text === '\u2063') return '' // 不可见的函数作用、乘号、分隔符
  if (FUNCTIONS.has(text)) return `\\${text} `
  if (/[\u4e00-\u9fff]/.test(text)) return textCmd(text)
  if (text === '{' || text === '}') return `\\${text}`
  return [...text].map(escapeChar).join('')
}

const OVER_ACCENTS: Record<string, string> = {
  '→': '\\overrightarrow',
  '⟶': '\\overrightarrow',
  '\u20D7': '\\vec',
  '←': '\\overleftarrow',
  '↔': '\\overleftrightarrow',
  '¯': '\\overline',
  '‾': '\\overline',
  '\u0305': '\\overline',
  '^': '\\hat',
  'ˆ': '\\hat',
  '\u0302': '\\hat',
  '~': '\\tilde',
  '˜': '\\tilde',
  '\u0303': '\\tilde',
  '˙': '\\dot',
  '\u0307': '\\dot',
  '¨': '\\ddot',
  '\u0308': '\\ddot',
  '⌢': '\\overarc',
  '⏜': '\\overarc'
}

function over(b: HtmlElement | undefined, o: HtmlElement | undefined, ctx: Ctx, baseLatex?: string): string {
  const inner = baseLatex ?? arg(b, ctx)
  const mark = o === undefined ? '' : textOf(o, ctx).trim()
  const accent = OVER_ACCENTS[mark]
  // 圆弧：KaTeX 没有 \overarc，用 \overgroup
  if (accent === '\\overarc') return `\\overgroup{${inner}}`
  if (accent !== undefined) return `${accent}{${inner}}`
  return `\\overset{${arg(o, ctx)}}{${inner}}`
}

function under(b: HtmlElement | undefined, u: HtmlElement | undefined, ctx: Ctx): string {
  const bt = b === undefined ? '' : textOf(b, ctx).trim()
  const big = NARY[bt] ?? (bt === 'lim' || bt === 'max' || bt === 'min' ? `\\${bt}` : undefined)
  if (big !== undefined) return `${big}_{${arg(u, ctx)}}`
  const mark = u === undefined ? '' : textOf(u, ctx).trim()
  if (mark === '_' || mark === '¯' || mark === '‾' || mark === '\u0332') return `\\underline{${arg(b, ctx)}}`
  return `\\underset{${arg(u, ctx)}}{${arg(b, ctx)}}`
}
