/**
 * 统一的格式工具：加粗、倾斜、下划线、文字颜色（公式可加粗、加下划线、设颜色；颜色取自格式预设）。
 *
 * 属性面板顶部的一组按钮，作用于当前正在编辑的文本框中选中的文字或公式；
 * 在文本框中也可以按 Ctrl+B / Ctrl+I / Ctrl+U。具体的改写规则见 core/model/markup.ts 的 toggleMark。
 */
import { createContext, useCallback, useContext, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { applyFormat, type FormatOp, type MarkKind } from '@core/model/markup'
import type { FormatPreset } from '@core/presets'
import type { Inline } from '@core/model/types'

/** 段落对齐（作用于光标所在的段，或选区涉及的几段）；left 为清除对齐，回到样式默认 */
export type AlignOp = { align: 'left' | 'center' | 'right' }
type Applier = (op: FormatOp | AlignOp) => void

interface FormatTarget {
  activate(apply: Applier): void
  deactivate(apply: Applier): void
}

const FormatTargetContext = createContext<FormatTarget>({ activate: () => {}, deactivate: () => {} })

/** 在属性面板中提供格式工具的作用对象 */
export function useFormatTargets(): { provider: FormatTarget; apply: (op: FormatOp | AlignOp) => void; active: boolean } {
  const current = useRef<Applier | null>(null)
  const [active, setActive] = useState(false)
  const provider = useRef<FormatTarget>({
    activate(a) {
      current.current = a
      setActive(true)
    },
    deactivate(a) {
      if (current.current === a) {
        current.current = null
        setActive(false)
      }
    }
  }).current
  return { provider, apply: (op) => current.current?.(op), active }
}

export const FormatTargetProvider = FormatTargetContext.Provider

const SHORTCUTS: Record<string, MarkKind> = { b: 'bold', i: 'italic', u: 'underline' }

/**
 * 文本框接入格式工具：聚焦时成为作用对象，并处理 Ctrl+B / I / U。
 * getState 返回当前草稿与标记对象表；onText 写回新的草稿。
 */
export function useFormattable(
  ref: RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
  getState: () => { text: string; objects: Map<number, Inline> },
  onText: (text: string) => void,
  /** 段落对齐：paragraphs 为涉及的段（输入框中一行一段）；不提供时对齐按钮对本输入框无效 */
  onAlign?: (paragraphs: number[], align: AlignOp['align']) => void
): { onFocus: () => void; onBlur: () => void; onKeyDown: (e: KeyboardEvent) => void } {
  const target = useContext(FormatTargetContext)
  const latest = useRef({ getState, onText, onAlign })
  latest.current = { getState, onText, onAlign }
  const apply = useRef<Applier>((op) => {
    const el = ref.current
    if (el === null) return
    const { text, objects } = latest.current.getState()
    if ('align' in op) {
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? start
      const first = text.slice(0, start).split('\n').length - 1
      // 选区正好止于下一段开头时，不算下一段
      const last = text.slice(0, Math.max(start, end > start && text[end - 1] === '\n' ? end - 1 : end)).split('\n').length - 1
      latest.current.onAlign?.(Array.from({ length: last - first + 1 }, (_, k) => first + k), op.align)
      requestAnimationFrame(() => el.focus())
      return
    }
    const r = applyFormat(text, objects, el.selectionStart ?? 0, el.selectionEnd ?? 0, op)
    if (r === null) return
    latest.current.onText(r.text)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(r.start, r.end)
    })
  }).current
  return {
    onFocus: useCallback(() => target.activate(apply), [target, apply]),
    onBlur: useCallback(() => target.deactivate(apply), [target, apply]),
    onKeyDown: useCallback(
      (e: KeyboardEvent) => {
        const mark = SHORTCUTS[e.key.toLowerCase()]
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && mark !== undefined) {
          e.preventDefault()
          apply({ mark })
        }
      },
      [apply]
    )
  }
}

