/**
 * 右键菜单：在鼠标位置弹出，点击菜单外、按 Esc 或选择一项后关闭；可用方向键选择。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean } | 'separator'

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  label: string
}

export function ContextMenu({ x, y, items, onClose, label }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // 靠近窗口边缘时向内收，不超出窗口
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]
        next?.focus()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="context-menu" role="menu" aria-label={label} style={{ left: pos.left, top: pos.top }}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="menu-divider" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={item.danger === true ? 'is-danger' : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
