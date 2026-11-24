/**
 * 内容块中的各组插图：题图（question.figures）、答案插图、解析插图（仅教师版），
 * 知识点插图与综合题背景配图（block.figures）。按 FigureRef.list 读写其中一组。
 *
 * 另有“单独成段的图片 → 插图”：从墨案、网页粘贴来的图片常常单独占一段、作为行内图片，
 * 插图栏认不出、也不能调大小。转成锚定在前一段之后的插图（位置“某段之后”），排版效果不变。
 */
import type { FigureListName } from '../document/ir'
import type { Block, ImageInline, QuestionFigure, RichParagraph, RichText } from './types'

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
