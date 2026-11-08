/**
 * 编辑器状态。工程数据为不可变对象，每次修改都生成新对象，
 * 便于 React 判断变化，也为后续实现撤销 / 重做打基础。
 */
import { createEmptyBundle } from '@core/model/factory'
import type { FigureRef, InlineRef } from '@core/document/ir'
import type { Asset, Block, Inline, PageHeader, ProjectBundle, ProjectLayout, QuestionFigure, Variant } from '@core/model/types'

/** 选中页眉时 selectedBlockId 的取值 */
export const HEADER_SELECTION = '#header'
/** 选中版式设置时 selectedBlockId 的取值 */
export const LAYOUT_SELECTION = '#layout'

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
  /**
   * 内容在属性面板之外被修改的次数（如在预览中编辑公式）。
   * 属性面板的输入框以它作为 key 的一部分，变化时重新读取内容。
   */
  revision: number
  /** 点击预览后请求定位到的输入框 */
  focusRequest: FocusRequest | null
  /** 在预览中拖动一张选项图片时，全部选项图片一起缩放（按住 Shift 临时反过来） */
  linkOptionImages: boolean
}

export interface FocusRequest {
  blockId: string
  /** 输入框标识，见 EditTarget.field */
  field: string
  paragraph: number
  /** 点击处前后的几个字，用于把光标放在点击位置 */
  before: string
  after: string
  nonce: number
}

