import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '@core/document/build'
import { writeDocx } from '@core/export/docx-writer'
import { applyHeadingStyles } from '@core/export/heading-styles'
import { createEmptyProject, createQuestion, newId } from '@core/model/factory'
import { getPreset, PRESETS, presetStyles, type FormatPreset } from '@core/presets'
import type { Project } from '@core/model/types'

const TEMPLATE = new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))

async function exportXml(p: Project, file = 'word/document.xml'): Promise<string> {
  const bytes = await writeDocx({ ir: buildDocument(p, 'teacher'), assets: {}, title: 't', template: TEMPLATE })
  return (await JSZip.loadAsync(bytes)).file(file)!.async('string')
}

function styleEl(xml: string, name: string): string {
  return [...xml.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)].map((m) => m[0]).find((e) => e.includes(`<w:name w:val="${name}"/>`))!
}

describe('格式预设', () => {
  it('默认预设：教学案与题型整理，找不到的 ID 回到默认预设，旧预设 ID 兼容回退', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['教学案', '题型整理'])
    expect(getPreset('不存在').id).toBe('lesson-v1')
    expect(getPreset('physics-v1').id).toBe('lesson-v1')
    expect(getPreset('physics-typesummary-v1').id).toBe('typesummary-v1')
    expect(createEmptyProject().presetId).toBe('lesson-v1')
  })

  it('教学案的标题格式与模板一致：导出时写回样式不改变格式', async () => {
    const zip = await JSZip.loadAsync(TEMPLATE)
    const before = await zip.file('word/styles.xml')!.async('string')
    const after = applyHeadingStyles(before, presetStyles(getPreset('lesson-v1')))
    for (const key of ['title', 'section', 'topic'] as const) {
      const el = styleEl(after, presetStyles(getPreset('lesson-v1'))[key].wordStyleName)
      const h = getPreset('lesson-v1').headings[key]
      expect(el).toContain(`<w:sz w:val="${h.sizeHalfPt}"/>`)
      expect(el).toContain(`w:eastAsia="宋体"`)
      expect(el).toContain('<w:b/>')
      expect(el).toContain(`<w:spacing w:before="${h.spaceBeforeTwip}" w:after="${h.spaceAfterTwip}"`)
      expect(el).not.toContain('eastAsiaTheme')
    }
    // 其他样式原样不动
    expect(styleEl(after, '物理排版 题目')).toBe(styleEl(before, '物理排版 题目'))
  })

  it('换一个预设：预览样式与导出样式都随之变化', async () => {
    const base = getPreset('lesson-v1')
    const custom: FormatPreset = {
      ...base,
      id: 'test',
      headings: { ...base.headings, section: { font: 'hei', sizeHalfPt: 32, bold: false, color: 'c00000', align: 'center', spaceBeforeTwip: 240, spaceAfterTwip: 100 } }
    }
    const styles = presetStyles(custom)
    expect(styles.section).toMatchObject({ fontRole: 'hei', sizeHalfPt: 32, bold: false, color: 'C00000', align: 'center' })
    const zip = await JSZip.loadAsync(TEMPLATE)
    const el = styleEl(applyHeadingStyles(await zip.file('word/styles.xml')!.async('string'), styles), styles.section.wordStyleName)
    expect(el).toContain('w:eastAsia="黑体"')
    expect(el).not.toContain('<w:b/>')
    expect(el).toContain('<w:color w:val="C00000"/>')
    expect(el).toContain('<w:jc w:val="center"/>')
    // rPr 中子元素按规范顺序：rFonts → color → sz → szCs
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>(?![\s\S]*<w:rPr>)/.exec(el)![1]!
    const names = [...rPr.matchAll(/<w:(\w+)/g)].map((m) => m[1])
    expect(names.indexOf('rFonts')).toBeLessThan(names.indexOf('color'))
    expect(names.indexOf('color')).toBeLessThan(names.indexOf('sz'))
  })
})

