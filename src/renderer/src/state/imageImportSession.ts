/**
 * 图片导入（含 WorkBuddy 自动识别 / 重绘）后台会话状态。
 *
 * 把会话提升到工作区（App）后，用户在等待 WorkBuddy 或其他 MCP Agent 返回内容期间，
 * 可以点击“收起到后台”继续编辑教学案、切换标签页、回到首页或导出；
 * 收到识别结果或全部重绘插图后，自动在右下角弹出提醒，并在顶部标签栏显示状态胶囊。
 */

export type ImageImportKind = 'questions' | 'knowledge'
export type ImageImportWbState = 'idle' | 'need-connect' | 'waiting' | 'received'

export interface ImageImportSummary {
  questionCount: number
  knowledgeCount?: number
  blockCount: number
  issueCount: number
}

export interface ImageImportRedrawProgress {
  received: number
  total: number
}

export interface ImageImportSession {
  /** 发起导入时所在标签页的 ID */
  tabId: string
  kind: ImageImportKind
  presetId: string | undefined
  minimized: boolean
  wbState: ImageImportWbState
  imageCount: number
  receivedSummary: ImageImportSummary | null
  redrawProgress: ImageImportRedrawProgress | null
  /** 每次收到 AI 识别结果或全部重绘完成时递增 */
  receivedNonce: number
  lastArrivalKind: 'recognition' | 'redraw' | null
  noticeDismissed: boolean
  /** 已有进行中任务时，从别处再点“图片导入”提示先处理当前任务 */
  reopenHint: string | null
}

export interface ImageImportSessionPatch {
  wbState?: ImageImportWbState
  imageCount?: number
  receivedSummary?: ImageImportSummary | null
  redrawProgress?: ImageImportRedrawProgress | null
  arrived?: 'recognition' | 'redraw'
}

export function createImageImportSession(req: {
  tabId: string
  kind: ImageImportKind
  presetId: string | undefined
}): ImageImportSession {
  return {
    tabId: req.tabId,
    kind: req.kind,
    presetId: req.presetId,
    minimized: false,
    wbState: 'idle',
    imageCount: 0,
    receivedSummary: null,
    redrawProgress: null,
    receivedNonce: 0,
    lastArrivalKind: null,
    noticeDismissed: false,
    reopenHint: null
  }
}

/** 会话中是否已有图片、等待中任务或已收到的结果 */
export function isSessionActive(session: ImageImportSession): boolean {
  return (
    session.wbState === 'waiting' ||
    session.wbState === 'received' ||
    session.imageCount > 0 ||
    (session.redrawProgress !== null && session.redrawProgress.total > 0)
  )
}

/**
 * 在某个标签页点击“导入题目 / 知识点 → 图片”时决定新建或恢复会话：
 * - 同一标签页且同类型：直接展开原会话
 * - 已有进行中任务（不同标签页或不同类型）：展开原会话并提示先完成或取消
 * - 否则（空白会话）：替换成新会话
 */
export function openImageImportSession(
  current: ImageImportSession | null,
  req: {
    tabId: string
    kind: ImageImportKind
    presetId: string | undefined
    currentTargetTitle?: string | null
  }
): ImageImportSession {
  if (current === null) return createImageImportSession(req)
  if (current.tabId === req.tabId && current.kind === req.kind) {
    return { ...current, presetId: req.presetId, minimized: false, noticeDismissed: true, reopenHint: null }
  }
  if (isSessionActive(current)) {
    const title = req.currentTargetTitle ?? null
    const targetText = title !== null && title !== '' ? `《${title}》` : '当前任务'
    return {
      ...current,
      minimized: false,
      noticeDismissed: true,
      reopenHint: `当前已有进行中的图片导入任务（目标：${targetText}），请先完成导入或取消后再新建。`
    }
  }
  return createImageImportSession(req)
}

export function minimizeImageImportSession(session: ImageImportSession): ImageImportSession {
  if (session.minimized && session.reopenHint === null) return session
  return { ...session, minimized: true, reopenHint: null }
}

