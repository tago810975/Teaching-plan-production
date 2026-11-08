/**
 * 大纲长按拖拽排序。
 *
 * - 按住约 0.3 秒进入拖动；按下后很快移动则视为普通点击或滚动，不进入拖动；
 * - 拖动中显示插入线，松开即移动；Esc 取消；
 * - 拖动中滚动鼠标滚轮会加速滚动大纲；指针靠近大纲上下边缘时自动滚动。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

const LONG_PRESS_MS = 300
/** 长按判定期间允许的抖动距离 */
const MOVE_TOLERANCE = 6
/** 拖动结束后多长时间内的 click 视为松开鼠标产生的，不选中条目 */
const CLICK_SUPPRESS_MS = 300
/** 滚轮加速倍数 */
const WHEEL_BOOST = 3
/** 靠近边缘自动滚动的范围与最大速度（像素 / 帧） */
const EDGE_ZONE = 36
const EDGE_SPEED = 18

export interface DragState {
  blockId: string
  /** 插入位置：放在第几项之前（按移动前的顺序） */
  targetIndex: number
  /** 插入线相对列表内容顶部的位置 */
  lineTop: number
  /** 浮起的那一项跟随指针的位置（视口坐标） */
  ghostX: number
  ghostY: number
  label: string
}

export function useOutlineDrag(
  listRef: RefObject<HTMLOListElement | null>,
  onMove: (blockId: string, toIndex: number) => void
): {
  drag: DragState | null
  onItemPointerDown: (e: ReactPointerEvent<HTMLElement>, blockId: string, label: string) => void
  /** 拖动结束后紧接着的 click 不应选中条目 */
  consumeClick: () => boolean
} {
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  const pending = useRef<{ timer: number; x: number; y: number; pointerId: number; blockId: string; label: string } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  /** 拖动结束的时间：紧随其后的 click 不应选中条目（Esc 取消时可能根本没有 click，所以按时间判断） */
  const draggedAt = useRef(0)
  const frame = useRef(0)

  /** 根据指针位置计算插入位置与插入线 */
  const locate = useCallback(
    (clientY: number): { targetIndex: number; lineTop: number } => {
      const list = listRef.current
      if (list === null) return { targetIndex: 0, lineTop: 0 }
      // 只有顶层条目参与排序（综合题中的小题随综合题移动）
      const items = Array.from(list.querySelectorAll<HTMLElement>(':scope > li[data-top-index]'))
      const listRect = list.getBoundingClientRect()
      for (let i = 0; i < items.length; i++) {
        const r = items[i]!.getBoundingClientRect()
        if (clientY < r.top + r.height / 2) {
          return { targetIndex: i, lineTop: r.top - listRect.top + list.scrollTop }
        }
      }
      const last = items[items.length - 1]?.getBoundingClientRect()
      return { targetIndex: items.length, lineTop: last ? last.bottom - listRect.top + list.scrollTop : 0 }
    },
    [listRef]
  )

  const update = useCallback(() => {
    const d = dragRef.current
    if (d === null) return
    const { x, y } = pointer.current
    setDrag({ ...d, ...locate(y), ghostX: x, ghostY: y })
  }, [locate])

  const finish = useCallback(
    (commit: boolean) => {
      const d = dragRef.current
      cancelAnimationFrame(frame.current)
      document.body.classList.remove('is-dragging-outline')
      setDrag(null)
      if (d !== null) {
        draggedAt.current = performance.now()
        if (commit) onMove(d.blockId, d.targetIndex)
      }
    },
    [onMove]
  )

  const onItemPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, blockId: string, label: string) => {
      if (e.button !== 0) return
      pointer.current = { x: e.clientX, y: e.clientY }
      const timer = window.setTimeout(() => {
        const p = pending.current
        pending.current = null
        if (p === null) return
        listRef.current?.setPointerCapture(p.pointerId)
        document.body.classList.add('is-dragging-outline')
        const start: DragState = { blockId: p.blockId, label: p.label, ...locate(pointer.current.y), ghostX: pointer.current.x, ghostY: pointer.current.y }
        dragRef.current = start
        setDrag(start)
      }, LONG_PRESS_MS)
      pending.current = { timer, x: e.clientX, y: e.clientY, pointerId: e.pointerId, blockId, label }
    },
    [listRef, locate]
  )

  // 指针移动、松开、取消，以及 Esc 与滚轮
  useEffect(() => {
    const onMoveEvt = (e: PointerEvent): void => {
      pointer.current = { x: e.clientX, y: e.clientY }
      const p = pending.current
      if (p !== null && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) {
        clearTimeout(p.timer)
        pending.current = null
      }
      if (dragRef.current !== null) update()
    }
    const onUp = (): void => {
      if (pending.current !== null) {
        clearTimeout(pending.current.timer)
        pending.current = null
      }
      if (dragRef.current !== null) finish(true)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dragRef.current !== null) {
        e.preventDefault()
        e.stopPropagation()
        finish(false)
      }
    }
    const onWheel = (e: WheelEvent): void => {
      const list = listRef.current
      if (dragRef.current === null || list === null) return
      e.preventDefault()
      list.scrollTop += e.deltaY * WHEEL_BOOST
      update()
    }
    window.addEventListener('pointermove', onMoveEvt)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('pointermove', onMoveEvt)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onWheel)
    }
  }, [finish, listRef, update])

  // 靠近边缘时自动滚动
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const tick = (): void => {
      const list = listRef.current
      if (list !== null) {
        const r = list.getBoundingClientRect()
        const y = pointer.current.y
        let speed = 0
        if (y < r.top + EDGE_ZONE) speed = -EDGE_SPEED * Math.min(1, (r.top + EDGE_ZONE - y) / EDGE_ZONE)
        else if (y > r.bottom - EDGE_ZONE) speed = EDGE_SPEED * Math.min(1, (y - (r.bottom - EDGE_ZONE)) / EDGE_ZONE)
        if (speed !== 0) {
          list.scrollTop += speed
          update()
        }
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [dragging, listRef, update])

  const consumeClick = useCallback((): boolean => performance.now() - draggedAt.current < CLICK_SUPPRESS_MS, [])

  return { drag, onItemPointerDown, consumeClick }
}
