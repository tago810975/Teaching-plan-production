/**
 * 题目图片中插图的自动检测（不依赖 AI、不联网）。移植自 tools/figure-detect-prototype.py（v2）。
 *
 * 思路：先认出文字行，其余为插图。
 * 1. 墨迹（深色或彩色像素）按 8 连通分成一块块，用中等块的高度中位数估计字高 h；
 *    去掉容器边框（笔记框：三边以上完整、框内大量字）与彩色底的标签。
 * 2. 横向膨胀约 0.6h，把一行中挨着的字连成一条；一条中主体是正常字号的字、紧密（允许分数线、括号）的是文字行，
 *    其余（一排排的 ×、长直线、零星的标注）是插图材料。答题括号“（　　）”算文字。
 * 3. 材料按距离合并（横 2.5h、纵 2.8h），中间隔着文字行的不合并；再只在最宽的几处竖直空白切开（并排的几幅图），
 *    太小的碎片并回邻近部分。
 * 4. 插图中必须有图形笔画（排除叠在一起的分式），太小的、二维码去掉。按阅读顺序（先上后下、同一行先左后右）排列。
 *
 * 另有 snapBox（框收紧到墨迹边缘）、trimBottomLabel（选项图去掉底部单独的“A.”）。
 * 在用户的 9 张常用题目图片上与 Python 原型一致：22 张插图全部框对。
 */

export interface Pixels {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface DetectResult {
  boxes: Box[]
  /** 全部插图候选块（含因太小、没有图形笔画等被筛掉的），供随手拖的框收紧使用 */
  pieces: Box[]
  /** 估计的字高（像素），用于阅读顺序与收紧 */
  textHeight: number
}

interface Comp {
  x0: number
  y0: number
  x1: number
  y1: number
  s: number
  /** 第一个像素的位置（用于查所属的膨胀块） */
  p: number
}

/** 墨迹：深色或彩色（透明当白色） */
export function inkMask(img: Pixels): Uint8Array {
  const { data, width, height } = img
  const n = width * height
  const ink = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]!
    const g = data[i * 4 + 1]!
    const b = data[i * 4 + 2]!
    const a = data[i * 4 + 3]!
    if (a < 128) continue
    const gray = (r + g + b) / 3
    const sat = Math.max(r, g, b) - Math.min(r, g, b)
    if (gray < 175 || (sat > 60 && gray < 235)) ink[i] = 1
  }
  return ink
}

/** 连通域标记（并查集两遍扫描）；eight 为 8 连通，否则 4 连通。返回每个像素的编号（0 为背景）与编号数 */
function label(mask: Uint8Array, width: number, height: number, eight: boolean): { labels: Int32Array; count: number } {
  const labels = new Int32Array(width * height)
  const parent: number[] = [0]
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  let next = 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (mask[i] === 0) continue
      const ns: number[] = []
      if (x > 0 && labels[i - 1]! > 0) ns.push(labels[i - 1]!)
      if (y > 0) {
        if (labels[i - width]! > 0) ns.push(labels[i - width]!)
        if (eight) {
          if (x > 0 && labels[i - width - 1]! > 0) ns.push(labels[i - width - 1]!)
          if (x < width - 1 && labels[i - width + 1]! > 0) ns.push(labels[i - width + 1]!)
        }
      }
      if (ns.length === 0) {
        parent.push(next)
        labels[i] = next++
      } else {
        let m = ns[0]!
        for (const v of ns) m = Math.min(m, v)
        labels[i] = m
        for (const v of ns) union(m, v)
      }
    }
  }
  // 压缩为连续编号
  const remap = new Int32Array(next)
  let count = 0
  for (let k = 1; k < next; k++) {
    const r = find(k)
    if (remap[r] === 0) remap[r] = ++count
    remap[k] = remap[r]!
  }
  for (let i = 0; i < labels.length; i++) if (labels[i]! > 0) labels[i] = remap[labels[i]!]!
  return { labels, count }
}

