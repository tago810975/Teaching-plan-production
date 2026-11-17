/**
 * 扫描件插图发灰：一键加深（autoLevels）与手动调整亮度、对比度、饱和度（adjustPixels）。透明通道不变。
 */
import type { Pixels } from './enhance'

/** 手动调整：亮度、对比度 −100～100（0 为原样）；饱和度 0～200（100 为原样，0 为黑白） */
export interface Adjust {
  brightness: number
  contrast: number
  saturation: number
}

export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 100 }

export const isNoAdjust = (a: Adjust): boolean => a.brightness === 0 && a.contrast === 0 && a.saturation === 100

/** 黑点映射到的亮度（不压到纯黑，留一点层次） */
const BLACK_TO = 25

/**
 * 一键加深：最深的线条（非纸色像素亮度的 1% 分位）拉到接近黑（25），纸色（90% 分位，不低于黑点 + 40，不高于 250）拉到纯白，
 * 中间按比例拉开；三个通道用同一映射，彩色线条色相不变、更鲜明。
 */
export function autoLevels(img: Pixels): Pixels {
  const { data, width: W, height: H } = img
  const n = W * H
  const hist = new Float64Array(256)
  const inkHist = new Float64Array(256)
  let inkCount = 0
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3]! < 128) continue
    const l = Math.round((data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]!) / 3)
    hist[l]!++
    if (l < 235) {
      inkHist[l]!++
      inkCount++
    }
  }
  if (inkCount === 0) return img
  const pct = (h: Float64Array, total: number, p: number): number => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += h[v]!
      if (acc >= total * p) return v
    }
    return 255
  }
  const total = hist.reduce((a, b) => a + b, 0)
  const lo = pct(inkHist, inkCount, 0.01)
  const paper = pct(hist, total, 0.9)
  const hi = Math.max(lo + 40, Math.min(250, paper))
  const map = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
    map[v] = BLACK_TO + t * (255 - BLACK_TO)
  }
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < n; i++) {
    out[i * 4] = map[data[i * 4]!]!
    out[i * 4 + 1] = map[data[i * 4 + 1]!]!
    out[i * 4 + 2] = map[data[i * 4 + 2]!]!
    out[i * 4 + 3] = data[i * 4 + 3]!
  }
  return { data: out, width: W, height: H }
}

/** 手动调整亮度、对比度、饱和度 */
export function adjustPixels(img: Pixels, a: Adjust): Pixels {
  if (isNoAdjust(a)) return img
  const { data, width: W, height: H } = img
  const c = Math.max(-254, Math.min(254, a.contrast * 2.55))
  const f = (259 * (c + 255)) / (255 * (259 - c))
  const b = a.brightness * 2.55
  const s = Math.max(0, a.saturation) / 100
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4]!
    const g = data[i * 4 + 1]!
    const bl = data[i * 4 + 2]!
    const gray = 0.299 * r + 0.587 * g + 0.114 * bl
    const ch = (v: number): number => f * (gray + (v - gray) * s - 128) + 128 + b
    out[i * 4] = ch(r)
    out[i * 4 + 1] = ch(g)
    out[i * 4 + 2] = ch(bl)
    out[i * 4 + 3] = data[i * 4 + 3]!
  }
  return { data: out, width: W, height: H }
}
