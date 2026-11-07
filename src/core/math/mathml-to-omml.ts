/**
 * MathML → OMML，用于导出 Word：软件中新建或修改过的公式（LaTeX）先由 temml 转为 MathML，
 * 再转为 Word 原生公式，老师在 Word 中仍可直接编辑。
 *
 * 覆盖 temml 输出的常用结构：分数、上下标、根式、重音、括号、大型运算符、矩阵、文字。
 * 不认识的元素按其子元素继续转换，不会丢失文字。
 */
import temml from 'temml'
import { children, escapeXml, parseXml, type Element } from '../xml/dom'

const MML = 'http://www.w3.org/1998/Math/MathML'
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

/** 大型运算符：其后紧跟的内容作为运算对象 */
const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋃', '⋂', '⋁', '⋀'])

/** LaTeX → OMML（<m:oMath> 元素的 XML，带命名空间声明） */
export function latexToOmml(latex: string): string {
  const mathml = temml.renderToString(latex, { throwOnError: true })
  return mathmlToOmml(mathml)
}

export function mathmlToOmml(mathml: string): string {
  const root = parseXml(mathml).documentElement as Element
  return `<m:oMath xmlns:m="${M_NS}">${seq(children(root))}</m:oMath>`
}

/** 转换一串兄弟元素；大型运算符会吞掉其后的一个元素作为运算对象 */
function seq(els: Element[]): string {
  let out = ''
  for (let i = 0; i < els.length; i++) {
    const el = els[i]!
    const nary = naryParts(el)
    if (nary !== null) {
      const operand = els[i + 1]
      if (operand !== undefined) i += 1
      out += naryXml(nary, operand === undefined ? '' : node(operand))
      continue
    }
    // \left( … \right) 生成的成对括号 → m:d
    if (isFence(el)) {
      const close = findClosingFence(els, i)
      if (close !== -1) {
        out += delimiter(text(el), text(els[close]!), seq(els.slice(i + 1, close)))
        i = close
        continue
      }
    }
    out += node(el)
  }
  return out
}

function node(el: Element): string {
  if (el.namespaceURI !== MML && el.namespaceURI !== null) return ''
  const kids = children(el)
  const arg = (k: Element | undefined): string => (k === undefined ? '' : node(k))
  switch (el.localName) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'semantics':
      return seq(kids.filter((k) => k.localName !== 'annotation' && k.localName !== 'annotation-xml'))
    case 'mphantom':
      return `<m:phant><m:e>${seq(kids)}</m:e></m:phant>`
    case 'mi': {
      const t = text(el)
      const normal = el.getAttribute('mathvariant') === 'normal' || [...t].length > 1
      return run(t, normal ? 'p' : undefined)
    }
    case 'mn':
      return run(text(el))
    case 'mo':
      return run(text(el))
    case 'mtext':
      return run(el.textContent ?? '', 'p', true)
    case 'ms':
      return run(`"${text(el)}"`, 'p', true)
    case 'mspace':
      return run(' ')
    case 'mfrac': {
      const noBar = el.getAttribute('linethickness') === '0' || el.getAttribute('linethickness') === '0px'
      const pr = noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''
      return `<m:f>${pr}<m:num>${arg(kids[0])}</m:num><m:den>${arg(kids[1])}</m:den></m:f>`
    }
    case 'msub':
      return `<m:sSub><m:e>${arg(kids[0])}</m:e><m:sub>${arg(kids[1])}</m:sub></m:sSub>`
    case 'msup':
      return `<m:sSup><m:e>${arg(kids[0])}</m:e><m:sup>${arg(kids[1])}</m:sup></m:sSup>`
    case 'msubsup':
      return `<m:sSubSup><m:e>${arg(kids[0])}</m:e><m:sub>${arg(kids[1])}</m:sub><m:sup>${arg(kids[2])}</m:sup></m:sSubSup>`
    case 'msqrt':
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${seq(kids)}</m:e></m:rad>`
    case 'mroot':
      return `<m:rad><m:deg>${arg(kids[1])}</m:deg><m:e>${arg(kids[0])}</m:e></m:rad>`
    case 'mover': {
      const accent = kids[1] !== undefined && (el.getAttribute('accent') === 'true' || kids[1].localName === 'mo')
      if (accent && [...text(kids[1]!)].length === 1) {
        return `<m:acc><m:accPr><m:chr m:val="${escapeXml(accentChar(text(kids[1]!)))}"/></m:accPr><m:e>${arg(kids[0])}</m:e></m:acc>`
      }
      return `<m:limUpp><m:e>${arg(kids[0])}</m:e><m:lim>${arg(kids[1])}</m:lim></m:limUpp>`
    }
    case 'munder':
      return `<m:limLow><m:e>${arg(kids[0])}</m:e><m:lim>${arg(kids[1])}</m:lim></m:limLow>`
    case 'munderover':
      return `<m:limUpp><m:e><m:limLow><m:e>${arg(kids[0])}</m:e><m:lim>${arg(kids[1])}</m:lim></m:limLow></m:e><m:lim>${arg(kids[2])}</m:lim></m:limUpp>`
    case 'mtable': {
      const rows = kids.filter((k) => k.localName === 'mtr' || k.localName === 'mlabeledtr')
      const cols = Math.max(1, ...rows.map((r) => children(r).length))
      const mrs = rows
        .map((r) => `<m:mr>${children(r).map((td) => `<m:e>${seq(children(td))}</m:e>`).join('')}</m:mr>`)
        .join('')
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${mrs}</m:m>`
    }
    case 'menclose':
      return `<m:borderBox><m:e>${seq(kids)}</m:e></m:borderBox>`
    default:
      return seq(kids)
  }
}

