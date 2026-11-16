/**
 * OMML（Word 公式）→ LaTeX，用于在公式编辑器中打开从 Word 导入的公式。
 *
 * 覆盖与 omml-to-mathml.ts 相同的结构。输出面向 MathLive 与 temml 都能解析的常用 LaTeX。
 */
import { attr, child, children, NS, parseXml, type Element } from '../xml/dom'

const M = NS.m

export interface LatexResult {
  latex: string
  /** 未能识别的 OMML 元素名 */
  unknown: string[]
}

export function ommlToLatex(omml: string): LatexResult {
  const root = parseXml(omml).documentElement as Element | null
  if (root === null) return { latex: '', unknown: ['(无法解析)'] }
  const ctx: Ctx = { unknown: new Set() }
  const latex = tidy(seq(root, ctx))
  return { latex, unknown: [...ctx.unknown] }
}

interface Ctx {
  unknown: Set<string>
}

/** 转换容器的全部子元素 */
function seq(el: Element | undefined, ctx: Ctx): string {
  if (el === undefined) return ''
  return children(el)
    .map((c) => node(c, ctx))
    .join('')
}

/** 作为参数时加花括号；单个记号可以不加，但统一加上最稳妥 */
function group(el: Element | undefined, ctx: Ctx): string {
  return `{${seq(el, ctx)}}`
}

/** 上标：其中的度数符号不再嵌套一层上标 */
function supGroup(el: Element | undefined, ctx: Ctx): string {
  return `{${seq(el, ctx).replace(/\^\{\\circ\}/g, '\\circ ')}}`
}

/** 上下标的底数：单个字母、数字或命令时不加括号，读起来更自然 */
function base(el: Element | undefined, ctx: Ctx): string {
  const s = seq(el, ctx)
  return /^(\\[A-Za-z]+|[A-Za-z0-9]|\\left.*\\right.)$/.test(s) ? s : `{${s}}`
}

function prop(el: Element, prName: string, name: string): string | undefined {
  const pr = child(el, M, prName)
  return attr(pr && child(pr, M, name), M, 'val')
}

function flag(el: Element, prName: string, name: string): boolean {
  const pr = child(el, M, prName)
  const f = pr && child(pr, M, name)
  if (f === undefined) return false
  const v = attr(f, M, 'val')
  return v === undefined || v === '1' || v === 'on' || v === 'true'
}

