import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { uprightOmml, applyMathMarks } from '@core/export/math-marks'
import { writeDocx } from '@core/export/docx-writer'
import { buildDocument } from '@core/document/build'
import { createEmptyProject, createQuestion } from '@core/model/factory'

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
const styles = (omml: string): string[] => [...omml.matchAll(/<m:r>[\s\S]*?<\/m:r>/g)].map((m) => /<m:sty m:val="(\w+)"\/>/.exec(m[0])?.[1] ?? '-')

describe('公式字母用正体', () => {
  it('每段设为正体；粗斜体改为粗正体；已是正体的不变；花体保持', () => {
    const omml = `<m:oMath ${M}><m:r><m:t>qE</m:t></m:r><m:r><m:rPr><m:sty m:val="bi"/></m:rPr><m:t>v</m:t></m:r><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>N</m:t></m:r><m:r><m:rPr><m:scr m:val="script"/></m:rPr><m:t>L</m:t></m:r><m:r><m:rPr><m:brk/></m:rPr><m:t>B</m:t></m:r></m:oMath>`
    const out = uprightOmml(omml)
    expect(styles(out)).toEqual(['p', 'b', 'p', '-', 'p'])
    // m:sty 排在 m:brk 之前（元素顺序）
    expect(out).toContain('<m:rPr><m:sty m:val="p"/><m:brk/></m:rPr>')
    expect(uprightOmml(out)).toBe(out)
  })

  it('与加粗一起用：粗体公式为粗正体', () => {
    const omml = `<m:oMath ${M}><m:r><m:t>F</m:t></m:r></m:oMath>`
    expect(styles(uprightOmml(applyMathMarks(omml, { bold: true })))).toEqual(['b'])
  })

  it('导出：打开时公式字母为正体，关闭时保持 Word 默认的斜体', async () => {
    const p = createEmptyProject()
    p.blocks = [{ id: 'q', type: 'question', question: createQuestion({ stem: [{ inlines: [{ type: 'text', text: '已知' }, { type: 'math', latex: 'qE=qvB' }] }] }) }]
    const tpl = new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
    const doc = async (mathUpright: boolean): Promise<string> =>
      (await JSZip.loadAsync(await writeDocx({ ir: buildDocument(p, 'teacher'), assets: {}, title: 't', template: tpl, mathUpright }))).file('word/document.xml')!.async('string')
    const on = await doc(true)
    const off = await doc(false)
    const runs = (xml: string): string[] => styles(/<m:oMath\b[\s\S]*?<\/m:oMath>/.exec(xml)![0])
    expect(runs(on).every((s) => s === 'p' || s === 'b')).toBe(true)
    expect(runs(off).some((s) => s === '-' || s === 'i')).toBe(true)
  })
})
