/**
 * OMML（Word 原生公式）→ MathML，供预览中由浏览器原生渲染。
 *
 * 覆盖 Word 公式编辑器的常用结构：分数、上下标、根式、重音、括号、上下划线、
 * 大型运算符（求和、积分）、函数名、上下极限、矩阵、方程组、组合字符。
 * 遇到不认识的结构时，退化为显示其中的文字，并记入 unknown，不会抛出异常。
 */
import { attr, child, children, NS, parseXml, type Element } from '../xml/dom'

const M = NS.m

export interface MathmlResult {
  mathml: string
  /** 未能识别的 OMML 元素名，供导入报告与测试使用 */
  unknown: string[]
}

/** 输入为 <m:oMath> 元素的 XML（需带 m 命名空间声明） */
export function ommlToMathml(omml: string, display = false): MathmlResult {
  const doc = parseXml(omml)
  const root = doc.documentElement
  if (root === null) return { mathml: '<math></math>', unknown: ['(无法解析)'] }
  return ommlElementToMathml(root as Element, display)
}

export function ommlElementToMathml(oMath: Element, display = false): MathmlResult {
  const ctx: Ctx = { unknown: new Set() }
  const body = convertChildren(oMath, ctx)
  const attrs = display ? ' display="block"' : ''
  return { mathml: `<math${attrs}><mrow>${body}</mrow></math>`, unknown: [...ctx.unknown] }
}

interface Ctx {
  unknown: Set<string>
}

/** 转换一个容器（m:e、m:num 等）的全部子元素 */
function convertChildren(el: Element | undefined, ctx: Ctx): string {
  if (el === undefined) return ''
  return children(el)
    .map((c) => convert(c, ctx))
    .join('')
}

/** 容器内容包成一个 mrow，作为 mfrac / msub 等的参数 */
function arg(el: Element | undefined, ctx: Ctx): string {
  return `<mrow>${convertChildren(el, ctx)}</mrow>`
}

function prop(el: Element, prName: string, name: string): string | undefined {
  return attr(child(el, M, prName) && child(child(el, M, prName)!, M, name), M, 'val')
}

/** 属性是否开启：<m:degHide/> 或 <m:degHide m:val="1"/> */
function flag(el: Element, prName: string, name: string): boolean {
  const pr = child(el, M, prName)
  const f = pr && child(pr, M, name)
  if (f === undefined) return false
  const v = attr(f, M, 'val')
  return v === undefined || v === '1' || v === 'on' || v === 'true'
}

