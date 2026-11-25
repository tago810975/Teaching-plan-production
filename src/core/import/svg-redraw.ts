/**
 * 让 AI（WorkBuddy）把插图重绘为 SVG：提示词（REDRAW_GUIDE）与交回的 SVG 的检查、净化（validateSvg）。
 *
 * AI 重绘不能保证还原（见 docs/图片导入.md），所以：提示词把“忠实还原”放在第一位；每张图由老师与原图对照后选择用不用。
 * 配色以用户给的示例为准（白底、黑色轮廓、品红 #E95283 矢量箭头、天蓝 #0599D9 虚线辅助框、斜体衬线字母）。
 */
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom'

export const REDRAW_COLORS = { black: '#000000', vector: '#E95283', auxiliary: '#0599D9', fill: '#E6E6E6' } as const

/** 交给 AI 的重绘说明 */
export const REDRAW_GUIDE = `请把下面每张插图重新绘制为 SVG 矢量图，用于物理教学案。第一要求是忠实还原原图：宁可画得朴素，也不要改动内容。

【还原要求】
1. 原图中的每个元素都要画出，不增加、不删除、不合并、不移动：线条、箭头、虚线、圆和圆弧、矩形、磁场符号（× 和 ·）、
   电路元件、坐标轴与刻度、阴影或填充区域、文字标注。不要“美化”或重新构图。
2. 位置与比例和原图一致：viewBox 的宽取 600，高按原图的宽高比；各元素按它在原图中的位置放置。
   直线的方向和交点、元件的连接关系、箭头的指向、曲线的弯曲方向、虚实线必须与原图相同。
3. 文字标注逐字照抄：表示物理量、点、线的字母用斜体，数字、单位、汉字以及电路仪表符号（V、A）用正体；下标、上标照原图，
   用 <tspan baseline-shift="sub" font-size="70%" font-style="normal"> 或 baseline-shift="super"（其中的数字用正体）。
   带圈序号（①②③④）宜用黑色空心 <circle fill="none"> 配居中的正体数字绘制，避免部分字体缺字。
4. 看不清的部分按原图的样子画出最可能的形状，并在 <svg> 内开头用注释 <!-- 不确定：…… --> 写明，不要添加原图没有的东西。

【配色与线型】（教学案统一风格）
- 背景：白色，不画背景矩形。
- 物体、器材、轮廓、导线、坐标轴、尺寸/半径标注、文字：黑色 #000000，实线。
- 矢量（速度、力、电流、位移、场强/磁感线等带箭头的量）：品红 #E95283 实线，箭头为同色实心锐三角形；坐标轴与几何尺寸/半径箭头（d、h、a、b）保持黑色 #000000。
- 表示物体的另一位置、辅助框、辅助线：天蓝 #0599D9 虚线（stroke-dasharray="8 6"）。原图中是虚线的轨迹、辅助线保持虚线。
- 原图是黑白时，只把“物理矢量箭头”画成品红、“另一位置 / 辅助框 / 辅助虚线”画成天蓝虚线，其余用黑色；原图有颜色时按上面的含义归类着色。
- 填充：一般不填充（fill="none"）；原图有灰色或彩色填充（如磁铁、液体、阴影面）时用浅灰 #E6E6E6 或该颜色的浅色，轮廓仍为黑色。空心元件（电阻、电压表 V、电流表 A 等）在元件边界处断开导线，不要用白色填充遮挡背景网格或导线。
- 线宽与字号：按本次任务中每张图给出的“字号、主线宽、细线宽、箭头”（由原图换算并已放大字号、加粗线条与箭头）；
  没有给出时（viewBox 宽 600）：
  - 字号：42–46（不低于 38，高瘦图可放大到 50–54），保证缩小排版到教案栏宽后清晰可读；合理使用 text-anchor 并留出边距，避免被 viewBox 裁切或压线。
  - 线宽：主要轮廓、坐标轴、导线、矢量 stroke-width="3.5"–"4.5"（默认 4；导体棒等强调粗线可再粗 1–1.5，如 4.5–5.5），细线、刻度、磁场符号（× / ·）、虚线 stroke-width="2.5"–"3"（默认 2.5）；拐角 stroke-linejoin="round"。
- 箭头：
  - <marker> 使用 markerUnits="userSpaceOnUse" 与 orient="auto"，实心锐三角形（如 viewBox="0 0 10 10" refX="9" refY="5"，<polygon points="0,0.5 10,5 0,9.5"/>）。
  - 主要箭头（坐标轴、物理矢量）按每张图给出的箭头尺寸绘制；未给出时宽×高约 24×16 ～ 28×19（高瘦图可用 30×21，紧凑图不低于 22×15）。
  - 辅助/尺寸标注箭头（如间距 d、高度 h）略小一档，约 18×13 ～ 20×14；半径与尺寸箭头用 refX="9.5" 或微调端点，使尖端恰好抵到圆周或界线而不越出。
- 文字：font-family="Times New Roman, serif"，黑色；字母加 font-style="italic"。

【SVG 格式】
- 每张图是一个完整的 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 …">，不要依赖外部文件。
- 只用这些元素：svg、g、defs、marker、path、line、polyline、polygon、rect、circle、ellipse、text、tspan、use、title、desc。
  不要 <image>、<script>、<style>、<foreignObject>，不要外部字体或链接。箭头用 <marker> 或 <polygon>。
- 通过工具提交时不要用代码块包起来。`

