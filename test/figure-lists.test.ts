import { describe, expect, it } from 'vitest'
import { figuresOf, hasImageParagraphs, imageParagraphsToFigures, withFigures } from '@core/model/figure-lists'
import { createEmptyProject, createKnowledge, createQuestion, para } from '@core/model/factory'
import { buildDocument } from '@core/document/build'
import type { Block, ImageInline, QuestionFigure, RichParagraph } from '@core/model/types'

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
