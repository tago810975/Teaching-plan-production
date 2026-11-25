/**
 * 内容块中的各组插图：题图（question.figures）、答案插图、解析插图（仅教师版），
 * 知识点插图与综合题背景配图（block.figures）。按 FigureRef.list 读写其中一组。
 *
 * 另有“单独成段的图片 → 插图”：从墨案、网页粘贴来的图片常常单独占一段、作为行内图片，
 * 插图栏认不出、也不能调大小。转成锚定在前一段之后的插图（位置“某段之后”），排版效果不变。
 */
import type { FigureListName, FigureRef } from '../document/ir'
import { plainText } from './factory'
import type { Block, FigurePlacement, ImageInline, QuestionFigure, RichParagraph, RichText } from './types'

export function figuresOf(b: Block, list?: FigureListName): QuestionFigure[] {
  if (b.type === 'question') {
    if (list === 'answer') return b.question.answerFigures ?? []
    if (list === 'analysis') return b.question.analysisFigures ?? []
    return b.question.figures
  }
  if (b.type === 'composite') {
    if (list === 'answer') return b.answerFigures ?? []
    if (list === 'analysis') return b.analysisFigures ?? []
    return b.figures
  }
  if (b.type === 'knowledge') return list === undefined ? b.figures : []
  return []
}

export function withFigures(b: Block, list: FigureListName | undefined, fn: (figs: QuestionFigure[]) => QuestionFigure[]): Block {
  if (b.type === 'question') {
    const q = b.question
    if (list === 'answer') return { ...b, question: { ...q, answerFigures: fn(q.answerFigures ?? []) } }
    if (list === 'analysis') return { ...b, question: { ...q, analysisFigures: fn(q.analysisFigures ?? []) } }
    return { ...b, question: { ...q, figures: fn(q.figures) } }
  }
  if (b.type === 'composite') {
    if (list === 'answer') return { ...b, answerFigures: fn(b.answerFigures ?? []) }
    if (list === 'analysis') return { ...b, analysisFigures: fn(b.analysisFigures ?? []) }
    return { ...b, figures: fn(b.figures) }
  }
  if (b.type === 'knowledge' && list === undefined) return { ...b, figures: fn(b.figures) } as Block
  return b
}

/** 只含图片（及空白）的段落中的图片；不是这样的段落返回 null */
function imagesOnly(p: RichParagraph): ImageInline[] | null {
  const images = p.inlines.filter((i): i is ImageInline => i.type === 'image')
  if (images.length === 0) return null
  return p.inlines.every((i) => i.type === 'image' || (i.type === 'text' && i.text.trim() === '')) ? images : null
}

/** 正文中是否有单独成段的图片 */
export function hasImageParagraphs(content: RichText): boolean {
  return content.some((p) => imagesOnly(p) !== null)
}

/**
 * 把单独成段的图片取出来作为插图（“某段之后”，锚定在前一段；在最前面时锚定第 1 段），其余段落不变。
 * 已有的插图（existing）锚定的段落序号随之调整。
 */
export function imageParagraphsToFigures(content: RichText, existing: QuestionFigure[] = []): { content: RichText; figures: QuestionFigure[] } {
  const kept: RichText = []
  const added: QuestionFigure[] = []
  /** 原段落序号 → 新段落序号 */
  const newIndex: number[] = []
  for (const p of content) {
    const images = imagesOnly(p)
    if (images === null) {
      newIndex.push(kept.length)
      kept.push(p)
      continue
    }
    newIndex.push(Math.max(0, kept.length - 1))
    for (const img of images) {
      added.push({ assetId: img.assetId, widthEmu: img.widthEmu, heightEmu: img.heightEmu, placement: 'below', anchorParagraph: Math.max(0, kept.length - 1) })
    }
  }
  if (added.length === 0) return { content, figures: existing }
  const moved = existing.map((f) => (f.anchorParagraph === undefined ? f : { ...f, anchorParagraph: newIndex[f.anchorParagraph] ?? Math.max(0, kept.length - 1) }))
  return { content: kept, figures: [...moved, ...added] }
}

/** 转移插图的目标位置（缺省 list = 题图 / 知识点插图 / 综合题背景配图；缺省 index = 追加到末尾） */
export interface MoveFigureTarget {
  blockId: string
  list?: FigureListName
  index?: number
}

