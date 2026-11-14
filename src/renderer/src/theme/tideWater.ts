/**
 * 月潮主题的页面切换：简洁的“涌水”，按内容区大小现场生成一张 SVG。
 *
 * 三层纯色水体（浅青、亮蓝、深蓝）依次从上往下灌，后一层叠在前一层上面，每层的下缘是一道舒缓的波浪，
 * 领头那层的波浪上描一条白色亮线；再加几个空心水泡往上浮。别的都不要。
 * 动画在 app.css（tide-* 关键帧）里。
 */

const NS = 'http://www.w3.org/2000/svg'

const LAYERS = [
  { fill: '#8fe0ff', cls: 'tide-layer--1' },
  { fill: '#3a7cf0', cls: 'tide-layer--2' },
  { fill: '#2242d4', cls: 'tide-layer--3' }
] as const

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

/** 一道舒缓的波浪：在 baseY 附近起伏，周期约为宽度的 1/2 ~ 1/1.4。返回从左到右的点 */
function waveEdge(w: number, baseY: number, amp: number): Array<[number, number]> {
  const period = w / rnd(1.4, 2.2)
  const phase = rnd(0, period)
  const tilt = rnd(-0.03, 0.03) * w
  const n = Math.max(24, Math.round(w / 30))
  const pts: Array<[number, number]> = []
  for (let i = 0; i <= n; i++) {
    const x = -20 + ((w + 40) * i) / n
    pts.push([x, baseY + Math.sin(((x + phase) / period) * Math.PI * 2) * amp + (x / w - 0.5) * tilt])
  }
  return pts
}

const line = (pts: Array<[number, number]>): string => pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')

export function buildTideWater(w: number, h: number): SVGSVGElement {
  const svg = el('svg', { class: 'tide-water', viewBox: `0 0 ${w} ${h}`, width: w, height: h, preserveAspectRatio: 'none' })
  const amp = Math.max(10, h * 0.025)

  // 浅青领头、画在最下面；亮蓝、深蓝晚一步，依次叠在上面。灌的过程中前缘露出浅青、亮蓝两道波浪，最后深蓝铺满
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i]!
    // 每层的下缘都在画面外，灌到底时铺满、不留缝
    const edge = waveEdge(w, h + amp * 2 + 8, amp * (1 - i * 0.15))
    const g = el('g', { class: `tide-layer ${layer.cls}` })
    // 顶边在画面上方，右边下来，沿波浪从右往左走回左边
    const back = [...edge].reverse()
    g.append(el('path', { fill: layer.fill, d: `M -20 ${(-h * 0.4).toFixed(1)} L ${w + 20} ${(-h * 0.4).toFixed(1)} L ${line(back)} Z` }))
    if (i === 0) g.append(el('path', { d: `M ${line(edge)}`, fill: 'none', stroke: '#ffffff', 'stroke-width': 3, 'stroke-opacity': 0.9 }))
    svg.append(g)
  }

  // 几个空心水泡
  for (let i = 0; i < 7; i++) {
    const r = rnd(5, 12)
    svg.append(
      el('circle', {
        class: 'tide-ring',
        cx: ((i + rnd(0.2, 0.8)) / 7) * w,
        cy: rnd(0.55, 0.95) * h,
        r,
        fill: 'none',
        stroke: '#c4f1ff',
        'stroke-width': 2,
        style: `--delay:${Math.round(rnd(420, 560))}ms;--rise:${Math.round(rnd(90, 200))}px`
      })
    )
  }
  return svg
}
