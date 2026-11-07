/**
 * 富文本 ↔ 简易标记文本的互相转换，供过渡期的文本框编辑使用。
 *
 * 标记规则：普通文字原样书写，公式写作 $LaTeX$，文字中的 $ 写作 \$。
 * 例："经过时间$t_0$刚好从c点射出"。
 *
 * 含有图片、填空、带格式文字或只有 OMML 的公式时无法用这种文本无损表示，
 * 此时 toMarkup 返回 null，界面应改为只读，避免编辑时丢失内容。
 * 正式的富文本编辑器（TipTap + MathLive）接入后，此模块只用于测试和导入辅助。
 */
import type { Inline, RichParagraph, RichText } from './types'

export function paragraphToMarkup(p: RichParagraph): string | null {
  let out = ''
  for (const inline of p.inlines) {
    switch (inline.type) {
      case 'text':
        if (inline.marks !== undefined && Object.keys(inline.marks).length > 0) return null
        out += inline.text.replace(/\$/g, '\\$')
        break
      case 'math':
        if (inline.latex === undefined || inline.display === true) return null
        out += `$${inline.latex}$`
        break
      case 'image':
      case 'blank':
        return null
    }
  }
  return out
}

export function richTextToMarkup(rich: RichText): string | null {
  const lines: string[] = []
  for (const p of rich) {
    const line = paragraphToMarkup(p)
    if (line === null) return null
    lines.push(line)
  }
  return lines.join('\n')
}

export function markupToParagraph(markup: string): RichParagraph {
  const inlines: Inline[] = []
  let text = ''
  let i = 0
  const flushText = (): void => {
    if (text !== '') inlines.push({ type: 'text', text })
    text = ''
  }

  while (i < markup.length) {
    const ch = markup[i]!
    if (ch === '\\' && markup[i + 1] === '$') {
      text += '$'
      i += 2
    } else if (ch === '$') {
      const end = findClosingDollar(markup, i + 1)
      if (end === -1) {
        // 没有配对的 $，按普通文字处理
        text += markup.slice(i)
        break
      }
      flushText()
      inlines.push({ type: 'math', latex: markup.slice(i + 1, end) })
      i = end + 1
    } else {
      text += ch
      i += 1
    }
  }
  flushText()
  return { inlines }
}

export function markupToRichText(markup: string): RichText {
  if (markup === '') return []
  return markup.split('\n').map(markupToParagraph)
}

function findClosingDollar(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') i += 1
    else if (s[i] === '$') return i
  }
  return -1
}
