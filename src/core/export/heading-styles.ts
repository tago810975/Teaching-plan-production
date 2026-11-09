/**
 * 把格式预设中的标题格式（大标题、二级标题、三级标题）写进模板 styles.xml 的同名样式，
 * 使导出的 Word 与预览一致，而且在 Word 中修改这些样式时仍保持样式关联。
 *
 * 改动：段前段后间距、对齐、中文字体、字号、加粗、颜色。其余属性（行距、大纲级别、西文字体等）保持模板原样。
 * 写入后按 ECMA-376 规定的顺序排列 pPr / rPr 的子元素，避免 Word 报错。
 */
import { WORD_FONT_NAMES } from '../document/fonts'
import type { ParagraphStyleSpec, StyleKey } from '../document/styles'

const HEADINGS = ['title', 'section', 'topic'] as const

const PPR_ORDER = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd',
  'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi',
  'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
  'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'
]
const RPR_ORDER = [
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint',
  'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u',
  'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'
]

export function applyHeadingStyles(stylesXml: string, styles: Readonly<Record<StyleKey, ParagraphStyleSpec>>): string {
  let xml = stylesXml
  for (const key of HEADINGS) {
    const spec = styles[key]
    xml = xml.replace(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g, (el) => (el.includes(`<w:name w:val="${spec.wordStyleName}"/>`) ? patchStyle(el, spec) : el))
  }
  return xml
}

function patchStyle(el: string, spec: ParagraphStyleSpec): string {
  // ---- 段落属性 ----
  el = ensure(el, 'pPr', ['rPr'])
  el = el.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (_m, inner: string) => {
    const kids = children(inner).filter((k) => k.name !== 'jc')
    const sp = kids.find((k) => k.name === 'spacing')
    const keep = sp === undefined ? '' : sp.xml.replace(/^<w:spacing|\/>$/g, '').replace(/\s*w:(before|after|beforeLines|afterLines|beforeAutospacing|afterAutospacing)="[^"]*"/g, '')
    const spacing = `<w:spacing w:before="${spec.spaceBeforeTwip}" w:after="${spec.spaceAfterTwip}"${keep}/>`
    const next = kids.filter((k) => k.name !== 'spacing').concat({ name: 'spacing', xml: spacing }, { name: 'jc', xml: `<w:jc w:val="${spec.align === 'both' ? 'both' : spec.align}"/>` })
    return `<w:pPr>${sorted(next, PPR_ORDER)}</w:pPr>`
  })
  // ---- 文字属性 ----
  el = ensure(el, 'rPr', [])
  el = el.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>(?![\s\S]*<w:rPr>)/, (_m, inner: string) => {
    const kids = children(inner).filter((k) => !['b', 'bCs', 'color', 'sz', 'szCs'].includes(k.name))
    const font = WORD_FONT_NAMES[spec.fontRole]
    const rf = kids.find((k) => k.name === 'rFonts')
    const rFonts =
      rf === undefined
        ? `<w:rFonts w:eastAsia="${font}"/>`
        : rf.xml.replace(/\s*w:eastAsia(Theme)?="[^"]*"/g, '').replace(/^<w:rFonts/, `<w:rFonts w:eastAsia="${font}"`)
    const next = kids.filter((k) => k.name !== 'rFonts').concat({ name: 'rFonts', xml: rFonts })
    if (spec.bold === true) next.push({ name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' })
    if (spec.color !== undefined) next.push({ name: 'color', xml: `<w:color w:val="${spec.color}"/>` })
    next.push({ name: 'sz', xml: `<w:sz w:val="${spec.sizeHalfPt}"/>` }, { name: 'szCs', xml: `<w:szCs w:val="${spec.sizeHalfPt}"/>` })
    return `<w:rPr>${sorted(next, RPR_ORDER)}</w:rPr>`
  })
  return el
}

/** 样式中没有该属性块时补上（pPr 放在 rPr 之前，rPr 放在末尾） */
function ensure(el: string, name: 'pPr' | 'rPr', before: string[]): string {
  if (new RegExp(`<w:${name}>`).test(el)) return el
  for (const b of before) {
    const i = el.indexOf(`<w:${b}>`)
    if (i >= 0) return `${el.slice(0, i)}<w:${name}></w:${name}>${el.slice(i)}`
  }
  return el.replace('</w:style>', `<w:${name}></w:${name}></w:style>`)
}

interface Kid {
  name: string
  xml: string
}

/** 拆出直接子元素（自闭合或成对） */
function children(inner: string): Kid[] {
  const out: Kid[] = []
  const re = /<w:(\w+)\b[^>]*?\/>|<w:(\w+)\b[^>]*>[\s\S]*?<\/w:\2>/g
  for (const m of inner.matchAll(re)) out.push({ name: m[1] ?? m[2]!, xml: m[0] })
  return out
}

/** 文字属性（rPr 的内容）按规范顺序排列；可先追加元素再调用 */
export function sortRunProps(inner: string): string {
  return sorted(children(inner), RPR_ORDER)
}

function sorted(kids: Kid[], order: string[]): string {
  const rank = (n: string): number => {
    const i = order.indexOf(n)
    return i === -1 ? order.length : i
  }
  return kids
    .map((k, i) => ({ k, i }))
    .sort((a, b) => rank(a.k.name) - rank(b.k.name) || a.i - b.i)
    .map((x) => x.k.xml)
    .join('')
}
