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

const TOKEN = /⟦(公式|图|填空|表格)(\d+)⟧|⟦(上标|下标|加粗|倾斜|下划线|颜色|字体|重点|格式)(\d+):([^⟧]*)⟧/g

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
        // 带格式（加粗、下划线、颜色）的公式写成标记，否则改文字时 $…$ 重新解析会丢掉格式
        if (inline.latex !== undefined && inline.display !== true && inline.bold !== true && inline.underline !== true && inline.color === undefined) {
          out += `$${inline.latex}$`
        } else out += `⟦公式${add(inline)}⟧`
        break
      case 'image':
        out += `⟦图${add(inline)}⟧`
        break
      case 'blank':
        out += `⟦填空${add(inline)}⟧`
        break
      case 'table':
        out += `⟦表格${add(inline)}⟧`
        break
    }
  }
  return out
}

/** 带格式文字的标记，如 ⟦加粗3:文字⟧（用于在输入框中给选中的文字加上格式） */
export function formatToken(n: number, marks: TextMarks, text: string): string {
  return `⟦${markName(marks)}${n}:${text}⟧`
}

/** 重点（知识梳理中的挖空内容）：红色加粗下划线，与格式预设 keyPoint 一致 */
export const KEY_POINT_MARKS: Readonly<Required<Pick<TextMarks, 'bold' | 'underline' | 'color'>>> = Object.freeze({
  bold: true,
  underline: true,
  color: 'C00000'
})

/** 是否正好是“重点”格式（红色加粗下划线，没有别的格式） */
export function isKeyPoint(m: TextMarks): boolean {
  const keys = Object.keys(m)
  return keys.length === 3 && m.bold === true && m.underline === true && m.color?.toUpperCase() === KEY_POINT_MARKS.color
}

