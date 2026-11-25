import { describe, expect, it } from 'vitest'
import { cloneBlocksWithNewIds, collectBlocksByIds, extractBlockAssets } from '@core/model/block-clipboard'
import { createComposite, createEmptyBundle, createKnowledge, createQuestion, para } from '@core/model/factory'
import type { Asset, Block, QuestionBlock } from '@core/model/types'
import { clearBlockClipboard, getBlockClipboard, setBlockClipboard, takeBlocksForPaste } from '../../src/renderer/src/state/blockClipboard'
import { initEditorState, reduceAt } from '../../src/renderer/src/state/store'

function fakeAsset(id: string): Asset {
  return { id, mime: 'image/png', data: new Uint8Array([1, 2, 3]) }
}

function makeRichSample() {
  const q1: QuestionBlock = {
    id: 'q1',
    type: 'question',
    question: createQuestion({
      id: 'q-inner-1',
      stem: [
        {
          inlines: [
            { type: 'text', text: '题干' },
            { type: 'image', assetId: 'img-stem', widthEmu: 100, heightEmu: 100 },
            {
              type: 'table',
              rows: [{ cells: [{ content: [{ inlines: [{ type: 'image', assetId: 'img-table', widthEmu: 100, heightEmu: 100 }] }] }] }]
            }
          ]
        }
      ],
      figures: [{ assetId: 'img-fig', widthEmu: 200, heightEmu: 200, placement: 'below' }],
      options: [{ label: 'A', content: { inlines: [{ type: 'image', assetId: 'img-opt', widthEmu: 80, heightEmu: 80 }] } }],
      subQuestions: [{ id: 'sq1', content: [para('第一问')] }],
      answerFigures: [{ assetId: 'img-ans', widthEmu: 150, heightEmu: 150, placement: 'below' }],
      analysisFigures: [{ assetId: 'img-ana', widthEmu: 150, heightEmu: 150, placement: 'below' }]
    })
  }
  const comp = createComposite({
    id: 'c1',
    title: '材料一',
    background: [para('背景')],
    figures: [{ assetId: 'img-comp-bg', widthEmu: 300, heightEmu: 200, placement: 'below' }],
    items: [
      {
        id: 'cq1',
        type: 'question',
        question: createQuestion({ id: 'cq-inner-1', stem: [para('小题一')], subQuestions: [{ id: 'csq1', content: [para('子问')] }] })
      }
    ],
    answerFigures: [{ assetId: 'img-comp-ans', widthEmu: 120, heightEmu: 120, placement: 'below' }]
  })
  const allAssets: Record<string, Asset> = {
    'img-stem': fakeAsset('img-stem'),
    'img-table': fakeAsset('img-table'),
    'img-fig': fakeAsset('img-fig'),
    'img-opt': fakeAsset('img-opt'),
    'img-ans': fakeAsset('img-ans'),
    'img-ana': fakeAsset('img-ana'),
    'img-comp-bg': fakeAsset('img-comp-bg'),
    'img-comp-ans': fakeAsset('img-comp-ans'),
    'img-unused': fakeAsset('img-unused')
  }
  return { q1, comp, allAssets }
}

describe('block-clipboard 核心函数', () => {
  it('extractBlockAssets 完整提取题目与综合题引用的图片并忽略未引用图片', () => {
    const { q1, comp, allAssets } = makeRichSample()
    const extracted = extractBlockAssets([q1, comp], allAssets)
    expect(Object.keys(extracted).sort()).toEqual([
      'img-ana',
      'img-ans',
      'img-comp-ans',
      'img-comp-bg',
      'img-fig',
      'img-opt',
      'img-stem',
      'img-table'
    ])
  })

  it('cloneBlocksWithNewIds 为所有块、题目与小问分配全新 ID 且多次克隆互不重复', () => {
    const { q1, comp } = makeRichSample()
    const clonedA = cloneBlocksWithNewIds([q1, comp])
    const clonedB = cloneBlocksWithNewIds([q1, comp])
    const q1A = clonedA[0]! as QuestionBlock
    const q1B = clonedB[0]! as QuestionBlock
    const compA = clonedA[1]!
    const cq1A = compA.type === 'composite' ? compA.items[0] : undefined
    const cq1B = clonedB[1]?.type === 'composite' ? clonedB[1].items[0] : undefined

    expect(q1A.id).not.toBe(q1.id)
    expect(q1A.id).not.toBe(q1B.id)
    expect(q1A.question.id).not.toBe(q1.question.id)
    expect(q1A.question.subQuestions[0]?.id).not.toBe('sq1')
    expect(compA.id).not.toBe(comp.id)
    expect(cq1A?.id).not.toBe('cq1')
    expect(cq1A?.id).not.toBe(cq1B?.id)
    expect(cq1A?.question.id).not.toBe('cq-inner-1')
    expect(cq1A?.question.subQuestions[0]!.id).not.toBe('csq1')
  })

  it('collectBlocksByIds 按大纲显示顺序收集顶层块与综合题小题', () => {
    const { q1, comp } = makeRichSample()
    const k1 = createKnowledge({ id: 'k1', title: '知识' })
    const picked = collectBlocksByIds([q1, comp, k1], ['k1', 'cq1', 'q1'])
    expect(picked.map((b) => b.id)).toEqual(['q1', 'cq1', 'k1'])
  })
})

