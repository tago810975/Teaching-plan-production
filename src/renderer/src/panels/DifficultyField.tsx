/**
 * 题目难度：按格式预设的等级选择，每个等级对应若干颗星（物理教案 V1.0：A=1 星简单、B=2 星中等、C=3 星难）。
 * 显示在题干开头，如【B】★★。数据中只存等级；预设中没有的等级（旧数据手填的）也能看到并保留。
 */
import { useId } from 'react'
import type { FormatPreset } from '@core/presets'

interface Props {
  /** 当前等级（已按预设由星级换算） */
  grade: string | undefined
  levels: FormatPreset['difficulty']['levels']
  onChange: (grade: string | undefined) => void
}

export function DifficultyField({ grade, levels, onChange }: Props) {
  const id = useId()
  const custom = grade !== undefined && !levels.some((l) => l.grade === grade)
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span className="field-label" id={id}>
        难度
      </span>
      <div className="segmented difficulty-levels" role="radiogroup" aria-label="难度">
        <button type="button" role="radio" aria-checked={grade === undefined} className={grade === undefined ? 'is-active' : undefined} onClick={() => onChange(undefined)}>
          无
        </button>
        {levels.map((l) => (
          <button
            key={l.grade}
            type="button"
            role="radio"
            aria-checked={grade === l.grade}
            aria-label={`${l.grade}，${l.stars} 星，${l.label}`}
            title={l.label}
            className={grade === l.grade ? 'is-active' : undefined}
            onClick={() => onChange(l.grade)}
          >
            {l.grade} <span className="difficulty-stars">{'★'.repeat(l.stars)}</span> {l.label}
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked className="is-active" title="预设中没有这个等级">
            {grade}
          </button>
        )}
      </div>
      <p className="field-hint">显示在题干开头，如【B】★★；星越多越难。</p>
    </div>
  )
}
