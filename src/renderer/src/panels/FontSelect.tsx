/**
 * 字体大类选择：作用于一个输入框中的全部段落（如题干、背景材料、全部选项）。
 *
 * 选择后设置每段的整段字体，并去掉这些段落中文字自身的字体，使整块字体统一；
 * 选“随样式”则恢复为模板样式的字体。加粗、颜色等其他格式不受影响。
 */
import { FONT_FAMILIES, FONT_LABELS } from '@core/document/fonts'
import type { FontFamily, Inline, RichParagraph } from '@core/model/types'

interface Props {
  /** 这一组段落 */
  paragraphs: readonly RichParagraph[]
  /** 样式的字体，“随样式”时使用 */
  styleFont: FontFamily
  onChange: (paragraphs: RichParagraph[]) => void
  label: string
}

const MIXED = 'mixed'

/** 这组段落当前的字体：统一时为该字体（'' 表示随样式），不统一时为 mixed */
export function currentFont(paragraphs: readonly RichParagraph[]): FontFamily | '' | typeof MIXED {
  const seen = new Set<string>()
  for (const p of paragraphs) {
    const pf = p.format?.font ?? ''
    let hasText = false
    for (const i of p.inlines) {
      if (i.type !== 'text' || i.text.trim() === '') continue
      hasText = true
      seen.add(i.marks?.font ?? pf)
    }
    if (!hasText) seen.add(pf)
  }
  if (seen.size === 0) return ''
  return seen.size === 1 ? ([...seen][0] as FontFamily | '') : MIXED
}

export function applyFont(paragraphs: readonly RichParagraph[], font: FontFamily | ''): RichParagraph[] {
  return paragraphs.map((p) => {
    const inlines = p.inlines.map((i): Inline => {
      if (i.type !== 'text' || i.marks?.font === undefined) return i
      const { font: _f, ...marks } = i.marks
      return Object.keys(marks).length > 0 ? { ...i, marks } : { type: 'text', text: i.text }
    })
    const { font: _old, ...rest } = p.format ?? {}
    const format = font === '' ? rest : { ...rest, font }
    return Object.keys(format).length > 0 ? { inlines, format } : { inlines }
  })
}

export function FontSelect({ paragraphs, styleFont, onChange, label }: Props) {
  const value = currentFont(paragraphs)
  return (
    <select
      className="font-select"
      aria-label={`${label}的字体`}
      title="字体"
      value={value}
      onChange={(e) => {
        const v = e.target.value
        if (v !== MIXED) onChange(applyFont(paragraphs, v as FontFamily | ''))
      }}
    >
      <option value="">随样式（{FONT_LABELS[styleFont]}）</option>
      {FONT_FAMILIES.map((f) => (
        <option key={f} value={f}>
          {FONT_LABELS[f]}
        </option>
      ))}
      {value === MIXED && (
        <option value={MIXED} disabled>
          多种字体
        </option>
      )}
    </select>
  )
}
