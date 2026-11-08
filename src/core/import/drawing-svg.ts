/**
 * Word / WPS 中用形状画的示意图（DrawingML 的 wps:wsp 形状与 wpg:wgp 组合）→ SVG 图片。
 *
 * 物理题里的磁场、轨迹、受力分析图常常是用直线、圆、圆弧、箭头、“×”符号和文本框拼成的，
 * 没有对应的图片文件。这里把它们逐个转成 SVG 元素，得到一张矢量图：
 * 预览中直接显示，导出 Word 时由界面转成高清 PNG。
 *
 * 坐标单位保持 EMU（SVG 的 viewBox 即 EMU），避免换算误差。
 */
import { attr, child, children, descendants, escapeXml, NS, type Element } from '../xml/dom'

const { a: A, w: W, m: M } = NS
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
const R_NS = NS.r

/** 文本默认字号（半磅）：五号 */
const DEFAULT_SIZE_HALF_PT = 21
const EMU_PER_PT = 12700

export interface ResolvedImage {
  mime: string
  base64: string
}

export interface DrawingSvg {
  svg: string
  widthEmu: number
  heightEmu: number
}

/** 判断 graphicData 中是否为可渲染的形状或组合 */
export function isShapeDrawing(graphicData: Element): boolean {
  return children(graphicData).some(
    (c) => (c.namespaceURI === WPS && c.localName === 'wsp') || (c.namespaceURI === WPG && c.localName === 'wgp')
  )
}

/** 文字达到这个长度的单个形状视为“文字框”，按文字导入以便编辑 */
const TEXT_FRAME_MIN_CHARS = 10

/**
 * 单个形状是否应当作为“文字框”按文字导入，而不是渲染成图片：
 * - 无边框无填充，只为了放文字；或
 * - 框里是成段的文字（如知识梳理中带边框的知识点框）。转成图片会无法编辑。
 * 组合图形（示意图）中的文字是简短标注，始终随图形渲染。
 */
export function isPlainTextBox(graphicData: Element): boolean {
  const wsp = children(graphicData).find((c) => c.namespaceURI === WPS && c.localName === 'wsp')
  if (wsp === undefined) return false
  const content = descendants(wsp, W, 'txbxContent')[0]
  if (content === undefined) return false
  const spPr = child(wsp, WPS, 'spPr')
  if (spPr !== undefined && !hasVisibleFill(spPr) && !hasVisibleLine(wsp, spPr)) return true
  const text = descendants(content, W, 't')
    .map((t) => t.textContent ?? '')
    .join('')
    .replace(/\s/g, '')
  return [...text].length >= TEXT_FRAME_MIN_CHARS || descendants(content, NS.m, 'oMath').length > 0
}

/**
 * 渲染 graphicData 中的形状或组合。
 * widthEmu / heightEmu 为外层 wp:extent 给出的显示尺寸；resolveImage 根据关系 ID 取图片数据。
 */
export function drawingToSvg(
  graphicData: Element,
  widthEmu: number,
  heightEmu: number,
  resolveImage: (rid: string) => ResolvedImage | undefined
): DrawingSvg | null {
  const ctx: Ctx = { defs: new Map(), resolveImage, idCounter: 0 }
  let body = ''
  for (const c of children(graphicData)) {
    if (c.namespaceURI === WPG && c.localName === 'wgp') body += group(c, ctx, true)
    else if (c.namespaceURI === WPS && c.localName === 'wsp') body += shape(c, ctx, { x: 0, y: 0, cx: widthEmu, cy: heightEmu })
  }
  if (body === '') return null
  const defs = ctx.defs.size > 0 ? `<defs>${[...ctx.defs.values()].join('')}</defs>` : ''
  const w = Math.max(1, Math.round(widthEmu))
  const h = Math.max(1, Math.round(heightEmu))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${(w / EMU_PER_PT).toFixed(2)}pt" height="${(h / EMU_PER_PT).toFixed(2)}pt" viewBox="0 0 ${w} ${h}" overflow="visible">` +
    `${defs}${body}</svg>`
  return { svg, widthEmu: w, heightEmu: h }
}

interface Ctx {
  defs: Map<string, string>
  resolveImage: (rid: string) => ResolvedImage | undefined
  idCounter: number
}

interface Box {
  x: number
  y: number
  cx: number
  cy: number
}

// ---------------- 组合 ----------------

