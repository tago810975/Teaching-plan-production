import { describe, expect, it } from 'vitest'
import {
  createImageImportSession,
  describeReceivedSummary,
  describeSessionPill,
  dismissImageImportNotice,
  isSessionActive,
  minimizeImageImportSession,
  openImageImportSession,
  resolveImportTargetTab,
  restoreImageImportSession,
  updateImageImportSession
} from '../../src/renderer/src/state/imageImportSession'

describe('图片导入后台会话状态', () => {
  it('等待中可收起到后台，收到 AI 返回结果后自动拉起提醒，点击查看恢复窗口', () => {
    let s = createImageImportSession({ tabId: 'tab-1', kind: 'questions', presetId: 'lesson-v1' })
    s = updateImageImportSession(s, { wbState: 'waiting', imageCount: 2 })
    expect(isSessionActive(s)).toBe(true)

    s = minimizeImageImportSession(s)
    expect(s.minimized).toBe(true)
    expect(describeSessionPill(s)).toEqual({ tone: 'waiting', label: '等待 AI 识别题目…' })

    // 后台收到识别结果：receivedNonce 递增、noticeDismissed 为 false（自动弹出提示）
    s = updateImageImportSession(s, {
      wbState: 'received',
      receivedSummary: { questionCount: 3, blockCount: 3, issueCount: 0 },
      arrived: 'recognition'
    })
    expect(s.minimized).toBe(true)
    expect(s.receivedNonce).toBe(1)
    expect(s.lastArrivalKind).toBe('recognition')
    expect(s.noticeDismissed).toBe(false)
    expect(describeSessionPill(s)).toEqual({ tone: 'ready', label: '已收到 3 道题 · 查看' })

    // 点击“稍后处理”关闭浮窗后，胶囊仍在；再点击“查看”恢复窗口
    s = dismissImageImportNotice(s)
    expect(s.noticeDismissed).toBe(true)
    s = restoreImageImportSession(s)
    expect(s.minimized).toBe(false)
    expect(s.reopenHint).toBeNull()
  })

  it('关闭一次提醒后，若再次提交并收到新的返回结果会重新弹出提示', () => {
    let s = createImageImportSession({ tabId: 'tab-1', kind: 'knowledge', presetId: 'lesson-v1' })
    s = updateImageImportSession(s, { wbState: 'waiting', imageCount: 1 })
    s = minimizeImageImportSession(s)
    s = updateImageImportSession(s, {
      wbState: 'received',
      receivedSummary: { questionCount: 0, knowledgeCount: 2, blockCount: 2, issueCount: 0 },
      arrived: 'recognition'
    })
    s = dismissImageImportNotice(s)
    expect(s.noticeDismissed).toBe(true)

    s = updateImageImportSession(s, { wbState: 'waiting' })
    s = updateImageImportSession(s, {
      wbState: 'received',
      receivedSummary: { questionCount: 0, knowledgeCount: 4, blockCount: 4, issueCount: 1 },
      arrived: 'recognition'
    })
    expect(s.receivedNonce).toBe(2)
    expect(s.noticeDismissed).toBe(false)
    expect(describeSessionPill(s)).toEqual({ tone: 'ready', label: '已收到 4 个知识点 · 查看' })
    expect(describeReceivedSummary('knowledge', s.receivedSummary)).toBe('识别到 4 个知识点，有 1 处需要留意')
  })

  it('后台重绘插图收齐后触发 redraw 提醒', () => {
    let s = createImageImportSession({ tabId: 'tab-1', kind: 'questions', presetId: undefined })
    s = updateImageImportSession(s, { imageCount: 1, redrawProgress: { received: 0, total: 2 } })
    s = minimizeImageImportSession(s)
    expect(describeSessionPill(s)).toEqual({ tone: 'waiting', label: '等待重绘插图 0/2…' })

    s = updateImageImportSession(s, { redrawProgress: { received: 1, total: 2 } })
    expect(s.receivedNonce).toBe(0)
    expect(describeSessionPill(s)).toEqual({ tone: 'waiting', label: '等待重绘插图 1/2…' })

    s = updateImageImportSession(s, { redrawProgress: { received: 2, total: 2 }, arrived: 'redraw' })
    expect(s.receivedNonce).toBe(1)
    expect(s.lastArrivalKind).toBe('redraw')
    expect(s.noticeDismissed).toBe(false)
    expect(describeSessionPill(s)).toEqual({ tone: 'ready', label: '已重绘 2 张插图 · 查看' })
  })

  it('已有进行中任务时，从其他标签页再点图片导入会还原原任务并提示，空白草稿可直接替换', () => {
    const empty = minimizeImageImportSession(
      createImageImportSession({ tabId: 'tab-1', kind: 'questions', presetId: 'lesson-v1' })
    )
    const replaced = openImageImportSession(empty, {
      tabId: 'tab-2',
      kind: 'knowledge',
      presetId: 'lesson-v1',
      currentTargetTitle: '力学'
    })
    expect(replaced.tabId).toBe('tab-2')
    expect(replaced.kind).toBe('knowledge')
    expect(replaced.reopenHint).toBeNull()

    const active = minimizeImageImportSession(
      updateImageImportSession(replaced, { wbState: 'waiting', imageCount: 1 })
    )
    const guarded = openImageImportSession(active, {
      tabId: 'tab-1',
      kind: 'questions',
      presetId: 'lesson-v1',
      currentTargetTitle: '电磁感应'
    })
    expect(guarded.tabId).toBe('tab-2')
    expect(guarded.minimized).toBe(false)
    expect(guarded.reopenHint).toContain('《电磁感应》')
  })

  it('原标签页关闭后，导入目标自动回退到当前激活或首个标签页', () => {
    expect(resolveImportTargetTab('tab-1', ['tab-1', 'tab-2'], 'tab-2')).toEqual({ tabId: 'tab-1', fellBack: false })
    expect(resolveImportTargetTab('tab-1', ['tab-2', 'tab-3'], 'tab-3')).toEqual({ tabId: 'tab-3', fellBack: true })
    expect(resolveImportTargetTab('tab-1', ['tab-2', 'tab-3'], null)).toEqual({ tabId: 'tab-2', fellBack: true })
    expect(resolveImportTargetTab('tab-1', [], null)).toEqual({ tabId: null, fellBack: true })
  })
})
