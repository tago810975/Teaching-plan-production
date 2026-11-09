/**
 * 选项列位置：选择间距方案（内置“默认”“模板原位置”与自己保存的方案），或直接修改各列从第几个字开始
 * （从左页边距算起，五号字一个字 = 210 twip，对应 Word 段落的制表位），并可另存为新方案。
 */
import { useId, useState } from 'react'
import { STYLE_SPECS } from '@core/document/styles'
import { A4_PAGE, contentWidthTwip } from '@core/document/units'
import {
  BUILTIN_OPTION_STOP_SCHEMES,
  matchScheme,
  schemeNameProblem,
  validStops
} from '@core/model/option-stop-schemes'
import { copyStops } from '@core/model/factory'
import type { OptionStops } from '@core/model/types'
import { useOptionStopSchemes } from '../state/optionStopSchemes'

export { validStops }

const CHAR = 210
const toChars = (twip: number): number => Math.round((twip / CHAR) * 10) / 10
/** A 列的起点（选项样式的左缩进） */
const FIRST = STYLE_SPECS.option.indentLeftTwip
const RIGHT = contentWidthTwip(A4_PAGE)
const CUSTOM = '\u0000custom'

interface Props {
  stops: OptionStops
  onChange: (stops: OptionStops) => void
}

export function OptionStopsEditor({ stops, onChange }: Props) {
  const [userSchemes, saveSchemes] = useOptionStopSchemes()
  const current = matchScheme(stops, userSchemes)
  const isUser = current !== undefined && !BUILTIN_OPTION_STOP_SCHEMES.includes(current)
  const [naming, setNaming] = useState<string | null>(null)
  const selectId = useId()
  const describe = (s: OptionStops): string => s.four.map(toChars).join(' / ')

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

  const problem = naming !== null ? schemeNameProblem(naming) : null
  const save = async (): Promise<void> => {
    if (naming === null || problem !== null) return
    const name = naming.trim()
    // 同名的方案覆盖
    await saveSchemes([...userSchemes.filter((s) => s.name !== name), { name, stops: copyStops(stops) }])
    setNaming(null)
  }

  return (
    <div className="option-stops">
      <div className="option-stops-scheme">
        <label htmlFor={selectId}>间距方案</label>
        <select
          id={selectId}
          value={current?.name ?? CUSTOM}
          onChange={(e) => {
            const s = [...BUILTIN_OPTION_STOP_SCHEMES, ...userSchemes].find((x) => x.name === e.target.value)
            if (s !== undefined) onChange(copyStops(s.stops))
          }}
        >
          {BUILTIN_OPTION_STOP_SCHEMES.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}（{describe(s.stops)} 字）
            </option>
          ))}
          {userSchemes.length > 0 && (
            <optgroup label="我的方案">
              {userSchemes.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}（{describe(s.stops)} 字）
                </option>
              ))}
            </optgroup>
          )}
          {current === undefined && <option value={CUSTOM}>自定义（未保存）</option>}
        </select>
      </div>
      {row('four', ['B', 'C', 'D'], '每行 4 项')}
      {row('two', ['B'], '每行 2 项')}
      <p className="field-hint">
        数字是各列从第几个字开始（从左页边距算起，A 列从第 {toChars(FIRST)} 字开始，一行共约 {toChars(RIGHT)} 字）。
      </p>
      {naming === null ? (
        <div className="group-actions">
          <button type="button" onClick={() => setNaming(isUser ? current.name : '')}>
            {isUser ? '更新此方案…' : '另存为方案…'}
          </button>
          {isUser && (
            <button
              type="button"
              className="link danger"
              onClick={() => {
                if (window.confirm(`删除间距方案“${current.name}”？已使用它的教学案不受影响。`)) {
                  void saveSchemes(userSchemes.filter((s) => s !== current))
                }
              }}
            >
              删除此方案
            </button>
          )}
        </div>
      ) : (
        <div className="option-stops-save">
          <input
            type="text"
            autoFocus
            aria-label="方案名称"
            placeholder="方案名称，如“图片选项宽松”"
            value={naming}
            maxLength={20}
            aria-invalid={problem !== null && naming !== ''}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setNaming(null)
            }}
          />
          <button type="button" className="primary" disabled={problem !== null} onClick={() => void save()}>
            保存
          </button>
          <button type="button" onClick={() => setNaming(null)}>
            取消
          </button>
          {naming.trim() !== '' && problem !== null && <span className="field-error">{problem}</span>}
          {problem === null && userSchemes.some((s) => s.name === naming.trim()) && <span className="field-hint">将覆盖同名方案</span>}
        </div>
      )}
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