export function restoreImageImportSession(session: ImageImportSession): ImageImportSession {
  return { ...session, minimized: false, noticeDismissed: true, reopenHint: null }
}

export function dismissImageImportNotice(session: ImageImportSession): ImageImportSession {
  if (session.noticeDismissed) return session
  return { ...session, noticeDismissed: true }
}

export function updateImageImportSession(session: ImageImportSession, patch: ImageImportSessionPatch): ImageImportSession {
  const wbState = patch.wbState ?? session.wbState
  const imageCount = patch.imageCount ?? session.imageCount
  const receivedSummary = patch.receivedSummary !== undefined ? patch.receivedSummary : session.receivedSummary
  const redrawProgress = patch.redrawProgress !== undefined ? patch.redrawProgress : session.redrawProgress

  if (patch.arrived !== undefined) {
    return {
      ...session,
      wbState,
      imageCount,
      receivedSummary,
      redrawProgress,
      receivedNonce: session.receivedNonce + 1,
      lastArrivalKind: patch.arrived,
      // 若窗口在后台，收到新结果时立即恢复提示
      noticeDismissed: session.minimized ? false : session.noticeDismissed
    }
  }

  if (
    wbState === session.wbState &&
    imageCount === session.imageCount &&
    receivedSummary === session.receivedSummary &&
    redrawProgress === session.redrawProgress
  ) {
    return session
  }

  return {
    ...session,
    wbState,
    imageCount,
    receivedSummary,
    redrawProgress
  }
}

/** 计算收到结果时实际要导入到的目标标签页（原标签页被关闭时回退到当前或首个打开的标签页） */
export function resolveImportTargetTab(
  sessionTabId: string,
  tabIds: readonly string[],
  activeTabId: string | null
): { tabId: string | null; fellBack: boolean } {
  if (tabIds.includes(sessionTabId)) return { tabId: sessionTabId, fellBack: false }
  if (activeTabId !== null && tabIds.includes(activeTabId)) return { tabId: activeTabId, fellBack: true }
  return { tabId: tabIds[0] ?? null, fellBack: true }
}

export function describeReceivedSummary(kind: ImageImportKind, summary: ImageImportSummary | null): string {
  if (summary === null) return kind === 'knowledge' ? '已收到知识点识别结果' : '已收到题目识别结果'
  const count =
    summary.knowledgeCount !== undefined
      ? `识别到 ${summary.knowledgeCount} 个知识点${summary.questionCount > 0 ? `、${summary.questionCount} 道题` : ''}`
      : summary.questionCount > 0
        ? `识别到 ${summary.questionCount} 道题`
        : summary.blockCount > 0
          ? `识别到 ${summary.blockCount} 项内容`
          : '暂未识别到可导入内容'
  const issueText = summary.issueCount > 0 ? `，有 ${summary.issueCount} 处需要留意` : summary.blockCount > 0 ? '，没有发现问题' : ''
  return `${count}${issueText}`
}

export function describeSessionPill(session: ImageImportSession): { label: string; tone: 'waiting' | 'ready' | 'idle' } {
  if (session.wbState === 'received') {
    const s = session.receivedSummary
    if (s !== null) {
      if (s.knowledgeCount !== undefined && s.knowledgeCount > 0) {
        return { tone: 'ready', label: `已收到 ${s.knowledgeCount} 个知识点 · 查看` }
      }
      if (s.questionCount > 0) {
        return { tone: 'ready', label: `已收到 ${s.questionCount} 道题 · 查看` }
      }
    }
    return { tone: 'ready', label: '已收到识别结果 · 查看' }
  }
  if (session.wbState === 'waiting') {
    return { tone: 'waiting', label: session.kind === 'knowledge' ? '等待 AI 识别知识点…' : '等待 AI 识别题目…' }
  }
  if (session.redrawProgress !== null && session.redrawProgress.total > 0) {
    const { received, total } = session.redrawProgress
    if (received >= total) return { tone: 'ready', label: `已重绘 ${total} 张插图 · 查看` }
    return { tone: 'waiting', label: `等待重绘插图 ${received}/${total}…` }
  }
  return { tone: 'idle', label: '图片导入（已收起）' }
}
