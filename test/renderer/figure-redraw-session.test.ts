import { describe, expect, it } from 'vitest'
import {
  createFigureRedrawSession,
  describeFigureRedrawPill,
  dismissFigureRedrawNotice,
  isFigureRedrawActive,
  minimizeFigureRedrawSession,
  openFigureRedrawSession,
  restoreFigureRedrawSession,
  updateFigureRedrawSession
} from '../../src/renderer/src/state/figureRedrawSession'

describe('插图重绘后台会话状态', () => {
  it('收起到后台等待重绘，收齐后自动拉起提示，点击查看并应用后清理状态', () => {
    let s = createFigureRedrawSession({
      tabId: 'tab-1',
      initial: { refs: [{ blockId: 'q1', figureIndex: 0 }], redraw: true }
    })
    s = updateFigureRedrawSession(s, { redrawProgress: { received: 0, total: 2 }, unappliedCount: 0 })
    expect(isFigureRedrawActive(s)).toBe(true)

    s = minimizeFigureRedrawSession(s)
    expect(s.minimized).toBe(true)
    expect(describeFigureRedrawPill(s)).toEqual({ tone: 'waiting', label: '等待重绘插图 0/2…' })

    // 收到第 1 张：只更新胶囊计数，不弹到齐提示
    s = updateFigureRedrawSession(s, { redrawProgress: { received: 1, total: 2 }, unappliedCount: 1 })
    expect(s.receivedNonce).toBe(0)
    expect(describeFigureRedrawPill(s)).toEqual({ tone: 'waiting', label: '等待重绘插图 1/2…' })

    // 收齐全部 2 张：递增 receivedNonce 并触发右下角提示
    s = updateFigureRedrawSession(s, { redrawProgress: { received: 2, total: 2 }, unappliedCount: 2, arrived: true })
    expect(s.receivedNonce).toBe(1)
    expect(s.noticeDismissed).toBe(false)
    expect(describeFigureRedrawPill(s)).toEqual({ tone: 'ready', label: '已重绘 2 张插图 · 查看' })

    // 点“稍后处理”后胶囊保留；再点“查看”还原弹窗
    s = dismissFigureRedrawNotice(s)
    expect(s.noticeDismissed).toBe(true)
    s = restoreFigureRedrawSession(s)
    expect(s.minimized).toBe(false)
    expect(s.reopenHint).toBeNull()

    // 结束重绘等待但仍有未应用的 SVG 时，胶囊仍提示待应用
    s = minimizeFigureRedrawSession(updateFigureRedrawSession(s, { redrawProgress: null, unappliedCount: 2 }))
    expect(isFigureRedrawActive(s)).toBe(true)
    expect(describeFigureRedrawPill(s)).toEqual({ tone: 'ready', label: '有 2 张重绘待应用 · 查看' })
  })

  it('有等待中任务或未应用 SVG 时，从别处再点重绘会展开原任务并提示，空闲后可递增 sessionKey 开启新任务', () => {
    let s = createFigureRedrawSession({
      tabId: 'tab-1',
      initial: { refs: [{ blockId: 'q1', figureIndex: 0 }], redraw: true }
    })
    s = minimizeFigureRedrawSession(
      updateFigureRedrawSession(s, { redrawProgress: { received: 0, total: 1 }, unappliedCount: 0 })
    )

    const guarded = openFigureRedrawSession(s, {
      tabId: 'tab-2',
      initial: { refs: [{ blockId: 'q2', figureIndex: 0 }], redraw: true },
      currentTargetTitle: '电场专题'
    })
    expect(guarded.tabId).toBe('tab-1')
    expect(guarded.sessionKey).toBe(1)
    expect(guarded.minimized).toBe(false)
    expect(guarded.reopenHint).toContain('《电场专题》')

    // 若之前无进行中任务也无未应用 SVG，则会替换为新会话并递增 sessionKey
    const idle = minimizeFigureRedrawSession(
      updateFigureRedrawSession(guarded, { redrawProgress: null, unappliedCount: 0 })
    )
    const next = openFigureRedrawSession(idle, {
      tabId: 'tab-2',
      initial: { refs: [{ blockId: 'q2', figureIndex: 0 }], redraw: true },
      currentTargetTitle: '电场专题'
    })
    expect(next.tabId).toBe('tab-2')
    expect(next.sessionKey).toBe(2)
    expect(next.reopenHint).toBeNull()
  })

  it('关闭一次提醒后，若再次发起重绘并收齐会重新触发提示', () => {
    let s = createFigureRedrawSession({ tabId: 'tab-1', initial: {} })
    s = minimizeFigureRedrawSession(updateFigureRedrawSession(s, { redrawProgress: { received: 1, total: 1 }, unappliedCount: 1, arrived: true }))
    s = dismissFigureRedrawNotice(s)
    expect(s.noticeDismissed).toBe(true)

    s = updateFigureRedrawSession(s, { redrawProgress: { received: 1, total: 1 }, unappliedCount: 2, arrived: true })
    expect(s.receivedNonce).toBe(2)
    expect(s.noticeDismissed).toBe(false)
  })
})
