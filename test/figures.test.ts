import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '@core/document/build'
import { writeDocx } from '@core/export/docx-writer'
import { importDocx } from '@core/import/import-docx'
import { createEmptyProject, createKnowledge, createQuestion, para } from '@core/model/factory'
import type { Project, QuestionFigure } from '@core/model/types'
import { createAsset } from '@core/project-file/codec'

const fig = (placement: QuestionFigure['placement'], extra: Partial<QuestionFigure> = {}): QuestionFigure => ({
  assetId: `img-${placement}`,
  widthEmu: 900000,
  heightEmu: 600000,
  placement,
  ...extra
})

function questionProject(figures: QuestionFigure[], withSubs = true): Project {
  const p = createEmptyProject()
  p.blocks = [
    {
      id: 'q',
      type: 'question',
      question: createQuestion({
        stem: [para('题干第一段'), para('题干第二段')],
        options: ['A', 'B', 'C', 'D'].map((label) => ({ label, content: para('选项') })),
        subQuestions: withSubs
          ? [
              { id: 's1', content: [para('小问一')] },
              { id: 's2', content: [para('小问二')] }
            ]
          : [],
        figures
      })
    }
  ]
  return p
}

/** 每段的简写：样式 + 图片位置 */
function outline(p: Project): string[] {
  return buildDocument(p, 'student').paragraphs.map((x) => {
    const img = x.runs.filter((r) => r.kind === 'image').map((r) => (r.kind === 'image' ? r.assetId : '')).join('+')
    const floats = (x.floatingImages ?? []).map((f) => ` ⟶${f.movable === 'free' ? '自由' : '右'}:${f.assetId}`).join('')
    return `${x.style}${img ? `[${img}]` : ''}${floats}`
  })
}

describe('题目图片的位置', () => {
  it('题干下方 / 第 N 小问下方 / 全部题目文字下方', () => {
    const p = questionProject([fig('below'), fig('below-item', { anchorItem: 0 }), fig('below-all')])
    expect(outline(p)).toEqual([
      'question',
      'questionContinued',
      'body[img-below]',
      'option',
      'subQuestion',
      'body[img-below-item]',
      'subQuestion',
      'body[img-below-all]'
    ])
  })

  it('题干右侧锚定在指定段落；位于选项/小问右侧挂在第一个选项行，选项改为每行 1 项', () => {
    const p = questionProject([fig('right', { anchorParagraph: 1 }), fig('right-items')], false)
    expect(outline(p)).toEqual([
      'question',
      'questionContinued ⟶右:img-right',
      'option ⟶右:img-right-items',
      'option',
      'option',
      'option'
    ])
  })

  it('自由位置：挤开文字的浮动图，按中心所在的半边决定靠哪一侧', () => {
    const p = questionProject(
      [
        fig('free', { anchorParagraph: 1, offsetXEmu: 100, offsetYEmu: 200 }),
        { ...fig('free', { offsetXEmu: 5000000, offsetYEmu: 0 }), assetId: 'img-r' }
      ],
      false
    )
    const ir = buildDocument(p, 'student')
    expect(ir.paragraphs[1]!.floatingImages).toEqual([
      { assetId: 'img-free', widthEmu: 900000, heightEmu: 600000, side: 'left', edgeEmu: 100, offsetYEmu: 200, movable: 'free', ref: { blockId: 'q', figureIndex: 0 } }
    ])
    const r = ir.paragraphs[0]!.floatingImages![0]!
    expect([r.side, r.edgeEmu]).toEqual(['right', 10466 * 635 - 5000000 - 900000])
  })

  it('右侧图可上下移动：带上下偏移', () => {
    const p = questionProject([fig('right', { offsetYEmu: 360000 })], false)
    const f = buildDocument(p, 'student').paragraphs[0]!.floatingImages![0]!
    expect([f.side, f.edgeEmu, f.offsetYEmu, f.movable]).toEqual(['right', 0, 360000, 'vertical'])
  })

  it('题干段落带锚定序号，供预览中拖动时改换段落', () => {
    const ir = buildDocument(questionProject([], false), 'student')
    expect(ir.paragraphs.map((x) => x.anchorIndex)).toEqual([0, 1, undefined]) // 题干两段 + 一行四个选项
  })

  it('同一位置的多张图放在同一段里并排', () => {
    const p = questionProject([fig('below-all'), { ...fig('below-all'), assetId: 'img-2' }], false)
    expect(outline(p).at(-1)).toBe('body[img-below-all+img-2]')
  })
})

