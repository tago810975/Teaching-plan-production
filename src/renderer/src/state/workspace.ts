/**
 * 工作区：像 WPS 一样同时打开多个教学案，每个教学案一个标签页。
 *
 * 每个标签页有自己完整的编辑状态（内容、撤销历史、选中项、教案 / 学案……），见 store.ts；
 * active 为当前显示的标签页，null 表示首页。同一文件只开一个标签页，再次打开时切换过去。
 */
import { createEmptyBundle, newId } from '@core/model/factory'
import type { ProjectBundle } from '@core/model/types'
import { editorReducer, initEditorState, type EditorAction, type EditorState } from './store'

export interface Tab {
  id: string
  state: EditorState
}

export interface Workspace {
  tabs: Tab[]
  /** 当前标签页；null 为首页 */
  active: string | null
}

export type WorkspaceAction =
  /** 打开教学案：同一文件已打开时切换过去，否则新开一个标签页 */
  | { type: 'open'; bundle: ProjectBundle; filePath: string | null; tabId?: string }
  | { type: 'close-tab'; id: string }
  /** 切换标签页；null 为首页 */
  | { type: 'activate'; id: string | null }
  /** 切换到下一个（delta 1）或上一个（-1）标签页，首页算第一个 */
  | { type: 'cycle'; delta: 1 | -1 }
  /** 拖动标签页：把 id 移到第 toIndex 个 */
  | { type: 'move-tab'; id: string; toIndex: number }
  /** 交给某个标签页处理的编辑动作 */
  | { type: 'doc'; id: string; action: EditorAction }

export const EMPTY_WORKSPACE: Workspace = { tabs: [], active: null }

/** 路径比较（Windows 不区分大小写） */
export function samePath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  const n = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  return n(a) === n(b)
}

export function findTabByPath(ws: Workspace, filePath: string): Tab | undefined {
  return ws.tabs.find((t) => samePath(t.state.filePath, filePath))
}

export function workspaceReducer(ws: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case 'open': {
      const existing = action.filePath !== null ? findTabByPath(ws, action.filePath) : undefined
      if (existing !== undefined) return { ...ws, active: existing.id }
      const id = action.tabId ?? newId()
      const state = editorReducer(initEditorState(createEmptyBundle()), { type: 'load', bundle: action.bundle, filePath: action.filePath })
      // 新标签页放在当前标签页之后（在首页打开时放在最后）
      const at = ws.active === null ? ws.tabs.length : ws.tabs.findIndex((t) => t.id === ws.active) + 1
      const tabs = [...ws.tabs.slice(0, at), { id, state }, ...ws.tabs.slice(at)]
      return { tabs, active: id }
    }
    case 'close-tab': {
      const i = ws.tabs.findIndex((t) => t.id === action.id)
      if (i === -1) return ws
      const tabs = ws.tabs.filter((t) => t.id !== action.id)
      // 关闭当前标签页时，切到右边的（没有则左边的；都没有回到首页）
      const active = ws.active !== action.id ? ws.active : (tabs[i]?.id ?? tabs[i - 1]?.id ?? null)
      return { tabs, active }
    }
    case 'activate':
      if (action.id !== null && !ws.tabs.some((t) => t.id === action.id)) return ws
      return ws.active === action.id ? ws : { ...ws, active: action.id }
    case 'cycle': {
      const order = [null, ...ws.tabs.map((t) => t.id)]
      const i = order.indexOf(ws.active)
      return { ...ws, active: order[(i + action.delta + order.length) % order.length]! }
    }
    case 'move-tab': {
      const i = ws.tabs.findIndex((t) => t.id === action.id)
      if (i === -1) return ws
      const tabs = ws.tabs.slice()
      const [tab] = tabs.splice(i, 1)
      tabs.splice(Math.max(0, Math.min(action.toIndex, tabs.length)), 0, tab!)
      return { ...ws, tabs }
    }
    case 'doc': {
      let changed = false
      const tabs = ws.tabs.map((t) => {
        if (t.id !== action.id) return t
        const state = editorReducer(t.state, action.action)
        if (state === t.state) return t
        changed = true
        return { ...t, state }
      })
      return changed ? { ...ws, tabs } : ws
    }
  }
}

export function activeTab(ws: Workspace): Tab | null {
  return ws.tabs.find((t) => t.id === ws.active) ?? null
}
