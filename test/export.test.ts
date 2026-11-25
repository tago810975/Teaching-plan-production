import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '@core/document/build'
import { writeDocx, DocxExportError } from '@core/export/docx-writer'
import { importDocx } from '@core/import/import-docx'
import { latexToOmml } from '@core/math/mathml-to-omml'
import { ommlToMathml } from '@core/math/omml-to-mathml'
import { createEmptyBundle, createQuestion, newId, para } from '@core/model/factory'
import type { ProjectBundle, Variant } from '@core/model/types'
import { createAsset } from '@core/project-file/codec'
import { A4_PAGE } from '@core/document/units'

const template = new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
const PNG = new Uint8Array(readFileSync('resources/templates/physics-default/header/phone-icon.png'))

async function exportParts(bundle: ProjectBundle, variant: Variant) {
  const bytes = await writeDocx({ ir: buildDocument(bundle.project, variant), assets: bundle.assets, title: bundle.project.meta.title, template })
  const zip = await JSZip.loadAsync(bytes)
  const read = (p: string) => zip.file(p)!.async('string')
  return { zip, doc: await read('word/document.xml'), header: await read('word/header1.xml'), numbering: await read('word/numbering.xml'), rels: await read('word/_rels/document.xml.rels'), headerRels: await read('word/_rels/header1.xml.rels'), core: await read('docProps/core.xml') }
}

async function bundleWithHeader(): Promise<ProjectBundle> {
  const bundle = createEmptyBundle()
  const logo = await createAsset(PNG, 'image/png')
  bundle.assets[logo.id] = logo
  bundle.project.meta.title = '测试 & 专题'
  bundle.project.header = { logo: { assetId: logo.id, widthEmu: 900000, heightEmu: 300000 }, left: '左侧<文字>', phone: '', right: '高二物理' }
  bundle.project.blocks = [
    { id: 't1', type: 'title', text: '专题' },
    { id: newId(), type: 'question', question: createQuestion({ stem: [para('第一题'), para('续行')], answer: [para('A')], knowledgePoints: ['知识点'], options: ['A', 'B', 'C', 'D'].map((l) => ({ label: l, content: para('1') })) }) },
    { id: newId(), type: 'question', question: createQuestion({ kind: 'solve', stem: [para('第二题 ', { type: 'math', latex: '\\frac{1}{2}mv^2' })], subQuestions: [{ id: 's1', content: [para('求速度')] }], layout: { studentSpaceLines: 6 } }) },
    { id: 't2', type: 'title', text: '作业单', restartNumbering: true },
    { id: newId(), type: 'question', question: createQuestion({ stem: [para('作业第一题')] }) }
  ]
  return bundle
}

