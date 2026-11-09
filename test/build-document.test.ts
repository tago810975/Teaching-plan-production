import { describe, expect, it } from 'vitest'
import { buildDocument, resolveOptionColumns } from '@core/document/build'
import { paginate, type MeasuredParagraph, type PageSlice } from '@core/document/paginate'
import { createEmptyProject, createQuestion, DEFAULT_OPTION_STOPS, LEGACY_OPTION_STOPS, newId, para } from '@core/model/factory'
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
    p.header.right = '高二物理勤敏'
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

  it('难度标记写在题干开头：等级与对应的星级', () => {
    const ir = buildDocument(projectWith(createQuestion({ difficulty: 'B', stem: [para('题干')] })), 'student')
    expect(ir.paragraphs[0]?.runs[0]).toEqual({ kind: 'text', text: '【B】★★' })
  })
})

describe('选项分列', () => {
  const opts = (...texts: string[]): Question['options'] =>
    texts.map((t, i) => ({ label: 'ABCD'[i]!, content: para(t) }))

  it('短选项排成一行四项', () => {
    expect(resolveOptionColumns(opts('2', '3', '4', '5'), 'auto')).toBe(4)
  })
  it('中等长度选项排成一行两项', () => {
    expect(resolveOptionColumns(opts('离子运动时间都相等', '运动半径不等', '时间最长', '偏转角最大'), 'auto')).toBe(2)
  })

  it('列位置决定能否排成四项：默认列宽比模板原有的略宽', () => {
    const o = opts('离子运动时间相等', '运动半径不等', '时间最长', '偏转角最大')
    expect(resolveOptionColumns(o, 'auto', LEGACY_OPTION_STOPS)).toBe(2)
    expect(resolveOptionColumns(o, 'auto')).toBe(4)
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
    expect(row.tabStopsTwip).toEqual(DEFAULT_OPTION_STOPS.four)
  })

  it('选项列位置：工程设置，单道题可另行设置', () => {
    const custom = { two: [5000] as [number], four: [2500, 5000, 7500] as [number, number, number] }
    const p = projectWith(createQuestion({ options: opts('2', '3', '4', '5') }))
    p.layout.optionStops = custom
    const row = (proj: Project) => buildDocument(proj, 'student').paragraphs.find((x) => x.style === 'option')!
    expect(row(p).tabStopsTwip).toEqual([2500, 5000, 7500])
    const own = { two: [4000] as [number], four: [2000, 4000, 6000] as [number, number, number] }
    const b = p.blocks[0]!
    if (b.type === 'question') b.question.layout.optionStops = own
    expect(row(p).tabStopsTwip).toEqual([2000, 4000, 6000])
    const two = projectWith(createQuestion({ options: opts('2', '3', '4', '5'), layout: { optionColumns: 2, optionStops: own } }))
    expect(buildDocument(two, 'student').paragraphs.filter((x) => x.style === 'option').map((x) => x.tabStopsTwip)).toEqual([[4000], [4000]])
  })
})

describe('版式参数', () => {
  it('标题类段落与下段同页', () => {
    const p = createEmptyProject()
    p.blocks = [
      { id: 'a', type: 'title', text: '大标题' },
      { id: 'b', type: 'section', text: '课堂练习' },
      { id: 'c', type: 'topic', text: '放缩圆' }
    ]
    expect(buildDocument(p, 'student').paragraphs.every((x) => x.keepNext === true)).toBe(true)
  })

  it('学生版作答留白为题末的固定高度空段，并与题目同页', () => {
    const q = createQuestion({ stem: [para('题')], layout: { studentSpaceLines: 5, keepTogether: 'never' } })
    const ir = buildDocument(projectWith(q), 'student')
    expect(ir.paragraphs.map((p) => [p.style, p.spacerTwip, p.keepNext ?? false])).toEqual([
      ['question', undefined, true],
      ['body', 5 * 312, false]
    ])
    expect(buildDocument(projectWith(q), 'teacher').paragraphs).toHaveLength(1)
  })

  it('整题同页：除最后一段外都与下段同页', () => {
    const q = fullQuestion()
    q.layout.keepTogether = 'always'
    const ir = buildDocument(projectWith(q), 'teacher')
    expect(ir.paragraphs.map((p) => p.keepNext ?? false)).toEqual([true, true, true, true, true, true, false])
    expect(ir.paragraphs.every((p) => p.keepLines === true)).toBe(true)
  })

  it('允许跨页：只有题目主体连在一起，答案与详解可以跨页', () => {
    const q = fullQuestion()
    q.layout.keepTogether = 'never'
    const ir = buildDocument(projectWith(q), 'teacher')
    expect(ir.paragraphs.map((p) => [p.style, p.keepNext ?? false, p.keepLines ?? false])).toEqual([
      ['question', true, true],
      ['option', false, true],
      ['answer', false, false],
      ['knowledge', false, false],
      ['keyPoint', false, false],
      ['difficultPoint', false, false],
      ['analysis', false, false]
    ])
  })

  it('跟随工程设置：教案默认允许跨页，学案默认整题同页', () => {
    const p = projectWith(fullQuestion())
    expect(p.layout.keepQuestionTogether).toEqual({ teacher: false, student: true })
    expect(buildDocument(p, 'teacher').paragraphs[2]?.keepLines).toBeUndefined()
    p.layout.keepQuestionTogether.teacher = true
    expect(buildDocument(p, 'teacher').paragraphs[2]?.keepLines).toBe(true)
  })

  it('右侧题图挂在题干段落上', async () => {
    const { project } = await createDemoBundle()
    const ir = buildDocument(project, 'student')
    const withFloat = ir.paragraphs.filter((p) => (p.floatingImages ?? []).length > 0)
    expect(withFloat).toHaveLength(1)
    expect(withFloat[0]?.style).toBe('question')
  })
})


