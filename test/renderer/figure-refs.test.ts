import { describe, expect, it } from 'vitest'
import { createEmptyBundle, createQuestion, newId } from '@core/model/factory'
import { figureFieldId, listFigures, replaceFigureAssets } from '@core/model/figure-refs'
import type { Block, QuestionFigure } from '@core/model/types'
import { initEditorState, reduceAt } from '../../src/renderer/src/state/store'

const fig = (assetId: string): QuestionFigure => ({ assetId, widthEmu: 1000, heightEmu: 500, placement: 'below' })

function sample(): Block[] {
  const q = createQuestion()
  q.figures = [fig('q-0')]
  q.answerFigures = [fig('qa-0')]
  q.analysisFigures = [fig('qn-0'), fig('qn-1')]
  const item = createQuestion()
  item.figures = [fig('i-0')]
  return [
    { id: 'k', type: 'knowledge', title: '加速电场', paragraphs: [], figures: [fig('k-0')] } as unknown as Block,
    { id: 'q', type: 'question', question: q } as Block,
    { id: 'c', type: 'composite', title: '综合题', background: [], figures: [fig('c-0')], items: [{ id: 'ci', type: 'question', question: item }] } as unknown as Block
  ]
}

describe('工程中的插图', () => {
  it('按文档顺序列出全部 6 个位置的插图', () => {
    const list = listFigures(sample())
    expect(list.map((e) => `${e.owner}/${e.list}/${e.figure.assetId}`)).toEqual([
      'knowledge/figures/k-0',
      'question/figures/q-0',
      'question/answer/qa-0',
      'question/analysis/qn-0',
      'question/analysis/qn-1',
      'composite/figures/c-0',
      'question/figures/i-0'
    ])
    expect(list[4]!.ref).toEqual({ blockId: 'q', figureIndex: 1, list: 'analysis' })
    expect(list[6]!.ref).toEqual({ blockId: 'ci', figureIndex: 0 })
    expect(figureFieldId('answer', 2)).toBe('figure:answer:2')
  })

  it('批量替换只影响指定的插图；给出宽高比时按宽度调整高度', () => {
    const blocks = replaceFigureAssets(sample(), [
      { ref: { blockId: 'q', figureIndex: 1, list: 'analysis' }, assetId: 'new-1' },
      { ref: { blockId: 'ci', figureIndex: 0 }, assetId: 'new-2', aspect: 4 },
      { ref: { blockId: 'k', figureIndex: 0 }, assetId: 'new-3' }
    ])
    expect(listFigures(blocks).map((e) => e.figure.assetId)).toEqual(['new-3', 'q-0', 'qa-0', 'qn-0', 'new-1', 'c-0', 'new-2'])
    expect(listFigures(blocks)[6]!.figure.heightEmu).toBe(250)
  })

  it('编辑器中批量替换：图片资源一并加入，一步撤销', () => {
    const bundle = createEmptyBundle()
    bundle.project.blocks = sample()
    let s = initEditorState(bundle)
    const asset = { id: 'new-1', mime: 'image/png', data: new Uint8Array([1]) }
    s = reduceAt(s, { type: 'replace-figure-assets', assets: [asset], changes: [{ ref: { blockId: 'k', figureIndex: 0 }, assetId: 'new-1' }, { ref: { blockId: 'q', figureIndex: 0 }, assetId: 'new-1' }] }, 1000)
    expect(listFigures(s.bundle.project.blocks).slice(0, 2).map((e) => e.figure.assetId)).toEqual(['new-1', 'new-1'])
    expect(s.bundle.assets['new-1']).toBe(asset)
    s = reduceAt(s, { type: 'undo' }, 5000)
    expect(listFigures(s.bundle.project.blocks).slice(0, 2).map((e) => e.figure.assetId)).toEqual(['k-0', 'q-0'])
    void newId
  })

  it('转移插图（move-figure）：切换到目标块与插图组并一步撤销', () => {
    const bundle = createEmptyBundle()
    bundle.project.blocks = sample()
    let s = initEditorState(bundle)
    s = { ...s, selectedBlockId: 'q' }

    // 把第 1 道题的题图 q-0 移到综合题小题 ci 的解析插图组
    s = reduceAt(s, { type: 'move-figure', from: { blockId: 'q', figureIndex: 0 }, to: { blockId: 'ci', list: 'analysis' } }, 1000)
    expect(s.selectedBlockId).toBe('ci')
    expect(s.focusRequest).toEqual({
      blockId: 'ci',
      field: 'figure:analysis:0',
      paragraph: 0,
      before: '',
      after: '',
      nonce: s.revision
    })
    const movedList = listFigures(s.bundle.project.blocks)
    expect(movedList.find((e) => e.figure.assetId === 'q-0')?.ref).toEqual({ blockId: 'ci', figureIndex: 0, list: 'analysis' })
    expect(movedList.filter((e) => e.ref.blockId === 'q' && e.list === 'figures')).toHaveLength(0)

    // 一步撤销：插图回到原题原组，selectedBlockId 恢复为 q
    s = reduceAt(s, { type: 'undo' }, 5000)
    expect(s.selectedBlockId).toBe('q')
    expect(listFigures(s.bundle.project.blocks).find((e) => e.figure.assetId === 'q-0')?.ref).toEqual({ blockId: 'q', figureIndex: 0 })
  })
})
