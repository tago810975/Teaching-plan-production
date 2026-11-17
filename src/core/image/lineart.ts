/**
 * 线稿模式：在“清理 + 放大”之后，把线条压成纯黑（彩色线条保持原色、变得鲜明）、纸张压成纯白，
 * 分界处留窄的过渡带（边缘平滑、无锯齿），去掉零星噪点。只改变深浅，不移动任何线条。
 *
 * 适合黑白线条图（电路图、受力图、坐标图）；有大块灰色填充或阴影的图（如立体的磁铁）压成黑白会丢掉层次，
 * 用 fillRatio 判断并提示改用普通方式。
 */
import type { Pixels } from './enhance'

const lumOf = (d: ArrayLike<number>, i: number): number => (d[i * 4]! + d[i * 4 + 1]! + d[i * 4 + 2]!) / 3

/** 大块填充所占的比例：中间调（90～215）且四周 3×3 也都是中间调的像素 ÷ 非白像素。超过 FILL_LIMIT 不适合线稿 */
export function fillRatio(img: Pixels): number {
  const { data, width: W, height: H } = img
  const mid = new Uint8Array(W * H)
  let ink = 0
  for (let i = 0; i < W * H; i++) {
    const l = lumOf(data, i)
    if (l < 235) ink++
    if (l >= 90 && l <= 215) mid[i] = 1
  }
  if (ink === 0) return 0
  let interior = 0
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      if (mid[i] === 0) continue
      let all = true
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1 && all; dx++) if (mid[i + dy * W + dx] === 0) all = false
      if (all) interior++
    }
  }
  return interior / ink
}

export const FILL_LIMIT = 0.12

/** 大津法求亮度的分界（0～255） */
function otsu(lum: Float32Array): number {
  const hist = new Float64Array(256)
  for (const v of lum) hist[Math.max(0, Math.min(255, Math.round(v)))]!++
  const total = lum.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]!
  let sumB = 0
  let wB = 0
  let best = 0
  let bestT = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]!
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      bestT = t
    }
  }
  return bestT
}

/** 线条粗细（像素）：横、纵方向上连续墨迹段长度的中位数（只计 1～40 像素的段） */
export function strokeWidth(lum: Float32Array, W: number, H: number, threshold = 160): number {
  const runs: number[] = []
  for (let y = 0; y < H; y += 2) {
    let r = 0
    for (let x = 0; x <= W; x++) {
      if (x < W && lum[y * W + x]! < threshold) r++
      else {
        if (r >= 1 && r <= 40) runs.push(r)
        r = 0
      }
    }
  }
  for (let x = 0; x < W; x += 2) {
    let r = 0
    for (let y = 0; y <= H; y++) {
      if (y < H && lum[y * W + x]! < threshold) r++
      else {
        if (r >= 1 && r <= 40) runs.push(r)
        r = 0
      }
    }
  }
  if (runs.length === 0) return 2
  runs.sort((a, b) => a - b)
  return Math.max(1, runs[Math.floor(runs.length / 2)]!)
}

/** 积分图（含平方）：求任意矩形的均值与方差 */
function integral(v: Float32Array, W: number, H: number): { sum: Float64Array; sq: Float64Array } {
  const sum = new Float64Array((W + 1) * (H + 1))
  const sq = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let rs = 0
    let rq = 0
    for (let x = 0; x < W; x++) {
      const a = v[y * W + x]!
      rs += a
      rq += a * a
      sum[(y + 1) * (W + 1) + x + 1] = sum[y * (W + 1) + x + 1]! + rs
      sq[(y + 1) * (W + 1) + x + 1] = sq[y * (W + 1) + x + 1]! + rq
    }
  }
  return { sum, sq }
}

/**
 * 线稿：img 为清理（并放大）后的图；scale 为相对原图的放大倍数（决定平滑的尺度）。
 * 分界用 Sauvola 局部阈值（扫描件上同一条线有深有浅，局部分界才能把浅的一段也压黑）；
 * 窗口与“填充”的判断按估计的线条粗细（大图不放大时线条有 5 像素粗，固定的小窗口会把浅的线段当成填充）。
 */
