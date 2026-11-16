/**
 * FSRCNN ×3 超分辨率（小型经典模型，约 8800 个参数；直接用 TypeScript 计算，不需要额外的运行库）。
 *
 * 结构：5×5 卷积 56 → 1×1 收缩到 12 → 4 层 3×3（12）→ 1×1 扩展到 56 → 1×1 到 9 通道 → 9 通道重排成 3×3 像素块。
 * 各层后为 PReLU：relu(x) + α·(x − |x|)·0.5。卷积补零保持尺寸（SAME）。
 * 只放大亮度（Y，0～1），颜色通道另行放大——与 OpenCV dnn_superres 的做法一致（测试中逐像素对照）。
 */
import { FSRCNN_X3 } from './fsrcnn-weights'

interface Layer {
  out: number
  in: number
  k: number
  w: Float32Array
  b: Float32Array
  a: Float32Array | null
}

let model: Layer[] | null = null

function load(): Layer[] {
  if (model !== null) return model
  const bin = atob(FSRCNN_X3.weights)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const all = new Float32Array(bytes.buffer)
  let p = 0
  const take = (n: number): Float32Array => {
    const v = all.subarray(p, p + n)
    p += n
    return v
  }
  model = FSRCNN_X3.layers.map((L) => ({
    out: L.out,
    in: L.in,
    k: L.k,
    w: take(L.out * L.in * L.k * L.k),
    b: take(L.out),
    a: L.prelu ? take(L.out) : null
  }))
  return model
}

/** 一层：补零卷积 + 偏置 + PReLU。x 为 [通道][行][列] 展平 */
function layer(x: Float32Array, W: number, H: number, L: Layer): Float32Array {
  const n = W * H
  const y = new Float32Array(L.out * n)
  const r = L.k >> 1
  for (let o = 0; o < L.out; o++) {
    const yo = y.subarray(o * n, (o + 1) * n)
    yo.fill(L.b[o]!)
    for (let c = 0; c < L.in; c++) {
      const xc = x.subarray(c * n, (c + 1) * n)
      for (let ky = 0; ky < L.k; ky++) {
        const dy = ky - r
        for (let kx = 0; kx < L.k; kx++) {
          const wv = L.w[((o * L.in + c) * L.k + ky) * L.k + kx]!
          if (wv === 0) continue
          const dx = kx - r
          const y0 = Math.max(0, -dy)
          const y1 = Math.min(H, H - dy)
          const x0 = Math.max(0, -dx)
          const x1 = Math.min(W, W - dx)
          for (let yy = y0; yy < y1; yy++) {
            const row = yy * W
            const srow = (yy + dy) * W + dx
            for (let xx = x0; xx < x1; xx++) yo[row + xx]! += wv * xc[srow + xx]!
          }
        }
      }
    }
    if (L.a !== null) {
      const a = L.a[o]!
      for (let i = 0; i < n; i++) {
        const v = yo[i]!
        if (v < 0) yo[i] = a * v
      }
    }
  }
  return y
}

/** 亮度 ×3：输入 W×H（0～1），输出 3W×3H（0～1） */
export function fsrcnnY(y: Float32Array, W: number, H: number): Float32Array {
  let x: Float32Array = y
  for (const L of load()) x = layer(x, W, H, L)
  // 9 通道 → 3×3 像素块（通道 c = 行偏移·3 + 列偏移）
  const out = new Float32Array(9 * W * H)
  const n = W * H
  const OW = W * 3
  for (let c = 0; c < 9; c++) {
    const a = Math.floor(c / 3)
    const b = c % 3
    for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) {
        const v = x[c * n + yy * W + xx]!
        out[(yy * 3 + a) * OW + xx * 3 + b] = v < 0 ? 0 : v > 1 ? 1 : v
      }
    }
  }
  return out
}
