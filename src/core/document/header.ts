/**
 * 页眉的版式参数，取自参考样例的 header1.xml。预览与导出共用。
 */
import type { PageHeader } from '../model/types'
import type { PageSetup } from './units'

/** 页眉顶端距页面上边缘（twip） */
export const HEADER_DISTANCE_TWIP = 851
/** 页眉文字行高（9 磅字号，单倍行距） */
export const HEADER_LINE_TWIP = 312
/** 页眉与正文之间的间隙 */
const HEADER_GAP_TWIP = 160
/** 页眉第二行的制表位（相对页边距）：电话居中、右侧文字右对齐 */
export const HEADER_TAB_CENTER_TWIP = 5250
export const HEADER_TAB_RIGHT_TWIP = 10500
/** 页眉字号（半磅） */
export const HEADER_SIZE_HALF_PT = 18
/** 水印相对页边距的偏移（EMU） */
export const WATERMARK_OFFSET_EMU = Object.freeze({ x: 143510, y: 579755 })

/**
 * 正文起点（twip）。页眉高过上页边距时，Word 会把正文往下推。
 */
export function bodyTopTwip(header: PageHeader, page: PageSetup): number {
  const logoTwip = header.logo !== undefined ? header.logo.heightEmu / 635 : 0
  const headerBottom = HEADER_DISTANCE_TWIP + logoTwip + HEADER_LINE_TWIP + HEADER_GAP_TWIP
  return Math.max(page.marginTopTwip, Math.round(headerBottom))
}
