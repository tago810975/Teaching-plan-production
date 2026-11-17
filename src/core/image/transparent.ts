/**
 * 去白底（插图处理）：白色变为透明。
 */
import type { Pixels } from './enhance'

/**
 * 去白底：白色变为透明（color to alpha）。按每个像素偏离白色的程度定不透明度、再把颜色还原，
 * 叠在白底上与原图一样；线条边缘的过渡变为半透明，放在任何底色上都没有白边。接近白色（亮度 ≥ 232）的先当作纯白。
 * 偏离白色达 OPAQUE_AT 以上的完全不透明、颜色不变（较浅的彩色线条在有底色处也是实色）。
 */
const OPAQUE_AT = 0.6
/* 说明：不透明度 a' = min(1, a / OPAQUE_AT)，颜色 c' = 255 − (255 − c) / a'，叠在白底上仍为 c。 */
export function whiteToAlpha(img: Pixels): Pixels {
  const { data, width: W, height: H } = img
  const n = W * H
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    let R = data[i * 4]!
    let G = data[i * 4 + 1]!
    let B = data[i * 4 + 2]!
    const A0 = data[i * 4 + 3]! / 255
    const l = (R + G + B) / 3
    if (l >= 232) {
      // 纸色附近：渐变到纯白（避免纸张留下一层淡淡的半透明）
      const w = Math.min(1, (l - 232) / 12)
      R += (255 - R) * w
      G += (255 - G) * w
      B += (255 - B) * w
    }
    const a = Math.min(1, Math.max(255 - R, 255 - G, 255 - B) / 255 / OPAQUE_AT)
    if (a < 0.03) continue
    out[i * 4] = 255 - (255 - R) / a
    out[i * 4 + 1] = 255 - (255 - G) / a
    out[i * 4 + 2] = 255 - (255 - B) / a
    out[i * 4 + 3] = Math.round(a * A0 * 255)
  }
  return { data: out, width: W, height: H }
}
