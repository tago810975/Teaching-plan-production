/**
 * 公式工具栏，仿照 WPS 公式编辑器：一排分类按钮（上方是公式图标，下方是类别名与下拉箭头），
 * 点击后展开该类的模板面板，模板直接显示为公式。
 */
import { memo, useEffect, useRef, useState } from 'react'
import temml from 'temml'
import { TEMPLATE_GROUPS, templatePreview, type TemplateGroup } from '@core/math/templates'

interface Props {
  onInsert: (latex: string) => void
  /** 面板打开状态变化，供弹窗判断 Esc 是关闭面板还是关闭弹窗 */
  onOpenChange?: (open: boolean) => void
  /** 每次变化都会关闭已打开的面板（弹窗中按 Esc 时递增） */
  closeRequest?: number
}

/** 渲染结果缓存：模板是固定的，渲染一次即可 */
const cache = new Map<string, string>()
function render(latex: string): string {
  let html = cache.get(latex)
  if (html === undefined) {
    try {
      html = temml.renderToString(templatePreview(latex))
    } catch {
      html = latex
    }
    cache.set(latex, html)
  }
  return html
}

const MathIcon = memo(function MathIcon({ latex }: { latex: string }) {
  return <span className="ftb-math" dangerouslySetInnerHTML={{ __html: render(latex) }} />
})

/** 点击按钮时不让公式框失去焦点，插入后可以直接继续输入 */
const keepFocus = (e: { preventDefault: () => void }): void => e.preventDefault()

export function FormulaToolbar({ onInsert, onOpenChange, closeRequest }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => setOpenId(null), [closeRequest])

  useEffect(() => onOpenChange?.(openId !== null), [openId, onOpenChange])

  useEffect(() => {
    if (openId === null) return
    const close = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenId(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [openId])

  const open = TEMPLATE_GROUPS.find((g) => g.id === openId)

  return (
    <div className="ftb" ref={rootRef}>
      <div className="ftb-groups" role="toolbar" aria-label="公式模板">
        {TEMPLATE_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={g.id === openId ? 'ftb-group is-open' : 'ftb-group'}
            aria-haspopup="true"
            aria-expanded={g.id === openId}
            onMouseDown={keepFocus}
            onClick={() => setOpenId((cur) => (cur === g.id ? null : g.id))}
          >
            <span className="ftb-icon">
              <MathIcon latex={g.icon} />
            </span>
            <span className="ftb-label">
              {g.label}
              <span className="ftb-caret" aria-hidden="true">
                ▾
              </span>
            </span>
          </button>
        ))}
      </div>
      {open !== undefined && (
        <TemplatePanel
          group={open}
          onPick={(latex) => {
            setOpenId(null)
            onInsert(latex)
          }}
        />
      )}
    </div>
  )
}

function TemplatePanel({ group, onPick }: { group: TemplateGroup; onPick: (latex: string) => void }) {
  return (
    <div className="ftb-panel" role="menu" aria-label={group.label}>
      <div className="ftb-panel-title">{group.label}</div>
      <div className="ftb-grid" style={{ gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))` }}>
        {group.templates.map((tpl) => (
          <button
            key={tpl.latex}
            type="button"
            role="menuitem"
            className="ftb-item"
            title={tpl.title}
            aria-label={tpl.title}
            onMouseDown={keepFocus}
            onClick={() => onPick(tpl.latex)}
          >
            <MathIcon latex={tpl.latex} />
          </button>
        ))}
      </div>
    </div>
  )
}