/** 矩形膨胀（可分离：先横后纵，用前缀和） */
function dilate(mask: Uint8Array, width: number, height: number, kx: number, ky: number): Uint8Array {
  const tmp = new Uint8Array(width * height)
  const pre = new Int32Array(Math.max(width, height) + 1)
  for (let y = 0; y < height; y++) {
    pre[0] = 0
    for (let x = 0; x < width; x++) pre[x + 1] = pre[x]! + mask[y * width + x]!
    for (let x = 0; x < width; x++) {
      const a = Math.max(0, x - kx)
      const b = Math.min(width, x + kx + 1)
      if (pre[b]! - pre[a]! > 0) tmp[y * width + x] = 1
    }
  }
  const out = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) {
    pre[0] = 0
    for (let y = 0; y < height; y++) pre[y + 1] = pre[y]! + tmp[y * width + x]!
    for (let y = 0; y < height; y++) {
      const a = Math.max(0, y - ky)
      const b = Math.min(height, y + ky + 1)
      if (pre[b]! - pre[a]! > 0) out[y * width + x] = 1
    }
  }
  return out
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function detectFigures(img: Pixels, options: { textHeight?: number } = {}): DetectResult {
  const { width: W, height: H } = img
  const ink = inkMask(img)
  const { labels: lab, count: n } = label(ink, W, H, true)
  // 各连通域的外框与像素数
  const stats: Comp[] = Array.from({ length: n + 1 }, () => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1, s: 0, p: -1 }))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = lab[y * W + x]!
      if (id === 0) continue
      const c = stats[id]!
      if (c.p < 0) c.p = y * W + x
      if (x < c.x0) c.x0 = x
      if (y < c.y0) c.y0 = y
      if (x + 1 > c.x1) c.x1 = x + 1
      if (y + 1 > c.y1) c.y1 = y + 1
      c.s++
    }
  }
  const comps: Array<Comp & { id: number }> = []
  for (let id = 1; id <= n; id++) if (stats[id]!.s >= 3) comps.push({ ...stats[id]!, id })
  const hts = comps.map((c) => c.y1 - c.y0).filter((v) => v >= 6 && v <= 80)
  // 字高：在框选的小区域中检测时由整张图给出（区域里的字太少，估不准）
  const h = options.textHeight ?? Math.max(8, Number.isNaN(median(hts)) ? 12 : median(hts))
  const cw = (c: Comp): number => c.x1 - c.x0
  const ch = (c: Comp): number => c.y1 - c.y0

  // 去掉容器边框与彩色底的标签
  const chars = comps.filter((c) => ch(c) >= 0.5 * h && ch(c) <= 1.6 * h && cw(c) <= 2.5 * h)
  const removed = new Uint8Array(n + 1)
  for (const c of comps) {
    const w = cw(c)
    const hh = ch(c)
    const dens = c.s / (w * hh)
    if (hh < 3 * h && dens > 0.45 && w > 1.5 * h) {
      removed[c.id] = 1
      continue
    }
    if (w > 6 * h && hh > 4 * h) {
      const band = Math.max(3, Math.floor(0.6 * h))
      const cover = (x0: number, y0: number, x1: number, y1: number, alongX: boolean): number => {
        let hit = 0
        const len = alongX ? x1 - x0 : y1 - y0
        for (let k = 0; k < len; k++) {
          let any = false
          for (let j = 0; j < (alongX ? y1 - y0 : x1 - x0) && !any; j++) {
            const x = alongX ? x0 + k : x0 + j
            const y = alongX ? y0 + j : y0 + k
            if (lab[y * W + x] === c.id) any = true
          }
          if (any) hit++
        }
        return len > 0 ? hit / len : 0
      }
      const sides = [
        cover(c.x0, c.y0, c.x1, c.y0 + band, true),
        cover(c.x0, c.y1 - band, c.x1, c.y1, true),
        cover(c.x0, c.y0, c.x0 + band, c.y1, false),
        cover(c.x1 - band, c.y0, c.x1, c.y1, false)
      ]
      const inside = chars.filter((d) => d.x0 >= c.x0 && d.x1 <= c.x1 && d.y0 >= c.y0 && d.y1 <= c.y1).length
      if (sides.filter((v) => v > 0.85).length >= 3 && inside > 40) removed[c.id] = 1
    }
  }
  const ink2 = new Uint8Array(W * H)
  for (let i = 0; i < ink.length; i++) if (ink[i] === 1 && removed[lab[i]!] === 0) ink2[i] = 1
  const keep = comps.filter((c) => removed[c.id] === 0)

  // 一行中挨着的字连成一条
  const kx = Math.max(2, Math.floor(0.6 * h))
  const ky = Math.max(1, Math.floor(0.2 * h))
  const dil = dilate(ink2, W, H, kx, ky)
  const { labels: blab, count: bn } = label(dil, W, H, false)
  const members: Array<Array<Comp & { id: number }>> = Array.from({ length: bn + 1 }, () => [])
  for (const c of keep) members[blab[c.p]!]!.push(c)

  const isChar = (c: Comp): boolean => ch(c) >= 0.4 * h && ch(c) <= 1.7 * h && cw(c) <= 2.2 * h
  const isBar = (c: Comp): boolean => ch(c) <= 0.3 * h && cw(c) <= 8 * h
  const isBracket = (c: Comp): boolean => cw(c) <= 0.7 * h && ch(c) <= 4.5 * h
  const colCoverage = (x0: number, y0: number, x1: number, y1: number): number => {
    let hit = 0
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        if (ink2[y * W + x] === 1) {
          hit++
          break
        }
      }
    }
    return x1 > x0 ? hit / (x1 - x0) : 0
  }

  interface Blob extends Box {
    x1: number
    y1: number
    text: boolean
  }
  const blobs: Blob[] = []
  for (let b = 1; b <= bn; b++) {
    const inner = members[b]!
    if (inner.length === 0) continue
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -1
    let y1 = -1
    for (const c of inner) {
      x0 = Math.min(x0, c.x0)
      y0 = Math.min(y0, c.y0)
      x1 = Math.max(x1, c.x1)
      y1 = Math.max(y1, c.y1)
    }
    const nchar = inner.filter(isChar).length
    const big = inner.some((c) => (ch(c) > 1.7 * h || cw(c) > 2.2 * h) && !isBar(c) && !isBracket(c))
    const cols = colCoverage(x0, y0, x1, y1)
    const hh = y1 - y0
    let text = (hh <= 4.5 * h && nchar >= 3 && cols >= 0.5 && !big) || (hh <= 2.2 * h && nchar >= 7 && !big)
    // 答题括号“（　　）”：只有一两个又细又高的括号；两半离得远时各成一块，靠页面右侧
    if (inner.length <= 2 && inner.every((c) => isBracket(c) && ch(c) >= 0.8 * h) && (inner.length === 2 || x0 > 0.7 * W)) text = true
    blobs.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1, text })
  }
  const texts = blobs.filter((b) => b.text)
  const mats = blobs.filter((b) => !b.text).map((b) => ({ x0: b.x, y0: b.y, x1: b.x1, y1: b.y1 }))

  // 材料合并：相距不远、中间没有文字行
  type R = { x0: number; y0: number; x1: number; y1: number }
  const gx = 2.5 * h
  const gy = 2.8 * h
  const blocked = (a: R, b: R): boolean => {
    const ux0 = Math.min(a.x0, b.x0)
    const ux1 = Math.max(a.x1, b.x1)
    let gy0: number
    let gy1: number
    if (a.y1 <= b.y0) [gy0, gy1] = [a.y1, b.y0]
    else if (b.y1 <= a.y0) [gy0, gy1] = [b.y1, a.y0]
    else return false
    return texts.some((t) => t.y >= gy0 - 1 && t.y1 <= gy1 + 1 && t.x1 > ux0 && t.x < ux1 && t.w > 4 * h)
  }
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < mats.length; i++) {
      for (let j = i + 1; j < mats.length; j++) {
        const a = mats[i]!
        const b = mats[j]!
        const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1))
        const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1))
        if (dx <= gx && dy <= gy && !blocked(a, b)) {
          mats[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
          mats.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }

  // 收紧到墨迹
  const tighten = (r: R): R | null => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -1
    let y1 = -1
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        if (ink2[y * W + x] === 1) {
          if (x < x0) x0 = x
          if (y < y0) y0 = y
          if (x + 1 > x1) x1 = x + 1
          if (y + 1 > y1) y1 = y + 1
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 }
  }

  // 按竖直空白切开（并排的几幅图）
  const split = (r: R): R[] => {
    const gaps: Array<[number, number]> = []
    let start = -1
    for (let x = r.x0; x <= r.x1; x++) {
      let any = false
      if (x < r.x1) {
        for (let y = r.y0; y < r.y1; y++) {
          if (ink2[y * W + x] === 1) {
            any = true
            break
          }
        }
      } else any = true
      if (!any && start < 0) start = x
      if (any && start >= 0) {
        if (x - start >= 1.0 * h) gaps.push([start, x])
        start = -1
      }
    }
    if (gaps.length === 0) return [r]
    const widest = Math.max(...gaps.map(([a, b]) => b - a))
    const use = gaps.filter(([a, b]) => b - a >= 0.7 * widest)
    let pieces: R[] = []
    let prev = r.x0
    for (const [a, b] of use) {
      pieces.push({ ...r, x0: prev, x1: a })
      prev = b
    }
    pieces.push({ ...r, x0: prev })
    // 太小的一片（如一列 ×）并回旁边空白较窄的那一片
    let merged = true
    while (merged && pieces.length > 1) {
      merged = false
      for (let k = 0; k < pieces.length; k++) {
        const p = pieces[k]!
        if (p.x1 - p.x0 >= 3.5 * h) continue
        const left = k > 0 ? p.x0 - pieces[k - 1]!.x1 : null
        const right = k + 1 < pieces.length ? pieces[k + 1]!.x0 - p.x1 : null
        const j = right === null || (left !== null && left <= right) ? k - 1 : k + 1
        const a = Math.min(k, j)
        const b = Math.max(k, j)
        pieces[a] = { ...r, x0: pieces[a]!.x0, x1: pieces[b]!.x1 }
        pieces.splice(b, 1)
        merged = true
        break
      }
    }
    pieces = pieces.map((p) => tighten(p)).filter((p): p is R => p !== null)
    return pieces
  }

  const figs: Box[] = []
  const pieces: Box[] = []
  for (const r of mats) {
    for (const p of split(r)) {
      const w = p.x1 - p.x0
      const hh = p.y1 - p.y0
      pieces.push({ x: p.x0, y: p.y0, w, h: hh })
      if (w < 3.5 * h || hh < 3 * h) continue
      const inside = keep.filter((c) => c.x0 >= p.x0 && c.x1 <= p.x1 && c.y0 >= p.y0 && c.y1 <= p.y1)
      // 插图里一定有图形笔画（坐标轴、曲线、导线……）；只有字、分数线、括号的是公式
      const graphic = inside.some((c) => (ch(c) > 1.7 * h || cw(c) > 2.2 * h) && !(ch(c) <= 0.3 * h) && !(cw(c) <= 0.7 * h))
      if (!graphic) continue
      // 二维码：近似正方形、墨迹密、碎块多
      let inkCount = 0
      for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) inkCount += ink2[y * W + x]!
      const dens = inkCount / (w * hh)
      if (w / hh > 0.75 && w / hh < 1.33 && dens > 0.3 && Math.max(w, hh) < 10 * h && inside.length > 10) continue
      figs.push({ x: p.x0, y: p.y0, w, h: hh })
    }
  }
  return { boxes: sortReading(figs, h), pieces, textHeight: h }
}