export function lineArt(img: Pixels, scale = 3): Pixels {
  const { data, width: W, height: H } = img
  const n = W * H
  // 1. 亮度轻微平滑（去掉锯齿）
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) lum[i] = lumOf(data, i)
  const sigma = Math.max(0.5, 0.25 * scale)
  const r = Math.ceil(sigma * 2.5)
  const k: number[] = []
  let ks = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k.push(v)
    ks += v
  }
  const tmp = new Float32Array(n)
  const sm = new Float32Array(n)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let j = -r; j <= r; j++) s += k[j + r]! * lum[y * W + Math.min(W - 1, Math.max(0, x + j))]!
      tmp[y * W + x] = s / ks
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let j = -r; j <= r; j++) s += k[j + r]! * tmp[Math.min(H - 1, Math.max(0, y + j)) * W + x]!
      sm[y * W + x] = s / ks
    }
  const stroke = strokeWidth(sm, W, H, Math.min(200, otsu(sm) + 10))

  // 2. 分界：Sauvola 局部阈值 T = m·(1 + k·(s/R − 1))，窗口约 8 倍线宽；纯白区域 s≈0，T≈0.75m，纸张不会被当成线条。
  //    只设一个宽松的上限（215）；不能用全图的大津法做上限——有成片填充时上限偏低，偏浅的线段压不黑
  const win = Math.max(7, Math.round(stroke * 8)) | 1
  const half = win >> 1
  const { sum, sq } = integral(sm, W, H)
  const globalT = 215
  const band = 30
  const ink = new Float32Array(n)
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(H, y + half + 1)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(W, x + half + 1)
      const cnt = (x1 - x0) * (y1 - y0)
      const s1 = sum[y1 * (W + 1) + x1]! - sum[y0 * (W + 1) + x1]! - sum[y1 * (W + 1) + x0]! + sum[y0 * (W + 1) + x0]!
      const s2 = sq[y1 * (W + 1) + x1]! - sq[y0 * (W + 1) + x1]! - sq[y1 * (W + 1) + x0]! + sq[y0 * (W + 1) + x0]!
      const m = s1 / cnt
      const sd = Math.sqrt(Math.max(0, s2 / cnt - m * m))
      const T = Math.min(globalT, m * (1 + 0.25 * (sd / 128 - 1)))
      const t = (T + band / 2 - sm[y * W + x]!) / band
      const c = t < 0 ? 0 : t > 1 ? 1 : t
      ink[y * W + x] = c * c * (3 - 2 * c)
    }
  }
  // 3. 去掉零星噪点：面积小于约线宽² 的孤立小块
  const minArea = Math.max(4, Math.round(stroke * stroke))
  const seen = new Uint8Array(n)
  const stack: number[] = []
  const comp: number[] = []
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0] === 1 || ink[s0]! < 0.5) continue
    comp.length = 0
    stack.push(s0)
    seen[s0] = 1
    while (stack.length > 0) {
      const i = stack.pop()!
      comp.push(i)
      const x = i % W
      const y = (i - x) / W
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const j = ny * W + nx
          if (seen[j] === 0 && ink[j]! >= 0.5) {
            seen[j] = 1
            stack.push(j)
          }
        }
    }
    if (comp.length < minArea) for (const i of comp) ink[i] = 0
  }
  // 4. 填充区域（成片的中间调，如浅灰小球、立体磁铁的阴影面）保持原样。
  //    “成片”：(2·rr+1)² 范围内都是中间调，rr 为线宽——范围比线条宽，线条上颜色浅的一段不会被当成填充；
  //    也不能太大，否则小的填充（如浅灰的小球）认不出来
  const rr = Math.max(2, Math.ceil(stroke))
  const mid = new Int32Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) {
      const v = sm[y * W + x]!
      row += v >= 90 && v <= 225 ? 1 : 0
      mid[(y + 1) * (W + 1) + x + 1] = mid[y * (W + 1) + x + 1]! + row
    }
  }
  const boxSum = (arr: Int32Array, x0: number, y0: number, x1: number, y1: number): number =>
    arr[y1 * (W + 1) + x1]! - arr[y0 * (W + 1) + x1]! - arr[y1 * (W + 1) + x0]! + arr[y0 * (W + 1) + x0]!
  const interior = new Uint8Array(n)
  for (let y = rr; y < H - rr; y++)
    for (let x = rr; x < W - rr; x++) if (boxSum(mid, x - rr, y - rr, x + rr + 1, y + rr + 1) === (2 * rr + 1) ** 2) interior[y * W + x] = 1
  const intSum = new Int32Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) {
      row += interior[y * W + x]!
      intSum[(y + 1) * (W + 1) + x + 1] = intSum[y * (W + 1) + x + 1]! + row
    }
  }
  const nearFill = (x: number, y: number): boolean =>
    boxSum(intSum, Math.max(0, x - rr), Math.max(0, y - rr), Math.min(W, x + rr + 1), Math.min(H, y + rr + 1)) > 0

  // 5. 着色：彩色线条用它鲜明的颜色，其余为黑；填充区保持原色
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const R = data[i * 4]!
    const G = data[i * 4 + 1]!
    const B = data[i * 4 + 2]!
    if (sm[i]! >= 90 && nearFill(i % W, Math.floor(i / W))) {
      out[i * 4] = R
      out[i * 4 + 1] = G
      out[i * 4 + 2] = B
      out[i * 4 + 3] = 255
      continue
    }
    const d = ink[i]!
    const dev = 255 - Math.min(R, G, B)
    const sat = Math.max(R, G, B) - Math.min(R, G, B)
    let cr = 0
    let cg = 0
    let cb = 0
    if (dev > 20 && sat / dev > 0.35) {
      const f = Math.max(1, 170 / Math.max(dev, 1))
      cr = 255 - (255 - R) * f
      cg = 255 - (255 - G) * f
      cb = 255 - (255 - B) * f
    }
    out[i * 4] = 255 * (1 - d) + cr * d
    out[i * 4 + 1] = 255 * (1 - d) + cg * d
    out[i * 4 + 2] = 255 * (1 - d) + cb * d
    out[i * 4 + 3] = 255
  }
  return { data: out, width: W, height: H }
}

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
