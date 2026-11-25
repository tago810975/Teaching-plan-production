import { describe, expect, it } from 'vitest'
import { figuresOf, hasImageParagraphs, imageParagraphsToFigures, listFigureTargets, moveFigure, withFigures } from '@core/model/figure-lists'
import { createComposite, createEmptyProject, createKnowledge, createQuestion, para } from '@core/model/factory'
import { buildDocument } from '@core/document/build'
import type { Block, ImageInline, Question, QuestionBlock, QuestionFigure, RichParagraph } from '@core/model/types'

const img = (id: string): ImageInline => ({ type: 'image', assetId: id, widthEmu: 1800000, heightEmu: 900000 })
const imgPara = (...ids: string[]): RichParagraph => ({ inlines: ids.map(img) })

describe('单独成段的图片转为插图', () => {
  it('锚定在前一段之后；在最前面时锚定第 1 段；夹在文字中的图片不动', () => {
    const content = [imgPara('a'), para('第一段'), imgPara('b', 'c'), para('第二段'), { inlines: [{ type: 'text' as const, text: '图 ' }, img('d')] }]
    expect(hasImageParagraphs(content)).toBe(true)
    const r = imageParagraphsToFigures(content)
    expect(r.content).toHaveLength(3)
    expect(r.figures.map((f) => [f.assetId, f.placement, f.anchorParagraph])).toEqual([['a', 'below', 0], ['b', 'below', 0], ['c', 'below', 0]])
    expect(hasImageParagraphs(r.content)).toBe(false)
  })
  it('已有插图的锚定段落随之调整', () => {
    const existing: QuestionFigure[] = [{ assetId: 'x', widthEmu: 1, heightEmu: 1, placement: 'right', anchorParagraph: 2 }]
    const r = imageParagraphsToFigures([para('一'), imgPara('a'), para('二')], existing)
    expect(r.figures[0]).toMatchObject({ assetId: 'x', anchorParagraph: 1 })
    expect(r.figures[1]).toMatchObject({ assetId: 'a', anchorParagraph: 0 })
  })
  it('没有这样的段落时原样返回', () => {
    const content = [para('一')]
    const r = imageParagraphsToFigures(content)
    expect(r.content).toBe(content)
  })
})

describe('答案插图、解析插图', () => {
  const q = createQuestion({
    kind: 'solve',
    stem: [para('题干')],
    answer: [para('答案第一段'), para('答案第二段')],
    analysis: [para('【解析】解析')],
    answerFigures: [{ assetId: 'ans', widthEmu: 1800000, heightEmu: 900000, placement: 'below', anchorParagraph: 0 }],
    analysisFigures: [{ assetId: 'ana', widthEmu: 1800000, heightEmu: 900000, placement: 'right', anchorParagraph: 0 }]
  })
  const block: Block = { id: 'q', type: 'question', question: q }
  const doc = (variant: 'teacher' | 'student') => buildDocument({ ...createEmptyProject(), blocks: [block] }, variant)

  it('教师版：答案插图紧跟锚定段落，解析插图环绕在解析段落右侧；引用标明所属组', () => {
    const ps = doc('teacher').paragraphs
    const texts = ps.map((p) => p.runs.map((r) => (r.kind === 'text' ? r.text : r.kind === 'image' ? `[${r.assetId}]` : '')).join(''))
    expect(texts.slice(1, 4)).toEqual(['答案第一段', '[ans]', '答案第二段'])
    const imgRun = ps[2]!.runs[0]!
    expect(imgRun.kind === 'image' && imgRun.ref).toEqual({ blockId: 'q', figureIndex: 0, list: 'answer' })
    const ana = ps.find((p) => p.editTarget?.field === 'analysis')!
    expect(ana.floatingImages?.[0]?.ref).toEqual({ blockId: 'q', figureIndex: 0, list: 'analysis' })
    expect(ana.anchorGroup).toBe('analysis')
  })
  it('学生版不出现', () => {
    const json = JSON.stringify(doc('student'))
    expect(json.includes('"ans"') || json.includes('"ana"')).toBe(false)
  })
  it('按引用读写对应的一组', () => {
    expect(figuresOf(block, 'answer')[0]!.assetId).toBe('ans')
    const next = withFigures(block, 'analysis', () => [])
    expect(figuresOf(next, 'analysis')).toEqual([])
    expect(figuresOf(next, 'answer')).toHaveLength(1)
    const k = createKnowledge({ content: [para('一')] })
    const kb: Block = k
    expect(withFigures(kb, 'answer', () => [])).toBe(kb)
  })
})

const qBlock = (id: string, partial: Partial<Question>): QuestionBlock => ({
  id,
  type: 'question',
  question: createQuestion({ kind: 'solve', id, ...partial })
})

