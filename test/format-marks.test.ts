import { describe, expect, it } from 'vitest'
import { applyMathMarks } from '@core/export/math-marks'
import { fromEditable, toEditable, toggleMark } from '@core/model/markup'
import type { Inline, RichText } from '@core/model/types'
import { buildDocument } from '@core/document/build'
import { createEmptyProject, createQuestion, newId } from '@core/model/factory'

/** 在 rich 的可编辑文本中选中 sel（第一次出现），切换格式，返回结果 */
function apply(rich: RichText, sel: string, mark: 'bold' | 'italic' | 'underline'): { text: string; rich: RichText } {
  const e = toEditable(rich)
  const objects = new Map(e.objects) as Map<number, Inline>
  const i = e.text.indexOf(sel)
  const r = toggleMark(e.text, objects, i, i + sel.length, mark)!
  return { text: r.text, rich: fromEditable(r.text, objects) }
}

describe('格式工具：加粗、倾斜、下划线', () => {
  it('普通文字：加粗后成为加粗文字，再点一次取消', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '洛伦兹力不做功' }] }]
    const a = apply(rich, '不做功', 'bold')
    expect(a.text).toMatch(/^洛伦兹力⟦加粗\d+:不做功⟧$/)
    expect(a.rich).toEqual([{ inlines: [{ type: 'text', text: '洛伦兹力' }, { type: 'text', text: '不做功', marks: { bold: true } }] }])
    const b = apply(a.rich, '不做功', 'bold')
    expect(b.rich).toEqual(rich)
  })

  it('在已有格式上叠加：加粗 + 下划线 + 原来的颜色', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '重点', marks: { color: 'C00000' } }] }]
    const a = apply(rich, '重点', 'bold')
    const b = apply(a.rich, '重点', 'underline')
    expect(b.rich).toEqual([{ inlines: [{ type: 'text', text: '重点', marks: { color: 'C00000', bold: true, underline: true } }] }])
  })

  it('选区只碰到标记的一部分时，按整个标记处理', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '粒子速度', marks: { bold: true } }, { type: 'text', text: '变大' }] }]
    const e = toEditable(rich)
    const objects = new Map(e.objects) as Map<number, Inline>
    const i = e.text.indexOf('速度')
    const r = toggleMark(e.text, objects, i, i + 2, 'underline')!
    expect(fromEditable(r.text, objects)).toEqual([
      { inlines: [{ type: 'text', text: '粒子速度', marks: { bold: true, underline: true } }, { type: 'text', text: '变大' }] }
    ])
  })

  it('混合选区：都有该格式时才取消，否则全部加上', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '甲', marks: { bold: true } }, { type: 'text', text: '乙' }] }]
    const e = toEditable(rich)
    const objects = new Map(e.objects) as Map<number, Inline>
    const r = toggleMark(e.text, objects, 0, e.text.length, 'bold')!
    expect(fromEditable(r.text, objects)).toEqual([
      { inlines: [{ type: 'text', text: '甲', marks: { bold: true } }, { type: 'text', text: '乙', marks: { bold: true } }] }
    ])
  })

  it('公式：可加粗、加下划线；倾斜对公式不起作用', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '由' }, { type: 'math', latex: 'F=qvB' }, { type: 'text', text: '得' }] }]
    const e = toEditable(rich)
    const objects = new Map(e.objects) as Map<number, Inline>
    const r = toggleMark(e.text, objects, 0, e.text.length, 'underline')!
    const out = fromEditable(r.text, objects)[0]!.inlines
    expect(out[1]).toEqual({ type: 'math', latex: 'F=qvB', underline: true })
    expect(out[0]).toEqual({ type: 'text', text: '由', marks: { underline: true } })
    const objects2 = new Map(e.objects) as Map<number, Inline>
    const i = e.text.indexOf('⟦公式')
    expect(toggleMark(e.text, objects2, i, i + 5, 'italic')).toBeNull()
  })

  it('新写的 $公式$ 也能加粗', () => {
    const objects = new Map<number, Inline>()
    const r = toggleMark('设$v_0$', objects, 0, 6, 'bold')!
    expect(fromEditable(r.text, objects)).toEqual([
      { inlines: [{ type: 'text', text: '设', marks: { bold: true } }, { type: 'math', latex: 'v_0', bold: true }] }
    ])
  })

  it('跨行：每行分别加标记', () => {
    const objects = new Map<number, Inline>()
    const r = toggleMark('第一行\n第二行', objects, 0, 7, 'italic')!
    expect(fromEditable(r.text, objects)).toEqual([
      { inlines: [{ type: 'text', text: '第一行', marks: { italic: true } }] },
      { inlines: [{ type: 'text', text: '第二行', marks: { italic: true } }] }
    ])
  })

  it('空选区或只选了图片时不改动', () => {
    const objects = new Map<number, Inline>([[1, { type: 'image', assetId: 'a', widthEmu: 1, heightEmu: 1 }]])
    expect(toggleMark('⟦图1⟧', objects, 0, 4, 'bold')).toBeNull()
    expect(toggleMark('文字', new Map(), 1, 1, 'bold')).toBeNull()
  })
})

describe('公式加粗、下划线的导出', () => {
  it('加粗：m:sty 改为粗体并设 w:b；下划线：w:u；属性按规范顺序', () => {
    const omml = '<m:oMath><m:r><m:rPr><m:sty m:val="p"/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math"/><w:lang w:val="en-US"/></w:rPr><m:t>F</m:t></m:r><m:r><m:t>v</m:t></m:r></m:oMath>'
    const out = applyMathMarks(omml, { bold: true, underline: true })
    expect(out).toContain('<m:r><m:rPr><m:sty m:val="b"/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math"/><w:b/><w:u w:val="single"/><w:lang w:val="en-US"/></w:rPr><m:t>F</m:t></m:r>')
    expect(out).toContain('<m:r><m:rPr><m:sty m:val="bi"/></m:rPr><w:rPr><w:b/><w:u w:val="single"/></w:rPr><m:t>v</m:t></m:r>')
    expect(applyMathMarks(omml, {})).toBe(omml)
  })
})

describe('难度显示开关', () => {
  const prefix = (display: 'both' | 'grade' | 'stars' | 'none'): string => {
    const p = createEmptyProject()
    p.layout.difficultyDisplay = display
    p.blocks = [{ id: newId(), type: 'question', question: createQuestion({ difficulty: 'B', stem: [{ inlines: [{ type: 'text', text: '题' }] }] }) }]
    return buildDocument(p, 'student').paragraphs.find((x) => x.style === 'question')!.runs.map((r) => (r.kind === 'text' ? r.text : '')).join('')
  }
  it('等级和星级 / 只显示等级 / 只显示星级 / 不显示', () => {
    expect(prefix('both')).toBe('【B】★★题')
    expect(prefix('grade')).toBe('【B】题')
    expect(prefix('stars')).toBe('★★题')
    expect(prefix('none')).toBe('题')
  })
})
