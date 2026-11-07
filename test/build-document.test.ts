import { describe, expect, it } from 'vitest'
import { buildDocument, resolveOptionColumns } from '@core/document/build'
import { paginate } from '@core/document/paginate'
import { createEmptyProject, createQuestion, newId, para } from '@core/model/factory'
import type { Project, Question } from '@core/model/types'
import { createDemoBundle } from '@core/sample/demo-project'

function projectWith(...questions: Question[]): Project {
  const p = createEmptyProject()
  p.blocks = questions.map((question) => ({ id: newId(), type: 'question', question }))
  return p
}

const fullQuestion = (): Question =>
  createQuestion({
    stem: [para('题干')],
    options: ['A', 'B', 'C', 'D'].map((label) => ({ label, content: para('短') })),
    answer: [para('B')],
    knowledgePoints: ['放缩圆'],
    keyPoint: '重点内容',
    difficultPoint: '难点内容',
    analysis: [para('【详解】……')]
  })

describe('教师版与学生版', () => {
  it('学生版不含答案、知识点、重点、难点、详解', () => {
    const ir = buildDocument(projectWith(fullQuestion()), 'student')
    const styles = ir.paragraphs.map((p) => p.style)
    expect(styles).toEqual(['question', 'option'])
  })

  it('教师版包含全部内容，且教师内容带底纹', () => {
    const ir = buildDocument(projectWith(fullQuestion()), 'teacher')
    expect(ir.paragraphs.map((p) => [p.style, p.label, p.shaded ?? false])).toEqual([
      ['question', '1.', false],
      ['option', undefined, false],
      ['answer', '【答案】', true],
      ['knowledge', '【知识点】', true],
      ['keyPoint', '【重点】', true],
      ['difficultPoint', '【难点】', true],
      ['analysis', undefined, true]
    ])
  })

  it('页眉右侧自动追加版本名', () => {
    const p = createEmptyProject()
    p.meta.headerRight = '高二物理勤敏'
    expect(buildDocument(p, 'teacher').header.right).toBe('高二物理勤敏(教案)')
    expect(buildDocument(p, 'student').header.right).toBe('高二物理勤敏(学案)')
  })

  it('仅限某一版本的段落只在该版本出现', () => {
    const p = createEmptyProject()
    p.blocks = [{ id: 'x', type: 'paragraph', content: [para('教师提示')], onlyIn: 'teacher' }]
    expect(buildDocument(p, 'teacher').paragraphs).toHaveLength(1)
    expect(buildDocument(p, 'student').paragraphs).toHaveLength(0)
  })
})

describe('题号', () => {
  it('跨章节连续编号，大标题可重新开始', () => {
    const p = createEmptyProject()
    const q = (): { id: string; type: 'question'; question: Question } => ({
      id: newId(),
      type: 'question',
      question: createQuestion({ stem: [para('题')] })
    })
    p.blocks = [
      q(),
      { id: newId(), type: 'section', text: '课堂练习' },
      q(),
      { id: newId(), type: 'title', text: '作业单', restartNumbering: true },
      q()
    ]
    const labels = buildDocument(p, 'student').paragraphs.flatMap((x) => (x.style === 'question' ? [x.label] : []))
    expect(labels).toEqual(['1.', '2.', '1.'])
  })

  it('难度标记写在题干开头', () => {
    const ir = buildDocument(projectWith(createQuestion({ difficulty: 'B', stem: [para('题干')] })), 'student')
    expect(ir.paragraphs[0]?.runs[0]).toEqual({ kind: 'text', text: '【B】' })
  })
})

describe('选项分列', () => {
  const opts = (...texts: string[]): Question['options'] =>
    texts.map((t, i) => ({ label: 'ABCD'[i]!, content: para(t) }))

  it('短选项排成一行四项', () => {
    expect(resolveOptionColumns(opts('2', '3', '4', '5'), 'auto')).toBe(4)
  })
  it('中等长度选项排成一行两项', () => {
    expect(resolveOptionColumns(opts('离子运动时间相等', '运动半径不等', '时间最长', '偏转角最大'), 'auto')).toBe(2)
  })
  it('长选项每行一项', () => {
    expect(
      resolveOptionColumns(opts('若该带电粒子从ab边射出，它经历的时间可能为t0', '短', '短', '短'), 'auto')
    ).toBe(1)
  })
  it('手动指定时以手动为准', () => {
    expect(resolveOptionColumns(opts('2', '3', '4', '5'), 1)).toBe(1)
  })
  it('四列时用制表符分隔并设置制表位', () => {
    const ir = buildDocument(projectWith(createQuestion({ options: opts('2', '3', '4', '5') })), 'student')
    const row = ir.paragraphs.find((p) => p.style === 'option')!
    expect(row.runs.filter((r) => r.kind === 'tab')).toHaveLength(3)
    expect(row.tabStopsTwip).toEqual([2310, 4200, 6090])
  })
})

describe('版式参数', () => {
  it('学生版题后留白加在最后一段，并按行高换算', () => {
    const q = createQuestion({ stem: [para('题')], layout: { studentSpaceLines: 5 } as Question['layout'] })
    const ir = buildDocument(projectWith(q), 'student')
    expect(ir.paragraphs.at(-1)?.extraSpaceAfterTwip).toBe(5 * 312)
    expect(buildDocument(projectWith(q), 'teacher').paragraphs.at(-1)?.extraSpaceAfterTwip).toBeUndefined()
  })

  it('防跨页：除最后一段外都与下段同页', () => {
    const ir = buildDocument(projectWith(fullQuestion()), 'teacher')
    expect(ir.paragraphs.map((p) => p.keepNext ?? false)).toEqual([true, true, true, true, true, true, false])
    expect(ir.paragraphs.every((p) => p.keepLines === true)).toBe(true)
  })

  it('右侧题图挂在题干段落上', async () => {
    const { project } = await createDemoBundle()
    const ir = buildDocument(project, 'student')
    const withFloat = ir.paragraphs.filter((p) => p.floatingImage !== undefined)
    expect(withFloat).toHaveLength(1)
    expect(withFloat[0]?.style).toBe('question')
  })
})


describe('预览分页', () => {
  const h = (height: number, extra: Partial<{ keepNext: boolean; pageBreakBefore: boolean }> = {}) => ({
    height,
    ...extra
  })

  it('按高度依次填满每页', () => {
    expect(paginate([h(40), h(40), h(40)], 100)).toEqual([[0, 1], [2]])
  })

  it('与下段同页的一组放不下时整组移到下一页', () => {
    expect(paginate([h(50), h(30, { keepNext: true }), h(30)], 100)).toEqual([[0], [1, 2]])
  })

  it('整组超过一页时逐段排', () => {
    expect(paginate([h(60, { keepNext: true }), h(60, { keepNext: true }), h(60)], 100)).toEqual([[0], [1], [2]])
  })

  it('段前分页', () => {
    expect(paginate([h(10), h(10, { pageBreakBefore: true })], 100)).toEqual([[0], [1]])
  })

  it('首页的段前分页不产生空白页', () => {
    expect(paginate([h(10, { pageBreakBefore: true })], 100)).toEqual([[0]])
  })

  it('空文档为一页空白页', () => {
    expect(paginate([], 100)).toEqual([[]])
  })
})