describe('跨学案剪贴板与下方粘贴', () => {
  it('可在学案 A 复制带图题目，粘贴到学案 B 所选题目/知识点下方，并支持一步撤销', () => {
    clearBlockClipboard()
    const { q1, allAssets } = makeRichSample()

    const bundleA = createEmptyBundle()
    bundleA.project.blocks = [q1]
    bundleA.assets = allAssets

    setBlockClipboard([q1], bundleA.assets, 'copy')
    expect(getBlockClipboard()?.mode).toBe('copy')

    const bundleB = createEmptyBundle()
    const targetKnowledge = createKnowledge({ id: 'bk1', title: '目标知识点' })
    const tailQuestion: QuestionBlock = { id: 'bq2', type: 'question', question: createQuestion({ stem: [para('尾部题目')] }) }
    bundleB.project.blocks = [targetKnowledge, tailQuestion]
    let stateB = reduceAt(initEditorState(bundleB), { type: 'load', bundle: bundleB, filePath: '/b.tplan' }, 0)

    const pastePayload = takeBlocksForPaste()
    expect(pastePayload).not.toBeNull()
    stateB = reduceAt(stateB, { type: 'insert-blocks', blocks: pastePayload!.blocks, assets: pastePayload!.assets, afterBlockId: 'bk1' }, 1000)

    expect(stateB.bundle.project.blocks.map((b) => b.type)).toEqual(['knowledge', 'question', 'question'])
    expect(stateB.bundle.project.blocks[0]!.id).toBe('bk1')
    expect(stateB.bundle.project.blocks[1]!.id).toBe(pastePayload!.blocks[0]!.id)
    expect(stateB.bundle.assets['img-fig']).toBeDefined()
    expect(stateB.bundle.assets['img-opt']).toBeDefined()
    expect(stateB.bundle.assets['img-ans']).toBeDefined()
    expect(stateB.bundle.assets['img-ana']).toBeDefined()

    // 多次粘贴生成不同 ID
    const secondPaste = takeBlocksForPaste()!
    expect(secondPaste.blocks[0]!.id).not.toBe(pastePayload!.blocks[0]!.id)

    // 撤销粘贴后移除刚粘贴的题目
    stateB = reduceAt(stateB, { type: 'undo' }, 2000)
    expect(stateB.bundle.project.blocks.map((b) => b.id)).toEqual(['bk1', 'bq2'])
  })

  it('选中综合题内小题时，粘贴题目会插入该小题正下方；粘贴知识点则插到综合题下方', () => {
    clearBlockClipboard()
    const sub1: QuestionBlock = { id: 'sub1', type: 'question', question: createQuestion({ stem: [para('小题1')] }) }
    const sub2: QuestionBlock = { id: 'sub2', type: 'question', question: createQuestion({ stem: [para('小题2')] }) }
    const comp = createComposite({ id: 'c-host', items: [sub1, sub2] })
    const tail = createKnowledge({ id: 'k-tail', title: '后续' })

    const bundle = createEmptyBundle()
    bundle.project.blocks = [comp, tail]
    let state = reduceAt(initEditorState(bundle), { type: 'load', bundle, filePath: '/c.tplan' }, 0)

    const pastedQ: QuestionBlock = { id: 'new-q', type: 'question', question: createQuestion({ stem: [para('粘贴的题')] }) }
    state = reduceAt(state, { type: 'insert-blocks', blocks: [pastedQ], afterBlockId: 'sub1' }, 1000)
    const cAfterQ = state.bundle.project.blocks[0]
    expect(cAfterQ?.type === 'composite' && cAfterQ.items.map((it) => it.id)).toEqual(['sub1', 'new-q', 'sub2'])

    const pastedK = createKnowledge({ id: 'new-k', title: '粘贴的知识点' })
    state = reduceAt(state, { type: 'insert-blocks', blocks: [pastedK], afterBlockId: 'sub1' }, 2000)
    expect(state.bundle.project.blocks.map((b) => b.id)).toEqual(['c-host', 'new-k', 'k-tail'])
  })

  it('同文档带 removeBlockIds 的剪切粘贴在单步内移除原题并支持一步撤销', () => {
    clearBlockClipboard()
    const qa: QuestionBlock = { id: 'qa', type: 'question', question: createQuestion({ stem: [para('甲')] }) }
    const qb: QuestionBlock = { id: 'qb', type: 'question', question: createQuestion({ stem: [para('乙')] }) }
    const qc: QuestionBlock = { id: 'qc', type: 'question', question: createQuestion({ stem: [para('丙')] }) }
    const bundle = createEmptyBundle()
    bundle.project.blocks = [qa, qb, qc]
    let state = reduceAt(initEditorState(bundle), { type: 'load', bundle, filePath: '/same.tplan' }, 0)

    setBlockClipboard([qa], bundle.assets, 'cut', {
      editorKey: 'tab-1',
      blockIds: ['qa'],
      commit: () => {}
    })
    expect(getBlockClipboard()?.cutSource?.blockIds).toEqual(['qa'])

    const payload = takeBlocksForPaste()!
    state = reduceAt(
      state,
      { type: 'insert-blocks', blocks: payload.blocks, assets: payload.assets, afterBlockId: 'qc', removeBlockIds: ['qa'] },
      1000
    )
    expect(state.bundle.project.blocks.map((b) => b.id)).toEqual(['qb', 'qc', payload.blocks[0]!.id])
    expect(state.history.past).toHaveLength(1)

    // 一步撤销回到 [qa, qb, qc]
    state = reduceAt(state, { type: 'undo' }, 2000)
    expect(state.bundle.project.blocks.map((b) => b.id)).toEqual(['qa', 'qb', 'qc'])
  })

  it('跨文档剪切时源文档先保留待剪切项，粘贴时触发 commit 移除源文档题目并清空剪贴板', () => {
    clearBlockClipboard()
    const { q1, allAssets } = makeRichSample()
    const bundleA = createEmptyBundle()
    bundleA.project.blocks = [q1]
    bundleA.assets = allAssets
    let stateA = reduceAt(initEditorState(bundleA), { type: 'load', bundle: bundleA, filePath: '/a.tplan' }, 0)

    setBlockClipboard([q1], bundleA.assets, 'cut', {
      editorKey: 'tab-a',
      blockIds: ['q1'],
      commit: () => {
        stateA = reduceAt(stateA, { type: 'delete-blocks', blockIds: ['q1'] }, 1000)
      }
    })
    // 剪切后、粘贴前：源文档仍保留 q1（仅虚化）
    expect(stateA.bundle.project.blocks.map((b) => b.id)).toEqual(['q1'])

    const bundleB = createEmptyBundle()
    let stateB = reduceAt(initEditorState(bundleB), { type: 'load', bundle: bundleB, filePath: '/b.tplan' }, 0)
    const cb = getBlockClipboard()!
    const payload = takeBlocksForPaste()!
    stateB = reduceAt(stateB, { type: 'insert-blocks', blocks: payload.blocks, assets: payload.assets, afterBlockId: null }, 2000)
    cb.cutSource!.commit()
    clearBlockClipboard()

    expect(stateB.bundle.project.blocks).toHaveLength(1)
    expect(stateB.bundle.assets['img-fig']).toBeDefined()
    expect(stateA.bundle.project.blocks).toHaveLength(0)
    expect(getBlockClipboard()).toBeNull()
  })

  it('标题、知识梳理栏目、带图知识点、正文段落与作业单均支持复制、剪切与跨学案粘贴', () => {
    clearBlockClipboard()
    const title: Block = { id: 't1', type: 'title', text: '第 1 讲 磁场' }
    const section: Block = { id: 'sec-know', type: 'section', text: '知识梳理' }
    const topic: Block = { id: 'top1', type: 'topic', text: '考点一、洛伦兹力' }
    const knowledge: Block = {
      ...createKnowledge({ id: 'k-fig', title: '左手定则', content: [para('四指指向正电荷运动方向')] }),
      figures: [{ assetId: 'img-know', widthEmu: 200, heightEmu: 150, placement: 'below' }]
    }
    const paragraph: Block = {
      id: 'p-tbl',
      type: 'paragraph',
      shaded: true,
      content: [
        {
          inlines: [
            {
              type: 'table',
              rows: [{ cells: [{ content: [{ inlines: [{ type: 'image', assetId: 'img-para-tbl', widthEmu: 90, heightEmu: 90 }] }] }] }]
            }
          ]
        }
      ]
    }
    const worksheet: Block = { id: 'ws1', type: 'worksheet', title: '课后作业', fields: ['姓名', '正确率'] }
    const allAssets: Record<string, Asset> = {
      'img-know': fakeAsset('img-know'),
      'img-para-tbl': fakeAsset('img-para-tbl')
    }

    const bundleA = createEmptyBundle()
    bundleA.project.blocks = [title, section, topic, knowledge, paragraph, worksheet]
    bundleA.assets = allAssets
    let stateA = reduceAt(initEditorState(bundleA), { type: 'load', bundle: bundleA, filePath: '/a.tplan' }, 0)

    // 多选“知识梳理栏目 + 知识点”复制并跨学案粘贴
    const pickedForCopy = collectBlocksByIds(stateA.bundle.project.blocks, ['sec-know', 'k-fig'])
    setBlockClipboard(pickedForCopy, stateA.bundle.assets, 'copy')
    const bundleB = createEmptyBundle()
    const existing: Block = { id: 'b-title', type: 'title', text: '新学案' }
    bundleB.project.blocks = [existing]
    let stateB = reduceAt(initEditorState(bundleB), { type: 'load', bundle: bundleB, filePath: '/b.tplan' }, 0)
    const copyPayload = takeBlocksForPaste()!
    stateB = reduceAt(stateB, { type: 'insert-blocks', blocks: copyPayload.blocks, assets: copyPayload.assets, afterBlockId: 'b-title' }, 1000)

    expect(stateB.bundle.project.blocks.map((b) => b.type)).toEqual(['title', 'section', 'knowledge'])
    expect(stateB.bundle.project.blocks[1]!.id).not.toBe('sec-know')
    expect(stateB.bundle.project.blocks[2]!.id).not.toBe('k-fig')
    expect(stateB.bundle.assets['img-know']).toBeDefined()
    expect(stateB.bundle.assets['img-para-tbl']).toBeUndefined()

    // 同文档内剪切标题/正文段落/作业单到末尾并支持一步撤销
    const pickedForCut = collectBlocksByIds(stateA.bundle.project.blocks, ['t1', 'p-tbl', 'ws1'])
    setBlockClipboard(pickedForCut, stateA.bundle.assets, 'cut', {
      editorKey: 'tab-a',
      blockIds: ['t1', 'p-tbl', 'ws1'],
      commit: () => {}
    })
    const cutPayload = takeBlocksForPaste()!
    stateA = reduceAt(
      stateA,
      {
        type: 'insert-blocks',
        blocks: cutPayload.blocks,
        assets: cutPayload.assets,
        afterBlockId: 'ws1',
        removeBlockIds: ['t1', 'p-tbl', 'ws1']
      },
      2000
    )
    expect(stateA.bundle.project.blocks.map((b) => b.type)).toEqual(['section', 'topic', 'knowledge', 'title', 'paragraph', 'worksheet'])

    stateA = reduceAt(stateA, { type: 'undo' }, 3000)
    expect(stateA.bundle.project.blocks.map((b) => b.id)).toEqual(['t1', 'sec-know', 'top1', 'k-fig', 'p-tbl', 'ws1'])
  })
})
