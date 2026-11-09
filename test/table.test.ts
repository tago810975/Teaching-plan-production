import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { blankKeyPoints, buildDocument } from '@core/document/build'
import { writeDocx } from '@core/export/docx-writer'
import { importDocx } from '@core/import/import-docx'
import { createEmptyBundle, createEmptyProject, createKnowledge, para } from '@core/model/factory'
import { fromEditable, toEditable } from '@core/model/markup'
import { projectSchema } from '@core/model/schema'
import { createTable, deleteColumn, deleteRow, hasMerges, insertColumn, insertRow, layoutTable } from '@core/model/table'
import type { Inline, Project, RichText, TableInline } from '@core/model/types'
import { decodeBundle, encodeBundle } from '@core/project-file/codec'
import { getPreset } from '@core/presets'

const TEMPLATE = new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
const cell = (text: string, extra: object = {}) => ({ content: [para(text)], ...extra })

/** 3 列：表头底纹；第一列“光”跨两行；最后一行跨两列；单元格中有红色加粗与公式 */
function sampleTable(): TableInline {
  return {
    type: 'table',
    colWidthsTwip: [1500, 3000, 3000],
    rows: [
      { cells: [cell('类别', { shading: 'F2F2F2' }), cell('单缝衍射', { shading: 'F2F2F2' }), cell('双缝干涉', { shading: 'F2F2F2' })] },
      { cells: [cell('条纹', { rowSpan: 2 }), { content: [{ inlines: [{ type: 'text', text: '中央宽' }, { type: 'text', text: '亮', marks: { bold: true, color: 'C00000' } }] }] }, cell('等宽')] },
      { cells: [{ content: [{ inlines: [{ type: 'math', latex: '\\Delta x=\\frac{L}{d}\\lambda' }] }] }, cell('间距相等')] },
      { cells: [cell('相同点'), cell('都是波特有的现象', { colSpan: 2 })] }
    ]
  }
}

function projectWith(content: RichText, presetId = 'physics-v1'): Project {
  const p = createEmptyProject()
  p.presetId = presetId
  p.blocks = [createKnowledge({ title: '一、光的衍射', content })]
  return p
}

describe('表格的网格', () => {
  it('合并单元格占据的格子', () => {
    const g = layoutTable(sampleTable().rows)
    expect([g.rows, g.cols]).toEqual([4, 3])
    expect(g.placed[2]!.map((p) => p.col)).toEqual([1, 2]) // 第 3 行第 1 列被“条纹”占据
    expect(g.owner[2]![0]!.row).toBe(1)
    expect(g.placed[3]![1]).toMatchObject({ col: 1, colSpan: 2 })
    expect(hasMerges(sampleTable())).toBe(true)
  })

  it('增删行列（没有合并单元格时）', () => {
    let t = createTable(2, 2)
    t = insertRow(t, 1)
    t = insertColumn(t, 0)
    expect([t.rows.length, t.rows[0]!.cells.length]).toEqual([3, 3])
    t = deleteRow(deleteColumn(t, 2), 0)
    expect([t.rows.length, t.rows[0]!.cells.length]).toEqual([2, 2])
    expect(deleteRow(createTable(1, 2), 0).rows).toHaveLength(1)
  })
})

describe('表格的数据与输入框', () => {
  it('工程文件保存、读取（含合并、底纹、公式）', async () => {
    const b = createEmptyBundle()
    b.project.blocks = projectWith([para('前'), { inlines: [sampleTable()] }, para('后')]).blocks
    expect(projectSchema.safeParse(b.project).success).toBe(true)
    const back = await decodeBundle(await encodeBundle(b, { appVersion: '0.1.0' } as never))
    expect(back.project.blocks).toEqual(b.project.blocks)
  })

  it('输入框中表格显示为 ⟦表格N⟧，改其他文字不影响表格', () => {
    const rich: RichText = [para('如表所示：'), { inlines: [sampleTable()] }]
    const e = toEditable(rich)
    expect(e.text).toBe('如表所示：\n⟦表格1⟧')
    expect(fromEditable(e.text.replace('如表', '如下表'), e.objects)[1]).toEqual({ inlines: [sampleTable()] })
  })
})

