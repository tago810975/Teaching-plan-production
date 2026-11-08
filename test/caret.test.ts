import { describe, expect, it } from 'vitest'
import { caretPosition } from '@shared/caret'

describe('点击预览定位光标', () => {
  const text = '第一段文字\n运动员上下抖动的频率应（　　）\n第三段'
  const line2 = text.indexOf('运动员')

  it('按点击处前后的文字定位到第 2 段中的位置', () => {
    expect(caretPosition(text, 1, '上下', '抖动')).toBe(line2 + 5)
  })
  it('只匹配到后半时放在其开头', () => {
    expect(caretPosition(text, 1, 'xx', '频率')).toBe(line2 + text.slice(line2).indexOf('频率'))
  })
  it('找不到时放在该段开头', () => {
    expect(caretPosition(text, 2, '无', '关')).toBe(text.indexOf('第三段'))
  })
  it('段落序号超出时取最后一段', () => {
    expect(caretPosition(text, 9, '', '')).toBe(text.indexOf('第三段'))
  })
})
