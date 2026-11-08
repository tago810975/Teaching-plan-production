import { readFileSync } from 'node:fs'
import temml from 'temml'
import { describe, expect, it } from 'vitest'
import { importDocx } from '@core/import/import-docx'
import type { Block } from '@core/model/types'
import { parseXml } from '@core/xml/dom'

const SAMPLE = 'reference/samples/2026秋季高二物理敏思_带电粒子在磁场中的运动/教案_T_带电粒子在磁场中的运动.docx'

function collectMath(blocks: Block[]): Array<{ latex?: string; omml?: string }> {
  const out: Array<{ latex?: string; omml?: string }> = []
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit)
    else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (o.type === 'math') out.push(o as { latex?: string; omml?: string })
      else Object.values(o).forEach(visit)
    }
  }
  visit(blocks)
  return out
}

describe('导入题库文档：MathType、EQ 域、形状示意图', async () => {
  const result = await importDocx(new Uint8Array(readFileSync(SAMPLE)))
  const math = collectMath(result.blocks)

  it('识别出 31 道题', () => {
    expect(result.questionCount).toBe(31)
    expect(result.firstTitle).toBe('带电粒子在磁场中的运动')
  })

  it('MathType 235 个与 EQ 域 23 个公式全部转为可编辑公式', () => {
    expect(math.filter((m) => m.omml !== undefined)).toHaveLength(109)
    expect(math.filter((m) => m.latex !== undefined)).toHaveLength(235 + 23)
    expect(result.warnings[0]).toContain('235 个 MathType 公式')
    expect(result.warnings[0]).toContain('23 个 EQ 域公式')
    // 不再有 WMF 预览图被当作图片导入
    expect(Object.values(result.assets).some((a) => a.mime === 'image/x-wmf')).toBe(false)
  })

  it('转换得到的 LaTeX 都能正常渲染', () => {
    for (const m of math) {
      if (m.latex === undefined) continue
      expect(() => temml.renderToString(m.latex!, { throwOnError: true }), m.latex).not.toThrow()
    }
  })

  it('典型公式与原文一致（已与 MathType 预览图逐个核对）', () => {
    const all = new Set(math.flatMap((m) => (m.latex !== undefined ? [m.latex] : [])))
    for (const expected of [
      'R=\\frac{mv}{qB}',
      'T=\\frac{2\\pi m}{qB}',
      'evB=m\\frac{v^{2}}{R}',
      'R_{2}=\\overline{OB}\\sin 30^{\\circ}=\\frac{1}{2}\\overline{OB}',
      't=\\frac{\\alpha}{360^{\\circ}}T=\\frac{\\pi L}{3v}',
      '\\frac{r_{\\text{甲}}}{r_{\\text{乙}}}=\\frac{m_{\\text{甲}}}{m_{\\text{乙}}}\\cdot\\frac{q_{\\text{乙}}}{q_{\\text{甲}}}=\\frac{4}{1}\\times\\frac{1}{2}=\\frac{2}{1}',
      '{}^{2}_{1}', // EQ 域：同位素记号
      '\\frac{mv}{qB}' // EQ 域：分数
    ]) {
      expect(all.has(expected), expected).toBe(true)
    }
  })

  it('三幅形状示意图渲染为合法的 SVG，标注文字保留', () => {
    const svgs = Object.values(result.assets).filter((a) => a.mime === 'image/svg+xml')
    expect(svgs).toHaveLength(3)
    const texts = svgs.map((a) => new TextDecoder().decode(a.data))
    for (const svg of texts) {
      const doc = parseXml(svg)
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
      expect(svg.startsWith('<svg')).toBe(true)
    }
    const labels = texts.join('').match(/<tspan[^>]*>([^<]*)<\/tspan>/g)?.map((t) => t.replace(/<[^>]+>/g, '')) ?? []
    expect(labels).toEqual(expect.arrayContaining(['B', 'O', 'f', 'v', '1', '2']))
    // 带箭头的直线
    expect(texts.join('')).toContain('marker-end=')
    // 文本框标注不再被拆成零散段落
    expect(result.warnings.join('')).not.toContain('文本框')
  })
})

describe('知识点框（带边框的成段文字）仍按文字导入', async () => {
  const result = await importDocx(
    new Uint8Array(readFileSync('reference/samples/2026秋季高二物理敏思_动态圆专题/教案_T_动态圆专题.docx'))
  )
  it('第一份样例中没有被转成图片的形状', () => {
    expect(Object.values(result.assets).some((a) => a.mime === 'image/svg+xml')).toBe(false)
  })
})
