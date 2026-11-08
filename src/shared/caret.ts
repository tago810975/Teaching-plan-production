/**
 * 点击预览定位到编辑框：计算光标位置（纯计算，界面与测试共用）。
 */

/**
 * 在第 paragraph 行中找到点击位置：先找“点击处前后的文字”，再分别找后半、前半；
 * 都找不到时放在该行开头。（编辑框中的公式、带格式文字显示为标记，所以只能按文字近似匹配）
 */
export function caretPosition(text: string, paragraph: number, before: string, after: string): number {
  const lines = text.split('\n')
  const index = Math.min(Math.max(0, paragraph), lines.length - 1)
  let start = 0
  for (let i = 0; i < index; i++) start += lines[i]!.length + 1
  const line = lines[index] ?? ''
  const both = line.indexOf(before + after)
  if (before + after !== '' && both !== -1) return start + both + before.length
  if (after !== '') {
    const i = line.indexOf(after)
    if (i !== -1) return start + i
  }
  if (before !== '') {
    const i = line.lastIndexOf(before)
    if (i !== -1) return start + i + before.length
  }
  return start
}