export interface MoveFigureResult {
  blocks: Block[]
  /** 转移后的新引用；源或目标无效时为 null */
  movedRef: FigureRef | null
}

/** 可接收插图的内容块摘要，供“转移插图”对话框展示 */
export interface FigureTargetBlock {
  blockId: string
  kind: 'question' | 'knowledge' | 'composite'
  label: string
  parentTitle?: string
  lists: Array<{ list: FigureListName | undefined; label: string }>
}

function findBlockRecursive(blocks: readonly Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b
    if (b.type === 'composite') {
      for (const item of b.items) {
        if (item.id === id) return item
      }
    }
  }
  return undefined
}

function mapBlockRecursive(blocks: readonly Block[], id: string, fn: (b: Block) => Block): Block[] {
  return blocks.map((b) => {
    if (b.id === id) return fn(b)
    if (b.type === 'composite' && b.items.some((item) => item.id === id)) {
      return { ...b, items: b.items.map((item) => (item.id === id ? (fn(item) as typeof item) : item)) }
    }
    return b
  })
}

function supportsTargetList(block: Block, list: FigureListName | undefined): boolean {
  if (block.type === 'question' || block.type === 'composite') return true
  if (block.type === 'knowledge') return list === undefined
  return false
}

/**
 * 规范化转移后的插图属性：
 * - 非题干插图（知识点、综合题背景、答案/解析）只支持 below / center / right / free
 * - 题干的 below-item（锚定原题小问）移出后降级为 below
 * - 清除已失效的 anchorParagraph / anchorItem / offsetYEmu
 */
export function normalizeFigureForTarget(
  fig: QuestionFigure,
  targetBlock: Block,
  targetList?: FigureListName
): QuestionFigure {
  const isQuestionStem = targetBlock.type === 'question' && targetList === undefined
  let placement: FigurePlacement = fig.placement
  if (!isQuestionStem) {
    if (placement === 'right-items') placement = 'right'
    else if (placement === 'below-item' || placement === 'below-all') placement = 'below'
  } else if (placement === 'below-item') {
    placement = 'below'
  }

  const base: QuestionFigure = {
    assetId: fig.assetId,
    widthEmu: fig.widthEmu,
    heightEmu: fig.heightEmu,
    placement
  }
  if (placement === 'free') {
    return { ...base, offsetXEmu: fig.offsetXEmu ?? 0, offsetYEmu: 0 }
  }
  return base
}

/**
 * 把一张插图从源位置转移到目标内容块 / 目标插图组。
 * 支持跨块转移、同块跨组（如题图 ↔ 答案插图 ↔ 解析插图）以及组内调整顺序。
 */