/**
 * 框四周留白：检测与收紧都贴着墨迹边缘，裁出的图边缘的线条紧贴图片边界、像被切掉一点。
 * 四周各放宽约半个字高（至少 4 像素），不超出图片。
 */
export function padBox(box: Box, textHeight: number, width: number, height: number): Box {
  const p = Math.max(4, Math.round(0.5 * textHeight))
  const x0 = Math.max(0, box.x - p)
  const y0 = Math.max(0, box.y - p)
  const x1 = Math.min(width, box.x + box.w + p)
  const y1 = Math.min(height, box.y + box.h + p)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** 阅读顺序：先上后下（约 3 个字高为一行），同一行先左后右 */
export function sortReading(boxes: Box[], textHeight: number): Box[] {
  return [...boxes].sort((a, b) => Math.round(a.y / (3 * textHeight)) - Math.round(b.y / (3 * textHeight)) || a.x - b.x)
}

/**
 * 随手拖的框收紧到其中的插图：用整页检测时得到的插图候选块（pieces，含因太小、太淡被筛掉的），
 * 取大部分面积（≥ 60%）落在框内的候选块的范围——整页的上下文完整，框住的图注、半行文字不会被算进去；
 * 框内没有候选块时收紧到墨迹边缘。
 */
export function snapToFigure(img: Pixels, box: Box, pieces: readonly Box[], margin = 2): Box {
  const inside = pieces.filter((p) => {
    const ix = Math.max(0, Math.min(p.x + p.w, box.x + box.w) - Math.max(p.x, box.x))
    const iy = Math.max(0, Math.min(p.y + p.h, box.y + box.h) - Math.max(p.y, box.y))
    return ix * iy >= 0.6 * p.w * p.h
  })
  if (inside.length === 0) return snapBox(img, box, margin)
  const x0 = Math.min(...inside.map((p) => p.x))
  const y0 = Math.min(...inside.map((p) => p.y))
  const x1 = Math.max(...inside.map((p) => p.x + p.w))
  const y1 = Math.max(...inside.map((p) => p.y + p.h))
  const nx0 = Math.max(0, x0 - margin)
  const ny0 = Math.max(0, y0 - margin)
  return { x: nx0, y: ny0, w: Math.min(img.width, x1 + margin) - nx0, h: Math.min(img.height, y1 + margin) - ny0 }
}

/** 框收紧到其中墨迹的边缘（留 margin 像素）；框内没有墨迹时不变 */
export function snapBox(img: Pixels, box: Box, margin = 2): Box {
  const ink = inkMask(img)
  const { width: W, height: H } = img
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  const bx0 = Math.max(0, Math.floor(box.x))
  const by0 = Math.max(0, Math.floor(box.y))
  const bx1 = Math.min(W, Math.ceil(box.x + box.w))
  const by1 = Math.min(H, Math.ceil(box.y + box.h))
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      if (ink[y * W + x] === 1) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x + 1 > x1) x1 = x + 1
        if (y + 1 > y1) y1 = y + 1
      }
    }
  }
  if (x1 < 0) return box
  const nx0 = Math.max(0, x0 - margin)
  const ny0 = Math.max(0, y0 - margin)
  return { x: nx0, y: ny0, w: Math.min(W, x1 + margin) - nx0, h: Math.min(H, y1 + margin) - ny0 }
}

