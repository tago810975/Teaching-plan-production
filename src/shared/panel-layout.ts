/**
 * 编辑界面左右两栏的宽度规则（纯计算，界面与测试共用）。
 */

export type PanelSide = 'left' | 'right'

export interface PanelLimits {
  min: number
  max: number
  default: number
}

export const PANEL_LIMITS: Readonly<Record<PanelSide, PanelLimits>> = {
  left: { min: 180, max: 480, default: 250 },
  right: { min: 300, max: 640, default: 360 }
}

/** 中间预览区至少保留的宽度 */
export const MIN_PREVIEW_WIDTH = 360

/**
 * 计算某一侧的允许宽度：在固定上下限之内，并为预览区与另一侧栏留出空间。
 */
export function clampPanelWidth(side: PanelSide, width: number, total: number, other: number): number {
  const { min, max } = PANEL_LIMITS[side]
  const roomLeft = total - other - MIN_PREVIEW_WIDTH
  return Math.round(Math.max(min, Math.min(max, roomLeft, width)))
}
