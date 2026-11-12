/**
 * 配色主题切换（设置对话框中）：一排色块，点一下立即生效并保存。
 */
import type { KeyboardEvent } from 'react'
import { THEMES } from '@shared/themes'
import { setTheme, useTheme } from '../theme/theme'

export function ThemePicker({ label }: { label: string }) {
  const current = useTheme()
  const index = THEMES.findIndex((t) => t.id === current)

  // 单选组的方向键习惯：左右切换
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const next = THEMES[(index + step + THEMES.length) % THEMES.length]!
    setTheme(next.id)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-id="${next.id}"]`)?.focus()
  }

  return (
    <div className="theme-swatches" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {THEMES.map((t) => {
          const on = t.id === current
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-theme-id={t.id}
              className={on ? 'theme-swatch is-active' : 'theme-swatch'}
              title={t.name}
              onClick={() => setTheme(t.id)}
            >
              <span className="theme-swatch-chip" aria-hidden="true" style={{ background: t.swatch.desk }}>
                <span style={{ background: t.swatch.panel }} />
                <span style={{ background: t.swatch.accent }} />
              </span>
              <span className="theme-swatch-name">{t.name}</span>
            </button>
          )
        })}
    </div>
  )
}
