/**
 * 公式整体加粗、加下划线：改写 OMML 中每个 <m:r>。
 * - 加粗：数学样式 m:sty 改为粗体（p→b，斜体或未指定→bi），同时设 w:b；
 * - 下划线：w:rPr 中加 <w:u w:val="single"/>；
 * - 颜色：w:rPr 中的 <w:color>。
 */
import { sortRunProps } from './heading-styles'

export function applyMathMarks(omml: string, marks: { bold?: boolean; underline?: boolean; color?: string }): string {
  if (marks.bold !== true && marks.underline !== true && marks.color === undefined) return omml
  return omml.replace(/<m:r>([\s\S]*?)<\/m:r>/g, (_whole, inner: string) => {
    let mrPr = /<m:rPr>([\s\S]*?)<\/m:rPr>/.exec(inner)?.[1]
    let wrPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(inner)?.[1] ?? ''
    const rest = inner.replace(/<m:rPr>[\s\S]*?<\/m:rPr>/, '').replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, '')
    if (marks.bold === true) {
      const sty = /<m:sty m:val="(\w+)"\/>/.exec(mrPr ?? '')?.[1]
      const bold = sty === 'p' || sty === 'b' ? 'b' : 'bi'
      mrPr = (mrPr ?? '').replace(/<m:sty\b[^>]*\/>/, '') + `<m:sty m:val="${bold}"/>`
      if (!/<w:b\/>/.test(wrPr)) wrPr += '<w:b/>'
    }
    if (marks.underline === true && !/<w:u\b/.test(wrPr)) wrPr += '<w:u w:val="single"/>'
    if (marks.color !== undefined) wrPr = wrPr.replace(/<w:color\b[^>]*\/>/, '') + `<w:color w:val="${marks.color}"/>`
    const m = mrPr !== undefined && mrPr !== '' ? `<m:rPr>${mrPr}</m:rPr>` : ''
    const w = wrPr !== '' ? `<w:rPr>${sortRunProps(wrPr)}</w:rPr>` : ''
    return `<m:r>${m}${w}${rest}</m:r>`
  })
}
