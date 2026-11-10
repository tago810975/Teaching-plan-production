import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { answerPlacement, collectAnswers, distributeAnswers } from '@core/model/composite-answers'
import { importDocx } from '@core/import/import-docx'
import { createComposite, createQuestion, newId, para, plainText } from '@core/model/factory'
import type { CompositeBlock, QuestionBlock } from '@core/model/types'

const item = (stem: string, extra: Partial<Parameters<typeof createQuestion>[0]> = {}): QuestionBlock => ({ id: newId(), type: 'question', question: createQuestion({ stem: [para(stem)], ...extra }) })

describe('综合题答案与解析：集中在最后 / 分到各小题', async () => {
  const r = await importDocx(new Uint8Array(readFileSync('reference/samples/组卷网_高中物理作业/组卷网_2026年11月6日高中物理作业.docx')))
  const comps = r.blocks.filter((b): b is CompositeBlock => b.type === 'composite')

  it('组卷网题组：答案按题号分到 5 道小题，多空用全角空格隔开，公式保留', () => {
    const c = comps[0]!
    expect(answerPlacement(c)).toBe('end')
    const { composite: d, answerParts, analysisParts } = distributeAnswers(c)
    expect([answerParts, analysisParts]).toEqual([5, 5])
    expect(answerPlacement(d)).toBe('items')
    const answers = d.items.map((it) => plainText(it.question.answer))
    expect(answers[1]).toBe('C　D')
    expect(answers[3]).toBe('C')
    expect(d.items[0]!.question.answer[0]!.inlines.some((i) => i.type === 'math')).toBe(true)
    // 解析：每道小题开头补上【解析】，去掉题号
    expect(plainText(d.items[1]!.question.analysis).startsWith('【解析】[1]由图根据同侧法可知')).toBe(true)
    expect(plainText(d.items[1]!.question.analysis)).toContain('故选D。')
    expect(plainText(d.items[0]!.question.analysis)).not.toContain('2．')
    // 【知识点】仍留在综合题
    expect(plainText(d.analysis)).toMatch(/^【知识点】/)
    expect(d.answer).toEqual([])
  })

  it('全部题组都能分开：段数与小题数一致', () => {
    for (const c of comps) {
      const { answerParts, analysisParts } = distributeAnswers(c)
      expect([answerParts, analysisParts]).toEqual([c.items.length, c.items.length])
    }
  })

  it('分到各小题后再集中回来：答案、解析与原来一致（空白统一为全角空格）', () => {
    const c = comps[1]! // 6～11 题
    const d = distributeAnswers(c).composite
    const back = collectAnswers(d, [6, 7, 8, 9, 10, 11])
    expect(answerPlacement(back)).toBe('end')
    const norm = (s: string): string => s.replace(/(\d．)[\s　]+/g, '$1').replace(/[\s　]+/g, ' ').trim()
    expect(norm(plainText(back.answer))).toBe(norm(plainText(c.answer)))
    expect(norm(plainText(back.analysis))).toBe(norm(plainText(c.analysis)))
    expect(back.items.every((it) => it.question.answer.length === 0 && it.question.analysis.length === 0)).toBe(true)
  })

  it('答案中的小数、[1]、（1）不会被当成题号', () => {
    const c = createComposite({
      title: '',
      background: [],
      items: [item('甲'), item('乙')],
      answer: [para('3．1.8　向上　4．（1）0.25 （2）B')],
      analysis: [para('【详解】3．[1]由图可知 v=1.8m/s'), para('故选A。'), para('4．（1）2．5 小时'), para('（2）略')]
    })
    const d = distributeAnswers(c).composite
    expect(d.items.map((it) => plainText(it.question.answer))).toEqual(['1.8　向上', '（1）0.25 （2）B'])
    expect(d.items.map((it) => plainText(it.question.analysis))).toEqual(['【详解】[1]由图可知 v=1.8m/s\n故选A。', '【详解】（1）2．5 小时\n（2）略'])
  })

  it('只有一道小题、答案不带题号：整段交给这道小题', () => {
    const c = createComposite({ title: '', background: [], items: [item('甲')], answer: [para('（1）1.570 （2）2')], analysis: [para('【解析】（1）由图可知')] })
    const d = distributeAnswers(c).composite
    expect(plainText(d.items[0]!.question.answer)).toBe('（1）1.570 （2）2')
    expect(plainText(d.items[0]!.question.analysis)).toBe('【解析】（1）由图可知')
  })

  it('集中到最后：各小题的答案拼成一段，解析按题号接起来，只保留一个标签', () => {
    const c = createComposite({
      title: '',
      background: [],
      items: [item('甲', { answer: [para('A')], analysis: [para('【解析】甲的解析'), para('故选A。')] }), item('乙', { answer: [para('BC')], analysis: [para('【解析】乙的解析')] })],
      answer: [],
      analysis: []
    })
    const back = collectAnswers(c, [12, 13])
    expect(plainText(back.answer)).toBe('12．A　　13．BC')
    expect(back.analysis.map((p) => plainText([p]))).toEqual(['【解析】12．甲的解析', '故选A。', '13．乙的解析'])
  })

  it('答案中找不到题号时不拆，留在综合题', () => {
    const c = createComposite({ title: '', background: [], items: [item('甲'), item('乙')], answer: [para('见解析')], analysis: [] })
    const { composite: d, answerParts } = distributeAnswers(c)
    expect(answerParts).toBe(0)
    expect(plainText(d.answer)).toBe('见解析')
  })
})
