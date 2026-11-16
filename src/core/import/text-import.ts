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
3. 把全部转写结果放在一个代码块里（以 \`\`\`text 开头、\`\`\` 结尾），代码块外不要写任何说明。
   这样公式和填空横线不会被对话界面渲染改掉。

【格式】
- 一行一段。按阅读顺序转写；分两栏的页面先左栏、后右栏。
- 每道题以题号开头，写成“1．”“2．”（数字加全角句点），按图片中的顺序编号。
  “例1”“原型题11”“案例一”“(1)案例一”这类题目标签也改成“1．”这样的题号；
  题目来源标注（如“（P823 T1）”）不要写。题号和题干写在同一行。
- 单选、多选等说明照原样写在题干开头，如“（多选）”。
- 选项写成“A．”“B．”“C．”“D．”，可以写在同一行，也可以一行一个。选项本身是图时写成“A．[图2]”。
- 小问写成“（1）”“（2）”，各占一行；圈码“①②③”作小问时也改成“（1）（2）（3）”。
  小问里再分的“①②”保持原样。小问自己的选项紧跟在这个小问后面。
- 答案、解析等另起一行，用【答案】【解析】【点睛】等标签开头，后面接内容；“[解析]”这类方括号标签也改成【解析】。
- 每个小问各有解析时：先写完这道题的全部小问，再写一个【解析】，在解析里用“（1）”“（2）”分开各小问的解析。
  不要把解析夹在小问之间。
- 填空的横线写成“______”（至少三个下划线）。
- 讲解、笔记、知识梳理等不是题目的内容照原样转写，标题照原样写（如“一、霍尔元件”“1.模型解析”）。
- 一张图片开头是上一页题目的后半部分时，先单独写一行【接上页】，再照原样转写这半道题，不要编题号。
- 不要转写：图下的说明（如“（第15题图）”“（例1图）”）、二维码及“扫码看解析”、页眉页脚、页码。
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
    // 填空横线：连续三个以上的下划线（全角、半角）
    const blankParts = text.split(/([_＿]{3,})/)
    if (blankParts.length > 1) {
      blankParts.forEach((part, i) => {
        if (i % 2 === 1) out.push({ type: 'blank', widthChars: Math.max(4, Math.round([...part].length / 2)) })
        else pushText(part, marks)
      })
      return
    }
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

/**
 * 整理 AI 的转写（识别前）：圈码小问、方括号标签、图注、二维码提示。
 * 只用于文字导入，不改动通用的识别器（以免影响 Word 导入）。
 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const BRACKET_LABEL = /^(\s*)[[［〔]\s*(答案|解析|详解|分析|点睛|点评|知识点|考点|重点|难点)\s*[\]］〕]/
const CAPTION = /^\s*[（(]?\s*(第\s*\d+\s*题\s*图|例\s*\d+\s*图|[甲乙丙丁]\s*图|图\s*[甲乙丙丁])\s*[）)]?\s*$/
const NOISE = /^\s*(扫码看解析|扫描二维码.*|第\s*\d+\s*页.*)$/
/** 讲解中的小标题：“1.模型解析”“一、电流按正弦规律变化时的有效值计算”——短、没有句读与括号，不是题目 */
const HEADING = /^\s*(?:\d{1,2}\s*[．.、]|[一二三四五六七八九十]+\s*[、．.])\s*[^\s，。；：？！,.;:?!（）()【】$]{1,24}\s*$/

function normalizeLine(line: string, hasSubQuestions: boolean): { text: string; heading: boolean } | null {
  if (CAPTION.test(line) || NOISE.test(line)) return null
  let t = line
  // 圈码作小问；本题已有“（1）”这样的小问时，圈码是小问里的下一级，保留原样
  const c = CIRCLED.indexOf(t.trimStart()[0] ?? '')
  if (c !== -1 && !hasSubQuestions) t = `（${c + 1}）${t.trimStart().slice(1).trimStart()}`
  t = t.replace(BRACKET_LABEL, '$1【$2】')
  return { text: t, heading: HEADING.test(t) && !/\$/.test(t) }
}

const QUESTION_LINE = /^\s*\d{1,3}\s*[．.、]/
const SUB_LINE = /^\s*[（(]\s*(\d{1,2})\s*[）)]/
const ANSWER_LINE = /^\s*【\s*答案\s*】\s*/
const ANALYSIS_LINE = /^\s*【\s*(解析|详解|分析|点睛|点评)\s*】\s*/

/**
 * 小问与解析交错（“（1）…【解析】…（2）…【解析】…”，原图常这样排）时重排为：全部小问 → 一个【答案】→ 一个【解析】，
 * 各小问的答案、解析用“（1）”“（2）”分开。题目的解析只属于整道题，交错时后面的小问会被当成解析，学生版里就看不到了。
 */
function restructureInterleaved(lines: Array<{ text: string; heading: boolean }>): Array<{ text: string; heading: boolean }> {
  const out: Array<{ text: string; heading: boolean }> = []
  let i = 0
  while (i < lines.length) {
    if (!QUESTION_LINE.test(lines[i]!.text)) {
      out.push(lines[i]!)
      i++
      continue
    }
    // 一道题：到下一道题或小标题为止
    let j = i + 1
    while (j < lines.length && !QUESTION_LINE.test(lines[j]!.text) && !lines[j]!.heading) j++
    const q = lines.slice(i, j)
    i = j
    // 是否交错：答案或解析之后出现了**新的**小问编号。解析里用已出现过的“（1）（2）”分段（先列小问、再统一解析）不算
    let seenTeacher = false
    let interleaved = false
    const seenSubs = new Set<number>()
    for (const l of q) {
      const m = SUB_LINE.exec(l.text)
      if (ANSWER_LINE.test(l.text) || ANALYSIS_LINE.test(l.text)) seenTeacher = true
      else if (m !== null && !seenTeacher) seenSubs.add(Number(m[1]))
      else if (m !== null && seenTeacher && !seenSubs.has(Number(m[1]))) {
        interleaved = true
        seenSubs.add(Number(m[1]))
      }
    }
    if (!interleaved) {
      out.push(...q)
      continue
    }
    const body: Array<{ text: string; heading: boolean }> = []
    const answers: string[] = []
    const analyses: string[] = []
    let sub = 0
    let mode: 'body' | 'answer' | 'analysis' = 'body'
    for (const l of q) {
      const m = SUB_LINE.exec(l.text)
      if (m !== null && body.length > 0) {
        sub = Number(m[1])
        mode = 'body'
        body.push(l)
      } else if (ANSWER_LINE.test(l.text)) {
        mode = 'answer'
        answers.push(`${sub > 0 ? `（${sub}）` : ''}${l.text.replace(ANSWER_LINE, '')}`)
      } else if (ANALYSIS_LINE.test(l.text)) {
        mode = 'analysis'
        analyses.push(`${sub > 0 ? `（${sub}）` : ''}${l.text.replace(ANALYSIS_LINE, '')}`)
      } else if (mode === 'answer') answers.push(l.text)
      else if (mode === 'analysis') analyses.push(l.text)
      else body.push(l)
    }
    out.push(...body)
    if (answers.length > 0) {
      out.push({ text: `【答案】${answers[0]}`, heading: false })
      answers.slice(1).forEach((t) => out.push({ text: t, heading: false }))
    }
    if (analyses.length > 0) {
      out.push({ text: `【解析】${analyses[0]}`, heading: false })
      analyses.slice(1).forEach((t) => out.push({ text: t, heading: false }))
    }
  }
  return out
}

/** 题号后面的来源标注，如“（P823 T1）”“(P824 T3)” */
/** 图片开头是上一页题目的后半部分（格式说明要求 AI 在前面写一行【接上页】） */
const CONTINUED = /^\s*【\s*(接上页|续上页|续)\s*】\s*$/
const SOURCE_TAG = /^(\s*\d{1,3}\s*[．.、]\s*)[（(]\s*P\s*\d+\s*T\s*\d+\s*[）)]\s*/i

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
): { paragraphs: ReadParagraph[]; usedFigures: Set<number>; missingFigures: Set<number>; continued: number } {
  const used = new Set<number>()
  const missing = new Set<number>()
  const paragraphs: ReadParagraph[] = []
  let hasSubQuestions = false
  const lines: Array<{ text: string; heading: boolean }> = []
  // 单独一行的题号（“1．”下一行才是题干）与下一行合并；【接上页】后面的半道题单独成题（不并进前一题的解析）
  let pendingNumber = ''
  let continued = 0
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    let cleaned = cleanLine(raw)
    if (cleaned.trim() === '') continue
    if (/^\s*\d{1,3}\s*[．.、]\s*$/.test(cleaned)) {
      pendingNumber = cleaned.trim()
      continue
    }
    if (CONTINUED.test(cleaned)) {
      pendingNumber = '1．'
      continued++
      continue
    }
    if (pendingNumber !== '') {
      cleaned = pendingNumber + cleaned.trimStart()
      pendingNumber = ''
    }
    cleaned = cleaned.replace(SOURCE_TAG, '$1')
    if (QUESTION_LINE.test(cleaned)) hasSubQuestions = false
    const n = normalizeLine(cleaned, hasSubQuestions)
    if (n === null) continue
    // 只有原文本来就写着“（1）”时，后面的圈码才是小问里的下一级（由圈码转换来的不算）
    if (SUB_LINE.test(cleaned)) hasSubQuestions = true
    lines.push(n)
  }
  // 编号的短行后面紧跟着选项（“A．”）或插图（“[图1]”）时是题目，不是小标题（“2.解题思路”后面跟“（1）……”仍是小标题）
  lines.forEach((l, k) => {
    if (l.heading && /^\s*\d/.test(l.text) && /^\s*(A\s*[．.、]|\[\s*图\s*\d+\s*\])/.test(lines[k + 1]?.text ?? '')) l.heading = false
  })
  for (const n of restructureInterleaved(lines)) {
    // 讲解中的小标题作为“题型分组”标题，不会被当成题目
    paragraphs.push({ numbered: false, inlines: parseLine(n.text, figures, used, missing), floating: [], ...(n.heading ? { styleName: '物理排版 题目类型' } : {}) })
  }
  return { paragraphs, usedFigures: used, missingFigures: missing, continued }
}

/** 文字 → 题目（与导入 Word 相同的识别与整理），并列出需要留意的问题 */
export function importText(text: string, options: TextImportOptions = {}): TextImportResult {
  const figures = options.figures ?? new Map<number, TextFigure>()
  const preset = getPreset(options.presetId)
  const { paragraphs, usedFigures, missingFigures, continued } = textToParagraphs(text, figures)
  const recognized = preset.kind === 'handbook' ? recognizeHandbook(paragraphs) : recognize(paragraphs, { optionsFollowSubQuestion: true })
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
  if (continued > 0) issues.push(`有 ${continued} 处“接上页”的半道题，已单独成题，请对照原图补全题干，或删去`)
  // 从对话气泡中复制的“渲染后”的公式：上下标、分式被拆成几行，夹着零宽字符
  if ((text.match(/\u200b/g) ?? []).length >= 3) {
    issues.unshift('这段文字像是从 AI 对话气泡中直接复制的显示结果：公式已被拆散变形，填空横线也会丢失。请让 AI 把结果放在代码块里（复制给 AI 的指令已经这样要求），再用代码块的“复制”按钮复制')
  }
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
