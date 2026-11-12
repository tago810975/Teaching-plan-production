/**
 * 栏间分隔条：鼠标悬停时显示调整光标，按住拖动改变相邻栏宽度；
 * 双击恢复默认宽度；获得焦点后可用左右方向键微调；拖动中按 Esc 取消，回到拖动前的宽度。
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { PANEL_LIMITS, type PanelSide } from './usePanelWidths'

interface Props {
  side: PanelSide
  /** 当前宽度 */
  width: number
  /** 分隔条在工作区中的水平位置（像素，相对工作区左侧） */
  position: number
  /** 拖动中：根据指针位置给出新的宽度；total 为工作区总宽 */
  onResize: (width: number, total: number) => void
  onReset: () => void
}

const KEY_STEP = 10

export function Splitter({ side, width, position, onResize, onReset }: Props) {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; width: number; total: number } | null>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<number | null>(null)

  // 拖动中按 Esc：恢复拖动前的宽度并结束拖动（指针被捕获时分隔条拿不到焦点，所以在 window 上监听）
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const start = startRef.current
      if (start === null) return
      e.preventDefault()
      e.stopPropagation()
      onResize(start.width, start.total)
      startRef.current = null
      setDragging(false)
      document.body.classList.remove('is-resizing')
      const el = handleRef.current
      const id = pointerRef.current
      if (el !== null && id !== null && el.hasPointerCapture(id)) el.releasePointerCapture(id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dragging, onResize])

  // 组件卸载时不留下拖动状态
  useEffect(() => () => document.body.classList.remove('is-resizing'), [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const workspace = e.currentTarget.parentElement
    startRef.current = { x: e.clientX, width, total: workspace?.clientWidth ?? window.innerWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerRef.current = e.pointerId
    setDragging(true)
    document.body.classList.add('is-resizing')
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const start = startRef.current
    if (start === null) return
    const delta = e.clientX - start.x
    // 左栏向右拖变宽；右栏向左拖变宽
    onResize(side === 'left' ? start.width + delta : start.width - delta, start.total)
  }

  const end = (e: PointerEvent<HTMLDivElement>): void => {
    if (startRef.current === null) return
    startRef.current = null
    setDragging(false)
    document.body.classList.remove('is-resizing')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const total = e.currentTarget.parentElement?.clientWidth ?? window.innerWidth
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
    if (e.key === grow) onResize(width + KEY_STEP, total)
    else if (e.key === shrink) onResize(width - KEY_STEP, total)
    else if (e.key === 'Home' || e.key === 'Enter') onReset()
    else return
    e.preventDefault()
  }

  const { min, max } = PANEL_LIMITS[side]
  return (
    <div
      ref={handleRef}
      className={dragging ? 'splitter is-dragging' : 'splitter'}
      style={{ left: `${position}px` }}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '调整大纲栏宽度' : '调整属性栏宽度'}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