export interface RedrawSizes {
  fontSize: number
  stroke: number
  thin: number
  arrowWidth: number
  arrowHeight: number
}

/**
 * 由原图换算每张图的字号、线宽与箭头尺寸（viewBox 宽 600）：原图中字高 textHeight 像素、图宽 width 像素。
 * 字号保底 38、主线宽保底 3.5、细线宽保底 2.5、箭头保底 22×15，保证缩小排版后文字、线条与箭头清晰醒目。
 */
export function redrawSizes(width: number, textHeight: number): RedrawSizes {
  const k = 600 / Math.max(1, width)
  const round = (v: number, step: number): number => Math.round(v / step) * step
  const fontSize = Math.max(38, Math.min(90, Math.round(textHeight * k)))
  const stroke = Math.max(3.5, Math.min(10, round(fontSize / 11, 0.5)))
  const thin = Math.max(2.5, Math.min(7, round(fontSize / 16, 0.5)))
  const arrowWidth = Math.max(22, Math.min(44, Math.round(fontSize * 0.58)))
  const arrowHeight = Math.max(15, Math.min(30, Math.round(arrowWidth * 0.68)))
  return { fontSize, stroke, thin, arrowWidth, arrowHeight }
}

export interface SvgCheck {
  ok: boolean
  /** 净化后的 SVG（ok 时） */
  svg?: string
  /** 宽高比（viewBox 的宽 / 高） */
  aspect?: number
  issues: string[]
}

const MAX_SVG = 400 * 1024
const ALLOWED = new Set(['svg', 'g', 'defs', 'marker', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'use', 'title', 'desc', 'lineargradient', 'radialgradient', 'stop', 'clippath'])
const DRAWING = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'use'])

/** 检查并净化 AI 交回的 SVG：合法、有 viewBox、只有允许的元素；去掉脚本、事件、外部链接 */
export function validateSvg(input: string): SvgCheck {
  const issues: string[] = []
  // 去掉代码块围栏与 SVG 之外的文字
  let text = input.replace(/^\s*```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const start = text.search(/<svg[\s>]/i)
  const end = text.lastIndexOf('</svg>')
  if (start < 0 || end < 0) return { ok: false, issues: ['没有找到完整的 <svg>…</svg>'] }
  text = text.slice(start, end + 6)
  if (text.length > MAX_SVG) return { ok: false, issues: [`SVG 太大（${Math.round(text.length / 1024)} KB，上限 ${MAX_SVG / 1024} KB），请简化路径`] }

  const errors: string[] = []
  let doc: ReturnType<DOMParser['parseFromString']>
  try {
    doc = new DOMParser({
      onError: (level: string, msg: string) => {
        if (level !== 'warning') errors.push(msg)
      }
    }).parseFromString(text, 'image/svg+xml')
  } catch (e) {
    return { ok: false, issues: [`SVG 不是合法的 XML：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`] }
  }
  const root = doc.documentElement
  if (errors.length > 0 || root === null || root.localName !== 'svg') {
    return { ok: false, issues: [`SVG 不是合法的 XML：${(errors[0] ?? '根元素不是 <svg>').slice(0, 120)}`] }
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  // viewBox：没有时由 width / height 补上
  let vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || vb[2]! <= 0 || vb[3]! <= 0) {
    const w = parseFloat(root.getAttribute('width') ?? '')
    const h = parseFloat(root.getAttribute('height') ?? '')
    if (w > 0 && h > 0) {
      vb = [0, 0, w, h]
      root.setAttribute('viewBox', `0 0 ${w} ${h}`)
    } else return { ok: false, issues: ['<svg> 缺少 viewBox（如 viewBox="0 0 600 400"）'] }
  }
  // 宽高按 viewBox 写死（导出时按它栅格化）
  root.setAttribute('width', String(vb[2]))
  root.setAttribute('height', String(vb[3]))

  let drawings = 0
  const removed = new Set<string>()
  const walk = (el: Element): void => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== 1) continue
      const c = child as Element
      const name = (c.localName ?? c.nodeName).toLowerCase()
      if (!ALLOWED.has(name)) {
        removed.add(name)
        el.removeChild(c)
        continue
      }
      if (DRAWING.has(name)) drawings++
      for (const attr of Array.from(c.attributes)) {
        const an = attr.name.toLowerCase()
        const v = attr.value
        // 事件、外部链接、样式中的外部地址
        if (an.startsWith('on') || ((an === 'href' || an === 'xlink:href') && !v.startsWith('#')) || /url\(\s*['"]?(?!#)/i.test(v)) c.removeAttribute(attr.name)
      }
      walk(c)
    }
  }
  for (const attr of Array.from(root.attributes)) if (attr.name.toLowerCase().startsWith('on')) root.removeAttribute(attr.name)
  walk(root)
  if (removed.size > 0) issues.push(`已去掉不允许的元素：${[...removed].map((n) => `<${n}>`).join('、')}（请只用说明中列出的元素）`)
  if (drawings === 0) return { ok: false, issues: ['SVG 里没有任何图形'] }
  return { ok: true, svg: new XMLSerializer().serializeToString(doc), aspect: vb[2]! / vb[3]!, issues }
}
