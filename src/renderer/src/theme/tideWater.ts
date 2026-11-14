/**
 * 月潮主题的页面切换：一场卡通风格的“涌水”，按内容区大小现场生成一张 SVG。
 *
 * 画法参照平涂动画里的水：不用渐变，全是几种纯色的色块——
 *   深蓝、亮蓝两层水体从上往下灌，下缘是一串大小不一的鼓包，中间那段垂得最深（水柱先落下来）；
 *   浅青、近白的长条水流像冰锥一样从上方刺下来；
 *   一团团圆鼓鼓的浪花在水的前缘和两侧炸开；空心的水泡往上浮。
 * 每次切换随机生成，形状都不一样。动画在 app.css（tide-* 关键帧）里。
 */

const NS = 'http://www.w3.org/2000/svg'

const DEEP = '#1c3fd0'
const MID = '#2f74ee'
const LIGHT = '#6fd6ff'
const PALE = '#bdf1ff'
const WHITE = '#effcff'

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

/**
 * 水体：顶边在画面上方，下缘是一串向下鼓起的圆包；越靠中间垂得越深。
 * 返回路径与最深处距离 baseY 的深度。
 */
function massPath(w: number, h: number, baseY: number, tongue: number, lobe: [number, number]): string {
  const center = rnd(0.4, 0.6) * w
  const spread = w * rnd(0.18, 0.26)
  const depthAt = (x: number): number => tongue * Math.exp(-(((x - center) / spread) ** 2))
  let d = `M ${-40} ${-h} L ${w + 40} ${-h} L ${w + 40} ${baseY + depthAt(w)}`
  let x = w + 40
  while (x > -40) {
    const seg = rnd(lobe[0], lobe[1])
    const nx = Math.max(-40, x - seg)
    const y0 = baseY + depthAt(x)
    const y1 = baseY + depthAt(nx)
    // 一个向下鼓起的圆包：两段三次曲线；鼓包深浅很不均匀，偶尔还有往回缩的凹口
    const bulge = Math.random() < 0.15 ? -seg * rnd(0.1, 0.3) : seg * rnd(0.15, 1.1)
    const mx = (x + nx) / 2
    const my = Math.max(y0, y1) + bulge
    d += ` C ${x} ${y0 + bulge * 0.9}, ${mx + seg * 0.3} ${my}, ${mx} ${my}`
    d += ` C ${mx - seg * 0.3} ${my}, ${nx} ${y1 + bulge * 0.9}, ${nx} ${y1}`
    x = nx
  }
  return `${d} Z`
}

/** 冰锥一样的长条水流：上宽下尖，两侧略带弯 */
function streakPath(x: number, top: number, width: number, len: number, lean: number): string {
  const tipX = x + lean
  const tipY = top + len
  const l = x - width / 2
  const r = x + width / 2
  return (
    `M ${l} ${top}` +
    ` C ${l + width * 0.1} ${top + len * 0.45}, ${tipX - width * 0.25} ${top + len * 0.7}, ${tipX} ${tipY}` +
    ` C ${tipX + width * 0.2} ${top + len * 0.65}, ${r - width * 0.05} ${top + len * 0.4}, ${r} ${top} Z`
  )
}

/** 水体里的一大块亮色：不规则的团块，像动画里水面上的反光与翻起的白浪 */
function blobPath(cx: number, cy: number, rx: number, ry: number): string {
  const n = 7 + Math.floor(Math.random() * 4)
  const pts: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const k = rnd(0.65, 1.15)
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k])
  }
  // 用相邻点的中点串起二次曲线，得到圆润但不规则的轮廓
  const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const [sx, sy] = mid(pts[n - 1]!, pts[0]!)
  let d = `M ${sx} ${sy}`
  for (let i = 0; i < n; i++) {
    const p = pts[i]!
    const [mx, my] = mid(p, pts[(i + 1) % n]!)
    d += ` Q ${p[0]} ${p[1]} ${mx} ${my}`
  }
  return `${d} Z`
}

