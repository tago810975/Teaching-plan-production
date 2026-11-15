/**
 * 从文字导入题目（图片识别的公共部分）：AI 把题目图片转写成约定格式的文字（FORMAT_GUIDE），
 * 这里转成段落后交给现有的识别器（recognize），再按格式预设整理——与导入 Word 走同一套规则。
 *
 * 文字格式：
 * - 一行一段；题号“1．”、选项“A．”、小问“（1）”、标签【答案】【解析】【知识点】……与 Word 文档相同
 * - 公式：$…$ 为行内公式，单独一行的 $$…$$ 为行间公式；也认 \(…\) 与 \[…\]
 * - 插图：在出现的位置写 [图1]、[图2]……导入时换成在原图上框选出的图片（没有框选的保留文字并提示）
 * - AI 常带的 Markdown：**加粗** 转为加粗，行首的 #、-、> 等记号去掉
 *
 * 复制粘贴入口与 WorkBuddy 的 MCP 工具都用这里的 FORMAT_GUIDE 与 importText / checkText。
 */
import { createEmptyProject } from '../model/factory'
import { collectAssetRefs } from '../project-file/codec'
import type { Asset, Block, Inline, TextMarks } from '../model/types'
import { getPreset } from '../presets'
import { latexToOmml } from '../math/mathml-to-omml'
import type { ReadParagraph } from './docx-reader'
import { normalizeFonts } from './normalize-fonts'
import { applyPresetRules } from './preset-rules'
import { recognize } from './recognize'
import { recognizeHandbook } from './recognize-handbook'

/** 交给 AI 的格式说明（复制给任意 AI 工具，或由 WorkBuddy 的工具返回） */
export const FORMAT_GUIDE = `请把图片中的题目逐字转写成下面的格式，用于导入“教学案制作”软件。

【必须遵守】
1. 逐字转写图片中的内容：不要解题、不要补全、不要改写、不要省略，也不要添加图片中没有的内容。
   图片中没有答案或解析，就不要写【答案】【解析】。
2. 看不清的字写成【?】，不要猜。
3. 只输出转写结果，不要输出说明、不要用代码块包起来。

【格式】
- 一行一段。题号写成“1．”“2．”（数字加全角句点），按图片中的题号。
- 单选、多选等说明照原样写在题干开头，如“（多选）”。
- 选项写成“A．”“B．”“C．”“D．”，可以写在同一行，也可以一行一个。
- 小问写成“（1）”“（2）”，各占一行。
- 答案、解析等另起一行，用【答案】【解析】【点睛】等标签开头，后面接内容。
- 所有公式、物理量符号、单位中的上下标都用 LaTeX 写在 $ 和 $ 之间，例如 $v_0$、$F=qvB$、$\\frac{mv}{qB}$、$1.6\\times10^{-19}\\,\\mathrm{C}$。
  单独成行的长公式写成 $$…$$。不要用 Unicode 上下标（如 v₀、m²）。
- 插图、示意图、电路图：在它出现的位置单独写一行 [图1]、[图2]……（按出现顺序编号），不要描述图的内容。
- 表格：每行写成一段，单元格之间用“｜”隔开。

【示例】
1．（多选）如图所示，一带电粒子以速度 $v_0$ 垂直射入磁感应强度为 $B$ 的匀强磁场，下列说法正确的是（　　）
[图1]
A．粒子做匀速圆周运动　　B．粒子的速度不变
C．半径 $r=\\frac{mv_0}{qB}$　　D．周期与速度有关
【答案】AC
2．质量为 $m$ 的小球从高 $h$ 处自由下落，求：
（1）落地时的速度大小；
（2）下落所用的时间。`

/** 框选出的插图：按编号对应文字中的 [图N] */
export interface TextFigure {
  asset: Asset
  widthEmu: number
  heightEmu: number
}

export interface TextImportOptions {
  presetId?: string
  figures?: ReadonlyMap<number, TextFigure>
}

export interface TextImportResult {
  blocks: Block[]
  assets: Record<string, Asset>
  questionCount: number
  /** 需要留意的问题：公式无法转换、插图没有框选等 */
  issues: string[]
}

const FIGURE = /\[\s*图\s*(\d+)\s*\]/g

