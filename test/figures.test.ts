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
    const float = x.floatingImage ? ` ⟶右:${x.floatingImage.assetId}` : ''
    const free = x.freeImages?.length ? ` ⟶自由:${x.freeImages.map((f) => f.assetId).join(',')}` : ''
    return `${x.style}${img ? `[${img}]` : ''}${float}${free}`
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

  it('自由位置：挂在锚定段落上，带偏移与回写位置', () => {
    const p = questionProject([fig('free', { anchorParagraph: 1, offsetXEmu: 100, offsetYEmu: 200 })], false)
    const ir = buildDocument(p, 'student')
    const host = ir.paragraphs[1]!
    expect(host.freeImages).toEqual([
      { assetId: 'img-free', widthEmu: 900000, heightEmu: 600000, offsetXEmu: 100, offsetYEmu: 200, ref: { blockId: 'q', figureIndex: 0 } }
    ])
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
    expect(ir.paragraphs.map((x) => [x.style, x.spacerTwip ?? 0, x.pageBreakBefore ?? false, x.floatingImage?.assetId ?? ''])).toEqual([
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
  it('写为浮于文字上方、相对段落定位的图片', async () => {
    const png = await createAsset(new Uint8Array(readFileSync('resources/templates/physics-default/header/phone-icon.png')), 'image/png')
    const p = questionProject([{ ...fig('free', { offsetXEmu: 1234, offsetYEmu: 5678 }), assetId: png.id }], false)
    const bytes = await writeDocx({
      ir: buildDocument(p, 'student'),
      assets: { [png.id]: png },
      title: 't',
      template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
    })
    const doc = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(doc).toContain('<wp:wrapNone/>')
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