/** 一团浪花：几个圆叠在一起，外面一层浅青、里面一层更亮 */
function foam(cx: number, cy: number, size: number, delay: number): SVGGElement {
  const g = el('g', { class: 'tide-foam', style: `--delay:${delay}ms;--dx:${rnd(-30, 30)}px;--dy:${rnd(-40, 10)}px` })
  const n = 3 + Math.floor(Math.random() * 3)
  const parts: Array<[number, number, number]> = []
  for (let i = 0; i < n; i++) parts.push([cx + rnd(-0.7, 0.7) * size, cy + rnd(-0.5, 0.5) * size, size * rnd(0.45, 0.8)])
  for (const [x, y, r] of parts) g.append(el('circle', { cx: x, cy: y, r: r + 4, fill: LIGHT }))
  for (const [x, y, r] of parts) g.append(el('circle', { cx: x - r * 0.15, cy: y - r * 0.2, r: r * 0.72, fill: PALE }))
  g.style.transformOrigin = `${cx}px ${cy}px`
  return g
}

export function buildTideWater(w: number, h: number): SVGSVGElement {
  const svg = el('svg', { class: 'tide-water', viewBox: `0 0 ${w} ${h}`, width: w, height: h, preserveAspectRatio: 'none' })

  // 两层水体：亮蓝在前、先到；深蓝在后、最终铺满（下缘落在画面外，底部不留缝）
  const lobeMin = Math.max(50, w / 22)
  const back = el('path', { class: 'tide-mass tide-mass--deep', fill: DEEP, d: massPath(w, h, h + 30, h * 0.18, [lobeMin * 0.8, lobeMin * 3.2]) })
  // 亮蓝水柱：两侧浅、中间一根深深垂下来的“舌头”，像一股水从上方倒进来
  const front = el('g', { class: 'tide-mass tide-mass--mid' })
  front.append(el('path', { fill: MID, d: massPath(w, h, h * 0.22, h * 0.68, [lobeMin * 0.6, lobeMin * 2.6]) }))
  // 水柱上方几大块浅色反光、翻起的白浪
  for (let i = 0; i < 5; i++) {
    const cx = rnd(0.1, 0.9) * w
    const cy = rnd(-0.05, 0.25) * h
    const rx = rnd(0.06, 0.14) * w
    front.append(el('path', { fill: i % 2 === 0 ? LIGHT : PALE, d: blobPath(cx, cy, rx, rx * rnd(0.5, 0.9)) }))
  }
  front.append(el('path', { fill: WHITE, d: blobPath(rnd(0.35, 0.65) * w, rnd(-0.02, 0.12) * h, w * 0.08, h * 0.08) }))
  svg.append(back, front)

  // 刺下来的长条水流
  const streaks = el('g', { class: 'tide-streaks' })
  const count = Math.max(5, Math.round(w / 260))
  for (let i = 0; i < count; i++) {
    const x = ((i + rnd(0.15, 0.85)) / count) * w
    const width = rnd(18, 110)
    const len = h * rnd(0.3, 1.0)
    const p = el('path', {
      class: 'tide-streak',
      fill: Math.random() < 0.4 ? WHITE : PALE,
      d: streakPath(x, -20, width, len, rnd(-40, 40)),
      style: `--delay:${Math.round(rnd(0, 180))}ms`
    })
    streaks.append(p)
  }
  svg.append(streaks)

  // 浪花：集中在水柱前缘附近与两侧
  const foams = el('g', { class: 'tide-foams' })
  const foamCount = Math.max(12, Math.round((w * h) / 60000))
  for (let i = 0; i < foamCount; i++) {
    const side = Math.random()
    const x = side < 0.3 ? rnd(0, 0.2) * w : side > 0.7 ? rnd(0.8, 1) * w : rnd(0.25, 0.75) * w
    const y = rnd(0.1, 0.95) * h
    foams.append(foam(x, y, rnd(14, 60), Math.round(100 + (y / h) * 420 + rnd(0, 80))))
  }
  svg.append(foams)

  // 空心水泡，往上浮
  const rings = el('g', { class: 'tide-rings' })
  for (let i = 0; i < foamCount * 2; i++) {
    const r = rnd(5, 16)
    rings.append(
      el('circle', {
        class: 'tide-ring',
        cx: rnd(0, w),
        cy: rnd(0.35, 1.05) * h,
        r,
        fill: 'none',
        stroke: Math.random() < 0.5 ? PALE : WHITE,
        'stroke-width': Math.max(2, r / 4),
        style: `--delay:${Math.round(rnd(200, 520))}ms;--rise:${Math.round(rnd(120, 320))}px`
      })
    )
  }
  svg.append(rings)
  return svg
}
