/**
 * 月潮主题的页面切换：一场平涂风格的“涌水”，按内容区大小现场生成一张 SVG。
 *
 * 画法：只用几种纯色，靠轮廓表现水——
 *   水体的下缘是一条用多组正弦叠出来、再用平滑曲线串起的起伏边，中间一段垂得更深（水柱先落）；
 *   边缘内侧描一道浅色的亮边，像动画里水体的高光轮廓；
 *   几条 S 形的浅色水流顺着水柱往下淌；前缘挂着几滴将落未落的水珠；
 *   浪花是带亮边的半透明圆团，少而大，集中在水柱前缘与两侧；空心水泡上浮。
 * 每次切换随机生成，形状都不一样。动画在 app.css（tide-* 关键帧）里。
 */

const NS = 'http://www.w3.org/2000/svg'

const DEEP = '#2242d4'
const MID = '#3a7cf0'
const LIGHT = '#67d2ff'
const PALE = '#c4f1ff'
const WHITE = '#f1fcff'

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

type Pt = [number, number]

/** 用 Catmull-Rom 样条把一串点连成平滑曲线（输出不含起点的 C 指令） */
function smooth(pts: Pt[]): string {
  let d = ''
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d
}

interface Edge {
  /** 下缘上的点，从左到右 */
  pts: Pt[]
  /** 水柱中心的横坐标 */
  center: number
}

/** 生成一条起伏的下缘：基线 + 中间垂下的水柱 + 三组正弦叠出的波动 */
function makeEdge(w: number, baseY: number, tongue: number, amp: number, center = rnd(0.42, 0.58) * w, side = 0): Edge {
  const spread = w * rnd(0.12, 0.18)
  // 两侧再挂几股细一些、短一些的水柱，前缘不至于只有一个光滑的 V
  const extras = Array.from({ length: side }, () => ({
    c: (Math.random() < 0.5 ? rnd(0.08, 0.32) : rnd(0.68, 0.92)) * w,
    s: w * rnd(0.035, 0.07),
    d: tongue * rnd(0.18, 0.4)
  }))
  const waves = [0, 1, 2].map((k) => ({ f: (Math.PI * 2 * rnd(1.5, 3) * (k + 1)) / w, ph: rnd(0, Math.PI * 2), a: amp / (k + 1) }))
  const n = Math.max(18, Math.round(w / 45))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const x = -40 + ((w + 80) * i) / n
    const t = Math.exp(-(((x - center) / spread) ** 2))
    let y = baseY + tongue * t
    for (const e of extras) y += e.d * Math.exp(-(((x - e.c) / e.s) ** 2))
    for (const wv of waves) y += Math.sin(x * wv.f + wv.ph) * wv.a * (1 - t * 0.6)
    pts.push([x, y])
  }
  return { pts, center }
}

/** 水体：上边在画面外，下缘就是 edge */
function massPath(edge: Edge, h: number): string {
  const first = edge.pts[0]!
  const last = edge.pts[edge.pts.length - 1]!
  return `M ${first[0]} ${-h} L ${first[0]} ${first[1].toFixed(1)}${smooth(edge.pts)} L ${last[0]} ${-h} Z`
}

/** 下缘内侧的亮边：沿下缘、往上收一点、两端渐细 */
function rimPath(edge: Edge, inset: number): string {
  const up = edge.pts.map(([x, y]): Pt => [x, y - inset])
  const first = up[0]!
  return `M ${first[0]} ${first[1].toFixed(1)}${smooth(up)}`
}

/** S 形水流：一条上宽下尖、左右摆动的长条 */
function ribbonPath(x: number, top: number, width: number, len: number, sway: number): string {
  const n = 6
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const cx = x + Math.sin(t * Math.PI * 1.4) * sway
    const half = (width / 2) * (1 - t) ** 1.3
    const y = top + len * t
    left.push([cx - half, y])
    right.unshift([cx + half, y])
  }
  const start = left[0]!
  return `M ${start[0].toFixed(1)} ${start[1].toFixed(1)}${smooth(left)}${smooth(right)} Z`
}

