import { describe, expect, it } from 'vitest'
import { buildPointsDocument, POINTS_TITLE_SUFFIX } from '@core/document/points'
import { createComposite, createEmptyProject, createQuestion, para } from '@core/model/factory'
import type { Block, Question } from '@core/model/types'
import { pointsFileName } from '@shared/export-name'

const q = (id: string, extra: Partial<Question> = {}): Block => ({ id, type: 'question', question: { ...createQuestion({ stem: [para(id)] }), ...extra } })
const sec = (text: string): Block => ({ id: `s-${text}`, type: 'section', text })
const lines = (blocks: Block[], fields = { review: true, important: true }): string[] => {
  const p = createEmptyProject()
  p.meta.title = '带电粒子在磁场中的运动'
  p.layout = { ...p.layout, questionFields: fields }
  p.blocks = blocks
  return buildPointsDocument(p).paragraphs.map((x) => `${x.style}|${x.runs.map((r) => (r.kind === 'text' ? r.text : r.kind === 'math' ? '〔式〕' : '')).join('')}`)
}

describe('知识点重点难点汇总', () => {
  it('仿照样张：栏目、第 N 题、知识点；有重点题 / 难点题的栏目只列这两类并分组', () => {
    const out = lines([
      sec('例题精讲'),
      q('a', { knowledgePoints: ['半径、周期公式'] }),
      q('b', { knowledgePoints: ['圆周运动的相关计算', '洛伦兹力的方向'] }),
      sec('课堂练习'),
      q('c', { knowledgePoints: ['只有知识点'] }),
      q('d', { knowledgePoints: ['圆（弧）形边界'], important: true }),
      q('e', { knowledgePoints: ['电性不确定的多解'], keyPoint: '多解性' }),
      q('f', { knowledgePoints: ['圆形磁场内运动'], difficultPoint: '不沿半径射入，图形难画' }),
      sec('课后练习'),
      q('g', { knowledgePoints: ['直边界磁场'] })
    ])
    expect(out).toEqual([
      `title|带电粒子在磁场中的运动 ${POINTS_TITLE_SUFFIX}`,
      'section|例题精讲',
      'body|第1题',
      'body|【知识点】半径、周期公式',
      'body|第2题',
      'body|【知识点】圆周运动的相关计算、洛伦兹力的方向',
      'section|课堂练习',
      'topic|【重点题】',
      'body|第4题',
      'body|【知识点】圆（弧）形边界',
      'body|第5题',
      'body|【知识点】电性不确定的多解',
      'body|【重点】多解性',
      'topic|【难点题】',
      'body|第6题',
      'body|【知识点】圆形磁场内运动',
      'body|【难点】不沿半径射入，图形难画',
      'section|课后练习',
      'body|第7题',
      'body|【知识点】直边界磁场'
    ])
  })

  it('审题（打开题目可选项时）；综合题的小题用全卷题号；没有要点的题不列', () => {
    const comp: Block = { ...createComposite({ title: '材料', background: [], items: [], answer: [], analysis: [] }), id: 'c' }
    if (comp.type === 'composite') {
      comp.items = [
        { id: 'i1', type: 'question', question: { ...createQuestion({ stem: [para('小题1')] }), knowledgePoints: ['波长'] } },
        { id: 'i2', type: 'question', question: createQuestion({ stem: [para('小题2')] }) }
      ]
    }
    const out = lines([q('a', { review: [para('先看清磁场方向')] }), comp])
    expect(out.slice(1)).toEqual(['body|第1题', 'body|【审题】先看清磁场方向', 'body|第2题', 'body|【知识点】波长'])
  })

  it('题目可选项关闭时：不列审题，重点题标记不起作用', () => {
    const out = lines([q('a', { review: [para('审题内容')], important: true, knowledgePoints: ['k'] })], { review: false, important: false })
    expect(out.slice(1)).toEqual(['body|第1题', 'body|【知识点】k'])
  })

  it('都没有要点时给出说明；文件名与样张一致', () => {
    expect(lines([q('a')])[1]).toBe('body|还没有题目写了知识点、重点或难点。')
    expect(pointsFileName('10-2026秋季高二物理敏思：带电粒子在磁场中的运动')).toBe('(T)10-2026秋季高二物理敏思：带电粒子在磁场中的运动(知识点重点难点).docx')
  })
})
