/**
 * 插图重绘（批量处理插图 / WorkBuddy & Antigravity SVG 重绘）后台会话状态。
 *
 * 把会话提升到工作区（App）后，用户在等待 AI 重绘 SVG 返回期间，
 * 可以点“收起到后台 / 后台等待”继续编辑教学案、切换标签页或导出；
 * 全部重绘插图收齐后，右下角自动弹出提醒卡片，并在顶部标签栏显示进度胶囊。
 */
import type { FigureRef } from '@core/document/ir'

export interface FigureBatchInitial {
  refs?: FigureRef[]
  redraw?: boolean
}

export interface FigureRedrawProgress {
  received: number
  total: number
}

export interface FigureRedrawSession {
  /** 发起重绘时所在标签页的 ID */
  tabId: string
  initial: FigureBatchInitial
  /** 每次新开重绘会话递增，用于重新初始化勾选项与自动触发重绘 */
  sessionKey: number
  minimized: boolean
  redrawProgress: FigureRedrawProgress | null
  /** 已收到但尚未点击“应用”的 SVG 数量 */
  unappliedCount: number
  /** 每次收齐重绘插图时递增 */
  receivedNonce: number
  noticeDismissed: boolean
  reopenHint: string | null
}

export interface FigureRedrawSessionPatch {
  redrawProgress?: FigureRedrawProgress | null
  unappliedCount?: number
  arrived?: boolean
}

export function createFigureRedrawSession(req: {
  tabId: string
  initial: FigureBatchInitial
  sessionKey?: number
}): FigureRedrawSession {
  return {
    tabId: req.tabId,
    initial: req.initial,
    sessionKey: req.sessionKey ?? 1,
    minimized: false,
    redrawProgress: null,
    unappliedCount: 0,
    receivedNonce: 0,
    noticeDismissed: false,
    reopenHint: null
  }
}

export function isFigureRedrawActive(session: FigureRedrawSession): boolean {
  return (session.redrawProgress !== null && session.redrawProgress.total > 0) || session.unappliedCount > 0
}

function sameInitial(a: FigureBatchInitial, b: FigureBatchInitial): boolean {
  if ((a.redraw === true) !== (b.redraw === true)) return false
  const ra = a.refs ?? []
  const rb = b.refs ?? []
  if (ra.length !== rb.length) return false
  return ra.every((x, i) => {
    const y = rb[i]!
    return x.blockId === y.blockId && x.figureIndex === y.figureIndex && (x.list ?? '') === (y.list ?? '')
  })
}

/**
 * 打开或恢复批量处理插图 / AI 重绘窗口：
 * - 已有等待中任务或未应用的 SVG 时，先保留并展开原会话；若本次来自不同标签页或带新选区则给出提示
 * - 否则替换成新会话（递增 sessionKey 让弹窗重新按 initial 初始化并自动交出重绘）
 */
export function openFigureRedrawSession(
  current: FigureRedrawSession | null,
  req: {
    tabId: string
    initial: FigureBatchInitial
    currentTargetTitle?: string | null
  }
): FigureRedrawSession {
  if (current === null) return createFigureRedrawSession({ tabId: req.tabId, initial: req.initial, sessionKey: 1 })
  if (isFigureRedrawActive(current)) {
    const isNewIntent = current.tabId !== req.tabId || (req.initial.redraw === true && !sameInitial(current.initial, req.initial))
    const title = req.currentTargetTitle ?? null
    const targetText = title !== null && title !== '' ? `《${title}》` : '原教学案'
    return {
      ...current,
      minimized: false,
      noticeDismissed: true,
      reopenHint: isNewIntent ? `当前已有进行中的插图重绘任务（目标：${targetText}），请先应用或关闭后再发起新的重绘。` : null
    }
  }
  return createFigureRedrawSession({ tabId: req.tabId, initial: req.initial, sessionKey: current.sessionKey + 1 })
}

export function minimizeFigureRedrawSession(session: FigureRedrawSession): FigureRedrawSession {
  if (session.minimized && session.reopenHint === null) return session
  return { ...session, minimized: true, reopenHint: null }
}

export function restoreFigureRedrawSession(session: FigureRedrawSession): FigureRedrawSession {
  return { ...session, minimized: false, noticeDismissed: true, reopenHint: null }
}

export function dismissFigureRedrawNotice(session: FigureRedrawSession): FigureRedrawSession {
  if (session.noticeDismissed) return session
  return { ...session, noticeDismissed: true }
}

export function updateFigureRedrawSession(
  session: FigureRedrawSession,
  patch: FigureRedrawSessionPatch
): FigureRedrawSession {
  const redrawProgress = patch.redrawProgress !== undefined ? patch.redrawProgress : session.redrawProgress
  const unappliedCount = patch.unappliedCount ?? session.unappliedCount

  if (patch.arrived === true) {
    return {
      ...session,
      redrawProgress,
      unappliedCount,
      receivedNonce: session.receivedNonce + 1,
      noticeDismissed: session.minimized ? false : session.noticeDismissed
    }
  }

  if (
    redrawProgress?.received === session.redrawProgress?.received &&
    redrawProgress?.total === session.redrawProgress?.total &&
    unappliedCount === session.unappliedCount
  ) {
    return session
  }

  return {
    ...session,
    redrawProgress,
    unappliedCount
  }
}

export function describeFigureRedrawPill(
  session: FigureRedrawSession
): { label: string; tone: 'waiting' | 'ready' | 'idle' } {
  if (session.redrawProgress !== null && session.redrawProgress.total > 0) {
    const { received, total } = session.redrawProgress
    if (received >= total) return { tone: 'ready', label: `已重绘 ${total} 张插图 · 查看` }
    return { tone: 'waiting', label: `等待重绘插图 ${received}/${total}…` }
  }
  if (session.unappliedCount > 0) {
    return { tone: 'ready', label: `有 ${session.unappliedCount} 张重绘待应用 · 查看` }
  }
  return { tone: 'idle', label: '批量处理插图（已收起）' }
}