/** 一团浪花：一个大圆带两三个小圆，半透明浅青，外圈描亮边 */
function foam(cx: number, cy: number, r: number, delay: number): SVGGElement {
  const g = el('g', { class: 'tide-foam', style: `--delay:${delay}ms;--dx:${rnd(-24, 24).toFixed(0)}px;--dy:${rnd(-36, 6).toFixed(0)}px` })
  g.style.transformOrigin = `${cx}px ${cy}px`
  const parts: Array<[number, number, number]> = [[cx, cy, r]]
  const extra = 1 + Math.floor(Math.random() * 3)
  for (let i = 0; i < extra; i++) {
    const a = rnd(0, Math.PI * 2)
    parts.push([cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.75, r * rnd(0.35, 0.6)])
  }
  for (const [x, y, rr] of parts) g.append(el('circle', { cx: x, cy: y, r: rr, fill: LIGHT, 'fill-opacity': 0.8, stroke: PALE, 'stroke-width': Math.max(2, rr * 0.16) }))
  // 高光：左上一小块月牙
  g.append(el('circle', { cx: cx - r * 0.32, cy: cy - r * 0.34, r: r * 0.28, fill: WHITE, 'fill-opacity': 0.9 }))
  return g
}

export function buildTideWater(w: number, h: number): SVGSVGElement {
  const svg = el('svg', { class: 'tide-water', viewBox: `0 0 ${w} ${h}`, width: w, height: h, preserveAspectRatio: 'none' })
  const amp = Math.max(14, h * 0.035)

  // 深蓝：最终铺满全屏，下缘落在画面外
  const deepEdge = makeEdge(w, h + 40, h * 0.1, amp, undefined, 2)
  const deep = el('g', { class: 'tide-mass tide-mass--deep' })
  deep.append(el('path', { fill: DEEP, d: massPath(deepEdge, h) }))
  deep.append(el('path', { d: rimPath(deepEdge, 6), fill: 'none', stroke: MID, 'stroke-width': 5, 'stroke-linecap': 'round' }))

  // 亮蓝水柱：两侧浅、中间垂得深
  const midEdge = makeEdge(w, h * 0.18, h * 0.62, amp * 1.2, undefined, 3)
  const mid = el('g', { class: 'tide-mass tide-mass--mid' })
  mid.append(el('path', { fill: MID, d: massPath(midEdge, h) }))
  mid.append(el('path', { d: rimPath(midEdge, 7), fill: 'none', stroke: LIGHT, 'stroke-width': 4, 'stroke-linecap': 'round' }))
  // 前缘将落未落的水珠
  for (let i = 0; i < 5; i++) {
    const p = midEdge.pts[Math.floor(rnd(0.15, 0.85) * midEdge.pts.length)]!
    const r = rnd(5, 11)
    mid.append(el('circle', { class: 'tide-drop', cx: p[0] + rnd(-10, 10), cy: p[1] + r * 1.6, r, fill: MID, style: `--delay:${Math.round(rnd(380, 520))}ms` }))
  }
  // 顺着水柱往下淌的浅色水流
  const ribbons = Math.max(3, Math.round(w / 380))
  for (let i = 0; i < ribbons; i++) {
    const near = i === 0
    const x = near ? midEdge.center + rnd(-0.04, 0.04) * w : ((i + rnd(0.2, 0.8)) / ribbons) * w
    const len = near ? h * rnd(0.6, 0.75) : h * rnd(0.2, 0.45)
    mid.append(
      el('path', {
        fill: near ? WHITE : PALE,
        'fill-opacity': near ? 0.95 : 0.8,
        d: ribbonPath(x, -10, rnd(26, near ? 70 : 46), len, rnd(-24, 24))
      })
    )
  }
  svg.append(deep, mid)

  // 浪花：少而大，沿水柱前缘与两侧
  const foams = el('g', { class: 'tide-foams' })
  const count = Math.max(6, Math.round(w / 220))
  for (let i = 0; i < count; i++) {
    const nearTip = i < count / 2
    const x = nearTip ? midEdge.center + rnd(-0.16, 0.16) * w : Math.random() < 0.5 ? rnd(0.02, 0.2) * w : rnd(0.8, 0.98) * w
    const y = nearTip ? h * rnd(0.55, 0.85) : h * rnd(0.2, 0.7)
    foams.append(foam(x, y, rnd(16, 34), Math.round(360 + rnd(0, 180))))
  }
  svg.append(foams)

  // 空心水泡
  const rings = el('g', { class: 'tide-rings' })
  for (let i = 0; i < count * 2; i++) {
    const r = rnd(4, 12)
    rings.append(
      el('circle', {
        class: 'tide-ring',
        cx: rnd(0, w),
        cy: rnd(0.4, 1) * h,
        r,
        fill: 'none',
        stroke: PALE,
        'stroke-width': Math.max(1.5, r / 4),
        style: `--delay:${Math.round(rnd(380, 600))}ms;--rise:${Math.round(rnd(100, 260))}px`
      })
    )
  }
  svg.append(rings)
  return svg
}