export type EditorAction =
  | { type: 'load'; bundle: ProjectBundle; filePath: string | null }
  /** 关闭当前教学案，回到首页 */
  | { type: 'close' }
  | { type: 'saved'; filePath: string }
  | { type: 'set-variant'; variant: Variant }
  | { type: 'select'; blockId: string | null; focus?: Omit<FocusRequest, 'blockId' | 'nonce'> }
  | { type: 'update-block'; blockId: string; update: (block: Block) => Block }
  | { type: 'move-block'; blockId: string; delta: -1 | 1 }
  | { type: 'delete-block'; blockId: string }
  /** 拖拽排序：把内容块移到第 toIndex 个位置之前（toIndex 按移动前的顺序计算） */
  | { type: 'move-block-to'; blockId: string; toIndex: number }
  | { type: 'set-title'; title: string }
  | { type: 'update-layout'; layout: ProjectLayout }
  /** 选项图片在预览中拖动时是否全部一起缩放（界面设置，不存入工程） */
  | { type: 'set-link-option-images'; value: boolean }
  /** 修改某张题图 / 插图（在预览中缩放、拖动后） */
  | { type: 'update-figure'; ref: FigureRef; patch: Partial<QuestionFigure> }
  /** 替换（inline 为 null 时删除）某个行内内容，如在预览中编辑的公式 */
  | { type: 'replace-inline'; ref: InlineRef; inline: Inline | null }
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
  return { screen: 'home', bundle, filePath: null, dirty: false, variant: 'teacher', selectedBlockId: null, revision: 0, focusRequest: null, linkOptionImages: false }
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
      return { ...initEditorState(createEmptyBundle()), variant: state.variant, linkOptionImages: state.linkOptionImages }
    case 'saved':
      return { ...state, filePath: action.filePath, dirty: false }
    case 'set-variant':
      return { ...state, variant: action.variant }
    case 'select':
      return {
        ...state,
        selectedBlockId: action.blockId,
        focusRequest:
          action.focus !== undefined && action.blockId !== null
            ? { ...action.focus, blockId: action.blockId, nonce: (state.focusRequest?.nonce ?? 0) + 1 }
            : state.focusRequest
      }
    case 'update-block':
      return withBlocks(state, (blocks) => mapBlockById(blocks, action.blockId, action.update))
    case 'move-block':
      return withBlocks(state, (blocks) => {
        const swapIn = <T>(list: T[], i: number): T[] => {
          const j = i + action.delta
          if (i === -1 || j < 0 || j >= list.length) return list
          const next = list.slice()
          ;[next[i], next[j]] = [next[j]!, next[i]!]
          return next
        }
        const i = blocks.findIndex((b) => b.id === action.blockId)
        if (i !== -1) return swapIn(blocks, i)
        // 综合题中的小题：在综合题内移动
        return blocks.map((b) =>
          b.type === 'composite' && b.items.some((it) => it.id === action.blockId)
            ? { ...b, items: swapIn(b.items, b.items.findIndex((it) => it.id === action.blockId)) }
            : b
        )
      })
    case 'move-block-to': {
      const next = withBlocks(state, (blocks) => {
        const from = blocks.findIndex((b) => b.id === action.blockId)
        if (from === -1) return blocks
        let to = Math.max(0, Math.min(blocks.length, action.toIndex))
        if (to > from) to -= 1
        if (to === from) return blocks
        const out = blocks.slice()
        const [moved] = out.splice(from, 1)
        out.splice(to, 0, moved!)
        return out
      })
      return { ...next, selectedBlockId: action.blockId }
    }
    case 'delete-block': {
      const next = withBlocks(state, (blocks) =>
        blocks
          .filter((b) => b.id !== action.blockId)
          .map((b) => (b.type === 'composite' && b.items.some((it) => it.id === action.blockId) ? { ...b, items: b.items.filter((it) => it.id !== action.blockId) } : b))
      )
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
    case 'update-figure': {
      const { ref, patch } = action
      const next = withBlocks(state, (blocks) =>
        mapBlockById(blocks, ref.blockId, (b) => {
          const apply = (figs: QuestionFigure[]): QuestionFigure[] =>
            figs.map((f, i) => (i === ref.figureIndex ? { ...f, ...patch } : f))
          if (b.type === 'question') return { ...b, question: { ...b.question, figures: apply(b.question.figures) } }
          if (b.type === 'knowledge' || b.type === 'composite') return { ...b, figures: apply(b.figures) }
          return b
        })
      )
      // 属性面板中的宽度等数值随之更新
      return { ...next, revision: state.revision + 1 }
    }
    case 'replace-inline': {
      const { ref, inline } = action
      const next = withBlocks(state, (blocks) => mapBlockById(blocks, ref.blockId, (b) => replaceAt(b, ref.path, inline) as Block))
      return { ...next, selectedBlockId: ref.blockId, revision: state.revision + 1 }
    }
    case 'set-link-option-images':
      return { ...state, linkOptionImages: action.value }
    case 'update-layout':
      return touch(state, { ...state.bundle.project, layout: action.layout })
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

/**
 * 按路径不可变地替换对象中的值。路径最后一项是数组下标时，value 为 null 表示删除该项。
 */
function replaceAt(obj: unknown, path: ReadonlyArray<string | number>, value: unknown): unknown {
  const [head, ...rest] = path
  if (head === undefined) return value
  if (Array.isArray(obj)) {
    const i = head as number
    if (rest.length === 0 && value === null) return obj.filter((_, j) => j !== i)
    return obj.map((item, j) => (j === i ? replaceAt(item, rest, value) : item))
  }
  const record = obj as Record<string, unknown>
  return { ...record, [head]: replaceAt(record[head as string], rest, value) }
}

/** 按 ID 修改内容块：顶层的块，或综合题中的小题 */
export function mapBlockById(blocks: Block[], id: string, fn: (b: Block) => Block): Block[] {
  return blocks.map((b) => {
    if (b.id === id) return fn(b)
    if (b.type === 'composite' && b.items.some((it) => it.id === id)) {
      return { ...b, items: b.items.map((it) => (it.id === id ? (fn(it) as typeof it) : it)) }
    }
    return b
  })
}

/** 按 ID 查找内容块（含综合题中的小题） */
export function findBlock(blocks: Block[], id: string | null): Block | null {
  if (id === null) return null
  for (const b of blocks) {
    if (b.id === id) return b
    if (b.type === 'composite') {
      const item = b.items.find((it) => it.id === id)
      if (item !== undefined) return item
    }
  }
  return null
}
