import { describe, expect, it } from 'vitest'
import { createComposite, createEmptyBundle, createKnowledge, createQuestion, para, plainText } from '@core/model/factory'
import type { Block, QuestionBlock } from '@core/model/types'
import { listOutlineQuestionIds, pruneQuestionSelection, selectQuestionRange, toggleQuestionSelection } from '../../src/renderer/src/panels/outline-selection'
import { findBlock, initEditorState, reduceAt, type EditorState } from '../../src/renderer/src/state/store'

function qBlock(id: string, stem: string): QuestionBlock {
  return { id, type: 'question', question: createQuestion({ stem: [para(stem)] }) }
}

function makeState(): EditorState {
  const bundle = createEmptyBundle()
  bundle.project.blocks = [
    { id: 'sec1', type: 'section', text: '课堂练习' },
    qBlock('q1', '第一题'),
    createKnowledge({ id: 'k1', title: '知识点1' }),
    createComposite({ id: 'c1', title: '综合甲', items: [qBlock('c1q1', '小题一'), qBlock('c1q2', '小题二')] }),
    createComposite({ id: 'c2', title: '综合乙', items: [] }),
    qBlock('q2', '第四题')
  ]
  return reduceAt(initEditorState(bundle), { type: 'load', bundle, filePath: '/a.tplan' }, 0)
}

describe('大纲多选辅助函数', () => {
  it('按大纲显示顺序列出顶层题目与综合题小题，忽略非题目块', () => {
    const s = makeState()
    expect(listOutlineQuestionIds(s.bundle.project.blocks)).toEqual(['q1', 'c1q1', 'c1q2', 'q2'])
  })

  it('Shift 连选支持正向、反向、跨综合题与无锚点回退', () => {
    const all = ['q1', 'c1q1', 'c1q2', 'q2']
    expect(selectQuestionRange(all, 'q1', 'c1q2')).toEqual(['q1', 'c1q1', 'c1q2'])
    expect(selectQuestionRange(all, 'q2', 'c1q1')).toEqual(['c1q1', 'c1q2', 'q2'])
    expect(selectQuestionRange(all, null, 'c1q2')).toEqual(['c1q2'])
    expect(selectQuestionRange(all, 'missing', 'q2')).toEqual(['q2'])
    expect(selectQuestionRange(all, 'q1', 'missing')).toEqual([])
  })

  it('Ctrl/Cmd 切换选中支持从当前单选扩展、取消并保持大纲顺序', () => {
    const all = ['q1', 'c1q1', 'c1q2', 'q2']
    const s1 = toggleQuestionSelection([], 'q1', all, 'q2')
    expect(s1).toEqual(['q1', 'q2'])
    const s2 = toggleQuestionSelection(s1, 'q2', all, 'c1q1')
    expect(s2).toEqual(['q1', 'c1q1', 'q2'])
    const s3 = toggleQuestionSelection(s2, 'c1q1', all, 'q1')
    expect(s3).toEqual(['c1q1', 'q2'])
    expect(toggleQuestionSelection([], 'q1', all, 'q1')).toEqual([])
  })

  it('pruneQuestionSelection 过滤失效 ID 并按新顺序重排', () => {
    const all = ['q2', 'c1q1', 'q1']
    expect(pruneQuestionSelection(['q1', 'deleted', 'q2'], all)).toEqual(['q2', 'q1'])
    expect(pruneQuestionSelection(['deleted'], all)).toEqual([])
  })
})