describe('导出 Word', () => {
  it('题目用模板样式与自动编号，正文不写题号文字', async () => {
    const { doc } = await exportParts(await bundleWithHeader(), 'teacher')
    expect(doc).not.toContain('{{body}}')
    expect(doc).toContain('<w:t xml:space="preserve">第一题</w:t>')
    expect(doc).not.toMatch(/<w:t[^>]*>1\.<\/w:t>/)
    expect(doc).not.toContain('【答案】') // 由 Word 自动编号生成
    // 题干续行不用“次级题目”样式（否则会被编上小问号），而是正文加缩进
    expect(doc).toContain('<w:ind w:left="333" w:firstLine="0"/>')
  })

  it('作业单从 1 重新编号', async () => {
    const { doc, numbering } = await exportParts(await bundleWithHeader(), 'student')
    expect(numbering).toMatch(/<w:num w:numId="9000"><w:abstractNumId w:val="\d+"\/><w:lvlOverride w:ilvl="\d"><w:startOverride w:val="1"\/>/)
    // 作业单之后的题目指向新的编号实例
    const after = doc.slice(doc.indexOf('作业单'))
    expect(after).toContain('<w:numId w:val="9000"/>')
    expect(doc.slice(0, doc.indexOf('作业单'))).not.toContain('<w:numId w:val="9000"/>')
  })

  it('学案不含答案与知识点，作答留白为固定行高的空段', async () => {
    const { doc } = await exportParts(await bundleWithHeader(), 'student')
    expect(doc).not.toContain('知识点')
    expect(doc).toContain(`w:line="${6 * 312}" w:lineRule="exact"`)
    const t = await exportParts(await bundleWithHeader(), 'teacher')
    expect(t.doc).toContain('w:fill="F2F2F2"')
  })

  it('LaTeX 公式转为 Word 公式', async () => {
    const { doc } = await exportParts(await bundleWithHeader(), 'student')
    expect(doc).toMatch(/<m:oMath><m:f><m:num>/)
    expect(doc).not.toContain('<m:oMath xmlns')
  })

  it('页眉：替换文字（含转义），设置的图片写入，未设置的删除', async () => {
    const { header, headerRels, zip } = await exportParts(await bundleWithHeader(), 'teacher')
    expect(header).toContain('左侧&lt;文字&gt;')
    expect(header).toContain('高二物理(教案)')
    expect(header).not.toContain('{{')
    expect(header).toContain('name="tp:logo"')
    expect(header).toContain('cx="900000" cy="300000"')
    expect(header).not.toContain('tp:watermark') // 未设置水印
    expect(header).not.toContain('tp:phone-icon') // 电话为空，图标一并删除
    const targets = [...headerRels.matchAll(/Target="([^"]+)"/g)].map((m) => m[1]!)
    for (const t of targets) if (t.startsWith('media/')) expect(zip.file(`word/${t}`)).not.toBeNull()
  })

  it('文档标题写入属性', async () => {
    const { core } = await exportParts(await bundleWithHeader(), 'teacher')
    expect(core).toContain('<dc:title>测试 &amp; 专题</dc:title>')
  })

  it('题图：右侧环绕与嵌入图片写入关系与内容类型', async () => {
    const bundle = await bundleWithHeader()
    const fig = await createAsset(new Uint8Array([...PNG, 1]), 'image/png')
    bundle.assets[fig.id] = fig
    const q = bundle.project.blocks[1]!
    if (q.type !== 'question') throw new Error()
    q.question.figures = [
      { assetId: fig.id, widthEmu: 1800000, heightEmu: 900000, placement: 'right' },
      { assetId: fig.id, widthEmu: 1800000, heightEmu: 900000, placement: 'below' }
    ]
    const { doc, rels, zip } = await exportParts(bundle, 'student')
    // 与用户在 WPS 中正常显示的文档写法一致：两侧环绕、水平位置用数值、允许重叠（WPS 不认 wrapText="left"）
    expect(doc).toContain('<wp:wrapSquare wrapText="bothSides"/>')
    expect(doc).not.toContain('<wp:align>')
    expect(doc).toMatch(/<wp:anchor [^>]*distL="114300" distR="114300"[^>]*allowOverlap="1">/)
    // 贴右边：距栏左侧 = 栏宽 − 图宽
    expect(doc).toContain(`<wp:positionH relativeFrom="column"><wp:posOffset>${10466 * 635 - 1800000}</wp:posOffset></wp:positionH>`)
    expect(doc).toContain('<wp:inline')
    expect(rels.match(/rIdTp\d+/g)).toHaveLength(1) // 同一张图只存一份
    const types = await zip.file('[Content_Types].xml')!.async('string')
    expect(types).toMatch(/Extension="png"/i)
  })

  it('Word 不支持的图片格式给出明确提示', async () => {
    const bundle = await bundleWithHeader()
    const svg = await createAsset(new TextEncoder().encode('<svg/>'), 'image/svg+xml')
    bundle.assets[svg.id] = svg
    bundle.project.blocks.push({ id: 'p', type: 'paragraph', content: [{ inlines: [{ type: 'image', assetId: svg.id, widthEmu: 1, heightEmu: 1 }] }] })
    await expect(exportParts(bundle, 'student')).rejects.toThrow(DocxExportError)
  })

  it('样例教案：导入后导出，20 道题与全部公式保留', async () => {
    const imported = await importDocx(new Uint8Array(readFileSync('reference/samples/2026秋季高二物理敏思_动态圆专题/教案_T_动态圆专题.docx')))
    const bundle = createEmptyBundle()
    bundle.project.blocks = imported.blocks
    Object.assign(bundle.assets, imported.assets)
    const { doc } = await exportParts(bundle, 'teacher')
    const questionStyle = doc.match(/<w:pStyle w:val="10"\/>/g) ?? []
    expect(questionStyle).toHaveLength(20)
    expect((doc.match(/<m:oMath>/g) ?? []).length).toBe(271)
  })
})

