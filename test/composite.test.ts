import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '@core/document/build'
import { writeDocx } from '@core/export/docx-writer'
import { importDocx } from '@core/import/import-docx'
import { createComposite, createEmptyProject, createQuestion, newId, para, plainText } from '@core/model/factory'
import type { Project } from '@core/model/types'
import { summarizeProject } from '@core/project-file/codec'

const q = (stem: string) => ({ id: newId(), type: 'question' as const, question: createQuestion({ stem: [para(stem)], answer: [para('略')] }) })

function project(): Project {
  const p = createEmptyProject()
  p.blocks = [
    q('单独的第一题'),
    createComposite({
      title: '材料一',
      background: [para('艺术体操中的带操表演……')],
      items: [q('小题甲'), q('小题乙')],
      answer: [para('2.横波 3.向上')],
      analysis: [para('【详解】……')]
    }),
    q('综合题之后的题')
  ]
  return p
}

describe('综合题的排版', () => {
  it('标题、背景、小题（题号连续）、共用答案与详解', () => {
    const ir = buildDocument(project(), 'teacher')
    const rows = ir.paragraphs.map((x) => [x.style, x.label ?? '', x.runs.map((r) => (r.kind === 'text' ? r.text : '')).join('').slice(0, 6)])
    expect(rows.filter((r) => r[0] !== 'answer' || r[1] === '【答案】')).toEqual([
      ['question', '1.', '单独的第一题'],
      ['answer', '【答案】', '略'],
      ['compositeTitle', '', '材料一'],
      ['compositeBackground', '', '艺术体操中的'],
      ['question', '2.', '小题甲'],
      ['answer', '【答案】', '略'],
      ['question', '3.', '小题乙'],
      ['answer', '【答案】', '略'],
      ['answer', '【答案】', '2.横波 3'],
      ['analysis', '', '【详解】……'],
      ['question', '4.', '综合题之后的'],
      ['answer', '【答案】', '略']
    ])
  })

  it('学生版没有共用答案与详解；背景与第一道小题同页', () => {
    const ir = buildDocument(project(), 'student')
    expect(ir.paragraphs.map((x) => x.style)).toEqual(['question', 'compositeTitle', 'compositeBackground', 'question', 'question', 'question'])
    expect(ir.paragraphs[2]!.keepNext).toBe(true)
  })

  it('导出使用模板的“综合题题目”“综合题背景”样式', async () => {
    const bytes = await writeDocx({
      ir: buildDocument(project(), 'teacher'),
      assets: {},
      title: 't',
      template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
    })
    const doc = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:pStyle w:val="19"/>') // 综合题题目
    expect(doc).toContain('<w:pStyle w:val="20"/>') // 综合题背景
  })
})

describe('题目总数按题号计（首页列表）', () => {
  it('综合题的每道小题各算一道，综合题本身不算', () => {
    const p = project()
    expect(summarizeProject(p).questionCount).toBe(4)
    const labels = buildDocument(p, 'teacher').paragraphs.filter((x) => x.style === 'question' && x.label !== undefined)
    expect(labels.map((x) => x.label)).toEqual(['1.', '2.', '3.', '4.'])
  })
})

describe('导入综合题（期中试卷分析）', async () => {
  const r = await importDocx(new Uint8Array(readFileSync('reference/samples/2026秋季高二物理东湖_期中试卷分析/教案_T_期中试卷分析.docx')))
  const comps = r.blocks.filter((b) => b.type === 'composite')

  it('4 道综合题，共 21 道小题', () => {
    expect(r.questionCount).toBe(21)
    // 导入后首页显示的题目总数与导入提示一致（此前首页只数独立题目，这份全是综合题，显示为 0）
    const p = createEmptyProject()
    p.blocks = r.blocks
    expect(summarizeProject(p).questionCount).toBe(21)
    expect(comps.map((c) => (c.type === 'composite' ? [c.title, c.items.length] : []))).toEqual([
      ['材料一', 5],
      ['材料二', 6],
      ['材料三', 7],
      ['材料四', 3]
    ])
  })

  it('背景与背景配图', () => {
    const c1 = comps[0]
    if (c1?.type !== 'composite') throw new Error()
    expect(plainText(c1.background)).toContain('艺术体操')
    expect(c1.figures).toHaveLength(1)
  })

  it('一段写出多道小题答案的，作为综合题的共用答案；小题本身没有答案', () => {
    for (const c of comps) {
      if (c.type !== 'composite') continue
      expect(c.answer.length).toBeGreaterThan(0)
      for (const item of c.items) expect(item.question.answer).toEqual([])
    }
    const c1 = comps[0]
    if (c1?.type === 'composite') expect(plainText(c1.answer)).toMatch(/^1\.横波/)
  })

  it('“A．”由自动编号生成的选项行也能识别', () => {
    const c1 = comps[0]
    if (c1?.type !== 'composite') throw new Error()
    expect(c1.items[2]!.question.options.map((o) => plainText(o.content))).toEqual(['增大', '减小', '保持不变'])
  })

  it('题号与全卷连续：材料二的小题从 6 开始', () => {
    const ir = buildDocument({ ...createEmptyProject(), blocks: r.blocks }, 'student')
    const labels = ir.paragraphs.filter((p) => p.style === 'question').map((p) => p.label)
    expect(labels.slice(4, 7)).toEqual(['5.', '6.', '7.'])
  })
})
