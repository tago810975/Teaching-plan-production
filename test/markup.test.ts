import { describe, expect, it } from 'vitest'
import { markupToRichText, richTextToMarkup } from '@core/model/markup'

describe('文字 + $公式$ 标记', () => {
  it('解析文字与公式', () => {
    expect(markupToRichText('经过时间$t_0$刚好')).toEqual([
      {
        inlines: [
          { type: 'text', text: '经过时间' },
          { type: 'math', latex: 't_0' },
          { type: 'text', text: '刚好' }
        ]
      }
    ])
  })

  it('多行对应多段，往返不变', () => {
    const src = '第一段$\\frac{5}{4}t_0$\n价格\\$5\n$\\sqrt{2}$'
    expect(richTextToMarkup(markupToRichText(src))).toBe(src)
  })

  it('未配对的 $ 视为文字', () => {
    expect(markupToRichText('a$b')).toEqual([{ inlines: [{ type: 'text', text: 'a$b' }] }])
  })

  it('含图片或仅有 OMML 的公式时不可转换', () => {
    expect(richTextToMarkup([{ inlines: [{ type: 'math', omml: '<m:oMath/>' }] }])).toBeNull()
    expect(
      richTextToMarkup([{ inlines: [{ type: 'image', assetId: 'x', widthEmu: 1, heightEmu: 1 }] }])
    ).toBeNull()
  })
})
