import { readFileSync } from 'node:fs'
import temml from 'temml'
import { describe, expect, it } from 'vitest'
import { readDocx } from '@core/import/docx-reader'
import { latexToOmml } from '@core/math/mathml-to-omml'
import { ommlToLatex } from '@core/math/omml-to-latex'
import { ommlToMathml } from '@core/math/omml-to-mathml'
import { TEMPLATE_GROUPS, templateFilled, templatePreview } from '@core/math/templates'

/** 公式中可见的文字（字母、数字、符号），用于比较往返前后是否丢失内容 */
const visible = (omml: string): string =>
  ommlToMathml(omml)
    .mathml.replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .replace(/−/g, '-')
    .replace(/′/g, "'")
    .replace(/∘/g, '°')

describe('OMML → LaTeX', () => {
  it('样例中的 373 个公式：LaTeX 可解析，转回 Word 公式后内容完全一致', async () => {
    let count = 0
    for (const f of ['教案_T_动态圆专题.docx', '学案_S_动态圆专题.docx']) {
      const read = await readDocx(new Uint8Array(readFileSync(`reference/samples/2026秋季高二物理敏思_动态圆专题/${f}`)))
      for (const p of read.paragraphs) {
        for (const i of p.inlines) {
          if (i.type !== 'math') continue
          count += 1
          const { latex, unknown } = ommlToLatex(i.omml!)
          expect(unknown).toEqual([])
          expect(() => temml.renderToString(latex, { throwOnError: true })).not.toThrow()
          expect(visible(latexToOmml(latex)), latex).toBe(visible(i.omml!))
        }
      }
    }
    expect(count).toBe(373)
  })

  const om = (inner: string): string =>
    `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${inner}</m:oMath>`
  const r = (t: string, sty?: string): string =>
    `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ''}<m:t>${t}</m:t></m:r>`

  it.each([
    [`<m:f><m:num>${r('qB')}</m:num><m:den>${r('m')}</m:den></m:f>`, '\\frac{qB}{m}'],
    [`<m:sSub><m:e>${r('v')}</m:e><m:sub>${r('0')}</m:sub></m:sSub>`, 'v_{0}'],
    [`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('3')}</m:e></m:rad>`, '\\sqrt{3}'],
    [`<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr><m:e>${r('F')}</m:e></m:acc>`, '\\vec{F}'],
    [`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${r('OP')}</m:e></m:bar>`, '\\overline{OP}'],
    [r('30°'), '30^{\\circ}'],
    [r('θ'), '\\theta'],
    [r('sin', 'p'), '\\sin'],
    [r('kg', 'p'), '\\mathrm{kg}'],
    [`<m:r><m:rPr><m:nor/></m:rPr><m:t>速度</m:t></m:r>`, '\\text{速度}']
  ])('%s → %s', (inner, latex) => {
    expect(ommlToLatex(om(inner)).latex).toBe(latex)
  })
})

describe('LaTeX → OMML', () => {
  it('上划线与下划线', () => {
    expect(latexToOmml('\\overline{AB}')).toContain('<m:pos m:val="top"/>')
    expect(latexToOmml('\\underline{AB}')).toContain('<m:pos m:val="bot"/>')
  })
})


describe('公式模板库', () => {
  const all = TEMPLATE_GROUPS.flatMap((g) => [
    { group: g.label, latex: g.icon, title: '（图标）' },
    ...g.templates.map((tpl) => ({ group: g.label, ...tpl }))
  ])

  it('分类与 WPS 一致且没有重复的 id', () => {
    expect(new Set(TEMPLATE_GROUPS.map((g) => g.id)).size).toBe(TEMPLATE_GROUPS.length)
    expect(TEMPLATE_GROUPS.map((g) => g.label)).toEqual([
      '常用公式', '分数', '上下标', '根式', '积分', '大型运算符', '括号',
      '函数', '导数符号', '极限和对数', '运算符', '箭头', '希腊字母', '矩阵'
    ])
  })

  it.each(all)('$group · $title：预览可渲染，填写后可导出为 Word 公式', ({ latex }) => {
    expect(() => temml.renderToString(templatePreview(latex), { throwOnError: true })).not.toThrow()
    const filled = templateFilled(latex)
    const omml = latexToOmml(filled)
    expect(ommlToMathml(omml).unknown).toEqual([])
  })
})