function group(g: Element, ctx: Ctx, isRoot: boolean): string {
  const grpSpPr = child(g, WPG, 'grpSpPr')
  const xfrm = grpSpPr && child(grpSpPr, A, 'xfrm')
  const off = point(xfrm && child(xfrm, A, 'off'))
  const ext = size(xfrm && child(xfrm, A, 'ext'))
  const chOff = point(xfrm && child(xfrm, A, 'chOff'))
  const chExt = size(xfrm && child(xfrm, A, 'chExt'))
  // 子形状坐标（chOff / chExt 空间）映射到组合的外框（off / ext）
  const sx = chExt.cx > 0 ? ext.cx / chExt.cx : 1
  const sy = chExt.cy > 0 ? ext.cy / chExt.cy : 1
  const ox = isRoot ? 0 : off.x
  const oy = isRoot ? 0 : off.y
  let inner = ''
  for (const c of children(g)) {
    if (c.localName === 'wsp') inner += shape(c, ctx)
    else if (c.localName === 'grpSp') inner += group(c, ctx, false)
    else if (c.localName === 'pic') inner += picture(c, ctx)
  }
  return `<g transform="translate(${ox} ${oy}) scale(${sx} ${sy}) translate(${-chOff.x} ${-chOff.y})">${inner}</g>`
}

// ---------------- 形状 ----------------

function shape(wsp: Element, ctx: Ctx, fallbackBox?: Box): string {
  const spPr = child(wsp, WPS, 'spPr')
  if (spPr === undefined) return ''
  const xfrm = child(spPr, A, 'xfrm')
  const box: Box = xfrm !== undefined ? { ...point(child(xfrm, A, 'off')), ...size(child(xfrm, A, 'ext')) } : (fallbackBox ?? { x: 0, y: 0, cx: 0, cy: 0 })
  const transform = shapeTransform(xfrm, box)

  const stroke = lineStyle(wsp, spPr, ctx)
  const fill = fillColor(wsp, spPr)
  const geometry = shapeGeometry(spPr, box.cx, box.cy)
  const style = `fill="${fill}" ${stroke.attrs}`
  let out = ''
  if (geometry !== null) {
    if (geometry.kind === 'path') {
      // 开放路径（直线、圆弧）不填充，并可带线端箭头
      out += geometry.open
        ? `<path d="${geometry.d}" fill="none" ${stroke.attrs}${stroke.markers}/>`
        : `<path d="${geometry.d}" ${style}/>`
    } else {
      out += geometry.svg.replace('/>', ` ${style}/>`)
    }
  }
  // 文本框中的文字不随形状翻转
  const text = textBox(wsp, box.cx, box.cy)
  return `<g transform="${transform}">${out}</g>${text === '' ? '' : `<g transform="translate(${box.x} ${box.y})">${text}</g>`}`
}

function shapeTransform(xfrm: Element | undefined, box: Box): string {
  const rot = Number(xfrm?.getAttribute('rot') ?? 0) / 60000
  const flipH = xfrm?.getAttribute('flipH') === '1'
  const flipV = xfrm?.getAttribute('flipV') === '1'
  const cx = box.cx / 2
  const cy = box.cy / 2
  let t = `translate(${box.x} ${box.y})`
  if (rot !== 0) t += ` rotate(${rot} ${cx} ${cy})`
  if (flipH || flipV) t += ` translate(${cx} ${cy}) scale(${flipH ? -1 : 1} ${flipV ? -1 : 1}) translate(${-cx} ${-cy})`
  return t
}

type Geometry = { kind: 'path'; d: string; open: boolean } | { kind: 'svg'; svg: string }