describe('知识点的插图与段落设置', () => {
  it('插图紧跟锚定段落；段后空行与段前换页', () => {
    const p = createEmptyProject()
    const k = createKnowledge({
      title: '一、标题',
      content: [para('第一段'), { ...para('第二段'), format: { spaceAfterLines: 3 } }, { ...para('第三段'), format: { pageBreakBefore: true } }],
      figures: [fig('below', { anchorParagraph: 0 }), fig('right', { anchorParagraph: 2 })]
    })
    p.blocks = [k]
    const ir = buildDocument(p, 'student')
    expect(ir.paragraphs.map((x) => [x.style, x.spacerTwip ?? 0, x.pageBreakBefore ?? false, x.floatingImages?.[0]?.assetId ?? ''])).toEqual([
      ['topic', 0, false, ''],
      ['body', 0, false, ''],
      ['body', 0, false, ''], // 第一段之后的插图
      ['body', 0, false, ''],
      ['body', 3 * 312, false, ''], // 段后空行
      ['body', 0, true, 'img-right'] // 第三段：换页，右侧有图
    ])
    expect(ir.paragraphs[2]!.runs[0]).toMatchObject({ kind: 'image', ref: { blockId: k.id, figureIndex: 0 } })
  })
})

describe('导出自由位置的图片', () => {
  it('写为四周型环绕、按栏左侧与段落顶端定位的图片', async () => {
    const png = await createAsset(new Uint8Array(readFileSync('resources/templates/physics-default/header/phone-icon.png')), 'image/png')
    const p = questionProject([{ ...fig('free', { offsetXEmu: 1234, offsetYEmu: 5678 }), assetId: png.id }], false)
    const bytes = await writeDocx({
      ir: buildDocument(p, 'student'),
      assets: { [png.id]: png },
      title: 't',
      template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
    })
    const doc = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(doc).toContain('<wp:wrapSquare wrapText="bothSides"/>')
    expect(doc).toContain('<wp:positionH relativeFrom="column"><wp:posOffset>1234</wp:posOffset></wp:positionH>')
    expect(doc).toContain('<wp:positionV relativeFrom="paragraph"><wp:posOffset>5678</wp:posOffset></wp:positionV>')
  })
})

describe('导入：知识点中的图片成为可编辑的插图', async () => {
  const r = await importDocx(
    new Uint8Array(readFileSync('reference/samples/2026秋季高二物理敏思_带电粒子在磁场中的运动/教案_T_带电粒子在磁场中的运动.docx'))
  )
  it('“二、圆周运动的三个确定”中的 4 张图都是插图，正文中不再有行内图片', () => {
    const k = r.blocks.find((b) => b.type === 'knowledge' && b.title.startsWith('二、'))
    if (k?.type !== 'knowledge') throw new Error('缺少知识点')
    expect(k.figures.map((f) => [f.placement, f.anchorParagraph])).toEqual([
      ['below', 2],
      ['below', 5],
      ['below', 9],
      ['below', 9]
    ])
    expect(JSON.stringify(k.content)).not.toContain('"image"')
  })
})