describe('LaTeX → OMML', () => {
  it.each([
    ['\\frac{5}{4}t_0', '<m:f>'],
    ['\\sqrt{3}', '<m:rad>'],
    ['\\vec{F}', '<m:acc>'],
    ['\\sum_{i=1}^{n} i', '<m:nary>'],
    ['\\left(\\frac{a}{b}\\right)', '<m:d>'],
    ['\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '<m:m>']
  ])('%s', (latex, element) => {
    const omml = latexToOmml(latex)
    expect(omml).toContain(element)
    // 往返：转回 MathML 不应有不认识的结构
    expect(ommlToMathml(omml).unknown).toEqual([])
  })

  it('LaTeX 有误时抛出异常（导出时会改为红色文字）', () => {
    expect(() => latexToOmml('\\frac{1}{')).toThrow()
  })
})

describe('导出：变式题题号', () => {
  it('变式题取消自动编号，题号“a.”写成文字加制表符；普通题仍用自动编号', async () => {
    const bundle = createEmptyBundle()
    bundle.project.blocks = [
      { id: newId(), type: 'question', question: createQuestion({ kind: 'solve', stem: [para('例题')] }) },
      { id: newId(), type: 'question', question: createQuestion({ kind: 'solve', stem: [para('变式一')], numberStyle: 'variant' }) }
    ]
    const { doc } = await exportParts(bundle, 'student')
    const paras = doc.split('<w:p>').filter((p) => p.includes('例题') || p.includes('变式一'))
    expect(paras).toHaveLength(2)
    expect(paras[0]).not.toContain('<w:t xml:space="preserve">1.</w:t>')
    expect(paras[0]).not.toContain('w:numId w:val="0"')
    expect(paras[1]).toContain('<w:numId w:val="0"/>')
    expect(paras[1]).toMatch(/<w:t[^>]*>a\.<\/w:t><\/w:r><w:r><w:tab\/><\/w:r>/)
    expect(paras[1]).toContain('<w:ind w:left="333" w:hanging="394"/>')
  })
})

describe('WPS 兼容：含浮动图片的段落不写“段中不分页”', async () => {
  const { writeDocx } = await import('@core/export/docx-writer')
  it('整题同页时，浮动图片所在段落只有“与下段同页”，其他段落照常', async () => {
    const png = await createAsset(new Uint8Array(readFileSync('resources/templates/physics-default/header/phone-icon.png')), 'image/png')
    const ir = {
      variant: 'student' as const,
      page: A4_PAGE,
      header: { left: '', phone: '', right: '' },
      bodyTopTwip: 0,
      paragraphs: [
        { key: 'a', sourceBlockId: 'q', style: 'question' as const, keepNext: true, keepLines: true, runs: [{ kind: 'text' as const, text: '题干' }], floatingImages: [{ assetId: png.id, widthEmu: 100, heightEmu: 100, side: 'right' as const, edgeEmu: 0, offsetYEmu: 0, movable: 'vertical' as const }] },
        { key: 'b', sourceBlockId: 'q', style: 'option' as const, keepNext: true, keepLines: true, runs: [{ kind: 'text' as const, text: 'A．选项' }] }
      ]
    }
    const bytes = await writeDocx({ ir: ir as never, assets: { [png.id]: png }, title: 't', template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx')) })
    const doc = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    const paras = doc.match(/<w:p>.*?<\/w:p>/gs) ?? []
    const withImage = paras.find((p) => p.includes('<wp:anchor'))!
    const option = paras.find((p) => p.includes('A．选项'))!
    expect(withImage).toContain('<w:keepNext/>')
    expect(withImage).not.toContain('<w:keepLines/>')
    expect(option).toContain('<w:keepLines/>')
  })
})

describe('答案、解析插图导出', () => {
  it('教师版写入图片（下方与右侧环绕），学生版不写', async () => {
    const bundle = createEmptyBundle()
    const a = await createAsset(new Uint8Array([...PNG, 7]), 'image/png')
    const b = await createAsset(new Uint8Array([...PNG, 8]), 'image/png')
    bundle.assets[a.id] = a
    bundle.assets[b.id] = b
    bundle.project.blocks = [{
      id: newId(), type: 'question',
      question: createQuestion({
        kind: 'solve', stem: [para('题干')], answer: [para('答案')], analysis: [para('解析')],
        answerFigures: [{ assetId: a.id, widthEmu: 1800000, heightEmu: 900000, placement: 'below', anchorParagraph: 0 }],
        analysisFigures: [{ assetId: b.id, widthEmu: 1800000, heightEmu: 900000, placement: 'right', anchorParagraph: 0 }]
      })
    }]
    const t = await exportParts(bundle, 'teacher')
    expect((t.doc.match(/<w:drawing>/g) ?? []).length).toBe(2)
    expect(t.doc).toContain('<wp:anchor')
    const s = await exportParts(bundle, 'student')
    expect(s.doc).not.toContain('<w:drawing>')
  })
})

describe('允许跨页导出：选择题多行选项不强行同页', () => {
  it('题干保留 keepNext，多行选项段落不写 keepNext 但保留 keepLines', async () => {
    const bundle = createEmptyBundle()
    bundle.project.blocks = [{
      id: newId(),
      type: 'question',
      question: createQuestion({
        stem: [para('跨页选择题题干')],
        options: ['A', 'B', 'C', 'D'].map((label, i) => ({ label, content: para(`选项第${i + 1}行`) })),
        layout: { optionColumns: 1, keepTogether: 'never' }
      })
    }]
    const { doc } = await exportParts(bundle, 'student')
    const paras = doc.match(/<w:p>.*?<\/w:p>/gs) ?? []
    const stem = paras.find((p) => p.includes('跨页选择题题干'))!
    const optA = paras.find((p) => p.includes('选项第1行'))!
    const optB = paras.find((p) => p.includes('选项第2行'))!
    expect(stem).toContain('<w:keepNext/>')
    expect(stem).toContain('<w:keepLines/>')
    expect(optA).not.toContain('<w:keepNext/>')
    expect(optA).toContain('<w:keepLines/>')
    expect(optB).not.toContain('<w:keepNext/>')
    expect(optB).toContain('<w:keepLines/>')
  })
})