function shapeGeometry(spPr: Element, w: number, h: number): Geometry | null {
  const cust = child(spPr, A, 'custGeom')
  if (cust !== undefined) return customPath(cust, w, h)
  const prst = child(spPr, A, 'prstGeom')
  const name = prst?.getAttribute('prst') ?? 'rect'
  const adj = adjustValues(prst)
  const path = (d: string, open = false): Geometry => ({ kind: 'path', d, open })
  switch (name) {
    case 'rect':
    case 'flowChartProcess':
      return { kind: 'svg', svg: `<rect x="0" y="0" width="${w}" height="${h}"/>` }
    case 'roundRect': {
      const r = (Math.min(w, h) * (adj.adj ?? 16667)) / 100000
      return { kind: 'svg', svg: `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}"/>` }
    }
    case 'ellipse':
    case 'flowChartConnector':
      return { kind: 'svg', svg: `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>` }
    case 'line':
    case 'straightConnector1':
    case 'bentConnector2':
    case 'bentConnector3':
    case 'curvedConnector3':
      return path(`M0 0L${w} ${h}`, true)
    case 'triangle': {
      const top = (w * (adj.adj ?? 50000)) / 100000
      return path(`M${top} 0L${w} ${h}L0 ${h}Z`)
    }
    case 'rtTriangle':
      return path(`M0 0L${w} ${h}L0 ${h}Z`)
    case 'diamond':
      return path(`M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`)
    case 'parallelogram': {
      const o = (Math.min(w, h) * (adj.adj ?? 25000)) / 100000
      return path(`M${o} 0L${w} 0L${w - o} ${h}L0 ${h}Z`)
    }
    case 'trapezoid': {
      const o = (Math.min(w, h) * (adj.adj ?? 25000)) / 100000
      return path(`M${o} 0L${w - o} 0L${w} ${h}L0 ${h}Z`)
    }
    case 'mathMultiply': {
      // “×”：用两条对角线表示（与磁场符号的观感一致）
      const i = Math.min(w, h) * 0.2
      return path(`M${i} ${i}L${w - i} ${h - i}M${w - i} ${i}L${i} ${h - i}`, true)
    }
    case 'mathPlus': {
      const i = Math.min(w, h) * 0.15
      return path(`M${w / 2} ${i}L${w / 2} ${h - i}M${i} ${h / 2}L${w - i} ${h / 2}`, true)
    }
    case 'mathMinus':
      return path(`M${w * 0.15} ${h / 2}L${w * 0.85} ${h / 2}`, true)
    case 'arc': {
      // 椭圆弧：adj1 起始角、adj2 终止角（单位 1/60000 度，顺时针）
      const st = ((adj.adj1 ?? 16200000) / 60000) * (Math.PI / 180)
      const en = ((adj.adj2 ?? 0) / 60000) * (Math.PI / 180)
      return path(ellipseArc(w / 2, h / 2, w / 2, h / 2, st, en), true)
    }
    case 'rightArrow':
    case 'leftArrow':
    case 'upArrow':
    case 'downArrow':
      return path(blockArrow(name, w, h))
    default:
      return { kind: 'svg', svg: `<rect x="0" y="0" width="${w}" height="${h}"/>` }
  }
}

function adjustValues(prst: Element | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  const av = prst && child(prst, A, 'avLst')
  for (const gd of av ? children(av, A, 'gd') : []) {
    const m = /val\s+(-?\d+)/.exec(gd.getAttribute('fmla') ?? '')
    if (m !== null) out[gd.getAttribute('name') ?? ''] = Number(m[1])
  }
  return out
}

function ellipseArc(cx: number, cy: number, rx: number, ry: number, st: number, en: number): string {
  let sweep = en - st
  if (sweep <= 0) sweep += Math.PI * 2
  const x1 = cx + rx * Math.cos(st)
  const y1 = cy + ry * Math.sin(st)
  const x2 = cx + rx * Math.cos(st + sweep)
  const y2 = cy + ry * Math.sin(st + sweep)
  return `M${x1} ${y1}A${rx} ${ry} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}`
}

function blockArrow(name: string, w: number, h: number): string {
  const right = `M0 ${h * 0.25}L${w * 0.6} ${h * 0.25}L${w * 0.6} 0L${w} ${h / 2}L${w * 0.6} ${h}L${w * 0.6} ${h * 0.75}L0 ${h * 0.75}Z`
  if (name === 'rightArrow') return right
  if (name === 'leftArrow') return `M${w} ${h * 0.25}L${w * 0.4} ${h * 0.25}L${w * 0.4} 0L0 ${h / 2}L${w * 0.4} ${h}L${w * 0.4} ${h * 0.75}L${w} ${h * 0.75}Z`
  if (name === 'upArrow') return `M${w * 0.25} ${h}L${w * 0.25} ${h * 0.4}L0 ${h * 0.4}L${w / 2} 0L${w} ${h * 0.4}L${w * 0.75} ${h * 0.4}L${w * 0.75} ${h}Z`
  return `M${w * 0.25} 0L${w * 0.25} ${h * 0.6}L0 ${h * 0.6}L${w / 2} ${h}L${w} ${h * 0.6}L${w * 0.75} ${h * 0.6}L${w * 0.75} 0Z`
}

