/**
 * 综合题的拆分与合并：
 * - splitComposite：拆开前自动先将集中在最后的答案与解析分到各小题，再把小题释放为独立题目；
 *   若综合题还有背景材料 / 背景配图，则在前面生成一个知识点块保存。
 * - mergeQuestionsToComposite：把多道选中的题目按大纲顺序合并为一道新综合题，放在第一道被选题目的位置。
 */
import { answerPlacement, distributeAnswers } from './composite-answers'
import { createComposite, createKnowledge } from './factory'
import type { Block, CompositeBlock, QuestionBlock, RichText } from './types'

const hasRichContent = (rt: RichText | undefined): boolean =>
  rt !== undefined && rt.some((p) => p.inlines.some((i) => i.type !== 'text' || i.text.trim() !== ''))

/**
 * 把综合题拆成独立的题目：
 * 1. 拆前先调用 distributeAnswers 把集中在最后的答案与解析尽量分到各小题；
 * 2. 若综合题仍有未拆完的教师版字段（知识点/重点/难点/审题/剩余答案或解析及插图），并入第一道小题以免丢失；
 * 3. 若有背景文字或配图，在前面转为知识点块保存背景；否则直接用小题列表替换原综合题。
 */
export function splitComposite(blocks: readonly Block[], compositeId: string): { blocks: Block[]; firstId: string } | null {
  const index = blocks.findIndex((b) => b.id === compositeId)
  const target = blocks[index]
  if (index === -1 || target?.type !== 'composite' || target.items.length === 0) return null

  const placement = answerPlacement(target)
  const distributed = placement === 'end' || placement === 'mixed' ? distributeAnswers(target).composite : target

  const first = distributed.items[0]!
  let q0 = first.question
  if (distributed.important === true && q0.important !== true) q0 = { ...q0, important: true }
  if ((distributed.knowledgePoints?.length ?? 0) > 0) {
    const merged = [...q0.knowledgePoints]
    for (const kp of distributed.knowledgePoints!) {
      if (!merged.includes(kp)) merged.push(kp)
    }
    q0 = { ...q0, knowledgePoints: merged }
  }
  if (distributed.keyPoint !== undefined && distributed.keyPoint !== '') {
    q0 = { ...q0, keyPoint: q0.keyPoint ? `${q0.keyPoint}；${distributed.keyPoint}` : distributed.keyPoint }
  }
  if (distributed.difficultPoint !== undefined && distributed.difficultPoint !== '') {
    q0 = { ...q0, difficultPoint: q0.difficultPoint ? `${q0.difficultPoint}；${distributed.difficultPoint}` : distributed.difficultPoint }
  }
  if (hasRichContent(distributed.review)) {
    q0 = { ...q0, review: [...(q0.review ?? []), ...distributed.review!] }
  }
  if (hasRichContent(distributed.answer)) {
    const prevLen = q0.answer.length
    q0 = { ...q0, answer: [...q0.answer, ...distributed.answer] }
    if ((distributed.answerFigures?.length ?? 0) > 0) {
      const shifted = distributed.answerFigures!.map((f) => (f.anchorParagraph !== undefined ? { ...f, anchorParagraph: f.anchorParagraph + prevLen } : f))
      q0 = { ...q0, answerFigures: [...(q0.answerFigures ?? []), ...shifted] }
    }
  } else if ((distributed.answerFigures?.length ?? 0) > 0) {
    q0 = { ...q0, answerFigures: [...(q0.answerFigures ?? []), ...distributed.answerFigures!] }
  }
  if (hasRichContent(distributed.analysis)) {
    const prevLen = q0.analysis.length
    q0 = { ...q0, analysis: [...q0.analysis, ...distributed.analysis] }
    if ((distributed.analysisFigures?.length ?? 0) > 0) {
      const shifted = distributed.analysisFigures!.map((f) => (f.anchorParagraph !== undefined ? { ...f, anchorParagraph: f.anchorParagraph + prevLen } : f))
      q0 = { ...q0, analysisFigures: [...(q0.analysisFigures ?? []), ...shifted] }
    }
  } else if ((distributed.analysisFigures?.length ?? 0) > 0) {
    q0 = { ...q0, analysisFigures: [...(q0.analysisFigures ?? []), ...distributed.analysisFigures!] }
  }

  const released: QuestionBlock[] = [{ ...first, question: q0 }, ...distributed.items.slice(1)]
  const hasBackground = hasRichContent(distributed.background) || distributed.figures.length > 0
  const replacement: Block[] = hasBackground
    ? [
        createKnowledge({
          title: distributed.title,
          content: distributed.background,
          figures: distributed.figures,
          layout: { ...distributed.layout, studentSpaceLines: 0, teacherSpaceLines: 0 }
        }),
        ...released
      ]
    : released

  if (distributed.layout.pageBreakBefore && !hasBackground && replacement[0]?.type === 'question') {
    const firstQ = replacement[0]
    replacement[0] = { ...firstQ, question: { ...firstQ.question, layout: { ...firstQ.question.layout, pageBreakBefore: true } } }
  }

  const out = [...blocks.slice(0, index), ...replacement, ...blocks.slice(index + 1)]
  return { blocks: out, firstId: released[0]!.id }
}

/**
 * 把多道选中的题目（按大纲顺序，含顶层题目或综合题内小题）合并为一道新综合题，
 * 放在第一道被选题目原来的位置；不足 2 道时返回 null。
 */
export function mergeQuestionsToComposite(blocks: readonly Block[], blockIds: readonly string[]): { blocks: Block[]; compositeId: string } | null {
  const idSet = new Set(blockIds)
  if (idSet.size < 2) return null

  const picked: QuestionBlock[] = []
  let firstKind: { type: 'top'; index: number } | { type: 'nested'; index: number } | null = null

  blocks.forEach((b, i) => {
    if (b.type === 'question' && idSet.has(b.id)) {
      if (firstKind === null) firstKind = { type: 'top', index: i }
      picked.push(b)
    } else if (b.type === 'composite') {
      for (const it of b.items) {
        if (idSet.has(it.id)) {
          if (firstKind === null) firstKind = { type: 'nested', index: i }
          picked.push(it)
        }
      }
    }
  })

  if (picked.length < 2 || firstKind === null) return null

  const composite: CompositeBlock = createComposite({ items: picked })
  const out: Block[] = []

  blocks.forEach((b, i) => {
    if (b.type === 'question') {
      if (firstKind!.type === 'top' && i === firstKind!.index) {
        out.push(composite)
        return
      }
      if (!idSet.has(b.id)) out.push(b)
      return
    }
    if (b.type === 'composite') {
      const items = b.items.filter((it) => !idSet.has(it.id))
      out.push(items.length === b.items.length ? b : { ...b, items })
      if (firstKind!.type === 'nested' && i === firstKind!.index) {
        out.push(composite)
      }
      return
    }
    out.push(b)
  })

  return { blocks: out, compositeId: composite.id }
}