function node(el: Element, ctx: Ctx): string {
  if (el.namespaceURI !== M) return el.localName === 'r' ? textCmd(textOf(el)) : ''
  switch (el.localName) {
    case 'rPr':
    case 'ctrlPr':
    case 'oMathParaPr':
    case 'fPr':
    case 'sSubPr':
    case 'sSupPr':
    case 'sSubSupPr':
    case 'sPrePr':
    case 'radPr':
    case 'accPr':
    case 'dPr':
    case 'barPr':
    case 'naryPr':
    case 'funcPr':
    case 'limLowPr':
    case 'limUppPr':
    case 'mPr':
    case 'eqArrPr':
    case 'boxPr':
    case 'borderBoxPr':
    case 'groupChrPr':
    case 'phantPr':
    case 'argPr':
      return ''

    case 'oMath':
    case 'e':
    case 'num':
    case 'den':
    case 'sub':
    case 'sup':
    case 'deg':
    case 'lim':
    case 'fName':
    case 'box':
      return seq(el, ctx)
    case 'oMathPara':
      return children(el, M, 'oMath')
        .map((m) => seq(m, ctx))
        .join(' \\\\ ')

    case 'r':
      return run(el)

    case 'f': {
      const type = prop(el, 'fPr', 'type')
      const num = seq(child(el, M, 'num'), ctx)
      const den = seq(child(el, M, 'den'), ctx)
      if (type === 'lin') return `{${num}}/{${den}}`
      if (type === 'noBar') return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`
      return `\\frac{${num}}{${den}}`
    }

    case 'sSub':
      return `${base(child(el, M, 'e'), ctx)}_${group(child(el, M, 'sub'), ctx)}`
    case 'sSup':
      return `${base(child(el, M, 'e'), ctx)}^${supGroup(child(el, M, 'sup'), ctx)}`
    case 'sSubSup':
      return `${base(child(el, M, 'e'), ctx)}_${group(child(el, M, 'sub'), ctx)}^${supGroup(child(el, M, 'sup'), ctx)}`
    case 'sPre':
      return `{}_${group(child(el, M, 'sub'), ctx)}^${group(child(el, M, 'sup'), ctx)}${base(child(el, M, 'e'), ctx)}`

    case 'rad': {
      const deg = child(el, M, 'deg')
      const hasDeg = !flag(el, 'radPr', 'degHide') && deg !== undefined && children(deg).length > 0
      return hasDeg ? `\\sqrt[${seq(deg, ctx)}]${group(child(el, M, 'e'), ctx)}` : `\\sqrt${group(child(el, M, 'e'), ctx)}`
    }

    case 'acc': {
      const chr = prop(el, 'accPr', 'chr') ?? '\u0302'
      const cmd = ACCENTS[chr]
      const e = group(child(el, M, 'e'), ctx)
      return cmd !== undefined ? `${cmd}${e}` : `\\overset{${escapeChar(chr)}}${e}`
    }

    case 'bar':
      return `${(prop(el, 'barPr', 'pos') ?? 'bot') === 'top' ? '\\overline' : '\\underline'}${group(child(el, M, 'e'), ctx)}`

    case 'groupChr': {
      const pos = prop(el, 'groupChrPr', 'pos') ?? 'bot'
      return `${pos === 'top' ? '\\overbrace' : '\\underbrace'}${group(child(el, M, 'e'), ctx)}`
    }

    case 'd': {
      const beg = prop(el, 'dPr', 'begChr') ?? '('
      const end = prop(el, 'dPr', 'endChr') ?? ')'
      const sep = prop(el, 'dPr', 'sepChr') ?? '|'
      const inner = children(el, M, 'e')
        .map((e) => seq(e, ctx))
        .join(sep === '|' ? ' \\mid ' : escapeChar(sep))
      return `\\left${fence(beg)}${inner}\\right${fence(end)}`
    }

    case 'nary': {
      const chr = prop(el, 'naryPr', 'chr') ?? '∫'
      const cmd = NARY[chr] ?? escapeChar(chr)
      const sub = flag(el, 'naryPr', 'subHide') ? '' : seq(child(el, M, 'sub'), ctx)
      const sup = flag(el, 'naryPr', 'supHide') ? '' : seq(child(el, M, 'sup'), ctx)
      return `${cmd}${sub === '' ? '' : `_{${sub}}`}${sup === '' ? '' : `^{${sup}}`}${group(child(el, M, 'e'), ctx)}`
    }

    case 'func': {
      const name = textOf(child(el, M, 'fName') ?? el).trim()
      const fn = FUNCTIONS.has(name) ? `\\${name}` : `\\operatorname{${seq(child(el, M, 'fName'), ctx)}}`
      return `${fn}${group(child(el, M, 'e'), ctx)}`
    }

    case 'limLow': {
      const e = seq(child(el, M, 'e'), ctx)
      const lim = seq(child(el, M, 'lim'), ctx)
      if (/^(\\mathrm\{lim\}|lim|\\lim)$/.test(e)) return `\\lim_{${lim}}`
      return `\\underset{${lim}}{${e}}`
    }
    case 'limUpp':
      return `\\overset{${seq(child(el, M, 'lim'), ctx)}}{${seq(child(el, M, 'e'), ctx)}}`

    case 'm': {
      const rows = children(el, M, 'mr').map((mr) =>
        children(mr, M, 'e')
          .map((e) => seq(e, ctx))
          .join(' & ')
      )
      return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`
    }

    case 'eqArr': {
      const rows = children(el, M, 'e').map((e) => seq(e, ctx))
      return `\\begin{array}{l}${rows.join(' \\\\ ')}\\end{array}`
    }

    case 'borderBox':
      return `\\boxed${group(child(el, M, 'e'), ctx)}`

    case 'phant':
      return flag(el, 'phantPr', 'show') ? seq(child(el, M, 'e'), ctx) : `\\phantom${group(child(el, M, 'e'), ctx)}`

    default:
      ctx.unknown.add(el.localName ?? '?')
      return textCmd(textOf(el))
  }
}