function convert(el: Element, ctx: Ctx): string {
  if (el.namespaceURI !== M) {
    // Word 的 w:r 等出现在公式中时，只取文字
    return el.localName === 'r' ? mtext(textOf(el)) : ''
  }
  switch (el.localName) {
    // ---- 属性节点，忽略 ----
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

    // ---- 容器 ----
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
    case 'borderBox':
      return `<mrow>${convertChildren(el, ctx)}</mrow>`
    case 'oMathPara':
      return children(el, M, 'oMath')
        .map((m) => `<mrow>${convertChildren(m, ctx)}</mrow>`)
        .join('<mspace linebreak="newline"/>')

    case 'r':
      return run(el)

    case 'f': {
      const type = prop(el, 'fPr', 'type')
      const num = arg(child(el, M, 'num'), ctx)
      const den = arg(child(el, M, 'den'), ctx)
      if (type === 'lin') return `<mrow>${num}<mo>/</mo>${den}</mrow>`
      if (type === 'noBar') return `<mfrac linethickness="0">${num}${den}</mfrac>`
      return `<mfrac>${num}${den}</mfrac>`
    }

    case 'sSub':
      return `<msub>${arg(child(el, M, 'e'), ctx)}${arg(child(el, M, 'sub'), ctx)}</msub>`
    case 'sSup':
      return `<msup>${arg(child(el, M, 'e'), ctx)}${arg(child(el, M, 'sup'), ctx)}</msup>`
    case 'sSubSup':
      return `<msubsup>${arg(child(el, M, 'e'), ctx)}${arg(child(el, M, 'sub'), ctx)}${arg(child(el, M, 'sup'), ctx)}</msubsup>`
    case 'sPre':
      return `<mmultiscripts>${arg(child(el, M, 'e'), ctx)}<mprescripts/>${arg(child(el, M, 'sub'), ctx)}${arg(child(el, M, 'sup'), ctx)}</mmultiscripts>`

    case 'rad': {
      const base = arg(child(el, M, 'e'), ctx)
      const deg = child(el, M, 'deg')
      const hasDeg = !flag(el, 'radPr', 'degHide') && deg !== undefined && children(deg).length > 0
      return hasDeg ? `<mroot>${base}${arg(deg, ctx)}</mroot>` : `<msqrt>${base}</msqrt>`
    }

    case 'acc': {
      const chr = prop(el, 'accPr', 'chr') ?? '\u0302'
      return `<mover accent="true">${arg(child(el, M, 'e'), ctx)}<mo>${esc(accentChar(chr))}</mo></mover>`
    }

    case 'bar': {
      const pos = prop(el, 'barPr', 'pos') ?? 'bot'
      const base = arg(child(el, M, 'e'), ctx)
      return pos === 'top'
        ? `<mover accent="true">${base}<mo>¯</mo></mover>`
        : `<munder accentunder="true">${base}<mo>_</mo></munder>`
    }

    case 'groupChr': {
      const chr = prop(el, 'groupChrPr', 'chr') ?? '\u23DF'
      const pos = prop(el, 'groupChrPr', 'pos') ?? 'bot'
      const base = arg(child(el, M, 'e'), ctx)
      return pos === 'top' ? `<mover>${base}<mo>${esc(chr)}</mo></mover>` : `<munder>${base}<mo>${esc(chr)}</mo></munder>`
    }

    case 'd': {
      const beg = prop(el, 'dPr', 'begChr') ?? '('
      const end = prop(el, 'dPr', 'endChr') ?? ')'
      const sep = prop(el, 'dPr', 'sepChr') ?? '|'
      const parts = children(el, M, 'e').map((e) => arg(e, ctx))
      const inner = parts.join(`<mo>${esc(sep)}</mo>`)
      const open = beg === '' ? '' : `<mo fence="true">${esc(beg)}</mo>`
      const close = end === '' ? '' : `<mo fence="true">${esc(end)}</mo>`
      return `<mrow>${open}${inner}${close}</mrow>`
    }

    case 'nary': {
      const chr = prop(el, 'naryPr', 'chr') ?? '∫'
      const limLoc = prop(el, 'naryPr', 'limLoc') ?? (chr === '∫' ? 'subSup' : 'undOvr')
      const sub = flag(el, 'naryPr', 'subHide') ? '' : convertChildren(child(el, M, 'sub'), ctx)
      const sup = flag(el, 'naryPr', 'supHide') ? '' : convertChildren(child(el, M, 'sup'), ctx)
      const op = `<mo largeop="true">${esc(chr)}</mo>`
      const s = `<mrow>${sub}</mrow>`
      const t = `<mrow>${sup}</mrow>`
      const operator =
        sub === '' && sup === ''
          ? op
          : limLoc === 'undOvr'
            ? `<munderover>${op}${s}${t}</munderover>`
            : `<msubsup>${op}${s}${t}</msubsup>`
      return `<mrow>${operator}${arg(child(el, M, 'e'), ctx)}</mrow>`
    }

    case 'func':
      return `<mrow>${funcName(child(el, M, 'fName'), ctx)}<mo>&#x2061;</mo>${arg(child(el, M, 'e'), ctx)}</mrow>`

    case 'limLow':
      return `<munder>${arg(child(el, M, 'e'), ctx)}${arg(child(el, M, 'lim'), ctx)}</munder>`
    case 'limUpp':
      return `<mover>${arg(child(el, M, 'e'), ctx)}${arg(child(el, M, 'lim'), ctx)}</mover>`

    case 'm': {
      const rows = children(el, M, 'mr').map(
        (mr) => `<mtr>${children(mr, M, 'e').map((e) => `<mtd>${arg(e, ctx)}</mtd>`).join('')}</mtr>`
      )
      return `<mtable>${rows.join('')}</mtable>`
    }

    case 'eqArr': {
      const rows = children(el, M, 'e').map((e) => `<mtr><mtd columnalign="left">${arg(e, ctx)}</mtd></mtr>`)
      return `<mtable columnalign="left">${rows.join('')}</mtable>`
    }

    case 'phant':
      return flag(el, 'phantPr', 'show') ? arg(child(el, M, 'e'), ctx) : `<mphantom>${arg(child(el, M, 'e'), ctx)}</mphantom>`

    default:
      ctx.unknown.add(el.localName ?? '?')
      return mtext(textOf(el))
  }
}

