import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '@core/document/build'
import { resolveOptionColumns } from '@core/document/build'
import { importDocx } from '@core/import/import-docx'
import { createEmptyProject, createQuestion, newId } from '@core/model/factory'
import {
  OPTION_IMAGE_MAX_WIDTH_EMU,
  OPTION_IMAGE_MIN_EMU,
  optionImages,
  optionImageSignature,
  resizeOptionImage,
  scaleOptionImages,
  unifyOptionImages
} from '@core/model/option-images'
import type { ImageInline, Question, QuestionBlock } from '@core/model/types'

const CM = 360000
const img = (w: number, h: number): ImageInline => ({ type: 'image', assetId: 'a', widthEmu: Math.round(w * CM), heightEmu: Math.round(h * CM) })

function imageQuestion(sizes: Array<[number, number]>): Question {
  return createQuestion({
    kind: 'single-choice',
    options: sizes.map(([w, h], i) => ({ label: String.fromCharCode(65 + i), content: { inlines: [img(w, h)] } }))
  })
}

const dims = (q: Question): Array<[number, number]> => optionImages(q).map((x) => [x.image.widthEmu, x.image.heightEmu])
const ratio = (x: ImageInline): number => x.heightEmu / x.widthEmu

describe('选项图片：单张缩放', () => {
  it('只改指定选项的图片，等比例', () => {
    const q = imageQuestion([[3, 2], [3, 2], [3, 2], [3, 2]])
    const next = resizeOptionImage(q, { option: 2, inline: 0 }, 4.5 * CM)
    const d = dims(next)
    expect(d[2]).toEqual([4.5 * CM, 3 * CM])
    expect([d[0], d[1], d[3]]).toEqual([dims(q)[0], dims(q)[1], dims(q)[3]])
    // 未改动的选项对象保持原引用（不可变更新）
    expect(next.options[0]).toBe(q.options[0])
  })

  it('不小于 0.5 厘米，不超过栏宽', () => {
    const q = imageQuestion([[3, 2]])
    const tiny = optionImages(resizeOptionImage(q, { option: 0, inline: 0 }, 1000))[0]!.image
    expect(Math.min(tiny.widthEmu, tiny.heightEmu)).toBeGreaterThanOrEqual(OPTION_IMAGE_MIN_EMU - 1)
    const huge = optionImages(resizeOptionImage(q, { option: 0, inline: 0 }, 100 * CM))[0]!.image
    expect(huge.widthEmu).toBe(OPTION_IMAGE_MAX_WIDTH_EMU)
  })

  it('选项中文字与图片混排时，按行内元素序号定位', () => {
    const q = createQuestion({
      options: [{ label: 'A', content: { inlines: [{ type: 'text', text: '甲' }, img(2, 2), { type: 'text', text: '乙' }, img(2, 1)] } }]
    })
    const next = resizeOptionImage(q, { option: 0, inline: 3 }, 4 * CM)
    expect(dims(next)).toEqual([[2 * CM, 2 * CM], [4 * CM, 2 * CM]])
  })
})

describe('选项图片：全部一起缩放', () => {
  it('同一比例缩放，大小关系与各自宽高比不变', () => {
    const q = imageQuestion([[2.75, 2.54], [2.88, 2.67], [2.7, 2.49], [2.91, 2.7]])
    const next = scaleOptionImages(q, 1.2)
    optionImages(next).forEach((x, i) => {
      const before = optionImages(q)[i]!.image
      expect(x.image.widthEmu).toBe(Math.round(before.widthEmu * 1.2))
      expect(ratio(x.image)).toBeCloseTo(ratio(before), 3)
    })
  })

  it('无效比例不改动', () => {
    const q = imageQuestion([[3, 2]])
    expect(scaleOptionImages(q, 0)).toBe(q)
    expect(scaleOptionImages(q, Number.NaN)).toBe(q)
  })
})