describe('作业单模块', () => {
  const project = (): Project => {
    const p = createEmptyProject()
    const q = () => ({ id: newId(), type: 'question' as const, question: createQuestion({ stem: [{ inlines: [{ type: 'text', text: '题' }] }] }) })
    p.blocks = [q(), q(), { id: newId(), type: 'worksheet', title: '作业单-动态圆', fields: ['姓名', '教室', '正确率'] }, q(), q()]
    return p
  }

  it('排版：分页的大标题、空行、姓名栏（制表位与下划线）、空行，其后题号从 1 开始', () => {
    const ir = buildDocument(project(), 'student')
    const i = ir.paragraphs.findIndex((x) => x.style === 'title')
    const [title, gap1, fields, gap2] = ir.paragraphs.slice(i, i + 4)
    expect(title).toMatchObject({ style: 'title', pageBreakBefore: true, restartNumbering: true })
    expect(title!.runs).toEqual([{ kind: 'text', text: '作业单-动态圆' }])
    expect(gap1!.spacerTwip).toBeGreaterThan(0)
    expect(gap2!.spacerTwip).toBeGreaterThan(0)
    expect(fields!.tabStopsTwip).toEqual([3980, 7980])
    expect(fields!.runs.map((r) => r.kind)).toEqual(['text', 'blank', 'tab', 'text', 'blank', 'tab', 'text', 'blank'])
    expect(ir.paragraphs.filter((x) => x.style === 'question').map((x) => x.label)).toEqual(['1.', '2.', '1.', '2.'])
  })

  it('导出与示例文档一致：段前分页、姓名栏制表位 3980/7980、填写处为下划线', async () => {
    const doc = await exportXml(project())
    expect(doc).toMatch(/<w:pageBreakBefore\/>[\s\S]*?作业单-动态圆/)
    expect(doc).toContain('<w:tabs><w:tab w:val="left" w:pos="3980"/><w:tab w:val="left" w:pos="7980"/></w:tabs>')
    expect(doc).toMatch(/姓名：<\/w:t><\/w:r><w:r><w:rPr><w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">　+<\/w:t><\/w:r><w:r><w:tab\/><\/w:r>/)
  })

  it('题目总数按题号计：作业单的题目也算', async () => {
    const { countQuestions } = await import('@core/model/stats')
    expect(countQuestions(project().blocks)).toBe(4)
  })
})

describe('星级难度（与等级对应：A=1 星简单、B=2 星、C=3 星难）', () => {
  const stemPrefix = (difficulty: string | undefined, stars: number | undefined): string => {
    const p = createEmptyProject()
    p.blocks = [{ id: newId(), type: 'question', question: createQuestion({ ...(difficulty ? { difficulty } : {}), ...(stars ? { stars } : {}), stem: [{ inlines: [{ type: 'text', text: '题' }] }] }) }]
    const r = buildDocument(p, 'student').paragraphs.find((x) => x.style === 'question')!.runs[0]!
    return r.kind === 'text' ? r.text : ''
  }

  it('题干前缀：只存等级时自动显示对应星级（旧工程无需修改数据）', () => {
    expect(stemPrefix('A', undefined)).toBe('【A】★')
    expect(stemPrefix('B', undefined)).toBe('【B】★★')
    expect(stemPrefix('C', undefined)).toBe('【C】★★★')
  })

  it('只有星级时换算成等级；等级与星级不一致时以等级为准', () => {
    expect(stemPrefix(undefined, 3)).toBe('【C】★★★')
    expect(stemPrefix('C', 1)).toBe('【C】★★★')
  })

  it('预设中没有的等级原样显示，不加星；没有难度时不显示', () => {
    expect(stemPrefix('D', undefined)).toBe('【D】')
    expect(stemPrefix(undefined, 5)).toBe('★★★★★')
    expect(stemPrefix(undefined, undefined)).toBe('题')
  })

  it('difficultyOf 给出等级、星级与说明', async () => {
    const { difficultyOf } = await import('@core/presets')
    expect(difficultyOf({ difficulty: 'A' }, getPreset('lesson-v1'))).toEqual({ grade: 'A', stars: 1, label: '简单' })
    expect(difficultyOf({ stars: 3 }, getPreset('lesson-v1'))).toEqual({ grade: 'C', stars: 3, label: '难' })
    expect(difficultyOf({}, getPreset('lesson-v1'))).toEqual({})
  })
})

describe('导入时的星级难度', () => {
  it('题干开头的★或【★★】换算成等级；已有等级时以等级为准', async () => {
    const { applyPresetRules } = await import('@core/import/preset-rules')
    const mk = (stem: string, difficulty?: string) => ({
      id: newId(),
      type: 'question' as const,
      question: createQuestion({ ...(difficulty ? { difficulty } : {}), stem: [{ inlines: [{ type: 'text', text: stem }] }] })
    })
    const [a, b, c, d] = applyPresetRules([mk('★★★如图所示'), mk('如图所示', '★★'), mk('★☆☆题', 'B'), mk('★★★★★题')], getPreset('lesson-v1')) as Array<ReturnType<typeof mk>>
    expect(a!.question).toMatchObject({ difficulty: 'C' })
    expect(a!.question.stars).toBeUndefined()
    expect(a!.question.stem[0]!.inlines).toEqual([{ type: 'text', text: '如图所示' }])
    expect(b!.question).toMatchObject({ difficulty: 'B' })
    expect(c!.question).toMatchObject({ difficulty: 'B' })
    expect(c!.question.stem[0]!.inlines).toEqual([{ type: 'text', text: '题' }])
    // 没有对应等级的星数单独记为星级
    expect(d!.question).toMatchObject({ stars: 5 })
    expect(d!.question.difficulty).toBeUndefined()
  })
})

describe('导出文件名', async () => {
  const { exportFileName } = await import('@shared/export-name')
  it('版本标记放在最前面：(T) 教师版、(S) 学生版', () => {
    expect(exportFileName('知识点清单-光', 'teacher')).toBe('(T)知识点清单-光.docx')
    expect(exportFileName('知识点清单-光', 'student')).toBe('(S)知识点清单-光.docx')
    expect(exportFileName('a/b:c', 'student')).toBe('(S)a_b_c.docx')
  })
})

describe('作业单姓名栏在预览中不折行', () => {
  it('姓名栏段落带 noWrap', () => {
    const p = createEmptyProject()
    p.blocks = [{ id: newId(), type: 'worksheet', title: '作业单-带电粒子在磁场中的运动', fields: ['姓名', '教室', '正确率'] }]
    const fields = buildDocument(p, 'teacher').paragraphs.find((x) => x.tabStopsTwip !== undefined)!
    expect(fields.noWrap).toBe(true)
  })
})

describe('大标题从新的一页开始', async () => {
  const { buildDocument: build } = await import('@core/document/build')
  it('设置后段前分页；文档开头的大标题不另起一页；可与题号重新开始同时使用', async () => {
    const p = createEmptyProject()
    p.blocks = [
      { id: 'a', type: 'title', text: '光的折射 全反射', pageBreakBefore: true },
      { id: 'q', type: 'question', question: createQuestion({ stem: [{ inlines: [{ type: 'text', text: '题' }] }] }) },
      { id: 'b', type: 'title', text: '光的现象', pageBreakBefore: true, restartNumbering: true },
      { id: 'q2', type: 'question', question: createQuestion({ stem: [{ inlines: [{ type: 'text', text: '题' }] }] }) }
    ]
    const titles = build(p, 'teacher').paragraphs.filter((x) => x.style === 'title')
    expect(titles.map((t) => t.pageBreakBefore === true)).toEqual([false, true])
    expect(titles[1]!.restartNumbering).toBe(true)
    const doc = await (await JSZip.loadAsync(await writeDocx({ ir: build(p, 'teacher'), assets: {}, title: 't', template: TEMPLATE }))).file('word/document.xml')!.async('string')
    expect(doc).toMatch(/<w:pageBreakBefore\/>[\s\S]*?光的现象/)
    expect(doc).not.toMatch(/<w:pageBreakBefore\/>[^]*?光的折射 全反射/)
  })
})

describe('栏目标题、题型分组从新的一页开始、题号重新开始', async () => {
  const { buildDocument: build } = await import('@core/document/build')
  const q = (id: string) => ({ id, type: 'question' as const, question: createQuestion({ stem: [{ inlines: [{ type: 'text' as const, text: '题' }] }] }) })
  it('栏目标题与题型分组都可设置；题号重新开始；导出为段前分页与新的编号', async () => {
    const p = createEmptyProject()
    p.blocks = [
      { id: 's1', type: 'section', text: '课堂练习', pageBreakBefore: true },
      q('a'),
      q('b'),
      { id: 's2', type: 'section', text: '课后练习', pageBreakBefore: true, restartNumbering: true },
      { id: 't1', type: 'topic', text: '放缩圆' },
      q('c'),
      { id: 't2', type: 'topic', text: '旋转圆', pageBreakBefore: true, restartNumbering: true },
      q('d')
    ]
    const ir = build(p, 'teacher')
    const heads = ir.paragraphs.filter((x) => x.style === 'section' || x.style === 'topic')
    // 文档开头的“课堂练习”不另起一页
    expect(heads.map((h) => [h.runs.map((r) => (r.kind === 'text' ? r.text : '')).join(''), h.pageBreakBefore === true, h.restartNumbering === true])).toEqual([
      ['课堂练习', false, false],
      ['课后练习', true, true],
      ['放缩圆', false, false],
      ['旋转圆', true, true]
    ])
    expect(ir.paragraphs.filter((x) => x.style === 'question').map((x) => x.label)).toEqual(['1.', '2.', '1.', '1.'])
    const doc = await (await JSZip.loadAsync(await writeDocx({ ir, assets: {}, title: 't', template: TEMPLATE }))).file('word/document.xml')!.async('string')
    expect(doc).toMatch(/<w:pageBreakBefore\/>[\s\S]*?课后练习/)
    expect(doc).toMatch(/<w:pageBreakBefore\/>[\s\S]*?旋转圆/)
  })

  it('工程文件保存、读取保留这两个选项', async () => {
    const { projectSchema } = await import('@core/model/schema')
    const p = createEmptyProject()
    p.blocks = [{ id: 's', type: 'section', text: '课后练习', pageBreakBefore: true, restartNumbering: true }, { id: 't', type: 'topic', text: '放缩圆', pageBreakBefore: true }]
    expect(projectSchema.parse(p).blocks).toEqual(p.blocks)
  })
})