export function moveFigure(blocks: readonly Block[], from: FigureRef, to: MoveFigureTarget): MoveFigureResult {
  const sourceBlock = findBlockRecursive(blocks, from.blockId)
  const targetBlock = findBlockRecursive(blocks, to.blockId)
  if (sourceBlock === undefined || targetBlock === undefined) {
    return { blocks: [...blocks], movedRef: null }
  }
  if (!supportsTargetList(sourceBlock, from.list) || !supportsTargetList(targetBlock, to.list)) {
    return { blocks: [...blocks], movedRef: null }
  }

  const sourceFigs = figuresOf(sourceBlock, from.list)
  const fig = sourceFigs[from.figureIndex]
  if (fig === undefined) {
    return { blocks: [...blocks], movedRef: null }
  }

  let insertAt = 0
  let nextBlocks: Block[]

  if (from.blockId === to.blockId && from.list === to.list) {
    const remaining = sourceFigs.filter((_, i) => i !== from.figureIndex)
    const rawIdx = to.index ?? remaining.length
    insertAt = Math.max(0, Math.min(rawIdx, remaining.length))
    const reordered = [...remaining.slice(0, insertAt), fig, ...remaining.slice(insertAt)]
    nextBlocks = mapBlockRecursive(blocks, to.blockId, (b) => withFigures(b, to.list, () => reordered))
  } else {
    const normalized = normalizeFigureForTarget(fig, targetBlock, to.list)
    if (from.blockId === to.blockId) {
      const targetLen = figuresOf(targetBlock, to.list).length
      const rawIdx = to.index ?? targetLen
      insertAt = Math.max(0, Math.min(rawIdx, targetLen))
      nextBlocks = mapBlockRecursive(blocks, to.blockId, (b) => {
        const withoutSource = withFigures(b, from.list, (figs) => figs.filter((_, i) => i !== from.figureIndex))
        return withFigures(withoutSource, to.list, (figs) => [...figs.slice(0, insertAt), normalized, ...figs.slice(insertAt)])
      })
    } else {
      const targetLen = figuresOf(targetBlock, to.list).length
      const rawIdx = to.index ?? targetLen
      insertAt = Math.max(0, Math.min(rawIdx, targetLen))
      const afterRemove = mapBlockRecursive(blocks, from.blockId, (b) =>
        withFigures(b, from.list, (figs) => figs.filter((_, i) => i !== from.figureIndex))
      )
      nextBlocks = mapBlockRecursive(afterRemove, to.blockId, (b) =>
        withFigures(b, to.list, (figs) => [...figs.slice(0, insertAt), normalized, ...figs.slice(insertAt)])
      )
    }
  }

  const movedRef: FigureRef =
    to.list !== undefined ? { blockId: to.blockId, figureIndex: insertAt, list: to.list } : { blockId: to.blockId, figureIndex: insertAt }
  return { blocks: nextBlocks, movedRef }
}

function summarize(text: string, max = 22): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s === '') return ''
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function formatNumber(n: string | undefined): string | undefined {
  if (n === undefined) return undefined
  const clean = n.replace(/[．.、\s]+$/, '').trim()
  return clean === '' ? undefined : clean
}

const QUESTION_LISTS: Array<{ list: FigureListName | undefined; label: string }> = [
  { list: undefined, label: '题图' },
  { list: 'answer', label: '答案插图' },
  { list: 'analysis', label: '解析插图' }
]

const COMPOSITE_LISTS: Array<{ list: FigureListName | undefined; label: string }> = [
  { list: undefined, label: '背景配图' },
  { list: 'answer', label: '答案插图' },
  { list: 'analysis', label: '解析插图' }
]

const KNOWLEDGE_LISTS: Array<{ list: FigureListName | undefined; label: string }> = [{ list: undefined, label: '插图' }]

/** 按文档顺序列出所有可接收插图的内容块（含综合题小题） */
export function listFigureTargets(blocks: readonly Block[], questionNumbers?: ReadonlyMap<string, string>): FigureTargetBlock[] {
  const targets: FigureTargetBlock[] = []
  for (const b of blocks) {
    if (b.type === 'question') {
      const n = formatNumber(questionNumbers?.get(b.id))
      const stem = summarize(plainText(b.question.stem))
      const head = n !== undefined ? `第 ${n} 题` : '题目'
      targets.push({
        blockId: b.id,
        kind: 'question',
        label: stem !== '' ? `${head} · ${stem}` : head,
        lists: QUESTION_LISTS
      })
    } else if (b.type === 'knowledge') {
      const title = summarize(b.title) || summarize(plainText(b.content)) || '未命名知识点'
      targets.push({
        blockId: b.id,
        kind: 'knowledge',
        label: `知识点 · ${title}`,
        lists: KNOWLEDGE_LISTS
      })
    } else if (b.type === 'composite') {
      const compTitle = summarize(b.title) || summarize(plainText(b.background)) || '未命名综合题'
      targets.push({
        blockId: b.id,
        kind: 'composite',
        label: `综合题 · ${compTitle}`,
        lists: COMPOSITE_LISTS
      })
      for (const item of b.items) {
        const n = formatNumber(questionNumbers?.get(item.id))
        const stem = summarize(plainText(item.question.stem))
        const subHead = n !== undefined ? `第 ${n} 题` : '小题'
        const subDesc = stem !== '' ? `${subHead} · ${stem}` : subHead
        targets.push({
          blockId: item.id,
          kind: 'question',
          label: `${compTitle} / ${subDesc}`,
          parentTitle: compTitle,
          lists: QUESTION_LISTS
        })
      }
    }
  }
  return targets
}
