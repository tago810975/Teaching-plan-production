/**
 * 富文本 ↔ 可编辑文本的互相转换，供过渡期的文本框编辑使用。
 *
 * 规则：
 * - 普通文字原样书写；
 * - 新公式写作 $LaTeX$，文字中的 $ 写作 \$；
 * - 无法用文字表示的内容显示为标记，编辑时可以移动或删除，原内容完整保留：
 *     ⟦公式1⟧ ⟦图2⟧ ⟦填空3⟧        —— 从 Word 导入的公式、图片、填空横线
 *     ⟦下标4:0⟧ ⟦上标5:2⟧ ⟦加粗6:文字⟧ —— 带格式的文字，冒号后的文字可以修改，格式保留
 *
 * 标记的编号只在同一个输入框内有效，由 toEditable 生成、fromEditable 解读。
 * 正式的富文本编辑器接入后，此模块只用于测试和导入辅助。
 */
import type { Inline, RichParagraph, RichText, TextMarks } from './types'

export interface Editable {
  text: string
  /** 标记编号 → 原始内容 */
  objects: ReadonlyMap<number, Inline>
}

const TOKEN = /⟦(公式|图|填空)(\d+)⟧|⟦(上标|下标|加粗|倾斜|下划线|颜色|字体|格式)(\d+):([^⟧]*)⟧/g

export function toEditable(rich: RichText): Editable {
  const objects = new Map<number, Inline>()
  const lines = rich.map((p) => paragraphText(p, objects))
  return { text: lines.join('\n'), objects }
}

export function paragraphToEditable(p: RichParagraph): Editable {
  const objects = new Map<number, Inline>()
  return { text: paragraphText(p, objects), objects }
}

function paragraphText(p: RichParagraph, objects: Map<number, Inline>): string {
  let out = ''
  const add = (inline: Inline): number => {
    const n = objects.size + 1
    objects.set(n, inline)
    return n
  }
  for (const inline of p.inlines) {
    switch (inline.type) {
      case 'text': {
        const text = inline.text.replace(/\$/g, '\\$')
        if (inline.marks === undefined || Object.keys(inline.marks).length === 0) out += text
        else out += `⟦${markName(inline.marks)}${add(inline)}:${inline.text.replace(/⟧/g, '')}⟧`
        break
      }
      case 'math':
        if (inline.latex !== undefined && inline.display !== true) out += `$${inline.latex}$`
        else out += `⟦公式${add(inline)}⟧`
        break
      case 'image':
        out += `⟦图${add(inline)}⟧`
        break
      case 'blank':
        out += `⟦填空${add(inline)}⟧`
        break
    }
  }
  return out
}

/** 带格式文字的标记，如 ⟦加粗3:文字⟧（用于在输入框中给选中的文字加上格式） */
export function formatToken(n: number, marks: TextMarks, text: string): string {
  return `⟦${markName(marks)}${n}:${text}⟧`
}

function markName(m: TextMarks): string {
  const keys = Object.keys(m).filter((k) => m[k as keyof TextMarks] !== undefined)
  if (keys.length !== 1) return '格式'
  if (m.script === 'sub') return '下标'
  if (m.script === 'sup') return '上标'
  if (m.bold === true) return '加粗'
  if (m.italic === true) return '倾斜'
  if (m.underline === true) return '下划线'
  if (m.color !== undefined) return '颜色'
  if (m.font !== undefined) return '字体'
  return '格式'
}

export function fromEditable(text: string, objects: ReadonlyMap<number, Inline>): RichText {
  if (text === '') return []
  return text.split('\n').map((line) => paragraphFromEditable(line, objects))
}

export function paragraphFromEditable(line: string, objects: ReadonlyMap<number, Inline>): RichParagraph {
  const inlines: Inline[] = []
  let last = 0
  for (const m of line.matchAll(TOKEN)) {
    pushPlain(inlines, line.slice(last, m.index))
    last = m.index + m[0].length
    const n = Number(m[2] ?? m[4])
    const original = objects.get(n)
    if (original === undefined) {
      pushPlain(inlines, m[0]) // 编号无效（例如从别处粘贴来的标记），按文字处理
    } else if (m[5] !== undefined) {
      const marks = original.type === 'text' ? original.marks : undefined
      if (m[5] !== '') inlines.push(marks !== undefined ? { type: 'text', text: m[5], marks } : { type: 'text', text: m[5] })
    } else {
      inlines.push(original)
    }
  }
  pushPlain(inlines, line.slice(last))
  return { inlines }
}

/** 普通文字：解析其中的 $LaTeX$ */
function pushPlain(inlines: Inline[], s: string): void {
  let text = ''
  let i = 0
  const flush = (): void => {
    if (text === '') return
    const prev = inlines[inlines.length - 1]
    if (prev?.type === 'text' && prev.marks === undefined) prev.text += text
    else inlines.push({ type: 'text', text })
    text = ''
  }
  while (i < s.length) {
    const ch = s[i]!
    if (ch === '\\' && s[i + 1] === '$') {
      text += '$'
      i += 2
    } else if (ch === '$') {
      const end = findClosingDollar(s, i + 1)
      if (end === -1) {
        text += s.slice(i)
        break
      }
      flush()
      inlines.push({ type: 'math', latex: s.slice(i + 1, end) })
      i = end + 1
    } else {
      text += ch
      i += 1
    }
  }
  flush()
}

function findClosingDollar(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') i += 1
    else if (s[i] === '$') return i
  }
  return -1
}