const ALIGNS: ReadonlyArray<readonly [AlignOp['align'], string, string]> = [
  ['left', '左对齐', '左对齐（恢复默认）：光标所在的段，或选中的几段'],
  ['center', '居中', '居中：光标所在的段，或选中的几段'],
  ['right', '右对齐', '右对齐：光标所在的段，或选中的几段']
]

/** 对齐图标：四条横线，按对齐方式排列长短 */
export function AlignIcon({ align }: { align: AlignOp['align'] }) {
  const lines = [14, 9, 14, 9]
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      {lines.map((w, i) => {
        const x = align === 'left' ? 1 : align === 'right' ? 15 - w : (16 - w) / 2
        return <rect key={i} x={x} y={1 + i * 3.3} width={w} height="1.6" rx="0.8" fill="currentColor" />
      })}
    </svg>
  )
}

const BUTTONS: ReadonlyArray<readonly [MarkKind, string, string]> = [
  ['bold', 'B', '加粗（Ctrl+B）：文字与公式'],
  ['italic', 'I', '倾斜（Ctrl+I）：只作用于文字'],
  ['underline', 'U', '下划线（Ctrl+U）：文字与公式']
]

export function FormatToolbar({
  active,
  onApply,
  colors,
  keyPoint,
  showAlign = true
}: {
  active: boolean
  onApply: (op: FormatOp | AlignOp) => void
  colors: FormatPreset['textColors']
  /** 显示段落对齐按钮（表格单元格中不显示） */
  showAlign?: boolean
  /** 知识点中提供“重点”快捷按钮（红色加粗下划线，以后做默写单时挖空） */
  keyPoint?: FormatPreset['keyPoint'] | undefined
}) {
  return (
    <div className="format-toolbar" role="toolbar" aria-label="文字格式">
      {keyPoint !== undefined && (
        <>
          <button
            type="button"
            className="format-button format-keypoint"
            title={`${keyPoint.label}：${keyPoint.description}；再点一次取消`}
            aria-label={`设为${keyPoint.label}`}
            disabled={!active}
            style={{ color: `#${keyPoint.marks.color}` }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onApply({ combo: keyPoint.marks })}
          >
            {keyPoint.label}
          </button>
          <span className="format-divider" aria-hidden="true" />
        </>
      )}
      {BUTTONS.map(([mark, label, title]) => (
        <button
          key={mark}
          type="button"
          className={`format-button format-button--${mark}`}
          title={title}
          aria-label={title}
          disabled={!active}
          // 按下时不让文本框失去焦点，保留选区
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApply({ mark })}
        >
          {label}
        </button>
      ))}
      <span className="format-divider" aria-hidden="true" />
      {colors.map((c) => (
        <button
          key={c.label}
          type="button"
          className="format-button format-color"
          title={c.color !== undefined ? `文字颜色：${c.label}色（文字与公式）` : '恢复黑色（去掉颜色）'}
          aria-label={c.color !== undefined ? `文字颜色${c.label}色` : '恢复黑色'}
          disabled={!active}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApply({ color: c.color })}
        >
          <span className="format-color-swatch" style={{ background: c.color !== undefined ? `#${c.color}` : '#1f2a2e' }} />
          {c.label}
        </button>
      ))}
      {showAlign && (
        <>
          <span className="format-divider" aria-hidden="true" />
          {ALIGNS.map(([align, label, title]) => (
            <button
              key={align}
              type="button"
              className="format-button format-align"
              title={title}
              aria-label={title}
              disabled={!active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onApply({ align })}
            >
              <AlignIcon align={align} />
              <span className="visually-hidden">{label}</span>
            </button>
          ))}
        </>
      )}
      <span className="format-toolbar-hint">{active ? '作用于选中的文字或公式；对齐作用于光标所在的段' : '在下方文本框中选中文字后使用'}</span>
    </div>
  )
}