interface NaryParts {
  chr: string
  sub: string
  sup: string
  limLoc: 'undOvr' | 'subSup'
}

/** 识别 ∑、∫ 等大型运算符（可带上下限） */
function naryParts(el: Element): NaryParts | null {
  const kids = children(el)
  const isOp = (e: Element | undefined): boolean => e?.localName === 'mo' && NARY.has(text(e))
  switch (el.localName) {
    case 'mo':
      return NARY.has(text(el)) ? { chr: text(el), sub: '', sup: '', limLoc: 'subSup' } : null
    case 'munderover':
    case 'msubsup':
      if (!isOp(kids[0])) return null
      return {
        chr: text(kids[0]!),
        sub: kids[1] === undefined ? '' : node(kids[1]),
        sup: kids[2] === undefined ? '' : node(kids[2]),
        limLoc: el.localName === 'munderover' ? 'undOvr' : 'subSup'
      }
    case 'munder':
    case 'msub':
      if (!isOp(kids[0])) return null
      return { chr: text(kids[0]!), sub: kids[1] === undefined ? '' : node(kids[1]), sup: '', limLoc: el.localName === 'munder' ? 'undOvr' : 'subSup' }
    default:
      return null
  }
}

function naryXml(p: NaryParts, operand: string): string {
  const hide = (p.sub === '' ? '<m:subHide m:val="1"/>' : '') + (p.sup === '' ? '<m:supHide m:val="1"/>' : '')
  return (
    `<m:nary><m:naryPr><m:chr m:val="${escapeXml(p.chr)}"/><m:limLoc m:val="${p.limLoc}"/>${hide}</m:naryPr>` +
    `<m:sub>${p.sub}</m:sub><m:sup>${p.sup}</m:sup><m:e>${operand}</m:e></m:nary>`
  )
}

function isFence(el: Element): boolean {
  return el.localName === 'mo' && el.getAttribute('fence') === 'true'
}

function findClosingFence(els: Element[], open: number): number {
  let depth = 0
  for (let i = open + 1; i < els.length; i++) {
    if (!isFence(els[i]!)) continue
    if (/[([{⟨|‖⌊⌈]/.test(text(els[i]!)) && i !== els.length - 1 && depth >= 0 && isOpening(els[i]!)) depth += 1
    else if (depth === 0) return i
    else depth -= 1
  }
  return -1
}

function isOpening(el: Element): boolean {
  return el.getAttribute('form') === 'prefix' || /^[([{⟨⌊⌈]$/.test(text(el))
}

function delimiter(beg: string, end: string, inner: string): string {
  return `<m:d><m:dPr><m:begChr m:val="${escapeXml(beg)}"/><m:endChr m:val="${escapeXml(end)}"/></m:dPr><m:e>${inner}</m:e></m:d>`
}

/** 公式中的一段文字。sty="p" 为正体；nor 表示普通文本（中文说明文字） */
function run(t: string, sty?: 'p', normalText = false): string {
  if (t === '') return ''
  const rPr = normalText ? '<m:rPr><m:nor/></m:rPr>' : sty !== undefined ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ''
  return `<m:r>${rPr}<m:t xml:space="preserve">${escapeXml(t)}</m:t></m:r>`
}

/** 显示用的重音字符 → Word 使用的组合字符 */
function accentChar(c: string): string {
  const map: Record<string, string> = {
    '→': '\u20D7',
    '⃗': '\u20D7',
    '^': '\u0302',
    'ˆ': '\u0302',
    '~': '\u0303',
    '˜': '\u0303',
    '¯': '\u0305',
    '‾': '\u0305',
    '˙': '\u0307',
    '¨': '\u0308',
    'ˇ': '\u030C',
    '˘': '\u0306'
  }
  return map[c] ?? c
}

function text(el: Element): string {
  return (el.textContent ?? '').replace(/\u2061/g, '').trim()
}
