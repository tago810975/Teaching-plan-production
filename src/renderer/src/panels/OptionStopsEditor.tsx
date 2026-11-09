/**
 * 选项列位置：每行 2 项、4 项时各列从第几个字开始（从左页边距算起，五号字一个字 = 210 twip），
 * 对应 Word 段落的制表位。
 */
import { useState } from 'react'
import { STYLE_SPECS } from '@core/document/styles'
import { A4_PAGE, contentWidthTwip } from '@core/document/units'
import type { OptionStops } from '@core/model/types'

const CHAR = 210
const toChars = (twip: number): number => Math.round((twip / CHAR) * 10) / 10
/** A 列的起点（选项样式的左缩进） */
const FIRST = STYLE_SPECS.option.indentLeftTwip
const RIGHT = contentWidthTwip(A4_PAGE)

/** 列位置是否可用：从小到大，每列至少 2 个字宽，最后一列不超出栏宽 */
export function validStops(stops: readonly number[]): boolean {
  const edges = [FIRST, ...stops, RIGHT]
  return edges.every((e, i) => i === 0 || e - edges[i - 1]! >= 2 * CHAR)
}

interface Props {
  stops: OptionStops
  onChange: (stops: OptionStops) => void
}

export function OptionStopsEditor({ stops, onChange }: Props) {
  const row = (key: 'two' | 'four', names: string[], caption: string) => (
    <div className="option-stops-row">
      <span className="option-stops-caption">{caption}</span>
      {names.map((name, i) => (
        <label key={name}>
          {name}
          <CharInput
            label={`${caption} ${name}列的位置（字）`}
            twip={stops[key][i]!}
            onCommit={(twip) => {
              const next = stops[key].slice() as number[]
              next[i] = twip
              if (!validStops(next)) return false
              onChange({ ...stops, [key]: next } as OptionStops)
              return true
            }}
          />
        </label>
      ))}
    </div>
  )
  return (
    <div className="option-stops">
      {row('four', ['B', 'C', 'D'], '每行 4 项')}
      {row('two', ['B'], '每行 2 项')}
      <p className="field-hint">
        数字是各列从第几个字开始（从左页边距算起，A 列从第 {toChars(FIRST)} 字开始，一行共约 {toChars(RIGHT)} 字）。
      </p>
    </div>
  )
}

/** 以“字”为单位的输入框：输入过程中允许暂时无效的数字，有效时立即生效，离开时恢复为实际值 */
function CharInput({ twip, onCommit, label }: { twip: number; onCommit: (twip: number) => boolean; label: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  return (
    <input
      type="number"
      step={0.5}
      min={1}
      max={toChars(RIGHT)}
      aria-label={label}
      aria-invalid={invalid}
      className={invalid ? 'is-invalid' : undefined}
      value={draft ?? toChars(twip)}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = Number(e.target.value)
        const ok = e.target.value !== '' && Number.isFinite(v) && onCommit(Math.round(v * CHAR))
        setInvalid(!ok)
      }}
      onBlur={() => {
        setDraft(null)
        setInvalid(false)
      }}
    />
  )
}
