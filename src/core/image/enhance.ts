/**
 * 插图变清晰（不改变内容）：清理纸张底色 → FSRCNN 放大 3 倍。
 *
 * 清理：按估计的纸张底色逐通道归一，接近纸色的压成纯白，深色线条略加深；填充色、彩色保留。底色只取接近纸张亮度的值，
 *   大块深色填充（如磁铁）不会被当成底色提亮。放大：亮度用 FSRCNN，颜色通道双线性。
 * 选型与对比见 docs/图片导入.md（矢量描摹会丢细线和文字，AI 重绘不能保证还原，大型模型太慢）。
 */
import { fsrcnnY } from './fsrcnn'
import { whiteToAlpha } from './transparent'

export interface Pixels {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

/** 一维滑动窗口最大 / 最小（单调队列） */
function slide(src: Float32Array, dst: Float32Array, len: number, stride: number, offset: number, r: number, max: boolean): void {
  const q: number[] = []
  let head = 0
  const val = (i: number): number => src[offset + i * stride]!
  for (let i = 0; i < len + r; i++) {
    if (i < len) {
      const v = val(i)
      while (q.length > head && (max ? val(q[q.length - 1]!) <= v : val(q[q.length - 1]!) >= v)) q.pop()
      q.push(i)
    }
    const c = i - r
    if (c >= 0) {
      while (q[head]! < c - r) head++
      dst[offset + c * stride] = val(q[head]!)
    }
  }
}

/** 方形窗口的最大 / 最小滤波（先横后纵） */
function minmax(src: Float32Array, W: number, H: number, r: number, max: boolean): Float32Array {
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) slide(src, tmp, W, 1, y * W, r, max)
  for (let x = 0; x < W; x++) slide(tmp, out, H, W, x, r, max)
  return out
}

function gaussian(src: Float32Array, W: number, H: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))
  for (let i = 0; i < k.length; i++) k[i]! /= sum
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += k[i + r]! * src[y * W + Math.min(W - 1, Math.max(0, x + i))]!
      tmp[y * W + x] = s
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += k[i + r]! * tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x]!
      out[y * W + x] = s
    }
  }
  return out
}

/** 清理纸张底色（保留填充与彩色） */
export function cleanBackground(img: Pixels): Pixels {
  const { data, width: W, height: H } = img
  const n = W * H
  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) gray[i] = (data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]!) / 3
  // 纸张底色：闭运算（去掉细线）后模糊；只取接近纸张亮度的值
  const k = Math.max(15, Math.floor(Math.min(W, H) * 0.08) | 1)
  const r = k >> 1
  let bg = minmax(minmax(gray, W, H, r, true), W, H, r, false)
  bg = gaussian(bg, W, H, k / 3)
  const sorted = Float32Array.from(gray).sort()
  const paper = sorted[Math.floor(sorted.length * 0.9)] ?? 255
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const b = Math.max(1, Math.min(255, Math.max(bg[i]!, paper * 0.88)))
    let R = Math.min(255, (data[i * 4]! / b) * 250)
    let G = Math.min(255, (data[i * 4 + 1]! / b) * 250)
    let B = Math.min(255, (data[i * 4 + 2]! / b) * 250)
    const lum = (R + G + B) / 3
    // 接近纸色（> 215）渐变到纯白；深色（< 120）加深最多 30%；中间调不动
    const w = Math.min(1, Math.max(0, (lum - 215) / 20))
    R = R * (1 - w) + 255 * w
    G = G * (1 - w) + 255 * w
    B = B * (1 - w) + 255 * w
    const d = Math.min(1, Math.max(0, (120 - lum) / 120))
    const f = 1 - 0.3 * d
    out[i * 4] = R * f
    out[i * 4 + 1] = G * f
    out[i * 4 + 2] = B * f
    out[i * 4 + 3] = 255
  }
  return { data: out, width: W, height: H }
}

/** FSRCNN 放大 3 倍（亮度用模型，颜色双线性；YCrCb 换算与 OpenCV 一致） */
export function upscale3(img: Pixels): Pixels {
  const { data, width: W, height: H } = img
  const n = W * H
  const Y = new Float32Array(n)
  const Cr = new Float32Array(n)
  const Cb = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const R = data[i * 4]!
    const G = data[i * 4 + 1]!
    const B = data[i * 4 + 2]!
    const y = 0.299 * R + 0.587 * G + 0.114 * B
    Y[i] = Math.round(y) / 255
    Cr[i] = (R - y) * 0.713 + 128
    Cb[i] = (B - y) * 0.564 + 128
  }
  const Y3 = fsrcnnY(Y, W, H)
  const OW = W * 3
  const OH = H * 3
  const out = new Uint8ClampedArray(OW * OH * 4)
  const bilinear = (ch: Float32Array, x: number, y: number): number => {
    const fx = Math.min(W - 1, Math.max(0, (x + 0.5) / 3 - 0.5))
    const fy = Math.min(H - 1, Math.max(0, (y + 0.5) / 3 - 0.5))
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = Math.min(W - 1, x0 + 1)
    const y1 = Math.min(H - 1, y0 + 1)
    const ax = fx - x0
    const ay = fy - y0
    return (ch[y0 * W + x0]! * (1 - ax) + ch[y0 * W + x1]! * ax) * (1 - ay) + (ch[y1 * W + x0]! * (1 - ax) + ch[y1 * W + x1]! * ax) * ay
  }
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const yy = Y3[y * OW + x]! * 255
      const cr = bilinear(Cr, x, y) - 128
      const cb = bilinear(Cb, x, y) - 128
      const o = (y * OW + x) * 4
      out[o] = yy + 1.403 * cr
      out[o + 1] = yy - 0.714 * cr - 0.344 * cb
      out[o + 2] = yy + 1.773 * cb
      out[o + 3] = 255
    }
  }
  return { data: out, width: OW, height: OH }
}

/** 放大前的最大像素数：更大的图本身已足够清楚，只清理不放大（也避免太慢） */
export const MAX_UPSCALE_PIXELS = 400 * 400

/** 处理方式：普通（清理 + 放大）或不处理（只去白底时用） */
export type EnhanceMode = 'normal' | 'none'

export interface EnhanceOptions {
  /** 去白底：白色变为透明 */
  transparent?: boolean
}

/** 插图变清晰：清理底色，较小的图再 FSRCNN 放大 3 倍；去白底时最后把白色变为透明。mode 为 'none' 时只去白底 */
export function enhanceFigure(img: Pixels, mode: EnhanceMode = 'normal', options: EnhanceOptions = {}): Pixels {
  let out: Pixels = img
  if (mode === 'normal') {
    const cleaned = cleanBackground(img)
    out = img.width * img.height <= MAX_UPSCALE_PIXELS ? upscale3(cleaned) : cleaned
  }
  return options.transparent === true ? whiteToAlpha(out) : out
}
