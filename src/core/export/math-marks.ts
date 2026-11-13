/**
 * 公式整体加粗、加下划线、设颜色：改写 OMML。
 * - 加粗：每个 <m:r> 的数学样式 m:sty 改为粗体（p→b，斜体或未指定→bi），同时设 w:b；
 * - 颜色：每个 <m:r> 的 w:rPr 中的 <w:color>；
 * - 下划线：整个公式放进 Word 公式的“下横线”结构（<m:bar>，位置在底部），在公式最下方画一条平直的线。
 *   不能给每个字符加 w:u——分式的分子、分母会各有一段高低不同的下划线。横线颜色随公式颜色（m:ctrlPr）。
 */
import { sortRunProps } from './heading-styles'

export function applyMathMarks(omml: string, marks: { bold?: boolean; underline?: boolean; color?: string }): string {
  if (marks.bold !== true && marks.underline !== true && marks.color === undefined) return omml
  let out = omml
  if (marks.bold === true || marks.color !== undefined) {
    out = out.replace(/<m:r>([\s\S]*?)<\/m:r>/g, (_whole, inner: string) => {
      let mrPr = /<m:rPr>([\s\S]*?)<\/m:rPr>/.exec(inner)?.[1]
      let wrPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(inner)?.[1] ?? ''
      const rest = inner.replace(/<m:rPr>[\s\S]*?<\/m:rPr>/, '').replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, '')
      if (marks.bold === true) {
        const sty = /<m:sty m:val="(\w+)"\/>/.exec(mrPr ?? '')?.[1]
        const bold = sty === 'p' || sty === 'b' ? 'b' : 'bi'
        mrPr = (mrPr ?? '').replace(/<m:sty\b[^>]*\/>/, '') + `<m:sty m:val="${bold}"/>`
        if (!/<w:b\/>/.test(wrPr)) wrPr += '<w:b/>'
      }
      if (marks.color !== undefined) wrPr = wrPr.replace(/<w:color\b[^>]*\/>/, '') + `<w:color w:val="${marks.color}"/>`
      const m = mrPr !== undefined && mrPr !== '' ? `<m:rPr>${mrPr}</m:rPr>` : ''
      const w = wrPr !== '' ? `<w:rPr>${sortRunProps(wrPr)}</w:rPr>` : ''
      return `<m:r>${m}${w}${rest}</m:r>`
    })
  }
  if (marks.underline === true) {
    const ctrl = `${marks.bold === true ? '<w:b/>' : ''}${marks.color !== undefined ? `<w:color w:val="${marks.color}"/>` : ''}`
    const barPr = `<m:barPr><m:pos m:val="bot"/>${ctrl !== '' ? `<m:ctrlPr><w:rPr>${ctrl}</w:rPr></m:ctrlPr>` : ''}</m:barPr>`
    out = out.replace(/^(<m:oMath\b[^>]*>)([\s\S]*)(<\/m:oMath>)$/, (_w, open: string, body: string, close: string) => `${open}<m:bar>${barPr}<m:e>${body}</m:e></m:bar>${close}`)
  }
  return out
}

/**
 * 公式中的字母改为正体（不倾斜）：每个 <m:r> 的数学样式 m:sty 设为 p（原为粗体 b / bi 的设为 b）。
 * Word 中公式字母默认是数学斜体，只能逐段标明正体。已是手写体、花体等（m:scr）的保持原样。
 * 用于“设置 → 公式中的字母用正体”（默认打开）。
 */
export function uprightOmml(omml: string): string {
  return omml.replace(/<m:r>([\s\S]*?)<\/m:r>/g, (whole, inner: string) => {
    const mrPrMatch = /<m:rPr>([\s\S]*?)<\/m:rPr>/.exec(inner)
    const mrPr = mrPrMatch?.[1] ?? ''
    if (/<m:scr\b/.test(mrPr) || /<m:nor\s*\/>/.test(mrPr)) return whole
    const sty = /<m:sty m:val="(\w+)"\/>/.exec(mrPr)?.[1]
    const upright = sty === 'b' || sty === 'bi' ? 'b' : 'p'
    if (sty === upright) return whole
    // m:rPr 中元素的顺序：lit、nor、scr、sty、brk、aln——sty 放在 brk、aln 之前
    const cleaned = mrPr.replace(/<m:sty\b[^>]*\/>/, '')
    const at = cleaned.search(/<m:(brk|aln)\b/)
    const next = at === -1 ? `${cleaned}<m:sty m:val="${upright}"/>` : `${cleaned.slice(0, at)}<m:sty m:val="${upright}"/>${cleaned.slice(at)}`
    const body = mrPrMatch !== null ? inner.replace(mrPrMatch[0], `<m:rPr>${next}</m:rPr>`) : `<m:rPr>${next}</m:rPr>${inner}`
    return `<m:r>${body}</m:r>`
  })
}
