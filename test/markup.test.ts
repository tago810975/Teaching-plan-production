import { describe, expect, it } from 'vitest'
import { fromEditable, paragraphFromEditable, paragraphToEditable, toEditable } from '@core/model/markup'
import type { RichText } from '@core/model/types'

const roundTrip = (rich: RichText): RichText => {
  const e = toEditable(rich)
  return fromEditable(e.text, e.objects)
}

describe('可编辑文本', () => {
  it('文字与 $公式$', () => {
    const e = toEditable([])
    expect(fromEditable('经过时间$t_0$刚好', e.objects)).toEqual([
      {
        inlines: [
          { type: 'text', text: '经过时间' },
          { type: 'math', latex: 't_0' },
          { type: 'text', text: '刚好' }
        ]
      }
    ])
  })

  it('导入的公式、图片显示为标记，往返后完整保留', () => {
    const rich: RichText = [
      {
        inlines: [
          { type: 'text', text: '已知' },
          { type: 'math', omml: '<m:oMath/>' },
          { type: 'image', assetId: 'x', widthEmu: 1, heightEmu: 1 }
        ]
      },
      { inlines: [{ type: 'text', text: '第二段 \\$5' }] }
    ]
    const e = toEditable(rich)
    expect(e.text).toBe('已知⟦公式1⟧⟦图2⟧\n第二段 \\\\$5')
    expect(roundTrip(rich)).toEqual(rich)
  })

  it('带格式的文字：可改文字，格式保留', () => {
    const rich: RichText = [
      { inlines: [{ type: 'text', text: 'v' }, { type: 'text', text: '0', marks: { script: 'sub' } }] }
    ]
    const e = toEditable(rich)
    expect(e.text).toBe('v⟦下标1:0⟧')
    expect(fromEditable('u⟦下标1:1⟧', e.objects)).toEqual([
      { inlines: [{ type: 'text', text: 'u' }, { type: 'text', text: '1', marks: { script: 'sub' } }] }
    ])
  })

  it('删除标记即删除对应内容；无效编号按文字处理', () => {
    const rich: RichText = [{ inlines: [{ type: 'math', omml: '<m:oMath/>' }] }]
    const e = toEditable(rich)
    expect(fromEditable('', e.objects)).toEqual([])
    expect(fromEditable('⟦公式9⟧', e.objects)).toEqual([{ inlines: [{ type: 'text', text: '⟦公式9⟧' }] }])
  })

  it('未配对的 $ 视为文字', () => {
    expect(fromEditable('a$b', new Map())).toEqual([{ inlines: [{ type: 'text', text: 'a$b' }] }])
  })

  it('颜色、字体单独设置时标记写作“颜色”“字体”，往返不变', () => {
    const p = { inlines: [{ type: 'text' as const, text: '红字', marks: { color: 'FF0000' } }, { type: 'text' as const, text: '和' }, { type: 'text' as const, text: '仿宋', marks: { font: 'fang' as const } }] }
    const e = paragraphToEditable(p)
    expect(e.text).toBe('⟦颜色1:红字⟧和⟦字体2:仿宋⟧')
    expect(paragraphFromEditable(e.text, e.objects)).toEqual(p)
  })
})
