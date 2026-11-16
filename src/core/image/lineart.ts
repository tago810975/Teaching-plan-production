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

/** 线稿：img 为清理（并放大）后的图；scale 为相对原图的放大倍数（决定平滑与噪点的尺度） */
export function lineArt(img: Pixels, scale = 3): Pixels {
  const { data, width: W, height: H } = img
  const n = W * H
  // 1. 亮度轻微平滑（去掉放大后的锯齿）
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
  // 2. 分界：大津法，略偏浅（淡的细线也算线条）；分界附近留过渡带（边缘平滑）
  const T = Math.min(200, Math.max(110, otsu(sm)))
  const band = 24
  const ink = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = (T + band / 2 - sm[i]!) / band
    const c = t < 0 ? 0 : t > 1 ? 1 : t
    ink[i] = c * c * (3 - 2 * c)
  }
  // 3. 去掉零星噪点：面积小于约 (0.6·放大倍数)² × 4 的孤立小块
  const minArea = Math.max(4, Math.round(4 * (0.6 * scale) ** 2))
  const seen = new Uint8Array(n)
  const stack: number[] = []
  const comp: number[] = []
  for (let s = 0; s < n; s++) {
    if (seen[s] === 1 || ink[s]! < 0.5) continue
    comp.length = 0
    stack.push(s)
    seen[s] = 1
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
  // 4. 填充区域（成片的中间调，如浅灰的小球、立体磁铁的阴影面）保持原样：只把线条压实，不把填充涂黑。
  //    用 (2·rr+1)² 的范围判断“四周都是中间调”：相当于原图中 4 个像素以上的成片区域才算填充，
  //    较粗的灰色线条（原图 2～3 像素宽）与线条边缘的过渡带都不会被当成填充
  const rr = Math.max(2, Math.round(2 * scale))
  const mid = new Int32Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) {
      const v = sm[y * W + x]!
      row += v >= 90 && v <= 225 ? 1 : 0
      mid[(y + 1) * (W + 1) + x + 1] = mid[y * (W + 1) + x + 1]! + row
    }
  }
  const boxSum = (x0: number, y0: number, x1: number, y1: number): number =>
    mid[y1 * (W + 1) + x1]! - mid[y0 * (W + 1) + x1]! - mid[y1 * (W + 1) + x0]! + mid[y0 * (W + 1) + x0]!
  const interior = new Uint8Array(n)
  for (let y = rr; y < H - rr; y++)
    for (let x = rr; x < W - rr; x++) if (boxSum(x - rr, y - rr, x + rr + 1, y + rr + 1) === (2 * rr + 1) ** 2) interior[y * W + x] = 1
  // 填充区连同边缘（向外 rr）
  const intSum = new Int32Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let row = 0
    for (let x = 0; x < W; x++) {
      row += interior[y * W + x]!
      intSum[(y + 1) * (W + 1) + x + 1] = intSum[y * (W + 1) + x + 1]! + row
    }
  }
  const nearFill = (x: number, y: number): boolean => {
    const x0 = Math.max(0, x - rr)
    const y0 = Math.max(0, y - rr)
    const x1 = Math.min(W, x + rr + 1)
    const y1 = Math.min(H, y + rr + 1)
    return intSum[y1 * (W + 1) + x1]! - intSum[y0 * (W + 1) + x1]! - intSum[y1 * (W + 1) + x0]! + intSum[y0 * (W + 1) + x0]! > 0
  }

  // 5. 着色：彩色线条用它鲜明的颜色，其余为黑；填充区保持原色
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const R0 = data[i * 4]!
    const G0 = data[i * 4 + 1]!
    const B0 = data[i * 4 + 2]!
    // 填充区（不含其中更深的线条：线条的核心比中间调更深）：原样
    if (sm[i]! >= 90 && nearFill(i % W, Math.floor(i / W))) {
      out[i * 4] = R0
      out[i * 4 + 1] = G0
      out[i * 4 + 2] = B0
      out[i * 4 + 3] = 255
      continue
    }
    const d = ink[i]!
    const R = data[i * 4]!
    const G = data[i * 4 + 1]!
    const B = data[i * 4 + 2]!
    const dev = 255 - Math.min(R, G, B)
    const sat = Math.max(R, G, B) - Math.min(R, G, B)
    let cr = 0
    let cg = 0
    let cb = 0
    if (dev > 20 && sat / dev > 0.35) {
      // 彩色：按偏离白色的方向放大到鲜明的程度（边缘的淡色也恢复为线条本色）
      const f = Math.max(1, 170 / Math.max(R === 255 && G === 255 && B === 255 ? 1 : 255 - Math.min(R, G, B), 1))
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