/** 自定义几何：路径坐标在 path 的 w/h 空间中，按形状尺寸缩放 */
function customPath(cust: Element, w: number, h: number): Geometry | null {
  const pathLst = child(cust, A, 'pathLst')
  if (pathLst === undefined) return null
  let d = ''
  let open = true
  for (const p of children(pathLst, A, 'path')) {
    const pw = Number(p.getAttribute('w') ?? w) || w
    const ph = Number(p.getAttribute('h') ?? h) || h
    const sx = w / pw
    const sy = h / ph
    const pt = (e: Element): string => `${Number(e.getAttribute('x')) * sx} ${Number(e.getAttribute('y')) * sy}`
    let cur = { x: 0, y: 0 }
    for (const cmd of children(p)) {
      const pts = children(cmd, A, 'pt')
      switch (cmd.localName) {
        case 'moveTo':
          d += `M${pt(pts[0]!)}`
          cur = { x: Number(pts[0]!.getAttribute('x')) * sx, y: Number(pts[0]!.getAttribute('y')) * sy }
          break
        case 'lnTo':
          d += `L${pt(pts[0]!)}`
          cur = { x: Number(pts[0]!.getAttribute('x')) * sx, y: Number(pts[0]!.getAttribute('y')) * sy }
          break
        case 'cubicBezTo':
          d += `C${pts.map(pt).join(' ')}`
          cur = { x: Number(pts[2]!.getAttribute('x')) * sx, y: Number(pts[2]!.getAttribute('y')) * sy }
          break
        case 'quadBezTo':
          d += `Q${pts.map(pt).join(' ')}`
          cur = { x: Number(pts[1]!.getAttribute('x')) * sx, y: Number(pts[1]!.getAttribute('y')) * sy }
          break
        case 'arcTo': {
          // 当前点位于椭圆上 stAng 处，沿 swAng 转动
          const wR = Number(cmd.getAttribute('wR')) * sx
          const hR = Number(cmd.getAttribute('hR')) * sy
          const st = (Number(cmd.getAttribute('stAng')) / 60000) * (Math.PI / 180)
          const sw = (Number(cmd.getAttribute('swAng')) / 60000) * (Math.PI / 180)
          const cx = cur.x - wR * Math.cos(st)
          const cy = cur.y - hR * Math.sin(st)
          const x2 = cx + wR * Math.cos(st + sw)
          const y2 = cy + hR * Math.sin(st + sw)
          d += `A${wR} ${hR} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${x2} ${y2}`
          cur = { x: x2, y: y2 }
          break
        }
        case 'close':
          d += 'Z'
          open = false
          break
      }
    }
  }
  return d === '' ? null : { kind: 'path', d, open }
}

// ---------------- 线条与填充 ----------------

function lineStyle(wsp: Element, spPr: Element, ctx: Ctx): { attrs: string; markers: string } {
  const ln = child(spPr, A, 'ln')
  if (!hasVisibleLine(wsp, spPr)) return { attrs: 'stroke="none"', markers: '' }
  const color = colorOf(ln) ?? styleColor(wsp, 'lnRef') ?? '#000000'
  const width = Number(ln?.getAttribute('w') ?? 9525)
  const dash = attr(ln && child(ln, A, 'prstDash'), A, 'val') ?? (ln && child(ln, A, 'prstDash')?.getAttribute('val')) ?? 'solid'
  const dashArray = DASHES[dash]
  let attrs = `stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`
  if (dashArray !== undefined) attrs += ` stroke-dasharray="${dashArray.map((d) => d * width).join(' ')}"`
  let markers = ''
  const head = ln && child(ln, A, 'headEnd')
  const tail = ln && child(ln, A, 'tailEnd')
  const headId = marker(head, color, ctx, width, true)
  const tailId = marker(tail, color, ctx, width, false)
  if (headId !== null) markers += ` marker-start="url(#${headId})"`
  if (tailId !== null) markers += ` marker-end="url(#${tailId})"`
  return { attrs, markers }
}

const DASHES: Record<string, number[]> = {
  dash: [4, 3],
  sysDash: [3, 1],
  dot: [1, 1],
  sysDot: [1, 1],
  dashDot: [4, 3, 1, 3],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  sysDashDot: [3, 1, 1, 1]
}

