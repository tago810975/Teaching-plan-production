/**
 * 栏间分隔条：鼠标悬停时显示调整光标，按住拖动改变相邻栏宽度；
 * 双击恢复默认宽度；获得焦点后可用左右方向键微调。
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
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

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const workspace = e.currentTarget.parentElement
    startRef.current = { x: e.clientX, width, total: workspace?.clientWidth ?? window.innerWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
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
