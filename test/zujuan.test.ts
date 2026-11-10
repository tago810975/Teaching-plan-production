import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importDocx } from '@core/import/import-docx'
import { gradeOfCoefficient, isZujuan, prepareZujuan } from '@core/import/zujuan'
import { readDocx } from '@core/import/docx-reader'
import { plainText } from '@core/model/factory'
import type { Block, CompositeBlock, QuestionBlock } from '@core/model/types'

const FILE = 'reference/samples/组卷网_高中物理作业/组卷网_2026年11月6日高中物理作业.docx'

describe('组卷网下载的题目', async () => {
  const bytes = new Uint8Array(readFileSync(FILE))
  const r = await importDocx(bytes)
  const composites = r.blocks.filter((b): b is CompositeBlock => b.type === 'composite')
  const questions = (bs: Block[]): QuestionBlock[] => bs.flatMap((b) => (b.type === 'question' ? [b] : b.type === 'composite' ? b.items : []))

  it('识别为组卷网格式；我们自己排版的教学案不算', async () => {
    expect(isZujuan((await readDocx(bytes)).paragraphs)).toBe(true)
    const own = await readDocx(new Uint8Array(readFileSync('reference/samples/2026秋季高二物理东湖_期中试卷分析/教案_T_期中试卷分析.docx')))
    expect(isZujuan(own.paragraphs)).toBe(false)
  })

  it('47 道题，题号连续；解析中“N．”开头的分题解析不会变成题目', () => {
    expect(r.questionCount).toBe(47)
    expect(questions(r.blocks)).toHaveLength(47)
    expect(questions(r.blocks).some((q) => /^\s*(\[\d\]|故选|由图)/.test(plainText(q.question.stem)))).toBe(false)
  })

  it('大标题；去掉“学校: 姓名:”与“系统分组”', () => {
    expect(r.blocks[0]).toMatchObject({ type: 'title', text: '2026年11月6日高中物理作业' })
    const all = JSON.stringify(r.blocks)
    expect(all).not.toContain('学校:')
    expect(all).not.toContain('系统分组')
  })

  it('题组做成综合题：短标题、背景、配图、小题，共用答案与解析', () => {
    expect(composites.map((c) => [c.title, c.items.length])).toEqual([
      ['', 5],
      ['艺术体操', 6],
      ['', 4],
      ['', 6],
      ['摆动', 6],
      ['光的性质', 5],
      ['', 5],
      ['光的性质', 3],
      ['', 2],
      ['', 4]
    ])
    const first = composites[0]!
    expect(plainText(first.background)).toMatch(/^体操运动员在上下抖动一轻质丝带/)
    expect(first.figures).toHaveLength(1)
    expect(plainText(first.answer)).toMatch(/^1．/)
    expect(plainText(first.analysis)).toContain('故选A')
    // 背景从上一组解析之后正确分开
    expect(plainText(composites[4]!.background)).toMatch(/^物体的摆动是生活中常见的物理现象/)
    expect(plainText(composites[3]!.analysis)).not.toContain('物体的摆动')
    // 只有两道小题的组：答案仍为共用（“【答案】42．C 43．…”）
    expect(plainText(composites[8]!.answer)).toMatch(/^42．C/)
  })

  it('单独的一道题（无背景）保留自己的答案与解析', () => {
    const single = r.blocks.filter((b): b is QuestionBlock => b.type === 'question')
    expect(single).toHaveLength(1)
    expect(plainText(single[0]!.question.stem)).toMatch(/^某同学用图甲所示的装置研究单摆运动的规律/)
    expect(plainText(single[0]!.question.answer)).toMatch(/1\.570/)
    expect(single[0]!.question.knowledgePoints).toEqual(['用单摆测量重力加速度的大小'])
  })

  it('选择题的选项（含图片选项）与小问', () => {
    const qs = questions(r.blocks)
    expect(qs[3]!.question.options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(qs[3]!.question.options.every((o) => o.content.inlines.some((i) => i.type === 'image'))).toBe(true)
    expect(qs[8]!.question.options.map((o) => plainText([o.content]))).toEqual(['增大', '减小', '保持不变'])
    expect(qs[16]!.question.subQuestions).toHaveLength(2)
  })

  it('难度按组卷网难度系数换算；知识点分给组中的每道小题', () => {
    const qs = questions(r.blocks)
    expect(qs[0]!.question.difficulty).toBe('B') // 0.61
    expect(qs[15]!.question.difficulty).toBe('C') // 0.4
    expect(qs[0]!.question.knowledgePoints).toEqual(['简谐运动的定义及特征', '波长', '频率和波速的关系', '波的图像'])
    expect(plainText(composites[0]!.analysis)).not.toContain('【知识点】')
    expect([gradeOfCoefficient(0.85), gradeOfCoefficient(0.7), gradeOfCoefficient(0.65), gradeOfCoefficient(0.49)]).toEqual(['A', 'A', 'B', 'C'])
  })

  it('导入提示中说明识别为组卷网格式', () => {
    expect(r.warnings[0]).toMatch(/组卷网/)
  })

  it('预处理：题组数与难度系数', async () => {
    const prep = prepareZujuan((await readDocx(bytes)).paragraphs)
    expect(prep.groups).toBe(11)
    expect(prep.difficulty.get(1)).toBe(0.61)
    expect(prep.difficulty.get(47)).toBe(0.65)
  })
})