/**
 * 线端箭头：尺寸按线宽计算，但不小于下限——细线（0.5 磅）上的箭头在 Word 中也清晰可见。
 * 尺寸单位为 EMU（与 viewBox 一致）。
 */
function marker(end: Element | undefined, color: string, ctx: Ctx, lineWidth: number, atStart: boolean): string | null {
  const type = end?.getAttribute('type') ?? 'none'
  if (type === 'none') return null
  const factor = (v: string | null): number => (v === 'sm' ? 2 : v === 'lg' ? 5 : 3)
  const unit = Math.max(lineWidth, 9525) * 1.6
  const w = Math.round(factor(end?.getAttribute('w') ?? null) * unit)
  const len = Math.round(factor(end?.getAttribute('len') ?? null) * unit)
  const id = `m-${type}-${w}-${len}-${color.slice(1)}-${atStart ? 's' : 'e'}`
  if (!ctx.defs.has(id)) {
    const shapeSvg =
      type === 'oval'
        ? `<ellipse cx="${len / 2}" cy="${w / 2}" rx="${len / 2}" ry="${w / 2}" fill="${color}"/>`
        : type === 'arrow'
          ? `<path d="M0 0L${len} ${w / 2}L0 ${w}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`
          : type === 'stealth'
            ? `<path d="M0 0L${len} ${w / 2}L0 ${w}L${len * 0.3} ${w / 2}Z" fill="${color}"/>`
            : `<path d="M0 0L${len} ${w / 2}L0 ${w}Z" fill="${color}"/>`
    // 箭头尖端对准线的端点
    const refX = type === 'oval' ? len / 2 : len
    ctx.defs.set(
      id,
      `<marker id="${id}" viewBox="0 0 ${len} ${w}" refX="${refX}" refY="${w / 2}" markerWidth="${len}" markerHeight="${w}" markerUnits="userSpaceOnUse" orient="${atStart ? 'auto-start-reverse' : 'auto'}" overflow="visible">${shapeSvg}</marker>`
    )
  }
  return id
}

function hasVisibleLine(wsp: Element, spPr: Element): boolean {
  const ln = child(spPr, A, 'ln')
  if (ln !== undefined) return child(ln, A, 'noFill') === undefined
  // 未设置线条时看样式引用：lnRef idx 为 0 表示无线条
  const lnRef = descendants(wsp, A, 'lnRef')[0]
  return lnRef !== undefined && lnRef.getAttribute('idx') !== '0'
}

function hasVisibleFill(spPr: Element): boolean {
  return child(spPr, A, 'solidFill') !== undefined || child(spPr, A, 'gradFill') !== undefined
}

function fillColor(wsp: Element, spPr: Element): string {
  if (child(spPr, A, 'noFill') !== undefined) return 'none'
  const solid = child(spPr, A, 'solidFill')
  if (solid !== undefined) return colorOf(spPr, 'solidFill') ?? '#000000'
  const grad = child(spPr, A, 'gradFill')
  if (grad !== undefined) return colorFromFill(descendants(grad, A, 'gs')[0]) ?? '#cccccc'
  // 未设置填充时看样式引用
  const fillRef = descendants(wsp, A, 'fillRef')[0]
  return fillRef !== undefined && fillRef.getAttribute('idx') !== '0' ? (colorFromFill(fillRef) ?? '#ffffff') : 'none'
}

function colorOf(parent: Element | undefined, fillName = 'solidFill'): string | undefined {
  const solid = parent && child(parent, A, fillName)
  return colorFromFill(solid)
}

/** 从包含 srgbClr / schemeClr / prstClr 的元素取颜色 */
function colorFromFill(el: Element | undefined): string | undefined {
  if (el === undefined) return undefined
  const srgb = child(el, A, 'srgbClr')
  if (srgb !== undefined) return `#${srgb.getAttribute('val') ?? '000000'}`
  const scheme = child(el, A, 'schemeClr')
  if (scheme !== undefined) return SCHEME[scheme.getAttribute('val') ?? ''] ?? '#000000'
  const prst = child(el, A, 'prstClr')
  if (prst !== undefined) return PRESET[prst.getAttribute('val') ?? ''] ?? '#000000'
  return undefined
}

