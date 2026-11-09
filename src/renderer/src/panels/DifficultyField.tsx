/**
 * 题目难度：等级（如 A、B、C，显示为【B】）与星级（1～5 颗星，显示为 ★★★），可同时使用。
 */
import { useId } from 'react'

interface Props {
  grade: string | undefined
  stars: number | undefined
  /** 预设中的常用等级 */
  grades: readonly string[]
  maxStars: number
  onChange: (grade: string | undefined, stars: number | undefined) => void
}

export function DifficultyField({ grade, stars, grades, maxStars, onChange }: Props) {
  const id = useId()
  const custom = grade !== undefined && !grades.includes(grade)
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span className="field-label" id={id}>
        难度
      </span>
      <div className="difficulty-row">
        <div className="segmented" role="radiogroup" aria-label="难度等级">
          {[undefined, ...grades, ...(custom ? [grade] : [])].map((g) => (
            <button
              key={g ?? 'none'}
              type="button"
              role="radio"
              aria-checked={grade === g}
              className={grade === g ? 'is-active' : undefined}
              onClick={() => onChange(g, stars)}
            >
              {g ?? '无'}
            </button>
          ))}
        </div>
        <div className="stars" role="radiogroup" aria-label="星级难度">
          {Array.from({ length: maxStars }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} 星`}
              title={stars === n ? '再点一次取消星级' : `${n} 星`}
              className={stars !== undefined && n <= stars ? 'star is-on' : 'star'}
              onClick={() => onChange(grade, stars === n ? undefined : n)}
            >
              {stars !== undefined && n <= stars ? '★' : '☆'}
            </button>
          ))}
        </div>
      </div>
      <p className="field-hint">显示在题干开头，如【B】★★★；星越多越难。都不选则不显示。</p>
    </div>
  )
}