describe('批量操作与一步撤销', () => {
  it('update-blocks 批量更新顶层与嵌套题目，递增 revision，并支持一步撤销', () => {
    let s = makeState()
    const rev = s.revision
    s = reduceAt(
      s,
      {
        type: 'update-blocks',
        blockIds: ['q1', 'c1q2'],
        update: (b: Block) => (b.type === 'question' ? { ...b, question: { ...b.question, difficulty: 'C', layout: { ...b.question.layout, teacherSpaceLines: 3 } } } : b)
      },
      1000
    )
    expect(s.revision).toBe(rev + 1)
    expect(s.history.past).toHaveLength(1)
    const b1 = findBlock(s.bundle.project.blocks, 'q1') as QuestionBlock
    const b2 = findBlock(s.bundle.project.blocks, 'c1q2') as QuestionBlock
    const bOther = findBlock(s.bundle.project.blocks, 'c1q1') as QuestionBlock
    expect(b1.question.difficulty).toBe('C')
    expect(b1.question.layout.teacherSpaceLines).toBe(3)
    expect(b2.question.difficulty).toBe('C')
    expect(bOther.question.difficulty).toBeUndefined()

    // 撤销后一步恢复全部
    s = reduceAt(s, { type: 'undo' }, 2000)
    expect((findBlock(s.bundle.project.blocks, 'q1') as QuestionBlock).question.difficulty).toBeUndefined()
    expect((findBlock(s.bundle.project.blocks, 'c1q2') as QuestionBlock).question.difficulty).toBeUndefined()
    expect(s.history.future).toHaveLength(1)

    // 没有实际修改时不产生历史记录
    const noop = reduceAt(s, { type: 'update-blocks', blockIds: ['q1'], update: (b) => b }, 3000)
    expect(noop).toBe(s)
  })

  it('delete-blocks 批量删除顶层与嵌套题目并清理选中项，可一步撤销', () => {
    let s = reduceAt(makeState(), { type: 'select', blockId: 'c1q1' }, 500)
    s = reduceAt(s, { type: 'delete-blocks', blockIds: ['c1q1', 'q2'] }, 1000)
    expect(s.selectedBlockId).toBeNull()
    expect(listOutlineQuestionIds(s.bundle.project.blocks)).toEqual(['q1', 'c1q2'])
    expect(s.history.past).toHaveLength(1)

    s = reduceAt(s, { type: 'undo' }, 2000)
    expect(s.selectedBlockId).toBe('c1q1')
    expect(listOutlineQuestionIds(s.bundle.project.blocks)).toEqual(['q1', 'c1q1', 'c1q2', 'q2'])
  })

  it('move-questions-to 批量移入与移出综合题保持相对顺序，可一步撤销', () => {
    let s = makeState()
    // 把 q1 与 q2（文档倒序传入）移入综合乙 c2，应保持 q1 在前、q2 在后
    s = reduceAt(s, { type: 'move-questions-to', blockIds: ['q2', 'q1'], compositeId: 'c2' }, 1000)
    const c2 = s.bundle.project.blocks.find((b) => b.id === 'c2')
    expect(c2?.type === 'composite' && c2.items.map((it) => it.id)).toEqual(['q1', 'q2'])
    expect(s.history.past).toHaveLength(1)

    // 再把综合甲两道小题全部移出综合题，应放到 c1 后且保持 c1q1 在 c1q2 前
    s = reduceAt(s, { type: 'move-questions-to', blockIds: ['c1q2', 'c1q1'], compositeId: null }, 2000)
    const c1Idx = s.bundle.project.blocks.findIndex((b) => b.id === 'c1')
    expect(s.bundle.project.blocks[c1Idx + 1]?.id).toBe('c1q1')
    expect(s.bundle.project.blocks[c1Idx + 2]?.id).toBe('c1q2')
    expect(s.history.past).toHaveLength(2)

    s = reduceAt(s, { type: 'undo' }, 3000)
    const c1AfterUndo = s.bundle.project.blocks.find((b) => b.id === 'c1')
    expect(c1AfterUndo?.type === 'composite' && c1AfterUndo.items.map((it) => it.id)).toEqual(['c1q1', 'c1q2'])
  })

  it('split-composite 拆成单题前先分发共用答案解析、保留背景与教师属性，支持一步撤销', () => {
    const bundle = createEmptyBundle()
    const sub1 = qBlock('sq1', '小题1')
    const sub2 = qBlock('sq2', '小题2')
    bundle.project.blocks = [
      createComposite({
        id: 'comp-s',
        title: '材料背景',
        background: [para('这里是背景材料')],
        items: [sub1, sub2],
        important: true,
        knowledgePoints: ['电场力'],
        keyPoint: '受力分析',
        difficultPoint: '临界条件',
        review: [para('先画受力图')],
        answer: [para('1．A　　2．B')],
        analysis: [para('【解析】1．解析一'), para('2．解析二')]
      })
    ]
    let s = reduceAt(initEditorState(bundle), { type: 'load', bundle, filePath: '/s.tplan' }, 0)
    s = reduceAt(s, { type: 'split-composite', blockId: 'comp-s' }, 1000)

    const blocks = s.bundle.project.blocks
    expect(blocks.map((b) => b.type)).toEqual(['knowledge', 'question', 'question'])
    expect(blocks[0]?.type === 'knowledge' && blocks[0].title).toBe('材料背景')
    expect(blocks[0]?.type === 'knowledge' && plainText(blocks[0].content)).toBe('这里是背景材料')
    const out1 = blocks[1] as QuestionBlock
    const out2 = blocks[2] as QuestionBlock
    expect(out1.id).toBe('sq1')
    expect(plainText(out1.question.answer)).toBe('A')
    expect(plainText(out1.question.analysis)).toBe('【解析】解析一')
    expect(out1.question.important).toBe(true)
    expect(out1.question.knowledgePoints).toEqual(['电场力'])
    expect(out1.question.keyPoint).toBe('受力分析')
    expect(out1.question.difficultPoint).toBe('临界条件')
    expect(plainText(out1.question.review ?? [])).toBe('先画受力图')
    expect(out2.id).toBe('sq2')
    expect(plainText(out2.question.answer)).toBe('B')
    expect(plainText(out2.question.analysis)).toBe('【解析】解析二')
    expect(s.selectedBlockId).toBe('sq1')

    // 一步撤销回原综合题
    s = reduceAt(s, { type: 'undo' }, 2000)
    expect(s.bundle.project.blocks).toHaveLength(1)
    expect(s.bundle.project.blocks[0]?.id).toBe('comp-s')
  })

  it('split-composite 无背景无配图时不生成空白知识点块', () => {
    const bundle = createEmptyBundle()
    bundle.project.blocks = [
      createComposite({
        id: 'comp-empty-bg',
        title: '材料一',
        items: [qBlock('a1', '题甲'), qBlock('a2', '题乙')]
      })
    ]
    const loaded = reduceAt(initEditorState(bundle), { type: 'load', bundle, filePath: '/s2.tplan' }, 0)
    const after = reduceAt(loaded, { type: 'split-composite', blockId: 'comp-empty-bg' }, 1000)
    expect(after.bundle.project.blocks.map((b) => [b.type, b.id])).toEqual([
      ['question', 'a1'],
      ['question', 'a2']
    ])
  })

  it('merge-to-composite 按大纲顺序合并多道题目成综合题并放到第一道选题位置，可一步撤销', () => {
    let s = makeState()
    // 按倒序传入 q2 与 q1，应按视觉顺序 q1 在前、q2 在后，且新综合题取代 q1 的位置
    s = reduceAt(s, { type: 'merge-to-composite', blockIds: ['q2', 'q1'] }, 1000)
    const ids = s.bundle.project.blocks.map((b) => b.type)
    expect(ids).toEqual(['section', 'composite', 'knowledge', 'composite', 'composite'])
    const merged = s.bundle.project.blocks[1]
    expect(merged?.type === 'composite' && merged.items.map((it) => it.id)).toEqual(['q1', 'q2'])
    expect(s.selectedBlockId).toBe(merged?.id)

    s = reduceAt(s, { type: 'undo' }, 2000)
    expect(listOutlineQuestionIds(s.bundle.project.blocks)).toEqual(['q1', 'c1q1', 'c1q2', 'q2'])
  })
})