describe('转移插图（moveFigure 与 listFigureTargets）', () => {
  it('可跨题目、知识点、综合题背景与小题之间转移，并支持同题内跨组转移', () => {
    const q1 = qBlock('q1', {
      stem: [para('第一题')],
      figures: [{ assetId: 'fig-1', widthEmu: 100, heightEmu: 80, placement: 'right-items', anchorParagraph: 0 }],
      answerFigures: [{ assetId: 'ans-1', widthEmu: 90, heightEmu: 70, placement: 'below', anchorParagraph: 1 }]
    })
    const k1 = createKnowledge({ id: 'k1', title: '动能定理', content: [para('正文')], figures: [] })
    const sub1 = qBlock('sub1', { stem: [para('第一小问')], figures: [] })
    const comp1 = createComposite({
      id: 'comp1',
      title: '材料一',
      background: [para('背景')],
      items: [sub1]
    })
    const blocks: Block[] = [q1, k1, comp1]

    // 1. 列出所有可接收插图的目标（含综合题及其小题）
    const numbers = new Map([
      ['q1', '1.'],
      ['sub1', '2.']
    ])
    const targets = listFigureTargets(blocks, numbers)
    expect(targets.map((t) => t.blockId)).toEqual(['q1', 'k1', 'comp1', 'sub1'])
    expect(targets[0]!.label).toBe('第 1 题 · 第一题')
    expect(targets[1]!.label).toBe('知识点 · 动能定理')
    expect(targets[2]!.label).toBe('综合题 · 材料一')
    expect(targets[3]!.label).toBe('材料一 / 第 2 题 · 第一小问')
    expect(targets[3]!.parentTitle).toBe('材料一')

    // 2. 题图（right-items）转移到知识点：自动降级为 right 并清除 anchorParagraph
    const toKnowledge = moveFigure(blocks, { blockId: 'q1', figureIndex: 0 }, { blockId: 'k1' })
    expect(toKnowledge.movedRef).toEqual({ blockId: 'k1', figureIndex: 0 })
    expect(figuresOf(toKnowledge.blocks[0]!, undefined)).toEqual([])
    expect(figuresOf(toKnowledge.blocks[1]!, undefined)).toEqual([
      { assetId: 'fig-1', widthEmu: 100, heightEmu: 80, placement: 'right' }
    ])

    // 3. 知识点插图转移到综合题小题解析插图，且从 below-item/below-all 降级
    const fromStem = qBlock('q2', {
      stem: [para('第二题')],
      figures: [{ assetId: 'fig-2', widthEmu: 120, heightEmu: 60, placement: 'below-item', anchorItem: 0 }]
    })
    const rSub = moveFigure([fromStem, comp1], { blockId: 'q2', figureIndex: 0 }, { blockId: 'sub1', list: 'analysis' })
    expect(rSub.movedRef).toEqual({ blockId: 'sub1', figureIndex: 0, list: 'analysis' })
    const movedComp = rSub.blocks[1]!
    if (movedComp.type !== 'composite') throw new Error('expected composite')
    expect(figuresOf(movedComp.items[0]!, 'analysis')).toEqual([
      { assetId: 'fig-2', widthEmu: 120, heightEmu: 60, placement: 'below' }
    ])

    // 4. 同一道题内部：答案插图 → 题图
    const sameQ = moveFigure(blocks, { blockId: 'q1', figureIndex: 0, list: 'answer' }, { blockId: 'q1' })
    expect(sameQ.movedRef).toEqual({ blockId: 'q1', figureIndex: 1 })
    expect(figuresOf(sameQ.blocks[0]!, 'answer')).toEqual([])
    expect(figuresOf(sameQ.blocks[0]!, undefined).map((f) => f.assetId)).toEqual(['fig-1', 'ans-1'])
  })

  it('目标不兼容（如把图移入知识点答案组）或下标越界时返回 movedRef=null 且不改动 blocks', () => {
    const q1 = qBlock('q1', {
      stem: [para('题')],
      figures: [{ assetId: 'a', widthEmu: 10, heightEmu: 10, placement: 'free', anchorParagraph: 0, offsetXEmu: 50, offsetYEmu: 80 }]
    })
    const k1 = createKnowledge({ id: 'k1', title: '知识点', content: [para('字')] })
    const blocks: Block[] = [q1, k1]

    const badList = moveFigure(blocks, { blockId: 'q1', figureIndex: 0 }, { blockId: 'k1', list: 'answer' })
    expect(badList.movedRef).toBeNull()
    expect(badList.blocks).toEqual(blocks)

    const badIdx = moveFigure(blocks, { blockId: 'q1', figureIndex: 3 }, { blockId: 'k1' })
    expect(badIdx.movedRef).toBeNull()

    // 自由位置转移时会保留水平偏移并将纵坐标归零、清掉旧锚定段落
    const movedFree = moveFigure(blocks, { blockId: 'q1', figureIndex: 0 }, { blockId: 'k1' })
    expect(figuresOf(movedFree.blocks[1]!, undefined)).toEqual([
      { assetId: 'a', widthEmu: 10, heightEmu: 10, placement: 'free', offsetXEmu: 50, offsetYEmu: 0 }
    ])
  })
})
