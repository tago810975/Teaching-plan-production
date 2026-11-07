/**
 * Word 常用长度单位换算。
 *
 *   twip（缇） = 1/20 磅，段落间距、缩进、页面尺寸使用
 *   半磅       = 1/2 磅，字号使用（21 = 10.5pt = 五号）
 *   EMU        = 1/914400 英寸，图片尺寸使用
 */

export type CSSLength = `${number}pt` | `${number}px` | `${number}mm`

export const twipToPt = (twip: number): number => twip / 20
export const halfPtToPt = (halfPt: number): number => halfPt / 2
export const emuToPt = (emu: number): number => emu / 12700
export const emuToTwip = (emu: number): number => emu / 635
export const cmToEmu = (cm: number): number => Math.round(cm * 360000)
export const twipToMm = (twip: number): number => (twip / 1440) * 25.4

/** A4 纵向，页边距 720 twip（1.27 cm），与参考样例一致 */
export const A4_PAGE = Object.freeze({
  widthTwip: 11906,
  heightTwip: 16838,
  marginTopTwip: 720,
  marginBottomTwip: 720,
  marginLeftTwip: 720,
  marginRightTwip: 720
})

export type PageSetup = typeof A4_PAGE

export const contentWidthTwip = (page: PageSetup): number =>
  page.widthTwip - page.marginLeftTwip - page.marginRightTwip