function styleColor(wsp: Element, refName: string): string | undefined {
  return colorFromFill(descendants(wsp, A, refName)[0])
}

/** Office 默认主题色 */
const SCHEME: Record<string, string> = {
  tx1: '#000000',
  dk1: '#000000',
  bg1: '#ffffff',
  lt1: '#ffffff',
  tx2: '#44546a',
  dk2: '#44546a',
  bg2: '#e7e6e6',
  lt2: '#e7e6e6',
  accent1: '#4472c4',
  accent2: '#ed7d31',
  accent3: '#a5a5a5',
  accent4: '#ffc000',
  accent5: '#5b9bd5',
  accent6: '#70ad47'
}

const PRESET: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000' }

// ---------------- 文本框 ----------------

function textBox(wsp: Element, w: number, h: number): string {
  const content = descendants(wsp, W, 'txbxContent')[0]
  if (content === undefined) return ''
  const bodyPr = child(wsp, WPS, 'bodyPr')
  const lIns = Number(bodyPr?.getAttribute('lIns') ?? 91440)
  const tIns = Number(bodyPr?.getAttribute('tIns') ?? 45720)
  const rIns = Number(bodyPr?.getAttribute('rIns') ?? 91440)
  const bIns = Number(bodyPr?.getAttribute('bIns') ?? 45720)
  const anchor = bodyPr?.getAttribute('anchor') ?? 't'

  const lines: Array<{ spans: string; size: number; align: string }> = []
  for (const p of descendants(content, W, 'p')) {
    const pPr = child(p, W, 'pPr')
    const align = attr(pPr && child(pPr, W, 'jc'), W, 'val') ?? 'left'
    const defaultSize = sizeOf(pPr && child(pPr, W, 'rPr'))
    let spans = ''
    let maxSize = 0
    for (const node of allDescendants(p)) {
      if (node.namespaceURI === W && node.localName === 'r' && !isInsideMath(node)) {
        const rPr = child(node, W, 'rPr')
        const text = children(node, W, 't').map((t) => t.textContent ?? '').join('')
        if (text === '') continue
        const size = sizeOf(rPr) ?? defaultSize ?? DEFAULT_SIZE_HALF_PT
        maxSize = Math.max(maxSize, size)
        spans += tspan(text, size, {
          italic: attr(rPr && child(rPr, W, 'i'), W, 'val') !== '0' && rPr !== undefined && child(rPr, W, 'i') !== undefined,
          bold: rPr !== undefined && child(rPr, W, 'b') !== undefined && attr(child(rPr, W, 'b'), W, 'val') !== '0',
          script: attr(rPr && child(rPr, W, 'vertAlign'), W, 'val'),
          color: attr(rPr && child(rPr, W, 'color'), W, 'val')
        })
      } else if (node.namespaceURI === M && node.localName === 'oMath') {
        // 文本框中的公式：按文字显示，字母用斜体
        const size = defaultSize ?? DEFAULT_SIZE_HALF_PT
        maxSize = Math.max(maxSize, size)
        for (const r of descendants(node, M, 'r')) {
          const text = descendants(r, M, 't').map((t) => t.textContent ?? '').join('')
          const inSub = r.parentNode !== null && (r.parentNode as Element).localName === 'sub'
          const inSup = r.parentNode !== null && (r.parentNode as Element).localName === 'sup'
          spans += tspan(text, size, { italic: /[A-Za-z]/.test(text), script: inSub ? 'subscript' : inSup ? 'superscript' : undefined })
        }
      }
    }
    lines.push({ spans, size: maxSize || defaultSize || DEFAULT_SIZE_HALF_PT, align })
  }
  if (lines.every((l) => l.spans === '')) return ''

  const lineHeights = lines.map((l) => (l.size / 2) * EMU_PER_PT * 1.25)
  const total = lineHeights.reduce((a, b) => a + b, 0)
  const avail = h - tIns - bIns
  let y = tIns + (anchor === 'ctr' ? (avail - total) / 2 : anchor === 'b' ? avail - total : 0)
  let out = ''
  lines.forEach((line, i) => {
    const lh = lineHeights[i]!
    y += lh
    if (line.spans === '') return
    const x = line.align === 'center' ? w / 2 : line.align === 'right' ? w - rIns : lIns
    const anchorAttr = line.align === 'center' ? 'middle' : line.align === 'right' ? 'end' : 'start'
    out += `<text x="${pt(x)}" y="${pt(y - lh * 0.22)}" text-anchor="${anchorAttr}" font-family="'Times New Roman', SimSun, serif">${line.spans}</text>`
  })
  // 文字以“磅”为单位书写再整体放大：浏览器对字号有上限，直接用 EMU（9 磅 = 114300）会被截断成小点
  return out === '' ? '' : `<g transform="scale(${EMU_PER_PT})">${out}</g>`
}