describe('预览分页', () => {
  const h = (height: number, extra: Partial<MeasuredParagraph> = {}): MeasuredParagraph => ({ height, ...extra })
  /** 只看每页有哪些段落 */
  const idx = (pages: PageSlice[][]): number[][] => pages.map((p) => p.map((s) => s.index))

  it('按高度依次填满每页', () => {
    expect(idx(paginate([h(40), h(40), h(40)], 100))).toEqual([[0, 1], [2]])
  })

  it('与下段同页的一组放不下时整组移到下一页', () => {
    expect(idx(paginate([h(50), h(30, { keepNext: true }), h(30, { keepLines: true })], 100))).toEqual([[0], [1, 2]])
  })

  it('整组超过一页时逐段排', () => {
    expect(idx(paginate([h(60, { keepNext: true }), h(60, { keepNext: true }), h(60)], 100))).toEqual([[0], [1], [2]])
  })

  it('页底段落的段后间距可以超出页面', () => {
    expect(idx(paginate([h(50), { height: 60, spaceAfter: 15 }], 100))).toEqual([[0, 1]])
    expect(idx(paginate([h(50), { height: 60, spaceAfter: 5 }], 100))).toEqual([[0], [1]])
  })

  it('段前分页；首页的段前分页不产生空白页', () => {
    expect(idx(paginate([h(10), h(10, { pageBreakBefore: true })], 100))).toEqual([[0], [1]])
    expect(idx(paginate([h(10, { pageBreakBefore: true })], 100))).toEqual([[0]])
  })

  it('空文档为一页空白页', () => {
    expect(paginate([], 100)).toEqual([[]])
  })

  // 一个 6 行的段落，每行 20：分界线在 20、40、60、80、100
  const sixLines = (extra: Partial<MeasuredParagraph> = {}): MeasuredParagraph =>
    h(120, { lineBreaks: [20, 40, 60, 80, 100], ...extra })

  it('允许拆分的段落按行拆到下一页', () => {
    expect(paginate([h(50), sixLines()], 100)).toEqual([
      [{ index: 0, from: 0 }, { index: 1, from: 0, to: 40 }],
      [{ index: 1, from: 40 }]
    ])
  })

  it('孤行控制：两边各至少 2 行', () => {
    // 当前页只放得下 1 行时不拆，整段移到下一页
    expect(paginate([h(95), sixLines({ minLines: 2 })], 130)).toEqual([[{ index: 0, from: 0 }], [{ index: 1, from: 0 }]])
    // 关闭孤行控制则可以只留 1 行在当前页
    expect(paginate([h(95), sixLines()], 130)).toEqual([
      [{ index: 0, from: 0 }, { index: 1, from: 0, to: 20 }],
      [{ index: 1, from: 20 }]
    ])
  })

  it('段中不分页的段落不拆', () => {
    expect(idx(paginate([h(50), sixLines({ keepLines: true })], 100))).toEqual([[0], [1]])
  })

  it('超过一页的长段落连续拆到多页', () => {
    const long = h(250, { lineBreaks: Array.from({ length: 24 }, (_, i) => (i + 1) * 10) })
    const pages = paginate([long], 100)
    expect(pages.map((p) => p[0])).toEqual([
      { index: 0, from: 0, to: 100 },
      { index: 0, from: 100, to: 200 },
      { index: 0, from: 200 }
    ])
  })

  it('与下段同页：前一段放得下且下一段开头几行放得下时，在下一段中间拆开', () => {
    expect(paginate([h(30), h(20, { keepNext: true }), sixLines()], 100)).toEqual([
      [{ index: 0, from: 0 }, { index: 1, from: 0 }, { index: 2, from: 0, to: 40 }],
      [{ index: 2, from: 40 }]
    ])
  })
})

describe('公式位置', () => {
  it('预览中的公式记录了它在工程数据中的位置，可按位置找回原公式', async () => {
    const { project } = await createDemoBundle()
    const ir = buildDocument(project, 'teacher')
    const refs = ir.paragraphs.flatMap((p) => p.runs.flatMap((r) => (r.kind === 'math' && r.ref !== undefined ? [r] : [])))
    expect(refs.length).toBeGreaterThan(10)
    for (const run of refs) {
      const block = project.blocks.find((b) => b.id === run.ref!.blockId)!
      let target: unknown = block
      for (const key of run.ref!.path) target = (target as Record<string | number, unknown>)[key]
      expect(target).toMatchObject({ type: 'math', latex: run.latex })
    }
  })
})
