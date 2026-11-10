/**
 * 物理题型整理 V1.0：预制模块、学生版书写横线、不编号的题干、底纹注释框、导出 Word。
 * 示例：reference/samples/物理题型整理_放缩圆（LaTeX 样张），用 test/fixtures/type-summary-sample.ts 重新搭出。
 *
 * 设置 TYPE_SUMMARY_OUT=<目录> 时，把示例存成 .tplan 并导出 (T) / (S) 两份 Word，供人工查看。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '@core/document/build'
import type { DocParagraph, DocTable } from '@core/document/ir'
import { writeDocx } from '@core/export/docx-writer'
import { createTypeSummarySkeleton, createThinkWriteTable, circledItems, TYPE_SUMMARY_COLORS } from '@core/model/type-summary'
import { createEmptyBundle, para } from '@core/model/factory'
import { decodeBundle, encodeBundle } from '@core/project-file/codec'
import { getPreset, PRESETS } from '@core/presets'
import { exportFileName } from '@shared/export-name'
import type { Variant } from '@core/model/types'
import { createTypeSummarySample } from './fixtures/type-summary-sample'

const template = new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
const preset = getPreset('physics-typesummary-v1')

const tables = (ps: DocParagraph[]): DocTable[] => ps.flatMap((p) => p.runs.flatMap((r) => (r.kind === 'table' ? [r.table] : [])))

async function documentXml(variant: Variant): Promise<string> {
  const bundle = await createTypeSummarySample()
  const bytes = await writeDocx({ ir: buildDocument(bundle.project, variant), assets: bundle.assets, title: bundle.project.meta.title, template })
  return (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
}

describe('物理题型整理 V1.0', () => {
  it('预设：题型整理类型、不编号、页眉不加(教案)(学案)、四个栏目', () => {
    expect(PRESETS.map((p) => p.id)).toContain('physics-typesummary-v1')
    expect(preset.name).toBe('物理题型整理 V1.0')
    expect(preset.kind).toBe('typeSummary')
    expect(preset.numberQuestions).toBe(false)
    expect(preset.header.variantSuffix).toBe(false)
    expect(preset.sectionNames).toHaveLength(4)
    expect(preset.sectionNames[0]).toBe('例题')
    expect(preset.headings.title.font).toBe('hei')
  })

  it('骨架：按样张顺序放好各部分', () => {
    const blocks = createTypeSummarySkeleton(preset.sectionNames)
    expect(blocks.map((b) => b.type)).toEqual(['title', 'section', 'question', 'section', 'paragraph', 'paragraph', 'section', 'paragraph', 'paragraph', 'section', 'paragraph'])
    const note = blocks[4]!
    expect(note.type === 'paragraph' && note.shaded).toBe(true)
  })

  it('对照表：深蓝表头、左栏浅蓝、右栏米色并设书写横线，顶端对齐', () => {
    const block = createThinkWriteTable([{ think: circledItems(['问题一', '问题二']), write: [para('书写')], lines: 7 }])
    const t = block.content[0]!.inlines[0]!
    expect(t.type).toBe('table')
    if (t.type !== 'table') return
    expect(t.borderColor).toBe(TYPE_SUMMARY_COLORS.blue)
    expect(t.valign).toBe('top')
    expect(t.rows[0]!.cells.map((c) => c.shading)).toEqual([TYPE_SUMMARY_COLORS.blue, TYPE_SUMMARY_COLORS.blue])
    expect(t.rows[1]!.cells[0]!.shading).toBe(TYPE_SUMMARY_COLORS.paleBlue)
    expect(t.rows[1]!.cells[1]).toMatchObject({ shading: TYPE_SUMMARY_COLORS.cream, studentLines: 7 })
    expect(t.colWidthsTwip!.reduce((a, b) => a + b, 0)).toBe(10466)
    // 续表没有表头
    const cont = createThinkWriteTable([{ think: [], write: [], lines: 3 }], false).content[0]!.inlines[0]!
    expect(cont.type === 'table' && cont.rows.length).toBe(1)
  })

  it('学生版：书写栏换成虚线格，教师版显示书写内容；思维过程两版相同', async () => {
    const { project } = await createTypeSummarySample()
    const teacher = tables(buildDocument(project, 'teacher').paragraphs)
    const student = tables(buildDocument(project, 'student').paragraphs)
    expect(teacher).toHaveLength(2)
    expect(student).toHaveLength(2)
    // 第一张表：表头 + 一行
    const tWrite = teacher[0]!.rows[1]!.cells[1]!
    const sWrite = student[0]!.rows[1]!.cells[1]!
    expect(tWrite.paragraphs.some((p) => p.ruleLine === true)).toBe(false)
    expect(tWrite.paragraphs[0]!.runs.length).toBeGreaterThan(0)
    expect(sWrite.paragraphs).toHaveLength(8)
    expect(sWrite.paragraphs.every((p) => p.ruleLine === true && p.runs.length === 0)).toBe(true)
    expect(sWrite.studentLines).toBeUndefined()
    expect(student[0]!.rows[1]!.cells[0]).toEqual(teacher[0]!.rows[1]!.cells[0])
    // 表头两版相同
    expect(student[0]!.rows[0]).toEqual(teacher[0]!.rows[0])
    // 续表两行都换成虚线格
    expect(student[1]!.rows.map((r) => r.cells[1]!.paragraphs.length)).toEqual([8, 8])
  })

  it('题干不编号、首行缩进两个字；页眉右侧不加(教案)(学案)', async () => {
    const { project } = await createTypeSummarySample()
    for (const v of ['teacher', 'student'] as const) {
      const ir = buildDocument(project, v)
      const stem = ir.paragraphs.find((p) => p.style === 'question')!
      expect(stem.label).toBeUndefined()
      expect(stem).toMatchObject({ unnumbered: true, indentLeftTwip: 0, firstLineIndentTwip: 420 })
      expect(ir.header.right).toBe('选修二　磁场 磁场力　带电粒子圆周运动')
    }
    // 其他预设照旧编号
    const lesson = buildDocument({ ...project, presetId: 'physics-v1' }, 'teacher')
    expect(lesson.paragraphs.find((p) => p.style === 'question')!.label).toBe('1.')
  })

  it('审题注释框整块浅灰底纹', async () => {
    const { project } = await createTypeSummarySample()
    const note = project.blocks.find((b) => b.type === 'paragraph' && b.shaded === true)!
    const paras = buildDocument(project, 'student').paragraphs.filter((p) => p.sourceBlockId === note.id)
    expect(paras).toHaveLength(4)
    expect(paras.every((p) => p.shaded === true)).toBe(true)
  })

  it('导出 Word：题干取消编号、表格彩色边框与底纹、学生版虚线格', async () => {
    const t = await documentXml('teacher')
    const s = await documentXml('student')
    for (const xml of [t, s]) {
      expect(xml).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>')
      expect(xml).toContain(`w:color="${TYPE_SUMMARY_COLORS.blue}"`)
      expect(xml).toContain(`w:fill="${TYPE_SUMMARY_COLORS.paleBlue}"`)
      expect(xml).toContain('<w:vAlign w:val="top"/>')
      expect(xml).toContain('w:fill="F2F2F2"')
    }
    const rules = (xml: string): number => (xml.match(/<w:bottom w:val="dotted"/g) ?? []).length
    expect(rules(t)).toBe(0)
    expect(rules(s)).toBe(24)
    expect(t).toContain('故选 ')
    expect(s).not.toContain('故选 ')
  })

  it('工程文件可保存再打开（第 13 版格式）', async () => {
    const bundle = await createTypeSummarySample()
    const bytes = await encodeBundle(bundle, { appVersion: 'test' })
    const back = await decodeBundle(bytes)
    expect(back.project).toEqual(bundle.project)
  })

  it('空工程换成题型整理预设也能排版', () => {
    const { project } = createEmptyBundle()
    project.presetId = preset.id
    project.blocks = createTypeSummarySkeleton(preset.sectionNames)
    expect(() => buildDocument(project, 'student')).not.toThrow()
  })

  // 人工查看用：TYPE_SUMMARY_OUT=<目录> npx vitest run test/type-summary.test.ts
  it.runIf(process.env.TYPE_SUMMARY_OUT !== undefined)('输出示例工程与 Word', async () => {
    const dir = process.env.TYPE_SUMMARY_OUT!
    mkdirSync(dir, { recursive: true })
    const bundle = await createTypeSummarySample()
    writeFileSync(join(dir, `${bundle.project.meta.title}.tplan`), await encodeBundle(bundle, { appVersion: 'sample' }))
    for (const v of ['teacher', 'student'] as const) {
      const bytes = await writeDocx({ ir: buildDocument(bundle.project, v), assets: bundle.assets, title: bundle.project.meta.title, template })
      writeFileSync(join(dir, exportFileName(bundle.project.meta.title, v)), bytes)
    }
  })
})
