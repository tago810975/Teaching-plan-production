import { describe, expect, it } from 'vitest'
import { createEmptyBundle } from '@core/model/factory'
import { activeTab, EMPTY_WORKSPACE, workspaceReducer, type Workspace, type WorkspaceAction } from '../../src/renderer/src/state/workspace'

const bundle = (title: string) => {
  const b = createEmptyBundle()
  b.project.meta.title = title
  return b
}
const run = (ws: Workspace, ...actions: WorkspaceAction[]): Workspace => actions.reduce(workspaceReducer, ws)
const titles = (ws: Workspace): string[] => ws.tabs.map((t) => t.state.bundle.project.meta.title)

describe('多个教学案（标签页）', () => {
  it('打开多个教学案各占一个标签页；同一文件再次打开时切换过去', () => {
    let ws = run(
      EMPTY_WORKSPACE,
      { type: 'open', bundle: bundle('甲'), filePath: 'C:\\教学案\\甲.tplan', tabId: 'a' },
      { type: 'open', bundle: bundle('乙'), filePath: 'C:\\教学案\\乙.tplan', tabId: 'b' }
    )
    expect(titles(ws)).toEqual(['甲', '乙'])
    expect(ws.active).toBe('b')
    ws = run(ws, { type: 'open', bundle: bundle('甲（重新读取）'), filePath: 'c:\\教学案\\甲.TPLAN' })
    expect(titles(ws)).toEqual(['甲', '乙'])
    expect(ws.active).toBe('a')
  })

  it('没有文件路径的（示例）每次都新开', () => {
    const ws = run(EMPTY_WORKSPACE, { type: 'open', bundle: bundle('示例'), filePath: null }, { type: 'open', bundle: bundle('示例'), filePath: null })
    expect(ws.tabs).toHaveLength(2)
  })

  it('新标签页开在当前标签页之后', () => {
    const ws = run(
      EMPTY_WORKSPACE,
      { type: 'open', bundle: bundle('甲'), filePath: '/甲', tabId: 'a' },
      { type: 'open', bundle: bundle('乙'), filePath: '/乙', tabId: 'b' },
      { type: 'activate', id: 'a' },
      { type: 'open', bundle: bundle('丙'), filePath: '/丙', tabId: 'c' }
    )
    expect(titles(ws)).toEqual(['甲', '丙', '乙'])
  })

  it('每个标签页的编辑与撤销互不影响', () => {
    let ws = run(
      EMPTY_WORKSPACE,
      { type: 'open', bundle: bundle('甲'), filePath: '/甲', tabId: 'a' },
      { type: 'open', bundle: bundle('乙'), filePath: '/乙', tabId: 'b' },
      { type: 'doc', id: 'a', action: { type: 'set-title', title: '甲改' } }
    )
    expect(titles(ws)).toEqual(['甲改', '乙'])
    expect(ws.tabs[1]!.state.history.past).toHaveLength(0)
    expect(ws.tabs[0]!.state.dirty).toBe(true)
    expect(ws.tabs[1]!.state.dirty).toBe(false)
    ws = run(ws, { type: 'doc', id: 'a', action: { type: 'undo' } })
    expect(titles(ws)).toEqual(['甲', '乙'])
  })

  it('关闭当前标签页切到右边的，没有则左边的，都没有回到首页', () => {
    let ws = run(
      EMPTY_WORKSPACE,
      { type: 'open', bundle: bundle('甲'), filePath: '/甲', tabId: 'a' },
      { type: 'open', bundle: bundle('乙'), filePath: '/乙', tabId: 'b' },
      { type: 'open', bundle: bundle('丙'), filePath: '/丙', tabId: 'c' },
      { type: 'activate', id: 'b' },
      { type: 'close-tab', id: 'b' }
    )
    expect(ws.active).toBe('c')
    ws = run(ws, { type: 'close-tab', id: 'c' })
    expect(ws.active).toBe('a')
    ws = run(ws, { type: 'close-tab', id: 'a' })
    expect(ws.active).toBeNull()
    expect(activeTab(ws)).toBeNull()
  })

  it('关闭别的标签页不改变当前标签页；Ctrl+Tab 依次切换（首页算第一个）', () => {
    let ws = run(
      EMPTY_WORKSPACE,
      { type: 'open', bundle: bundle('甲'), filePath: '/甲', tabId: 'a' },
      { type: 'open', bundle: bundle('乙'), filePath: '/乙', tabId: 'b' },
      { type: 'close-tab', id: 'a' }
    )
    expect(ws.active).toBe('b')
    ws = run(ws, { type: 'cycle', delta: 1 })
    expect(ws.active).toBeNull()
    ws = run(ws, { type: 'cycle', delta: 1 })
    expect(ws.active).toBe('b')
    ws = run(ws, { type: 'cycle', delta: -1 })
    expect(ws.active).toBeNull()
  })

  it('拖动标签页调整顺序', () => {
    const ws = run(
      EMPTY_WORKSPACE,
      { type: 'open', bundle: bundle('甲'), filePath: '/甲', tabId: 'a' },
      { type: 'open', bundle: bundle('乙'), filePath: '/乙', tabId: 'b' },
      { type: 'open', bundle: bundle('丙'), filePath: '/丙', tabId: 'c' },
      { type: 'move-tab', id: 'c', toIndex: 0 }
    )
    expect(titles(ws)).toEqual(['丙', '甲', '乙'])
  })

  it('只改界面的动作不产生新的工作区对象', () => {
    const ws = run(EMPTY_WORKSPACE, { type: 'open', bundle: bundle('甲'), filePath: '/甲', tabId: 'a' })
    expect(workspaceReducer(ws, { type: 'doc', id: 'a', action: { type: 'undo' } })).toBe(ws)
    expect(workspaceReducer(ws, { type: 'activate', id: 'a' })).toBe(ws)
  })

  it('同步重命名：更新标签页名称与文件路径，不产生未保存状态也不记入撤销', () => {
    const ws = run(
      EMPTY_WORKSPACE,
      { type: 'open', bundle: bundle('甲'), filePath: '/dir/甲.tplan', tabId: 'a' },
      { type: 'doc', id: 'a', action: { type: 'renamed', filePath: '/dir/乙.tplan', title: '乙' } }
    )
    expect(ws.tabs[0]!.state.filePath).toBe('/dir/乙.tplan')
    expect(ws.tabs[0]!.state.bundle.project.meta.title).toBe('乙')
    expect(ws.tabs[0]!.state.dirty).toBe(false)
    expect(ws.tabs[0]!.state.history.past).toHaveLength(0)
  })
})
