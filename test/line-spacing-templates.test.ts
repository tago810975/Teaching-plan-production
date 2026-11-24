/**
 * 版式设置中的行距（标题 / 题目 / 知识点 / 正文段落），以及用户模板的核心逻辑
 * （预设校验、登记、Word 模板检查）。主进程中读写模板文件夹的部分在真实界面中验证。
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDocument } from '@core/document/build'
import { writeDocx } from '@core/export/docx-writer'
import { createEmptyBundle, createKnowledge, createQuestion, newId, para } from '@core/model/factory'
import { decodeBundle, encodeBundle } from '@core/project-file/codec'
import { allPresets, getPreset, parsePreset, PRESETS, resolveLineSpacing, setUserPresets } from '@core/presets'
import { checkWordTemplate } from '@core/template/check'
import lessonV1 from '@core/presets/lesson-v1.json'
import type { Project } from '@core/model/types'

const template = new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))

function sampleProject(): Project {
  const { project } = createEmptyBundle()
  project.blocks = [
    { id: 'title', type: 'title', text: '大标题' },
    { id: 'q', type: 'question', question: createQuestion({ stem: [para('题干')], answer: [para('A')], layout: { studentSpaceLines: 2 } }) },
    { ...createKnowledge({ title: '一、知识点', content: [para('内容')] }), id: 'k' },
    { id: 'p', type: 'paragraph', content: [para('正文')] }
  ]
  return project
}

const lineOf = (project: Project, blockId: string): Array<number | undefined> =>
  buildDocument(project, 'student')
    .paragraphs.filter((p) => p.sourceBlockId === blockId && p.spacerTwip === undefined)
    .map((p) => p.lineAuto)

describe('行距', () => {
  it('不设时为单倍（旧工程排版不变）', () => {
    const project = sampleProject()
    for (const id of ['title', 'q', 'k', 'p']) expect(lineOf(project, id).every((v) => v === undefined)).toBe(true)
  })

  it('标题、题目、知识点、正文段落分别设置；作答留白不受影响', () => {
    const project = sampleProject()
    project.layout.lineSpacing = { heading: 1.2, question: 1.5, knowledge: 1.3, body: 2 }
    expect(lineOf(project, 'title')).toEqual([288])
    expect(lineOf(project, 'q').every((v) => v === 360)).toBe(true)
    expect(lineOf(project, 'k').every((v) => v === 312)).toBe(true)
    expect(lineOf(project, 'p')).toEqual([480])
    const spacer = buildDocument(project, 'student').paragraphs.find((p) => p.sourceBlockId === 'q' && p.spacerTwip !== undefined)!
    expect(spacer.lineAuto).toBeUndefined()
  })

  it('工程没设的项用格式预设的行距（题型整理默认 1.3 倍，标题单倍）', () => {
    const project = sampleProject()
    project.presetId = 'typesummary-v1'
    expect(resolveLineSpacing(project.layout, getPreset(project.presetId))).toEqual({ heading: 1, question: 1.3, knowledge: 1.3, body: 1.3 })
    expect(lineOf(project, 'title')).toEqual([undefined])
    expect(lineOf(project, 'q').every((v) => v === 312)).toBe(true)
    // 工程中设了的项优先
    project.layout.lineSpacing = { question: 1 }
    expect(lineOf(project, 'q').every((v) => v === undefined)).toBe(true)
    expect(lineOf(project, 'p')).toEqual([312])
  })

  it('导出 Word：写成多倍行距，段前段后随样式', async () => {
    const project = sampleProject()
    project.layout.lineSpacing = { question: 1.5 }
    const bytes = await writeDocx({ ir: buildDocument(project, 'teacher'), assets: {}, title: 't', template })
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(xml).toContain('<w:spacing w:line="360" w:lineRule="auto"/>')
  })

  it('工程文件保存再打开（第 14 版），行距不变', async () => {
    const bundle = createEmptyBundle()
    bundle.project.layout.lineSpacing = { heading: 1.2, body: 1.5 }
    bundle.project.blocks = [{ id: newId(), type: 'paragraph', content: [para('x')] }]
    const back = await decodeBundle(await encodeBundle(bundle, { appVersion: 'test' }))
    expect(back.project.layout.lineSpacing).toEqual({ heading: 1.2, body: 1.5 })
  })
})

describe('用户模板', () => {
  afterEach(() => setUserPresets([]))

  it('preset.json 校验：字段错误、id 格式给出中文说明', () => {
    expect(parsePreset({ ...lessonV1, id: 'my-preset' }).ok).toBe(true)
    const bad = parsePreset({ ...lessonV1, kind: 'exam' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('kind')
    const badId = parsePreset({ ...lessonV1, id: '我的模板' })
    expect(badId.ok).toBe(false)
    if (!badId.ok) expect(badId.error).toContain('小写字母')
  })

  it('登记后可按 ID 取用、出现在预设列表末尾；与内置同 ID 的忽略；删除后回到默认预设', () => {
    const mine = { ...PRESETS[0]!, id: 'zhang-v1', name: '张老师的教学案', templateId: 'user-zhang-v1' }
    setUserPresets([mine, { ...PRESETS[1]!, name: '冒充的' }])
    expect(allPresets().map((p) => p.id)).toEqual([...PRESETS.map((p) => p.id), 'zhang-v1'])
    expect(getPreset('zhang-v1').name).toBe('张老师的教学案')
    expect(getPreset('typesummary-v1').name).toBe('题型整理')
    setUserPresets([])
    expect(getPreset('zhang-v1').id).toBe('lesson-v1')
  })

  it('Word 模板检查：内置模板通过；缺少 {{body}} 或样式时说明原因', async () => {
    expect(await checkWordTemplate(template)).toBeNull()
    const zip = await JSZip.loadAsync(template)
    const doc = await zip.file('word/document.xml')!.async('string')
    zip.file('word/document.xml', doc.replace('{{body}}', ''))
    expect(await checkWordTemplate(await zip.generateAsync({ type: 'uint8array' }))).toContain('{{body}}')
    const zip2 = await JSZip.loadAsync(template)
    const styles = await zip2.file('word/styles.xml')!.async('string')
    zip2.file('word/styles.xml', styles.replace('w:val="物理排版 题目 选项"', 'w:val="选项"'))
    expect(await checkWordTemplate(await zip2.generateAsync({ type: 'uint8array' }))).toContain('物理排版 题目 选项')
    expect(await checkWordTemplate(new Uint8Array([1, 2, 3]))).toContain('不是有效的 Word 文档')
  })
})