/**
 * 选项图去掉底部单独的选项字母（如第 14 题每幅图下的“A.”）：软件排版时选项本身会显示“A．”。
 * 底部最后一段墨迹与上方隔着空白、高度不超过约一个字、宽度不超过约 3.5 个字时裁掉。
 */
export function trimBottomLabel(img: Pixels, box: Box, textHeight: number): Box {
  const ink = inkMask(img)
  const { width: W } = img
  const x0 = Math.max(0, Math.floor(box.x))
  const x1 = Math.min(W, Math.ceil(box.x + box.w))
  const y0 = Math.max(0, Math.floor(box.y))
  const y1 = Math.min(img.height, Math.ceil(box.y + box.h))
  const rowInk = (y: number): boolean => {
    for (let x = x0; x < x1; x++) if (ink[y * W + x] === 1) return true
    return false
  }
  let y = y1 - 1
  while (y >= y0 && !rowInk(y)) y--
  const bandBottom = y + 1
  while (y >= y0 && rowInk(y)) y--
  const bandTop = y + 1
  let gapTop = y
  while (gapTop >= y0 && !rowInk(gapTop)) gapTop--
  const gap = y - gapTop
  const bandH = bandBottom - bandTop
  if (gapTop < y0 || gap < 0.2 * textHeight || bandH > 1.7 * textHeight) return box
  let lx0 = Infinity
  let lx1 = -1
  for (let yy = bandTop; yy < bandBottom; yy++) {
    for (let x = x0; x < x1; x++) {
      if (ink[yy * W + x] === 1) {
        lx0 = Math.min(lx0, x)
        lx1 = Math.max(lx1, x + 1)
      }
    }
  }
  if (lx1 - lx0 > 3.5 * textHeight) return box
  return { ...box, h: gapTop + 1 - box.y + 1 }
}
