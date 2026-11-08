/**
 * 选择题中“选项是图片”的尺寸调整：单张缩放、全部一起缩放、统一大小。
 *
 * 选项图片就是选项内容里的行内图片（ImageInline），尺寸直接改在它的 widthEmu / heightEmu 上，
 * 预览、选项自动分列（resolveOptionColumns 按图片宽度估算）与 Word 导出都随之变化。
 * 所有操作都保持每张图自身的宽高比，避免示意图（圆、坐标轴）被拉变形。
 */
import { A4_PAGE, contentWidthTwip } from '../document/units'
import type { ImageInline, Question } from './types'

/** 选项中的一张图片：第几个选项、选项内容中第几个行内元素 */
export interface OptionImageAt {
  option: number
  inline: number
}

export interface OptionImage extends OptionImageAt {
  image: ImageInline
}

/** 最小宽度或高度：0.5 厘米 */
export const OPTION_IMAGE_MIN_EMU = 180000
/** 最大宽度：一栏宽 */
export const OPTION_IMAGE_MAX_WIDTH_EMU = contentWidthTwip(A4_PAGE) * 635

/** 题目选项中的全部图片，按选项顺序 */
export function optionImages(q: Question): OptionImage[] {
  const out: OptionImage[] = []
  q.options.forEach((opt, option) => {
    opt.content.inlines.forEach((inline, i) => {
      if (inline.type === 'image') out.push({ option, inline: i, image: inline })
    })
  })
  return out
}

/** 选项图片尺寸的签名：尺寸变化时据此让属性面板中的选项输入框重新读取内容 */
export function optionImageSignature(q: Question): string {
  return optionImages(q)
    .map((x) => `${x.image.widthEmu}x${x.image.heightEmu}`)
    .join(',')
}

/** 把一张图等比例缩放到指定宽度，并限制在最小尺寸与栏宽之间 */
export function fitWidth(image: ImageInline, widthEmu: number): ImageInline {
  const ratio = image.heightEmu / image.widthEmu
  // 宽、高都不小于最小尺寸，宽度不超过栏宽
  const minWidth = Math.max(OPTION_IMAGE_MIN_EMU, OPTION_IMAGE_MIN_EMU / ratio)
  const w = Math.round(Math.min(OPTION_IMAGE_MAX_WIDTH_EMU, Math.max(minWidth, widthEmu)))
  return { ...image, widthEmu: w, heightEmu: Math.round(w * ratio) }
}

function mapImages(q: Question, fn: (image: ImageInline, at: OptionImageAt) => ImageInline): Question {
  let changed = false
  const options = q.options.map((opt, option) => {
    let optChanged = false
    const inlines = opt.content.inlines.map((inline, i) => {
      if (inline.type !== 'image') return inline
      const next = fn(inline, { option, inline: i })
      if (next.widthEmu === inline.widthEmu && next.heightEmu === inline.heightEmu) return inline
      optChanged = true
      return next
    })
    if (!optChanged) return opt
    changed = true
    return { ...opt, content: { ...opt.content, inlines } }
  })
  return changed ? { ...q, options } : q
}

/** 单张缩放：把某个选项中的图片等比例调整到指定宽度 */
export function resizeOptionImage(q: Question, at: OptionImageAt, widthEmu: number): Question {
  return mapImages(q, (image, p) => (p.option === at.option && p.inline === at.inline ? fitWidth(image, widthEmu) : image))
}

/** 全部一起缩放：所有选项图片按同一比例放大或缩小，彼此的大小关系不变 */
export function scaleOptionImages(q: Question, factor: number): Question {
  if (!Number.isFinite(factor) || factor <= 0) return q
  return mapImages(q, (image) => fitWidth(image, image.widthEmu * factor))
}

/**
 * 统一大小：以某一张图（默认第一张）为准，其余每张等比例缩放到恰好放进它的宽、高之内。
 * 宽高比相同的图会变得完全一样大；宽高比略有不同的图，宽或高其中一边与基准相同，不会被拉变形。
 */
export function unifyOptionImages(q: Question, reference?: OptionImageAt): Question {
  const all = optionImages(q)
  const ref = (reference !== undefined ? all.find((x) => x.option === reference.option && x.inline === reference.inline) : undefined) ?? all[0]
  if (ref === undefined) return q
  const { widthEmu: bw, heightEmu: bh } = ref.image
  return mapImages(q, (image) => {
    const scale = Math.min(bw / image.widthEmu, bh / image.heightEmu)
    return fitWidth(image, image.widthEmu * scale)
  })
}
