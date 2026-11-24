/**
 * 工程中所有的插图：题目的题图、答案插图、解析插图，知识点的插图，综合题的背景配图（含综合题中各小题的插图）。
 * 供“批量处理插图”（变清晰、WorkBuddy 重绘）、点击预览中的插图定位到属性栏使用。
 */
import type { FigureListName, FigureRef } from '../document/ir'
import type { Block, Question, QuestionFigure } from './types'

/** 插图所在的组：题图（以及知识点插图、背景配图）、答案插图、解析插图 */
export type FigureListKey = 'figures' | FigureListName

export interface FigureEntry {
  ref: FigureRef
  list: FigureListKey
  figure: QuestionFigure
  /** 所在内容：题目（含小题）、知识点、综合题背景 */
  owner: 'question' | 'knowledge' | 'composite'
  /** 知识点、综合题的标题 */
  title?: string
}

export const listKeyOf = (ref: FigureRef): FigureListKey => ref.list ?? 'figures'

/** 预览中插图元素的标识（data-figure）：属性栏中单击插图时据此找到它 */
export function figureRefKey(ref: FigureRef): string {
  return `${ref.blockId}|${listKeyOf(ref)}|${ref.figureIndex}`
}

/** 属性栏中插图行的标识（预览中点击插图时据此定位） */
export function figureFieldId(list: FigureListKey, index: number): string {
  return `figure:${list}:${index}`
}

const questionLists = (q: Question): Array<[FigureListKey, QuestionFigure[]]> => [
  ['figures', q.figures],
  ['answer', q.answerFigures ?? []],
  ['analysis', q.analysisFigures ?? []]
]

/** 按文档顺序列出所有插图 */
export function listFigures(blocks: readonly Block[]): FigureEntry[] {
  const out: FigureEntry[] = []
  const pushQuestion = (id: string, q: Question): void => {
    for (const [list, figs] of questionLists(q)) {
      figs.forEach((figure, figureIndex) => out.push({ ref: { blockId: id, figureIndex, ...(list !== 'figures' ? { list } : {}) }, list, figure, owner: 'question' }))
    }
  }
  for (const b of blocks) {
    if (b.type === 'question') pushQuestion(b.id, b.question)
    else if (b.type === 'knowledge') b.figures.forEach((figure, figureIndex) => out.push({ ref: { blockId: b.id, figureIndex }, list: 'figures', figure, owner: 'knowledge', title: b.title }))
    else if (b.type === 'composite') {
      b.figures.forEach((figure, figureIndex) => out.push({ ref: { blockId: b.id, figureIndex }, list: 'figures', figure, owner: 'composite', title: b.title }))
      ;(b.answerFigures ?? []).forEach((figure, figureIndex) =>
        out.push({ ref: { blockId: b.id, figureIndex, list: 'answer' }, list: 'answer', figure, owner: 'composite', title: b.title })
      )
      ;(b.analysisFigures ?? []).forEach((figure, figureIndex) =>
        out.push({ ref: { blockId: b.id, figureIndex, list: 'analysis' }, list: 'analysis', figure, owner: 'composite', title: b.title })
      )
      for (const it of b.items) pushQuestion(it.id, it.question)
    }
  }
  return out
}

export interface FigureAssetChange {
  ref: FigureRef
  assetId: string
  /** 换成重绘的 SVG 时宽高比可能略有不同：给出时按它调整高度（宽度不变） */
  aspect?: number
}

/** 替换若干插图的图片（宽度不变；给出宽高比时调整高度） */
export function replaceFigureAssets(blocks: Block[], changes: readonly FigureAssetChange[]): Block[] {
  const byBlock = new Map<string, FigureAssetChange[]>()
  for (const c of changes) byBlock.set(c.ref.blockId, [...(byBlock.get(c.ref.blockId) ?? []), c])
  const apply = (figs: QuestionFigure[], list: FigureListKey, cs: FigureAssetChange[]): QuestionFigure[] =>
    figs.map((f, i) => {
      const c = cs.find((x) => listKeyOf(x.ref) === list && x.ref.figureIndex === i)
      if (c === undefined) return f
      return { ...f, assetId: c.assetId, ...(c.aspect !== undefined && c.aspect > 0 ? { heightEmu: Math.round(f.widthEmu / c.aspect) } : {}) }
    })
  const fixQuestion = (q: Question, cs: FigureAssetChange[]): Question => ({
    ...q,
    figures: apply(q.figures, 'figures', cs),
    ...(q.answerFigures !== undefined ? { answerFigures: apply(q.answerFigures, 'answer', cs) } : {}),
    ...(q.analysisFigures !== undefined ? { analysisFigures: apply(q.analysisFigures, 'analysis', cs) } : {})
  })
  return blocks.map((b) => {
    if (b.type === 'question') {
      const cs = byBlock.get(b.id)
      return cs === undefined ? b : { ...b, question: fixQuestion(b.question, cs) }
    }
    if (b.type === 'knowledge') {
      const cs = byBlock.get(b.id)
      return cs === undefined ? b : { ...b, figures: apply(b.figures, 'figures', cs) }
    }
    if (b.type === 'composite') {
      const cs = byBlock.get(b.id)
      const items = b.items.map((it) => {
        const ic = byBlock.get(it.id)
        return ic === undefined ? it : { ...it, question: fixQuestion(it.question, ic) }
      })
      return {
        ...b,
        ...(cs !== undefined
          ? {
              figures: apply(b.figures, 'figures', cs),
              ...(b.answerFigures !== undefined ? { answerFigures: apply(b.answerFigures, 'answer', cs) } : {}),
              ...(b.analysisFigures !== undefined ? { analysisFigures: apply(b.analysisFigures, 'analysis', cs) } : {})
            }
          : {}),
        items
      }
    }
    return b
  })
}
