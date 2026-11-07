/**
 * 编辑器状态。工程数据为不可变对象，每次修改都生成新对象，
 * 便于 React 判断变化，也为后续实现撤销 / 重做打基础。
 */
import type { Block, ProjectBundle, Variant } from '@core/model/types'

export interface EditorState {
  bundle: ProjectBundle
  /** 当前工程文件路径；新建未保存时为 null */
  filePath: string | null
  /** 是否有未保存的修改 */
  dirty: boolean
  /** 预览显示的版本 */
  variant: Variant
  selectedBlockId: string | null
}

export type EditorAction =
  | { type: 'load'; bundle: ProjectBundle; filePath: string | null }
  | { type: 'saved'; filePath: string }
  | { type: 'set-variant'; variant: Variant }
  | { type: 'select'; blockId: string | null }
  | { type: 'update-block'; blockId: string; update: (block: Block) => Block }
  | { type: 'move-block'; blockId: string; delta: -1 | 1 }
  | { type: 'delete-block'; blockId: string }
  | { type: 'set-title'; title: string }

export function initEditorState(bundle: ProjectBundle): EditorState {
  return { bundle, filePath: null, dirty: false, variant: 'teacher', selectedBlockId: null }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return { ...state, bundle: action.bundle, filePath: action.filePath, dirty: false, selectedBlockId: null }
    case 'saved':
      return { ...state, filePath: action.filePath, dirty: false }
    case 'set-variant':
      return { ...state, variant: action.variant }
    case 'select':
      return { ...state, selectedBlockId: action.blockId }
    case 'update-block':
      return withBlocks(state, (blocks) =>
        blocks.map((b) => (b.id === action.blockId ? action.update(b) : b))
      )
    case 'move-block':
      return withBlocks(state, (blocks) => {
        const i = blocks.findIndex((b) => b.id === action.blockId)
        const j = i + action.delta
        if (i === -1 || j < 0 || j >= blocks.length) return blocks
        const next = blocks.slice()
        ;[next[i], next[j]] = [next[j]!, next[i]!]
        return next
      })
    case 'delete-block': {
      const next = withBlocks(state, (blocks) => blocks.filter((b) => b.id !== action.blockId))
      return next.selectedBlockId === action.blockId ? { ...next, selectedBlockId: null } : next
    }
    case 'set-title': {
      const { project } = state.bundle
      return touch(state, { ...project, meta: { ...project.meta, title: action.title } })
    }
  }
}

function withBlocks(state: EditorState, fn: (blocks: Block[]) => Block[]): EditorState {
  const { project } = state.bundle
  const blocks = fn(project.blocks)
  if (blocks === project.blocks) return state
  return touch(state, { ...project, blocks })
}

function touch(state: EditorState, project: ProjectBundle['project']): EditorState {
  return {
    ...state,
    dirty: true,
    bundle: {
      ...state.bundle,
      project: { ...project, meta: { ...project.meta, updatedAt: new Date().toISOString() } }
    }
  }
}
