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
  it('加粗：m:sty 改为粗体并设 w:b；属性按规范顺序', () => {
    const omml = '<m:oMath><m:r><m:rPr><m:sty m:val="p"/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math"/><w:lang w:val="en-US"/></w:rPr><m:t>F</m:t></m:r><m:r><m:t>v</m:t></m:r></m:oMath>'
    const out = applyMathMarks(omml, { bold: true })
    expect(out).toContain('<m:r><m:rPr><m:sty m:val="b"/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math"/><w:b/><w:lang w:val="en-US"/></w:rPr><m:t>F</m:t></m:r>')
    expect(out).toContain('<m:r><m:rPr><m:sty m:val="bi"/></m:rPr><w:rPr><w:b/></w:rPr><m:t>v</m:t></m:r>')
    expect(applyMathMarks(omml, {})).toBe(omml)
  })

  it('下划线：整个公式放进底部的“下横线”结构，分式下方也是一条平直的线；横线随公式加粗、颜色', () => {
    const frac = '<m:oMath xmlns:m="x"><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f><m:r><m:t>m</m:t></m:r></m:oMath>'
    const out = applyMathMarks(frac, { underline: true, bold: true, color: 'C00000' })
    expect(out).toMatch(/^<m:oMath xmlns:m="x"><m:bar><m:barPr><m:pos m:val="bot"\/><m:ctrlPr><w:rPr><w:b\/><w:color w:val="C00000"\/><\/w:rPr><\/m:ctrlPr><\/m:barPr><m:e><m:f>/)
    expect(out).toMatch(/<\/m:e><\/m:bar><\/m:oMath>$/)
    // 不再给每个字符加 w:u
    expect(out).not.toContain('<w:u ')
    expect(applyMathMarks('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', { underline: true })).toBe(
      '<m:oMath><m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:bar></m:oMath>'
    )
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

describe('格式工具：文字颜色', async () => {
  const { setTextColor } = await import('@core/model/markup')
  const color = (rich: RichText, sel: string, c: string | undefined): RichText => {
    const e = toEditable(rich)
    const objects = new Map(e.objects) as Map<number, Inline>
    const i = e.text.indexOf(sel)
    const r = setTextColor(e.text, objects, i, i + sel.length, c)!
    return fromEditable(r.text, objects)
  }

  it('设为红色、蓝色，再恢复黑色；其他格式保留', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '洛伦兹力' }, { type: 'text', text: '不做功', marks: { bold: true } }] }]
    const red = color(rich, '洛伦兹力', 'c00000')
    expect(red[0]!.inlines[0]).toEqual({ type: 'text', text: '洛伦兹力', marks: { color: 'C00000' } })
    const blue = color(red, '不做功', '2F5597')
    expect(blue[0]!.inlines[1]).toEqual({ type: 'text', text: '不做功', marks: { bold: true, color: '2F5597' } })
    const black = color(blue, '不做功', undefined)
    expect(black[0]!.inlines[1]).toEqual({ type: 'text', text: '不做功', marks: { bold: true } })
    expect(color(black, '洛伦兹力', undefined)).toEqual(rich)
  })

  it('公式也可设颜色', () => {
    const rich: RichText = [{ inlines: [{ type: 'math', latex: 'F=qvB' }] }]
    const red = color(rich, '$F=qvB$', 'C00000')
    expect(red[0]!.inlines[0]).toEqual({ type: 'math', latex: 'F=qvB', color: 'C00000' })
    // 带颜色的公式在输入框中是标记，改文字时颜色不会丢
    expect(toEditable(red).text).toBe('⟦公式1⟧')
    expect(color(red, '⟦公式1⟧', undefined)).toEqual(rich)
  })

  it('普通文字恢复黑色：没有可改的内容', () => {
    expect(setTextColor('文字', new Map(), 0, 2, undefined)).toBeNull()
  })

  it('导出：公式颜色写入 w:color', () => {
    expect(applyMathMarks('<m:r><m:t>x</m:t></m:r>', { color: '2F5597' })).toBe('<m:r><w:rPr><w:color w:val="2F5597"/></w:rPr><m:t>x</m:t></m:r>')
  })
})