describe('表格的排版与导出', () => {
  it('预览数据：列宽不超过栏宽；学生版挖空单元格中的重点', () => {
    const p = projectWith([{ inlines: [sampleTable()] }], 'physics-handbook-v1')
    const run = (v: 'teacher' | 'student') => buildDocument(p, v).paragraphs.flatMap((x) => x.runs).find((r) => r.kind === 'table')!
    const t = run('teacher')
    expect(t.kind === 'table' && t.table.colWidthsTwip).toEqual([1500, 3000, 3000])
    const s = run('student')
    const cellRuns = s.kind === 'table' ? s.table.rows[1]!.cells[1]!.paragraphs[0]!.runs : []
    expect(cellRuns).toEqual([{ kind: 'text', text: '中央宽' }, { kind: 'blank', widthChars: 4 }])
    // 教学案预设不挖空
    expect(blankKeyPoints(buildDocument(projectWith([{ inlines: [sampleTable()] }]), 'student').paragraphs[1]!, { ...getPreset('physics-v1').dictation, enabled: false })).toBeDefined()
  })

  it('导出为 Word 表格：gridSpan、vMerge（续行单元格）、底纹、列宽；正文不以表格结尾', async () => {
    const bytes = await writeDocx({ ir: buildDocument(projectWith([{ inlines: [sampleTable()] }]), 'teacher'), assets: {}, title: 't', template: TEMPLATE })
    const doc = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    const tbl = /<w:tbl>[\s\S]*?<\/w:tbl>/.exec(doc)![0]
    expect(tbl).toContain('<w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>')
    expect(tbl).toContain('<w:vMerge w:val="restart"/>')
    expect(tbl.match(/<w:vMerge\/>/g)).toHaveLength(1)
    expect(tbl).toContain('<w:gridSpan w:val="2"/>')
    expect(tbl.match(/w:fill="F2F2F2"/g)).toHaveLength(3)
    expect(tbl.match(/<w:tr>/g)).toHaveLength(4)
    expect(doc).not.toMatch(/<\/w:tbl><w:sectPr/)
  })

  it('导出后再导入，表格结构与内容不变', async () => {
    const bytes = await writeDocx({ ir: buildDocument(projectWith([para('前'), { inlines: [sampleTable()] }]), 'teacher'), assets: {}, title: 't', template: TEMPLATE })
    const r = await importDocx(bytes, { presetId: 'physics-handbook-v1' })
    const tables: TableInline[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v !== null && typeof v === 'object') {
        if ((v as Inline).type === 'table') tables.push(v as TableInline)
        Object.values(v).forEach(walk)
      }
    }
    walk(r.blocks)
    expect(tables).toHaveLength(1)
    const t = tables[0]!
    expect(t.colWidthsTwip).toEqual([1500, 3000, 3000])
    const shape = t.rows.map((row) => row.cells.map((c) => [c.colSpan ?? 1, c.rowSpan ?? 1, c.shading ?? '']))
    expect(shape).toEqual([
      [[1, 1, 'F2F2F2'], [1, 1, 'F2F2F2'], [1, 1, 'F2F2F2']],
      [[1, 2, ''], [1, 1, ''], [1, 1, '']],
      [[1, 1, ''], [1, 1, '']],
      [[1, 1, ''], [2, 1, '']]
    ])
    const marks = t.rows[1]!.cells[1]!.content[0]!.inlines
    expect(marks.some((i) => i.type === 'text' && i.text === '亮' && i.marks?.bold === true && i.marks?.color === 'C00000')).toBe(true)
    expect(t.rows[2]!.cells[0]!.content[0]!.inlines[0]!.type).toBe('math')
  })

  it('示例知识点手册：三个表格（含合并单元格与图片）', async () => {
    const r = await importDocx(new Uint8Array(readFileSync('reference/samples/物理知识点手册_光/教案_T_知识点清单-光.docx')), { presetId: 'physics-handbook-v1' })
    const tables: TableInline[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v !== null && typeof v === 'object') {
        if ((v as Inline).type === 'table') tables.push(v as TableInline)
        Object.values(v).forEach(walk)
      }
    }
    walk(r.blocks)
    expect(tables.map((t) => [t.rows.length, layoutTable(t.rows).cols])).toEqual([[7, 2], [5, 3], [4, 3]])
    expect(tables[1]!.rows[4]!.cells[1]!.colSpan).toBe(2)
    expect(tables[2]!.rows[1]!.cells.slice(1).every((c) => c.content[0]!.inlines.some((i) => i.type === 'image'))).toBe(true)
  })
})
