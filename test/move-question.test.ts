import { describe, expect, it } from 'vitest'
import { createComposite, createQuestion, para } from '@core/model/factory'
import { moveQuestion, moveQuestionTo } from '@core/model/move-question'
import type { Block, QuestionBlock } from '@core/model/types'

const q = (id: string): QuestionBlock => ({ id, type: 'question', question: createQuestion({ stem: [para(id)], answer: [para(`${id}的答案`)] }) })
const comp = (id: string, items: QuestionBlock[]): Block => ({ ...createComposite({ title: id, background: [], items, answer: [], analysis: [] }), id })
/** 结构的简写：a、B[b1 b2] */
const shape = (blocks: Block[]): string =>
  blocks.map((b) => (b.type === 'composite' ? `${b.id}[${b.items.map((i) => i.id).join(' ')}]` : b.id)).join(' ')

const start = (): Block[] => [q('a'), comp('B', [q('b1'), q('b2')]), q('c'), comp('D', [q('d1')]), { id: 's', type: 'section', text: '课后练习' }]

describe('题目跨综合题移动', () => {
  it('小题在综合题内移动；到边缘后移出成为独立题目', () => {
    let b = start()
    b = moveQuestion(b, 'b1', 1)
    expect(shape(b)).toBe('a B[b2 b1] c D[d1] s')
    b = moveQuestion(b, 'b1', 1)
    expect(shape(b)).toBe('a B[b2] b1 c D[d1] s')
    b = moveQuestion(start(), 'b1', -1)
    expect(shape(b)).toBe('a b1 B[b2] c D[d1] s')
  })

  it('独立题目紧挨着综合题时移进去：下移成为第一道，上移成为最后一道', () => {
    expect(shape(moveQuestion(start(), 'a', 1))).toBe('B[a b1 b2] c D[d1] s')
    expect(shape(moveQuestion(start(), 'c', -1))).toBe('a B[b1 b2 c] D[d1] s')
    expect(shape(moveQuestion(start(), 'c', 1))).toBe('a B[b1 b2] D[c d1] s')
  })

  it('连续下移：从一道综合题一路走到另一道综合题', () => {
    let b = start()
    const steps: string[] = []
    for (let k = 0; k < 4; k++) {
      b = moveQuestion(b, 'b2', 1)
      steps.push(shape(b))
    }
    expect(steps).toEqual(['a B[b1] b2 c D[d1] s', 'a B[b1] c b2 D[d1] s', 'a B[b1] c D[b2 d1] s', 'a B[b1] c D[d1 b2] s'])
  })

  it('带着自己的答案一起移动；首尾不能再移时不变', () => {
    const b = moveQuestion(start(), 'd1', 1)
    // 小题都移走后综合题仍保留（标题、背景、配图还在）
    expect(shape(b)).toBe('a B[b1 b2] c D[] d1 s')
    const d1 = b.find((x) => x.id === 'd1') as QuestionBlock
    expect(d1.question.answer).toEqual([para('d1的答案')])
    const top = [q('x')]
    expect(moveQuestion(top, 'x', -1)).toBe(top)
  })

  it('一步移到某道综合题的最后，或移出综合题', () => {
    expect(shape(moveQuestionTo(start(), 'b1', 'D'))).toBe('a B[b2] c D[d1 b1] s')
    expect(shape(moveQuestionTo(start(), 'a', 'D'))).toBe('B[b1 b2] c D[d1 a] s')
    expect(shape(moveQuestionTo(start(), 'b1', null))).toBe('a B[b2] b1 c D[d1] s')
    // 已在目标中、目标不是综合题、本来就独立：不变
    const s = start()
    expect(moveQuestionTo(s, 'b1', 'B')).toBe(s)
    expect(moveQuestionTo(s, 'a', 'c')).toBe(s)
    expect(moveQuestionTo(s, 'a', null)).toBe(s)
  })
})