describe('标记重新编号：反复加粗、取消不会让编号一直增长', () => {
  const M = (n: string): Inline => ({ type: 'math', omml: `<m:oMath><m:r><m:t>${n}</m:t></m:r></m:oMath>` })
  it('编号按出现顺序 1、2、3……，用不到的对象被清掉', () => {
    const rich: RichText = [{ inlines: [M('a'), { type: 'text', text: '甲乙' }, M('b')] }]
    const e = toEditable(rich)
    const objects = new Map(e.objects) as Map<number, Inline>
    let text = e.text
    for (let k = 0; k < 10; k++) {
      const i = text.indexOf('甲乙') - (text.includes('⟦加粗') ? '⟦加粗2:'.length : 0)
      const j = text.indexOf('⟧', text.indexOf('甲乙')) + 1
      const r = toggleMark(text, objects, k % 2 === 0 ? text.indexOf('甲乙') : i, k % 2 === 0 ? text.indexOf('甲乙') + 2 : j, 'bold')!
      text = r.text
    }
    // 加粗、取消各 5 次后回到原样，编号仍是 1、2
    expect(text).toBe('⟦公式1⟧甲乙⟦公式2⟧')
    expect([...objects.keys()]).toEqual([1, 2])
    expect(fromEditable(text, objects)).toEqual(rich)
  })

  it('加粗后的编号也按顺序；选区随之调整', () => {
    const rich: RichText = [{ inlines: [M('a'), { type: 'text', text: '甲乙' }, M('b')] }]
    const e = toEditable(rich)
    const objects = new Map(e.objects) as Map<number, Inline>
    const i = e.text.indexOf('甲乙')
    const r = toggleMark(e.text, objects, i, i + 2, 'bold')!
    expect(r.text).toBe('⟦公式1⟧⟦加粗2:甲乙⟧⟦公式3⟧')
    expect(r.text.slice(r.start, r.end)).toBe('⟦加粗2:甲乙⟧')
    expect([...objects.keys()]).toEqual([1, 2, 3])
  })

  it('无效编号（如从别处粘贴来的标记）原样保留，新编号避开它', () => {
    const objects = new Map<number, Inline>([[1, M('a')]])
    const t = '⟦公式1⟧⟦公式1⟧甲'
    const r = toggleMark(t, objects, t.indexOf('甲'), t.length, 'bold')
    // 两个 ⟦公式1⟧ 都有效，指向同一对象：分别编为 1、2
    expect(r!.text).toBe('⟦公式1⟧⟦公式2⟧⟦加粗3:甲⟧')
    const objects2 = new Map<number, Inline>([[5, M('a')]])
    const t2 = '⟦公式1⟧⟦公式5⟧甲'
    const r2 = toggleMark(t2, objects2, t2.indexOf('甲'), t2.length, 'bold')!
    expect(r2.text).toBe('⟦公式1⟧⟦公式2⟧⟦加粗3:甲⟧')
    expect(objects2.has(1)).toBe(false)
  })
})

describe('重点（红色加粗下划线，知识梳理中的挖空内容）', async () => {
  const { applyFormat, isKeyPoint, KEY_POINT_MARKS } = await import('@core/model/markup')
  const { getPreset } = await import('@core/presets')
  const op = { combo: getPreset('physics-v1').keyPoint.marks }
  const run = (rich: RichText, sel: string): { text: string; rich: RichText } => {
    const e = toEditable(rich)
    const objects = new Map(e.objects) as Map<number, Inline>
    const i = e.text.indexOf(sel)
    const r = applyFormat(e.text, objects, i, i + sel.length, op)!
    return { text: r.text, rich: fromEditable(r.text, objects) }
  }

  it('预设中的重点格式与 KEY_POINT_MARKS 一致', () => {
    expect(getPreset('physics-v1').keyPoint.marks).toEqual(KEY_POINT_MARKS)
  })

  it('一次设好红色加粗下划线，标记写作“重点”；再点一次全部取消', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '洛伦兹力不做功' }] }]
    const a = run(rich, '不做功')
    expect(a.text).toBe('洛伦兹力⟦重点1:不做功⟧')
    expect(a.rich[0]!.inlines[1]).toEqual({ type: 'text', text: '不做功', marks: { bold: true, underline: true, color: 'C00000' } })
    expect(run(a.rich, '不做功').rich).toEqual(rich)
  })

  it('已有部分格式（如加粗）时补全；取消时只去掉重点格式，保留别的（如倾斜）', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '速度', marks: { bold: true, italic: true } }] }]
    const a = run(rich, '速度')
    expect(a.rich[0]!.inlines[0]).toEqual({ type: 'text', text: '速度', marks: { bold: true, italic: true, underline: true, color: 'C00000' } })
    expect(run(a.rich, '速度').rich[0]!.inlines[0]).toEqual({ type: 'text', text: '速度', marks: { italic: true } })
  })

  it('公式也可设为重点', () => {
    const rich: RichText = [{ inlines: [{ type: 'text', text: '半径' }, { type: 'math', latex: 'r=\\frac{mv}{qB}' }] }]
    const a = run(rich, '半径$r=\\frac{mv}{qB}$')
    expect(a.rich[0]!.inlines[1]).toEqual({ type: 'math', latex: 'r=\\frac{mv}{qB}', bold: true, underline: true, color: 'C00000' })
  })

  it('isKeyPoint：只有正好是红色加粗下划线才算', () => {
    expect(isKeyPoint({ bold: true, underline: true, color: 'c00000' })).toBe(true)
    expect(isKeyPoint({ bold: true, underline: true, color: '2F5597' })).toBe(false)
    expect(isKeyPoint({ bold: true, underline: true, color: 'C00000', italic: true })).toBe(false)
  })
})
