/**
 * 左侧大纲栏与右侧属性栏的宽度：可拖拽调整，并在本机记住。
 */
import { useCallback, useEffect, useState } from 'react'
import { clampPanelWidth, PANEL_LIMITS, type PanelSide } from '@shared/panel-layout'

export { PANEL_LIMITS, MIN_PREVIEW_WIDTH, clampPanelWidth, type PanelSide } from '@shared/panel-layout'

const STORAGE_KEY = 'editor.panelWidths'

export type PanelWidths = Record<PanelSide, number>

function load(): PanelWidths {
  const fallback = { left: PANEL_LIMITS.left.default, right: PANEL_LIMITS.right.default }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as Partial<PanelWidths>
    return {
      left: clampToLimits('left', parsed.left ?? fallback.left),
      right: clampToLimits('right', parsed.right ?? fallback.right)
    }
  } catch {
    return fallback
  }
}

function clampToLimits(side: PanelSide, width: number): number {
  const { min, max, default: def } = PANEL_LIMITS[side]
  if (!Number.isFinite(width)) return def
  return Math.round(Math.min(max, Math.max(min, width)))
}

export function usePanelWidths(): {
  widths: PanelWidths
  setWidth: (side: PanelSide, width: number, total: number) => void
  reset: (side: PanelSide) => void
} {
  const [widths, setWidths] = useState<PanelWidths>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
    } catch {
      // 存储不可用时只是不记住宽度，不影响使用
    }
  }, [widths])

  const setWidth = useCallback((side: PanelSide, width: number, total: number) => {
    setWidths((cur) => {
      const other = side === 'left' ? cur.right : cur.left
      const next = clampPanelWidth(side, width, total, other)
      return cur[side] === next ? cur : { ...cur, [side]: next }
    })
  }, [])

  const reset = useCallback((side: PanelSide) => {
    setWidths((cur) => ({ ...cur, [side]: PANEL_LIMITS[side].default }))
  }, [])

  return { widths, setWidth, reset }
}