function tspan(
  text: string,
  sizeHalfPt: number,
  o: { italic?: boolean; bold?: boolean; script?: string | undefined; color?: string | undefined }
): string {
  const size = sizeHalfPt / 2 // 磅，见 textBox 中的说明
  const script = o.script === 'subscript' || o.script === 'superscript'
  const r2 = (n: number): number => Math.round(n * 100) / 100
  const attrs = [
    `font-size="${r2(script ? size * 0.65 : size)}"`,
    o.italic === true ? 'font-style="italic"' : '',
    o.bold === true ? 'font-weight="bold"' : '',
    o.color !== undefined && o.color !== 'auto' ? `fill="#${o.color}"` : '',
    o.script === 'subscript' ? `baseline-shift="${r2(-size * 0.2)}"` : o.script === 'superscript' ? `baseline-shift="${r2(size * 0.35)}"` : ''
  ]
    .filter(Boolean)
    .join(' ')
  return `<tspan ${attrs}>${escapeXml(text)}</tspan>`
}

/** EMU → 磅，保留两位小数 */
function pt(emu: number): number {
  return Math.round((emu / EMU_PER_PT) * 100) / 100
}

function sizeOf(rPr: Element | undefined): number | undefined {
  const v = attr(rPr && child(rPr, W, 'sz'), W, 'val')
  return v === undefined ? undefined : Number(v)
}

/** 文档顺序的全部后代元素（xmldom 的 getElementsByTagNameNS 不支持通配符） */
function allDescendants(el: Element): Element[] {
  const out: Element[] = []
  const walk = (e: Element): void => {
    for (const c of children(e)) {
      out.push(c)
      walk(c)
    }
  }
  walk(el)
  return out
}

function isInsideMath(el: Element): boolean {
  for (let p = el.parentNode as Element | null; p !== null; p = p.parentNode as Element | null) {
    if (p.namespaceURI === M) return true
  }
  return false
}

// ---------------- 图片 ----------------

/** 组合中的图片，支持 srcRect 裁剪 */
function picture(pic: Element, ctx: Ctx): string {
  const blip = descendants(pic, A, 'blip')[0]
  const rid = blip?.getAttributeNS(R_NS, 'embed')
  const img = rid ? ctx.resolveImage(rid) : undefined
  const spPr = child(pic, PIC, 'spPr')
  const xfrm = spPr && child(spPr, A, 'xfrm')
  if (img === undefined || xfrm === undefined) return ''
  const box = { ...point(child(xfrm, A, 'off')), ...size(child(xfrm, A, 'ext')) }
  const src = descendants(pic, A, 'srcRect')[0]
  const crop = (k: string): number => Number(src?.getAttribute(k) ?? 0) / 100000
  const l = crop('l')
  const t = crop('t')
  const r = crop('r')
  const b = crop('b')
  // 用嵌套 SVG 的 viewBox 实现裁剪：图片按 1×1 拉伸，viewBox 只取保留的部分
  const href = `data:${img.mime};base64,${img.base64}`
  return (
    `<svg x="${box.x}" y="${box.y}" width="${box.cx}" height="${box.cy}" viewBox="${l} ${t} ${Math.max(0.0001, 1 - l - r)} ${Math.max(0.0001, 1 - t - b)}" preserveAspectRatio="none">` +
    `<image x="0" y="0" width="1" height="1" preserveAspectRatio="none" href="${href}" xlink:href="${href}"/></svg>`
  )
}

// ---------------- 工具 ----------------

function point(el: Element | undefined): { x: number; y: number } {
  return { x: Number(el?.getAttribute('x') ?? 0), y: Number(el?.getAttribute('y') ?? 0) }
}

function size(el: Element | undefined): { cx: number; cy: number } {
  return { cx: Number(el?.getAttribute('cx') ?? 0), cy: Number(el?.getAttribute('cy') ?? 0) }
}