/** 公式中的一段文字 */
function run(r: Element): string {
  const text = textOf(r)
  if (text === '') return ''
  const rPr = child(r, M, 'rPr')
  const nor = rPr && child(rPr, M, 'nor')
  if (nor !== undefined && attr(nor, M, 'val') !== '0') return textCmd(text)
  const sty = attr(rPr && child(rPr, M, 'sty'), M, 'val')

  let out = ''
  const re = /([A-Za-z]+)|([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+)|(\s+)|(.)/gu
  for (const m of text.matchAll(re)) {
    const [, letters, cjk, space, other] = m
    if (letters !== undefined) {
      // 函数名（sin、cos……）在 Word 中常写作正体文字
      if (sty === 'p' && FUNCTIONS.has(letters)) out += `\\${letters} `
      else if (sty === 'p') out += `\\mathrm{${letters}}`
      else if (sty === 'b') out += `\\mathbf{${letters}}`
      else if (sty === 'bi') out += `\\boldsymbol{${letters}}`
      else out += letters
    } else if (cjk !== undefined) out += textCmd(cjk)
    else if (space !== undefined) out += ''
    else if (other !== undefined) out += escapeChar(other)
  }
  return out
}

export function textCmd(s: string): string {
  return s === '' ? '' : `\\text{${s.replace(/[{}\\]/g, (c) => `\\${c === '\\' ? 'backslash ' : c}`)}}`
}

const SYMBOLS: Record<string, string> = {
  '{': '\\{',
  '}': '\\}',
  '\\': '\\backslash ',
  '#': '\\#',
  $: '\\$',
  '%': '\\%',
  '&': '\\&',
  _: '\\_',
  '^': '\\hat{}',
  '~': '\\sim ',
  '×': '\\times ',
  '÷': '\\div ',
  '±': '\\pm ',
  '∓': '\\mp ',
  '·': '\\cdot ',
  '⋅': '\\cdot ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '≠': '\\ne ',
  '≈': '\\approx ',
  '≡': '\\equiv ',
  '∝': '\\propto ',
  '∞': '\\infty ',
  '°': '^{\\circ}',
  '′': "'",
  '″': "''",
  '→': '\\rightarrow ',
  '←': '\\leftarrow ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '↑': '\\uparrow ',
  '↓': '\\downarrow ',
  '∠': '\\angle ',
  '⊥': '\\perp ',
  '∥': '\\parallel ',
  '△': '\\triangle ',
  '∴': '\\therefore ',
  '∵': '\\because ',
  '∈': '\\in ',
  '∉': '\\notin ',
  '⊂': '\\subset ',
  '⊆': '\\subseteq ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '∅': '\\varnothing ',
  '∂': '\\partial ',
  '∇': '\\nabla ',
  '…': '\\ldots ',
  '⋯': '\\cdots ',
  '−': '-',
  'α': '\\alpha ',
  'β': '\\beta ',
  'γ': '\\gamma ',
  'δ': '\\delta ',
  'ε': '\\varepsilon ',
  'ϵ': '\\epsilon ',
  'ζ': '\\zeta ',
  'η': '\\eta ',
  'θ': '\\theta ',
  'ϑ': '\\vartheta ',
  'ι': '\\iota ',
  'κ': '\\kappa ',
  'λ': '\\lambda ',
  'μ': '\\mu ',
  'ν': '\\nu ',
  'ξ': '\\xi ',
  'π': '\\pi ',
  'ρ': '\\rho ',
  'σ': '\\sigma ',
  'τ': '\\tau ',
  'υ': '\\upsilon ',
  'φ': '\\varphi ',
  'ϕ': '\\phi ',
  'χ': '\\chi ',
  'ψ': '\\psi ',
  'ω': '\\omega ',
  'Γ': '\\Gamma ',
  'Δ': '\\Delta ',
  'Θ': '\\Theta ',
  'Λ': '\\Lambda ',
  'Ξ': '\\Xi ',
  'Π': '\\Pi ',
  'Σ': '\\Sigma ',
  'Φ': '\\Phi ',
  'Ψ': '\\Psi ',
  'Ω': '\\Omega '
}

export function escapeChar(c: string): string {
  return SYMBOLS[c] ?? c
}

export const ACCENTS: Record<string, string> = {
  '\u20D7': '\\vec',
  '\u0302': '\\hat',
  '\u0303': '\\tilde',
  '\u0304': '\\bar',
  '\u0305': '\\overline',
  '\u0307': '\\dot',
  '\u0308': '\\ddot',
  '\u030C': '\\check',
  '\u0306': '\\breve',
  '\u20D6': '\\overleftarrow',
  '\u20E1': '\\overleftrightarrow',
  '→': '\\vec'
}

export const NARY: Record<string, string> = {
  '∑': '\\sum',
  '∏': '\\prod',
  '∐': '\\coprod',
  '∫': '\\int',
  '∬': '\\iint',
  '∭': '\\iiint',
  '∮': '\\oint',
  '⋃': '\\bigcup',
  '⋂': '\\bigcap'
}

export const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'ln', 'lg', 'log', 'exp', 'lim', 'max', 'min', 'det'
])

export function fence(c: string): string {
  if (c === '') return '.'
  const map: Record<string, string> = {
    '{': '\\{',
    '}': '\\}',
    '⟨': '\\langle ',
    '〈': '\\langle ',
    '⟩': '\\rangle ',
    '〉': '\\rangle ',
    '‖': '\\|',
    '⌊': '\\lfloor ',
    '⌋': '\\rfloor ',
    '⌈': '\\lceil ',
    '⌉': '\\rceil '
  }
  return map[c] ?? c
}

function textOf(el: Element): string {
  let s = ''
  for (const t of Array.from(el.getElementsByTagNameNS(M, 't'))) s += t.textContent ?? ''
  for (const t of Array.from(el.getElementsByTagNameNS(NS.w, 't'))) s += t.textContent ?? ''
  return s
}

/** 去掉命令后多余的空格（如“\times }”→“\times}”），保持输出整洁 */
export function tidy(s: string): string {
  return s.replace(/ +(?=[}^_)\]|,.;:!?=+\-*/&\\])/g, '').replace(/ {2,}/g, ' ').trim()
}