/** 一行文字 → 行内元素：公式、插图、加粗 */
function parseLine(line: string, figures: ReadonlyMap<number, TextFigure>, used: Set<number>, missing: Set<number>): Inline[] {
  const out: Inline[] = []
  const pushText = (text: string, marks?: TextMarks): void => {
    if (text === '') return
    // **加粗**
    const parts = text.split(/\*\*(.+?)\*\*/g)
    parts.forEach((part, i) => {
      if (part === '') return
      const bold = i % 2 === 1 || marks?.bold === true
      const last = out[out.length - 1]
      const m = bold ? { bold: true } : undefined
      if (last?.type === 'text' && JSON.stringify(last.marks ?? null) === JSON.stringify(m ?? null)) out[out.length - 1] = { ...last, text: last.text + part }
      else out.push(m !== undefined ? { type: 'text', text: part, marks: m } : { type: 'text', text: part })
    })
  }
  // 公式：$$…$$、\[…\]、$…$、\(…\)；插图：[图N]；\$ 为普通的 $
  const TOKEN = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|(?<!\\)\$((?:\\\$|[^$])+?)\$|\\\(([\s\S]+?)\\\)|\[\s*图\s*(\d+)\s*\]/g
  let last = 0
  for (const m of line.matchAll(TOKEN)) {
    pushText(line.slice(last, m.index).replace(/\\\$/g, '$'))
    last = m.index + m[0].length
    if (m[5] !== undefined) {
      const n = Number(m[5])
      const fig = figures.get(n)
      if (fig !== undefined) {
        used.add(n)
        out.push({ type: 'image', assetId: fig.asset.id, widthEmu: fig.widthEmu, heightEmu: fig.heightEmu })
      } else {
        missing.add(n)
        pushText(m[0])
      }
      continue
    }
    const latex = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (latex === '') continue
    const display = m[1] !== undefined || m[2] !== undefined
    out.push({ type: 'math', latex, ...(display ? { display: true } : {}) })
  }
  pushText(line.slice(last).replace(/\\\$/g, '$'))
  // 只有一个行间公式、但同一行还有文字时按行内公式排（与 Word 一致）
  if (out.length > 1) return out.map((i) => (i.type === 'math' && i.display === true ? (({ display: _d, ...rest }) => rest)(i) : i))
  return out
}

/** 去掉 AI 常带的 Markdown 记号与代码块 */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*```.*$/, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*•]\s+(?=\S)/, '')
    .replace(/\s+$/, '')
}

/** 文字 → 段落（供识别器使用） */
export function textToParagraphs(
  text: string,
  figures: ReadonlyMap<number, TextFigure> = new Map()
): { paragraphs: ReadParagraph[]; usedFigures: Set<number>; missingFigures: Set<number> } {
  const used = new Set<number>()
  const missing = new Set<number>()
  const paragraphs: ReadParagraph[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = cleanLine(raw)
    if (line.trim() === '') continue
    paragraphs.push({ numbered: false, inlines: parseLine(line, figures, used, missing), floating: [] })
  }
  return { paragraphs, usedFigures: used, missingFigures: missing }
}

/** 文字 → 题目（与导入 Word 相同的识别与整理），并列出需要留意的问题 */
export function importText(text: string, options: TextImportOptions = {}): TextImportResult {
  const figures = options.figures ?? new Map<number, TextFigure>()
  const preset = getPreset(options.presetId)
  const { paragraphs, usedFigures, missingFigures } = textToParagraphs(text, figures)
  const recognized = preset.kind === 'handbook' ? recognizeHandbook(paragraphs) : recognize(paragraphs)
  const blocks = applyPresetRules(normalizeFonts(recognized.blocks), preset)

  const refs = collectAssetRefs({ ...createEmptyProject(), blocks })
  const assets: Record<string, Asset> = {}
  for (const f of figures.values()) if (refs.has(f.asset.id)) assets[f.asset.id] = f.asset

  const issues: string[] = []
  // 公式：能否转为 Word 公式（导出时转不了的会显示为红字）
  const bad: string[] = []
  visitLatex(blocks, (latex) => {
    try {
      latexToOmml(latex)
    } catch {
      bad.push(latex)
    }
  })
  if (bad.length > 0) issues.push(`${bad.length} 个公式无法转换为 Word 公式：${bad.slice(0, 5).map((l) => `$${l}$`).join('，')}${bad.length > 5 ? '……' : ''}`)
  if (missingFigures.size > 0) issues.push(`[图${[...missingFigures].sort((a, b) => a - b).join('] [图')}] 还没有在原图上框选，导入后会保留为文字`)
  const unused = [...figures.keys()].filter((n) => !usedFigures.has(n))
  if (unused.length > 0) issues.push(`框选的图 ${unused.map((n) => `[图${n}]`).join(' ')} 在文字中没有出现，不会导入`)
  if (/【\?】/.test(text)) issues.push('有看不清的地方（【?】），请对照原图修改')
  if (recognized.questionCount === 0 && preset.kind !== 'handbook') issues.push('没有识别到题目：题目要以“1．”这样的题号开头')
  return { blocks, assets, questionCount: recognized.questionCount, issues }
}

function visitLatex(value: unknown, fn: (latex: string) => void): void {
  if (Array.isArray(value)) value.forEach((v) => visitLatex(v, fn))
  else if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.type === 'math' && typeof obj.latex === 'string' && obj.omml === undefined) fn(obj.latex)
    else Object.values(obj).forEach((v) => visitLatex(v, fn))
  }
}
