import { describe, expect, it } from 'vitest'
import { paragraphFromEditable, paragraphToEditable } from '@core/model/markup'

describe('填空在编辑框中写成下划线（可直接增删调节长度）', () => {
  it('填空显示为下划线：每个字宽 2 个下划线', () => {
    const { text } = paragraphToEditable({ inlines: [{ type: 'text', text: '速度为' }, { type: 'blank', widthChars: 4 }, { type: 'text', text: '。' }] })
    expect(text).toBe('速度为________。')
  })

  it('连续 3 个以上的下划线成为填空，宽度为个数的一半；多打几个就更长', () => {
    expect(paragraphFromEditable('速度为______。', new Map()).inlines).toEqual([
      { type: 'text', text: '速度为' },
      { type: 'blank', widthChars: 3 },
      { type: 'text', text: '。' }
    ])
    expect(paragraphFromEditable('a____________b', new Map()).inlines[1]).toEqual({ type: 'blank', widthChars: 6 })
    expect(paragraphFromEditable('全角＿＿＿＿', new Map()).inlines[1]).toEqual({ type: 'blank', widthChars: 2 })
  })

  it('一两个下划线是普通文字；公式中的下划线（下标）不受影响', () => {
    expect(paragraphFromEditable('a__b', new Map()).inlines).toEqual([{ type: 'text', text: 'a__b' }])
    expect(paragraphFromEditable('$v_0$与______', new Map()).inlines).toEqual([
      { type: 'math', latex: 'v_0' },
      { type: 'text', text: '与' },
      { type: 'blank', widthChars: 3 }
    ])
  })

  it('改了长度再转回来，宽度随之改变', () => {
    const { text, objects } = paragraphToEditable({ inlines: [{ type: 'blank', widthChars: 3 }] })
    expect(paragraphFromEditable(text + '____', objects).inlines).toEqual([{ type: 'blank', widthChars: 5 }])
  })
})
