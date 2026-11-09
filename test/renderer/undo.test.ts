import { describe, expect, it } from 'vitest'
import { createEmptyBundle, createQuestion, newId, para } from '@core/model/factory'
import type { Block, QuestionBlock } from '@core/model/types'
import { HISTORY_LIMIT, initEditorState, MERGE_MS, reduceAt, type EditorAction, type EditorState } from '../../src/renderer/src/state/store'

function start(): EditorState {
  const bundle = createEmptyBundle()
  const q: QuestionBlock = { id: 'q1', type: 'question', question: createQuestion({ stem: [para('原题干')] }) }
  bundle.project.blocks = [q, { id: 's1', type: 'section', text: '课堂练习' }]
  return reduceAt(initEditorState(bundle), { type: 'load', bundle, filePath: '/a.tplan' }, 0)
}

/** 依次执行动作；t 为每个动作的时间 */
function run(state: EditorState, steps: Array<[EditorAction, number]>): EditorState {
  return steps.reduce((s, [a, t]) => reduceAt(s, a, t), state)
}

const typeStem = (text: string): EditorAction => ({
  type: 'update-block',
  blockId: 'q1',
  update: (b: Block) => (b.type === 'question' ? { ...b, question: { ...b.question, stem: [para(text)] } } : b)
})
const stemOf = (s: EditorState): string => {
  const b = s.bundle.project.blocks.find((x) => x.id === 'q1')
  return b?.type === 'question' ? (b.question.stem[0]!.inlines[0] as { text: string }).text : ''
}

describe('撤销 / 重做', () => {
  it('撤销、重做一步修改；打开后没有可撤销的内容', () => {
    let s = start()
    expect(s.history.past).toHaveLength(0)
    s = run(s, [[{ type: 'set-title', title: '新名称' }, 1000]])
    expect(s.bundle.project.meta.title).toBe('新名称')
    s = reduceAt(s, { type: 'undo' }, 2000)
    expect(s.bundle.project.meta.title).not.toBe('新名称')
    expect(s.history.future).toHaveLength(1)
    s = reduceAt(s, { type: 'redo' }, 3000)
    expect(s.bundle.project.meta.title).toBe('新名称')
  })

  it('在同一处连续输入合并为一步；停顿超过 1 秒后另算一步', () => {
    let s = start()
    s = run(s, [
      [typeStem('原题干甲'), 1000],
      [typeStem('原题干甲乙'), 1300],
      [typeStem('原题干甲乙丙'), 1600],
      [typeStem('原题干甲乙丙丁'), 1600 + MERGE_MS + 1]
    ])
    expect(s.history.past).toHaveLength(2)
    s = reduceAt(s, { type: 'undo' }, 9000)
    expect(stemOf(s)).toBe('原题干甲乙丙')
    s = reduceAt(s, { type: 'undo' }, 9100)
    expect(stemOf(s)).toBe('原题干')
  })

  it('不同的操作各算一步，即使挨得很近', () => {
    let s = start()
    s = run(s, [
      [typeStem('改了'), 1000],
      [{ type: 'move-block', blockId: 's1', delta: -1 }, 1100],
      [{ type: 'delete-block', blockId: 'q1' }, 1200]
    ])
    expect(s.history.past).toHaveLength(3)
    s = run(s, [[{ type: 'undo' }, 2000]])
    expect(s.bundle.project.blocks.map((b) => b.id)).toEqual(['s1', 'q1'])
    s = run(s, [[{ type: 'undo' }, 2100]])
    expect(s.bundle.project.blocks.map((b) => b.id)).toEqual(['q1', 's1'])
  })

  it('只改界面（选中、切换版本）不记入历史', () => {
    let s = start()
    s = run(s, [
      [{ type: 'select', blockId: 'q1' }, 1000],
      [{ type: 'set-variant', variant: 'student' }, 1100],
      [{ type: 'refresh-inspector' }, 1200]
    ])
    expect(s.history.past).toHaveLength(0)
  })

  it('撤销后做新的修改，重做记录清空', () => {
    let s = start()
    s = run(s, [
      [{ type: 'set-title', title: 'A' }, 1000],
      [{ type: 'undo' }, 2000],
      [{ type: 'set-title', title: 'B' }, 3000]
    ])
    expect(s.history.future).toHaveLength(0)
    expect(reduceAt(s, { type: 'redo' }, 4000)).toBe(s)
  })

  it('撤销到保存时的状态，标记为已保存；再重做又是未保存', () => {
    let s = start()
    expect(s.dirty).toBe(false)
    s = run(s, [[{ type: 'set-title', title: 'A' }, 1000]])
    expect(s.dirty).toBe(true)
    s = run(s, [[{ type: 'undo' }, 2000]])
    expect(s.dirty).toBe(false)
    s = run(s, [[{ type: 'redo' }, 3000]])
    expect(s.dirty).toBe(true)
    // 保存后，再撤销是未保存
    s = run(s, [[{ type: 'saved', filePath: '/a.tplan' }, 4000]])
    expect(s.dirty).toBe(false)
    s = run(s, [[{ type: 'undo' }, 5000]])
    expect(s.dirty).toBe(true)
  })

  it('撤销时选中改动所在的内容，属性面板重新读取；仍是同一内容时光标放回原处', () => {
    let s = start()
    s = run(s, [
      [{ type: 'select', blockId: 'q1' }, 500],
      [typeStem('改了'), 1000],
      [{ type: 'select', blockId: 's1' }, 1500]
    ])
    const rev = s.revision
    let u = reduceAt(s, { type: 'undo', focus: { field: 'stem', caret: 2 } }, 2000)
    expect(u.selectedBlockId).toBe('q1')
    expect(u.revision).toBe(rev + 1)
    // 撤销前选中的是别的内容：不移动光标
    expect(u.focusRequest).toBe(s.focusRequest)
    s = run(s, [[{ type: 'select', blockId: 'q1' }, 1600]])
    u = reduceAt(s, { type: 'undo', focus: { field: 'stem', caret: 2 } }, 2000)
    expect(u.focusRequest).toMatchObject({ blockId: 'q1', field: 'stem', caret: 2, quiet: true })
  })

  it('打开别的教学案、关闭后历史清空；最多保留 HISTORY_LIMIT 步', () => {
    let s = start()
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = reduceAt(s, { type: 'set-title', title: String(i) }, i * 10_000)
    expect(s.history.past).toHaveLength(HISTORY_LIMIT)
    s = reduceAt(s, { type: 'close' }, 1e9)
    expect(s.history.past).toHaveLength(0)
  })

  it('没有可撤销的内容时撤销不改变状态', () => {
    const s = start()
    expect(reduceAt(s, { type: 'undo' }, 1000)).toBe(s)
  })

  it('添加图片资源也能撤销', () => {
    let s = start()
    const asset = { id: newId(), mime: 'image/png', data: new Uint8Array([1]) }
    s = run(s, [[{ type: 'add-asset', asset }, 1000]])
    expect(Object.keys(s.bundle.assets)).toContain(asset.id)
    s = run(s, [[{ type: 'undo' }, 2000]])
    expect(Object.keys(s.bundle.assets)).not.toContain(asset.id)
  })
})