function markName(m: TextMarks): string {
  if (isKeyPoint(m)) return '重点'
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

// ---------------- 格式工具：加粗、倾斜、下划线、颜色 ----------------

export type MarkKind = 'bold' | 'italic' | 'underline'

/**
 * 格式操作：切换加粗/倾斜/下划线；设定颜色（color 为 undefined 表示恢复黑色）；
 * 或切换一组格式（如“重点”= 红色加粗下划线：都有时取消，否则全部加上）。
 */
export type FormatOp = { mark: MarkKind } | { color: string | undefined } | { combo: { bold?: boolean; underline?: boolean; color?: string } }

export interface MarkEdit {
  text: string
  /** 修改后应选中的范围（覆盖改动的部分） */
  start: number
  end: number
}

/** 切换加粗、倾斜或下划线（像 Word 的 Ctrl+B）。规则见 applyFormat */
export function toggleMark(text: string, objects: Map<number, Inline>, start: number, end: number, mark: MarkKind): MarkEdit | null {
  return applyFormat(text, objects, start, end, { mark })
}

/** 设定文字颜色；color 为 undefined 时恢复黑色（去掉颜色） */
export function setTextColor(text: string, objects: Map<number, Inline>, start: number, end: number, color: string | undefined): MarkEdit | null {
  return applyFormat(text, objects, start, end, { color: color?.toUpperCase() })
}

/**
 * 在可编辑文本中给选中范围改格式：
 * - 普通文字包成格式标记，如 ⟦加粗3:文字⟧；新写的 $公式$ 变成公式标记；
 * - 已有的格式标记、公式标记在原有格式上增减（选区只碰到标记的一部分时按整个标记处理）；
 * - 加粗/倾斜/下划线：选中的内容都已有该格式时取消，否则加上；颜色：一律设为所选颜色；
 * - 公式可加粗、加下划线、设颜色（倾斜对公式不起作用）；图片、填空不受影响。
 * 改完后整个文本的标记按出现顺序重新编号为 1、2、3……，objects 只保留用到的（会修改传入的 Map）。
 * 没有可改的内容时返回 null。
 */
export function applyFormat(text: string, objects: Map<number, Inline>, start: number, end: number, op: FormatOp): MarkEdit | null {
  // 选区扩展到完整的标记
  for (const m of text.matchAll(TOKEN)) {
    const s = m.index
    const e = s + m[0].length
    if (s < start && e > start) start = s
    if (s < end && e > end) end = e
  }
  if (start >= end) return null
  const range = text.slice(start, end)

  interface Piece {
    plain?: string
    token?: RegExpMatchArray
  }
  const pieces: Piece[] = []
  let last = 0
  for (const m of range.matchAll(TOKEN)) {
    if (m.index > last) pieces.push({ plain: range.slice(last, m.index) })
    pieces.push({ token: m })
    last = m.index + m[0].length
  }
  if (last < range.length) pieces.push({ plain: range.slice(last) })

  const isMark = 'mark' in op
  const combo = 'combo' in op ? { ...op.combo, ...(op.combo.color !== undefined ? { color: op.combo.color.toUpperCase() } : {}) } : null
  const toggles = isMark || combo !== null
  const mathOk = !isMark || op.mark !== 'italic'
  /** 是否已有该格式（切换类操作用） */
  const has = (o: Record<string, unknown>): boolean =>
    isMark ? o[op.mark] === true : Object.entries(combo!).every(([k, v]) => (typeof v === 'string' ? String(o[k] ?? '').toUpperCase() === v : o[k] === v))
  // 切换类：所有可改的内容都已有该格式时取消，否则加上
  let on = true
  if (toggles) {
    const states: boolean[] = []
    for (const p of pieces) {
      if (p.plain !== undefined) {
        if (p.plain.trim() !== '') states.push(false)
        continue
      }
      const obj = objects.get(Number(p.token![2] ?? p.token![4]))
      if (obj?.type === 'text' && p.token![5] !== undefined) states.push(has((obj.marks ?? {}) as Record<string, unknown>))
      else if (obj?.type === 'math' && mathOk) states.push(has(obj as unknown as Record<string, unknown>))
    }
    if (states.length === 0) return null
    on = !states.every(Boolean)
  }

  /** 改一组格式（TextMarks 或公式本身） */
  const change = <T extends object>(o: T): T => {
    const copy = { ...o } as Record<string, unknown>
    if (isMark) {
      if (on) copy[op.mark] = true
      else delete copy[op.mark]
    } else if (combo !== null) {
      for (const [k, v] of Object.entries(combo)) {
        if (on) copy[k] = v
        else if (typeof v === 'string' ? String(copy[k] ?? '').toUpperCase() === v : copy[k] === v) delete copy[k]
      }
    } else if ('color' in op && op.color !== undefined) copy.color = op.color
    else delete copy.color
    return copy as T
  }

  let next = Math.max(0, ...objects.keys()) + 1
  const register = (inline: Inline): number => {
    objects.set(next, inline)
    return next++
  }

  let changed = false
  let out = ''
  for (const p of pieces) {
    if (p.plain !== undefined) {
      // 普通文字：取消格式、恢复黑色时不用改
      if ((toggles && !on) || ('color' in op && op.color === undefined)) {
        out += p.plain
        continue
      }
      // 逐行处理：标记不能跨行
      out += p.plain
        .split('\n')
        .map((line) => {
          const inlines: Inline[] = []
          pushPlain(inlines, line)
          return inlines
            .map((i) => {
              if (i.type === 'text') {
                if (i.text.trim() === '') return i.text.replace(/\$/g, '\\$')
                changed = true
                const marks = change({} as TextMarks)
                return formatToken(register({ type: 'text', text: i.text, marks }), marks, i.text)
              }
              if (i.type === 'math') {
                if (!mathOk) return `$${i.latex ?? ''}$`
                changed = true
                return `⟦公式${register(change(i))}⟧`
              }
              return ''
            })
            .join('')
        })
        .join('\n')
      continue
    }
    const m = p.token!
    const obj = objects.get(Number(m[2] ?? m[4]))
    if (obj?.type === 'text' && m[5] !== undefined) {
      const marks = change(obj.marks ?? {})
      changed = true
      out += Object.keys(marks).length === 0 ? m[5] : formatToken(register({ type: 'text', text: m[5], marks }), marks, m[5])
    } else if (obj?.type === 'math' && mathOk) {
      changed = true
      out += `⟦公式${register(change(obj))}⟧`
    } else {
      out += m[0]
    }
  }
  if (!changed) return null

  // 重新编号：按出现顺序 1、2、3……（选区边界不会落在标记中间，可分三段处理）
  const renumber = compactor(objects, text.slice(0, start) + out + text.slice(end))
  const before = renumber(text.slice(0, start))
  const middle = renumber(out)
  const after = renumber(text.slice(end))
  renumber.commit()
  return { text: before + middle + after, start: before.length, end: before.length + middle.length }
}

/**
 * 标记重新编号。依次调用返回的函数改写各段文字，最后 commit() 把 objects 换成新编号。
 * 无效的编号（如从别处粘贴来的）原样保留，新编号会避开它们。
 */
function compactor(objects: Map<number, Inline>, whole: string): ((s: string) => string) & { commit(): void } {
  const invalid = new Set<number>()
  for (const m of whole.matchAll(TOKEN)) {
    const n = Number(m[2] ?? m[4])
    if (!objects.has(n)) invalid.add(n)
  }
  const fresh = new Map<number, Inline>()
  let n = 0
  const take = (): number => {
    do n += 1
    while (invalid.has(n))
    return n
  }
  const fn = ((s: string) =>
    s.replace(TOKEN, (whole, a: string | undefined, an: string | undefined, b: string | undefined, bn: string | undefined, inner: string | undefined) => {
      const old = Number(an ?? bn)
      const obj = objects.get(old)
      if (obj === undefined) return whole
      const k = take()
      fresh.set(k, obj)
      return a !== undefined ? `⟦${a}${k}⟧` : `⟦${b}${k}:${inner}⟧`
    })) as ((s: string) => string) & { commit(): void }
  fn.commit = () => {
    objects.clear()
    for (const [k, v] of fresh) objects.set(k, v)
  }
  return fn
}
