/**
 * 编辑器状态。工程数据为不可变对象，每次修改都生成新对象，
 * 便于 React 判断变化，也为后续实现撤销 / 重做打基础。
 */
import { createEmptyBundle } from '@core/model/factory'
import type { Asset, Block, PageHeader, ProjectBundle, Variant } from '@core/model/types'

/** 选中页眉时 selectedBlockId 的取值 */
export const HEADER_SELECTION = '#header'

export type HeaderImageSlot = 'logo' | 'phoneIcon' | 'watermark'

export interface EditorState {
  /** home：首页；editor：编辑某个教学案 */
  screen: 'home' | 'editor'
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
  /** 关闭当前教学案，回到首页 */
  | { type: 'close' }
  | { type: 'saved'; filePath: string }
  | { type: 'set-variant'; variant: Variant }
  | { type: 'select'; blockId: string | null }
  | { type: 'update-block'; blockId: string; update: (block: Block) => Block }
  | { type: 'move-block'; blockId: string; delta: -1 | 1 }
  | { type: 'delete-block'; blockId: string }
  | { type: 'set-title'; title: string }
  /** 添加图片资源（题图等），不改变内容 */
  | { type: 'add-asset'; asset: Asset }
  /** 插入内容块：放在 afterBlockId 之后；为 null 时放在末尾。插入后选中第一个 */
  | { type: 'insert-blocks'; blocks: Block[]; assets?: Record<string, Asset>; afterBlockId: string | null }
  /** 修改页眉文字或图片；image 为 null 表示移除该图片，asset 为新图片的资源 */
  | {
      type: 'update-header'
      patch?: Partial<Pick<PageHeader, 'left' | 'phone' | 'right'>>
      image?: { slot: HeaderImageSlot; value: PageHeader[HeaderImageSlot] | null; asset?: Asset }
    }

export function initEditorState(bundle: ProjectBundle): EditorState {
  return { screen: 'home', bundle, filePath: null, dirty: false, variant: 'teacher', selectedBlockId: null }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return {
        ...state,
        screen: 'editor',
        bundle: action.bundle,
        filePath: action.filePath,
        dirty: false,
        selectedBlockId: null
      }
    case 'close':
      return { ...initEditorState(createEmptyBundle()), variant: state.variant }
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
    case 'update-header': {
      const { project, assets } = state.bundle
      const header: PageHeader = { ...project.header, ...action.patch }
      let nextAssets = assets
      if (action.image !== undefined) {
        const { slot, value, asset } = action.image
        if (value === null) delete header[slot]
        else if (value !== undefined) header[slot] = value
        if (asset !== undefined) nextAssets = { ...assets, [asset.id]: asset }
      }
      const next = touch(state, { ...project, header })
      return { ...next, bundle: { ...next.bundle, assets: nextAssets } }
    }
    case 'add-asset':
      return { ...state, bundle: { ...state.bundle, assets: { ...state.bundle.assets, [action.asset.id]: action.asset } } }
    case 'insert-blocks': {
      if (action.blocks.length === 0) return state
      const next = withBlocks(state, (blocks) => {
        const i = action.afterBlockId === null ? -1 : blocks.findIndex((b) => b.id === action.afterBlockId)
        const at = i === -1 ? blocks.length : i + 1
        return [...blocks.slice(0, at), ...action.blocks, ...blocks.slice(at)]
      })
      return {
        ...next,
        selectedBlockId: action.blocks[0]!.id,
        bundle: { ...next.bundle, assets: { ...next.bundle.assets, ...action.assets } }
      }
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
