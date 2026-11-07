import { describe, expect, it } from 'vitest'
import { clampPanelWidth, MIN_PREVIEW_WIDTH, PANEL_LIMITS } from '@shared/panel-layout'

describe('侧栏宽度', () => {
  it('限制在上下限之内', () => {
    expect(clampPanelWidth('left', 50, 2000, 360)).toBe(PANEL_LIMITS.left.min)
    expect(clampPanelWidth('left', 900, 2000, 360)).toBe(PANEL_LIMITS.left.max)
    expect(clampPanelWidth('right', 100, 2000, 250)).toBe(PANEL_LIMITS.right.min)
    expect(clampPanelWidth('right', 400, 2000, 250)).toBe(400)
  })

  it('为中间预览区留出空间', () => {
    // 总宽 1100，右栏 360：左栏最多 1100 - 360 - 360 = 380
    expect(clampPanelWidth('left', 450, 1100, 360)).toBe(1100 - 360 - MIN_PREVIEW_WIDTH)
  })

  it('窗口极窄时不小于下限', () => {
    expect(clampPanelWidth('left', 300, 600, 360)).toBe(PANEL_LIMITS.left.min)
  })
})