describe('图片居中与右侧图旁的 2/4 列选项自适应间距', () => {
  it('图片位置设为 center 时，预览与导出 Word 都居中对齐', async () => {
    const png = await createAsset(new Uint8Array(readFileSync('resources/templates/physics-default/header/phone-icon.png')), 'image/png')
    const p = questionProject([{ ...fig('center'), assetId: png.id }], false)
    const ir = buildDocument(p, 'student')
    const imgPara = ir.paragraphs.find((dp) => dp.runs.some((r) => r.kind === 'image'))!
    expect(imgPara.align).toBe('center')
    const bytes = await writeDocx({
      ir,
      assets: { [png.id]: png },
      title: 't',
      template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
    })
    const doc = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:jc w:val="center"/>')
  })

  it('选择题右侧有图且每行 2 项或 4 项时，制表位按图片宽度自适应缩进，不超出图左侧边界', () => {
    // 2 cm 宽的右侧图（约 1134 twip + 180 twip 间距 = 1314 twip，右侧边界约 9152 twip）
    const p2 = questionProject([fig('right', { widthEmu: 720000 })], false)
    const q2 = p2.blocks[0]!
    if (q2.type !== 'question') throw new Error()
    q2.question.layout.optionColumns = 2
    const ir2 = buildDocument(p2, 'student')
    const opt2 = ir2.paragraphs.find((dp) => dp.style === 'option')!
    expect(opt2.tabStopsTwip).toHaveLength(1)
    expect(opt2.tabStopsTwip![0]!).toBeLessThan(5233)

    const p4 = questionProject([fig('right', { widthEmu: 720000 })], false)
    const q4 = p4.blocks[0]!
    if (q4.type !== 'question') throw new Error()
    q4.question.layout.optionColumns = 4
    const ir4 = buildDocument(p4, 'student')
    const opt4 = ir4.paragraphs.find((dp) => dp.style === 'option')!
    expect(opt4.tabStopsTwip).toHaveLength(3)
    expect(opt4.tabStopsTwip![2]!).toBeLessThan(7970)
  })
})

describe('图片上下间距与多图换行分段', () => {
  it('单张非环绕插图段落带有与题目一致的 120 twip 上下间距，并在 Word 导出时写入 spacing', async () => {
    const png = await createAsset(new Uint8Array(readFileSync('resources/templates/physics-default/header/phone-icon.png')), 'image/png')
    const p = questionProject([{ ...fig('below-all'), assetId: png.id }], false)
    const ir = buildDocument(p, 'student')
    const imgPara = ir.paragraphs.find((dp) => dp.runs.some((r) => r.kind === 'image'))!
    expect(imgPara.spaceBeforeTwip).toBe(120)
    expect(imgPara.spaceAfterTwip).toBe(120)

    const bytes = await writeDocx({
      ir,
      assets: { [png.id]: png },
      title: 't',
      template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
    })
    const doc = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(doc).toContain('<w:spacing w:before="120" w:after="120"/>')
  })

  it('两张超宽大图自动拆成两个独立图片段（首段 120/120，次段 0/120）避免上下紧贴；两张窄图仍并排', () => {
    // 栏宽约 10466 * 635 = 6,645,910 EMU，每张 4,500,000 EMU 两张超宽需拆行
    const wide = questionProject([fig('below-all', { widthEmu: 4500000 }), { ...fig('below-all', { widthEmu: 4500000 }), assetId: 'img-w2' }], false)
    const imgParas = buildDocument(wide, 'student').paragraphs.filter((dp) => dp.runs.some((r) => r.kind === 'image'))
    expect(imgParas).toHaveLength(2)
    expect([imgParas[0]!.spaceBeforeTwip, imgParas[0]!.spaceAfterTwip]).toEqual([120, 120])
    expect([imgParas[1]!.spaceBeforeTwip, imgParas[1]!.spaceAfterTwip]).toEqual([0, 120])

    // 窄图（900,000 EMU）仍放在同一段并排
    const narrow = questionProject([fig('below-all'), { ...fig('below-all'), assetId: 'img-n2' }], false)
    const narrowParas = buildDocument(narrow, 'student').paragraphs.filter((dp) => dp.runs.some((r) => r.kind === 'image'))
    expect(narrowParas).toHaveLength(1)
    expect([narrowParas[0]!.spaceBeforeTwip, narrowParas[0]!.spaceAfterTwip]).toEqual([120, 120])
  })
})