describe('选项图片：统一大小', () => {
  it('宽高比相同的图变得完全一样大（以第一张为准）', () => {
    const q = imageQuestion([[4, 3], [2, 1.5], [6, 4.5], [3.2, 2.4]])
    expect(new Set(dims(unifyOptionImages(q)).map((d) => d.join('x')))).toEqual(new Set([`${4 * CM}x${3 * CM}`]))
  })

  it('可指定基准；宽高比不同的图放进基准的宽高之内，不变形', () => {
    // 期中试卷分析第 15 题的四个选项图
    const q = imageQuestion([[4.26, 3.86], [5.03, 4.0], [4.63, 3.81], [3.84, 3.44]])
    const ref = optionImages(q)[3]!.image
    const next = unifyOptionImages(q, { option: 3, inline: 0 })
    optionImages(next).forEach((x, i) => {
      const before = optionImages(q)[i]!.image
      expect(ratio(x.image)).toBeCloseTo(ratio(before), 2)
      expect(x.image.widthEmu).toBeLessThanOrEqual(ref.widthEmu + 1)
      expect(x.image.heightEmu).toBeLessThanOrEqual(ref.heightEmu + 1)
      // 宽或高至少有一边与基准相同
      expect(Math.min(Math.abs(x.image.widthEmu - ref.widthEmu), Math.abs(x.image.heightEmu - ref.heightEmu))).toBeLessThanOrEqual(1)
    })
  })

  it('没有图片时原样返回', () => {
    const q = createQuestion({ options: [{ label: 'A', content: { inlines: [{ type: 'text', text: '甲' }] } }] })
    expect(unifyOptionImages(q)).toBe(q)
    expect(optionImageSignature(q)).toBe('')
  })
})

describe('选项图片：排版与预览', () => {
  it('选项中的图片带有位置，预览据此回写', () => {
    const p = createEmptyProject()
    const block: QuestionBlock = { id: newId(), type: 'question', question: imageQuestion([[3, 2], [3, 2], [3, 2], [3, 2]]) }
    p.blocks = [block]
    const runs = buildDocument(p, 'student').paragraphs.filter((x) => x.style === 'option').flatMap((x) => x.runs)
    const refs = runs.flatMap((r) => (r.kind === 'image' ? [r.optionRef] : []))
    expect(refs).toEqual([0, 1, 2, 3].map((option) => ({ blockId: block.id, option, inline: 0 })))
  })

  it('整体缩小后，自动分列可以从每行 2 项变为每行 4 项', () => {
    const q = imageQuestion([[5.11, 4.13], [5.11, 4.13], [5.11, 4.13], [5.11, 4.13]])
    expect(resolveOptionColumns(q.options, 'auto')).toBe(2)
    expect(resolveOptionColumns(scaleOptionImages(q, 0.4).options, 'auto')).toBe(4)
  })

  it('样例中的图片选项题：统一大小后各图宽高比不变、都放进基准框内', async () => {
    const r = await importDocx(new Uint8Array(readFileSync('reference/samples/2026秋季高二物理东湖_期中试卷分析/教案_T_期中试卷分析.docx')))
    const qs = r.blocks.flatMap((b) => (b.type === 'question' ? [b] : b.type === 'composite' ? b.items : []))
    const withImages = qs.filter((b) => optionImages(b.question).length > 0)
    expect(withImages.length).toBe(4)
    for (const b of withImages) {
      const next = unifyOptionImages(b.question)
      const ref = optionImages(b.question)[0]!.image
      for (const x of optionImages(next)) {
        expect(x.image.widthEmu).toBeLessThanOrEqual(ref.widthEmu + 1)
        expect(x.image.heightEmu).toBeLessThanOrEqual(ref.heightEmu + 1)
      }
    }
  })
})

describe('选项图片：导出', () => {
  it('缩放后的尺寸写入 Word', async () => {
    const { default: JSZip } = await import('jszip')
    const { writeDocx } = await import('@core/export/docx-writer')
    const { createAsset } = await import('@core/project-file/codec')
    // 1×1 的 PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const asset = await createAsset(png, 'image/png')
    const q = imageQuestion([[3, 2], [3, 2]])
    q.options = q.options.map((o) => ({ ...o, content: { inlines: [{ ...(o.content.inlines[0] as ImageInline), assetId: asset.id }] } }))
    const p = createEmptyProject()
    p.blocks = [{ id: newId(), type: 'question', question: scaleOptionImages(q, 0.5) }]
    const bytes = await writeDocx({
      ir: buildDocument(p, 'student'),
      assets: { [asset.id]: asset },
      title: 't',
      template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx'))
    })
    const doc = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    expect(doc.match(/<wp:extent cx="540000" cy="360000"\/>/g)?.length).toBe(2)
  })
})
