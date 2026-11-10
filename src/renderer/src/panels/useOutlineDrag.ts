/**
 * 大纲长按拖拽排序。
 *
 * - 按住约 0.3 秒进入拖动；按下后很快移动则视为普通点击或滚动，不进入拖动；
 * - 拖动中显示插入线，松开即移动；Esc 取消；
 * - 拖动中滚动鼠标滚轮会加速滚动大纲；指针靠近大纲上下边缘时自动滚动；
 * - 拖动题目（含综合题中的小题）时可放进综合题的任意位置或拖出到顶层；综合题末尾的空隙
 *   按指针左右区分——偏右（缩进处）放进综合题最后，偏左放在综合题后面。其他内容只在顶层移动。
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

/** 放下的位置：顶层第 index 块之前，或某道综合题第 index 道小题之前 */
export type DropTarget = { kind: 'top'; index: number } | { kind: 'item'; compositeId: string; index: number }

/** 综合题末尾的空隙：指针在列表左边缘右侧多远以内算“放在综合题后面” */
const NEST_X = 40

export interface DragState {
  blockId: string
  /** 拖的是题目（可进出综合题） */
  isQuestion: boolean
  /** 插入位置（按移动前的顺序） */
  target: DropTarget
  /** 插入线相对列表内容顶部的位置；nested 为插入线缩进（放进综合题） */
  lineTop: number
  nested: boolean
  /** 浮起的那一项跟随指针的位置（视口坐标） */
  ghostX: number
  ghostY: number
  label: string
}

export function useOutlineDrag(
  listRef: RefObject<HTMLOListElement | null>,
  onMove: (blockId: string, target: DropTarget, isQuestion: boolean) => void
): {
  drag: DragState | null
  onItemPointerDown: (e: ReactPointerEvent<HTMLElement>, blockId: string, label: string, isQuestion: boolean) => void
  /** 拖动结束后紧接着的 click 不应选中条目 */
  consumeClick: () => boolean
} {
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  const pending = useRef<{ timer: number; x: number; y: number; pointerId: number; blockId: string; label: string; isQuestion: boolean } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  /** 拖动结束的时间：紧随其后的 click 不应选中条目（Esc 取消时可能根本没有 click，所以按时间判断） */
  const draggedAt = useRef(0)
  const frame = useRef(0)

  /** 根据指针位置计算插入位置与插入线 */
  const locate = useCallback(
    (clientX: number, clientY: number, isQuestion: boolean): { target: DropTarget; lineTop: number; nested: boolean } => {
      const list = listRef.current
      if (list === null) return { target: { kind: 'top', index: 0 }, lineTop: 0, nested: false }
      const listRect = list.getBoundingClientRect()
      const top = (r: DOMRect): number => r.top - listRect.top + list.scrollTop
      const bottom = (r: DOMRect): number => r.bottom - listRect.top + list.scrollTop
      // 其他内容：只有顶层条目参与排序（综合题中的小题随综合题移动）
      const tops = Array.from(list.querySelectorAll<HTMLElement>(':scope > li[data-top-index]'))
      if (!isQuestion) {
        for (let i = 0; i < tops.length; i++) {
          const r = tops[i]!.getBoundingClientRect()
          if (clientY < r.top + r.height / 2) return { target: { kind: 'top', index: i }, lineTop: top(r), nested: false }
        }
        const last = tops[tops.length - 1]?.getBoundingClientRect()
        return { target: { kind: 'top', index: tops.length }, lineTop: last ? bottom(last) : 0, nested: false }
      }
      // 题目：顶层条目与小题都参与；找出指针所在的空隙（上一行 prev、下一行 next）
      const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > li'))
      let i = rows.findIndex((row) => {
        const r = row.getBoundingClientRect()
        return clientY < r.top + r.height / 2
      })
      if (i === -1) i = rows.length
      const prev = rows[i - 1]
      const next = rows[i]
      const lineTop = next !== undefined ? top(next.getBoundingClientRect()) : prev !== undefined ? bottom(prev.getBoundingClientRect()) : 0
      // 下一行是小题：放在这道小题之前
      if (next?.dataset.parentId !== undefined) {
        return { target: { kind: 'item', compositeId: next.dataset.parentId, index: Number(next.dataset.itemIndex) }, lineTop, nested: true }
      }
      // 上一行是综合题的最后一道小题（或没有小题的综合题）：按指针左右决定放进综合题还是放在它后面
      const compositeId = prev?.dataset.parentId ?? prev?.dataset.compositeId
      const count = prev?.dataset.parentId !== undefined ? Number(prev.dataset.itemIndex) + 1 : Number(prev?.dataset.itemCount ?? 0)
      if (compositeId !== undefined && clientX > listRect.left + NEST_X) {
        return { target: { kind: 'item', compositeId, index: count }, lineTop, nested: true }
      }
      return { target: { kind: 'top', index: next !== undefined ? Number(next.dataset.topIndex) : tops.length }, lineTop, nested: false }
    },
    [listRef]
  )

  const update = useCallback(() => {
    const d = dragRef.current
    if (d === null) return
    const { x, y } = pointer.current
    setDrag({ ...d, ...locate(x, y, d.isQuestion), ghostX: x, ghostY: y })
  }, [locate])

  const finish = useCallback(
    (commit: boolean) => {
      const d = dragRef.current
      cancelAnimationFrame(frame.current)
      document.body.classList.remove('is-dragging-outline')
      setDrag(null)
      if (d !== null) {
        draggedAt.current = performance.now()
        if (commit) onMove(d.blockId, d.target, d.isQuestion)
      }
    },
    [onMove]
  )

  const onItemPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, blockId: string, label: string, isQuestion: boolean) => {
      if (e.button !== 0) return
      pointer.current = { x: e.clientX, y: e.clientY }
      const timer = window.setTimeout(() => {
        const p = pending.current
        pending.current = null
        if (p === null) return
        listRef.current?.setPointerCapture(p.pointerId)
        document.body.classList.add('is-dragging-outline')
        const start: DragState = { blockId: p.blockId, label: p.label, isQuestion: p.isQuestion, ...locate(pointer.current.x, pointer.current.y, p.isQuestion), ghostX: pointer.current.x, ghostY: pointer.current.y }
        dragRef.current = start
        setDrag(start)
      }, LONG_PRESS_MS)
      pending.current = { timer, x: e.clientX, y: e.clientY, pointerId: e.pointerId, blockId, label, isQuestion }
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