/** 函数名（sin、cos、lg 等）一律正体 */
function funcName(el: Element | undefined, ctx: Ctx): string {
  if (el === undefined) return ''
  const text = textOf(el)
  if (/^[A-Za-z]+$/.test(text)) return `<mi mathvariant="normal">${esc(text)}</mi>`
  return arg(el, ctx)
}

/**
 * 公式中的一段文字 <m:r>。按字符类别拆成 mi / mn / mo / mtext：
 * - m:nor（普通文本）或中文 → mtext
 * - m:sty="p"（正体）→ 字母用 mathvariant="normal"
 */
function run(r: Element): string {
  const text = textOf(r)
  if (text === '') return ''
  const rPr = child(r, M, 'rPr')
  const normalText = rPr !== undefined && child(rPr, M, 'nor') !== undefined && attr(child(rPr, M, 'nor'), M, 'val') !== '0'
  const sty = attr(rPr && child(rPr, M, 'sty'), M, 'val')
  if (normalText) return mtext(text)

  let out = ''
  const re = /(\d+(?:\.\d+)?)|([A-Za-z\u0370-\u03FF])|([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+)|(\s+)|(.)/gu
  for (const m of text.matchAll(re)) {
    const [, num, letter, cjk, space, other] = m
    if (num !== undefined) out += `<mn>${num}</mn>`
    else if (letter !== undefined) {
      const variant = sty === 'p' ? ' mathvariant="normal"' : sty === 'b' ? ' mathvariant="bold"' : sty === 'bi' ? ' mathvariant="bold-italic"' : ''
      out += `<mi${variant}>${esc(letter)}</mi>`
    } else if (cjk !== undefined) out += mtext(cjk)
    else if (space !== undefined) out += '<mspace width="0.25em"/>'
    else if (other !== undefined) out += `<mo>${esc(other)}</mo>`
  }
  return out
}

/** 组合用重音符（如 U+20D7 矢量箭头）显示时换成对应的独立字符 */
function accentChar(chr: string): string {
  const map: Record<string, string> = {
    '\u20D7': '→',
    '\u0302': '^',
    '\u0303': '~',
    '\u0304': '¯',
    '\u0305': '¯',
    '\u0307': '˙',
    '\u0308': '¨',
    '\u030C': 'ˇ',
    '\u0306': '˘',
    '\u20D6': '←',
    '\u20E1': '↔'
  }
  return map[chr] ?? chr
}

function textOf(el: Element): string {
  let s = ''
  for (const t of Array.from(el.getElementsByTagNameNS(M, 't'))) s += t.textContent ?? ''
  // Word 公式中可能混入 w:t
  for (const t of Array.from(el.getElementsByTagNameNS(NS.w, 't'))) s += t.textContent ?? ''
  return s
}

function mtext(s: string): string {
  return s === '' ? '' : `<mtext>${esc(s)}</mtext>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
