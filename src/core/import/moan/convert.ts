/**
 * 墨案（老教学案系统）教案 → 工程内容。
 *
 * 数据来自墨案服务器 socket.io 命名空间 moan-teaching-plan 的 show 事件（参数 { id, token }），见
 * main/moan-import.ts。返回的 content 结构（2026-11 实测）：
 * - teachingPlan：{ id, name: “2026高二数学解析几何第1讲：直线方程”, type: “秋季班”, … }
 * - mainTeachingPlanExtra：教案中依次排列的卡片，按 sort_id 排序。type_id 3 = 文字（栏目标题、导语、总结），
 *   5 = 知识点，1 = 题目。题目的 name 是题干，review_topic 是解析（审题 / 讲解提要 / 注意点），answer 是答案；
 *   blankArea 是学案作答留白（行），paging 是从新页开始，isImportant 是“重点”，difficultyLevel_id 为 1～5 级难度；
 *   child 是这道例题的变式题（编号 a、b、c）。
 * - childTeachingPlanExtra：{ 父题 id: 变式题[] }，与 child 相同（以 child 为准，缺少时用它）。
 * 富文本都是 HTML，公式写作 $…$（KaTeX），见 html.ts。
 */
import { createKnowledge, createQuestion, newId } from '../../model/factory'
import { imageParagraphsToFigures } from '../../model/figure-lists'
import type { Block, ChoiceOption, ImageInline, Inline, OptionColumns, QuestionFigure, QuestionKind, RichParagraph, RichText, TableInline } from '../../model/types'
import { htmlPlainText, htmlToRich, parseHtml, type HtmlNode } from './html'

export interface MoanItem {
  id: number
  extra_id?: number | null
  type_id: number
  parent_id?: number
  sort_id?: number
  blankArea?: number | null
  paging?: number | null
  isImportant?: number | null
  name?: string | null
  review_topic?: string | null
  answer?: string | null
  difficultyLevel_id?: number | string | null
  questionType_id?: number | string | null
  child?: MoanItem[]
}

export interface MoanPlanShow {
  teachingPlan: { id: number; name: string; type?: string | null; subject_id?: number; semester_id?: number }
  mainTeachingPlanExtra: MoanItem[]
  childTeachingPlanExtra?: Record<string, MoanItem[]> | MoanItem[] | null
}

/** 已下载的图片：地址 → 资源 */
export interface MoanImage {
  assetId: string
  /** 像素尺寸 */
  width: number
  height: number
}

export interface MoanConvertResult {
  /** 工程标题（教案名中“：”之后的部分，如“直线方程”） */
  title: string
  /** 页眉右侧（教案名中“：”之前的部分，如“2026高二数学解析几何第1讲”） */
  headerRight: string
  blocks: Block[]
  questionCount: number
  warnings: string[]
}

const EMU_PER_PX = 9525
/** 图片最宽 14 cm（版心约 15.9 cm） */
const MAX_IMAGE_EMU = 14 * 360000

/** 教案中引用的全部图片地址（下载用） */
export function collectMoanImageUrls(show: MoanPlanShow): string[] {
  const urls = new Set<string>()
  const visit = (n: HtmlNode): void => {
    if (n.kind !== 'element') return
    if (n.tag === 'img') {
      const src = n.attrs['data-href'] || n.attrs['src'] || ''
      if (/^https?:\/\//i.test(src)) urls.add(src)
    }
    n.children.forEach(visit)
  }
  for (const item of allItems(show)) {
    for (const html of [item.name, item.review_topic, item.answer]) if (typeof html === 'string' && html !== '') visit(parseHtml(html))
  }
  return [...urls]
}

function allItems(show: MoanPlanShow): MoanItem[] {
  const out: MoanItem[] = []
  for (const m of show.mainTeachingPlanExtra) {
    out.push(m)
    out.push(...childrenOf(show, m))
  }
  return out
}

function childrenOf(show: MoanPlanShow, item: MoanItem): MoanItem[] {
  const fromMap = show.childTeachingPlanExtra !== null && show.childTeachingPlanExtra !== undefined && !Array.isArray(show.childTeachingPlanExtra)
    ? show.childTeachingPlanExtra[String(item.id)]
    : undefined
  const kids = item.child !== undefined && item.child.length > 0 ? item.child : (fromMap ?? [])
  return [...kids].sort((a, b) => (a.sort_id ?? 0) - (b.sort_id ?? 0))
}

/** 教案名拆成标题与页眉：“2026高二数学解析几何第1讲：直线方程” → 直线方程 / 2026高二数学解析几何第1讲 */
export function splitPlanName(name: string): { title: string; headerRight: string } {
  const n = name.trim()
  const i = Math.max(n.lastIndexOf('：'), n.lastIndexOf(':'))
  if (i > 0 && i < n.length - 1) return { title: n.slice(i + 1).trim(), headerRight: n.slice(0, i).trim() }
  return { title: n, headerRight: n }
}

export function convertMoanPlan(show: MoanPlanShow, images: ReadonlyMap<string, MoanImage> = new Map(), sectionNames: readonly string[] = []): MoanConvertResult {
  const warnings: string[] = []
  const { title, headerRight } = splitPlanName(show.teachingPlan.name)
  const blocks: Block[] = [{ id: newId(), type: 'title', text: title }]
  let questionCount = 0

  const imageFor = (src: string, attrs: Record<string, string>): ImageInline | null => {
    const img = images.get(src) ?? images.get(attrs['src'] ?? '') ?? images.get(attrs['data-href'] ?? '')
    if (img === undefined) return null
    let w = img.width * EMU_PER_PX
    let h = img.height * EMU_PER_PX
    const styleWidth = /(?:^|;)\s*width\s*:\s*([\d.]+)px/i.exec(attrs['style'] ?? '')?.[1] ?? attrs['width']
    const sw = styleWidth !== undefined ? Number(styleWidth) : NaN
    if (Number.isFinite(sw) && sw > 0 && img.width > 0) {
      h = Math.round((h * sw) / img.width)
      w = Math.round(sw * EMU_PER_PX)
    }
    if (w > MAX_IMAGE_EMU) {
      h = Math.round((h * MAX_IMAGE_EMU) / w)
      w = MAX_IMAGE_EMU
    }
    return { type: 'image', assetId: img.assetId, widthEmu: Math.round(w), heightEmu: Math.round(h) }
  }

  const rich = (html: string | null | undefined, where: string): RichText =>
    htmlToRich(html ?? '', { image: imageFor, warn: (m) => warnings.push(`${where}：${m}`) })

  const items = [...show.mainTeachingPlanExtra].sort((a, b) => (a.sort_id ?? 0) - (b.sort_id ?? 0))
  let mainNo = 0
  /** 当前所在栏目（知识梳理中的文字卡片按知识点导入，与知识点卡片排版一致） */
  let section = ''
  for (const item of items) {
    const pageBreak = item.paging === 1
    switch (item.type_id) {
      case 1: {
        mainNo += 1
        questionCount += 1
        blocks.push(questionBlock(item, false, rich, `第 ${mainNo} 题`))
        childrenOf(show, item).forEach((child, k) => {
          questionCount += 1
          blocks.push(questionBlock(child, true, rich, `第 ${mainNo} 题变式 ${String.fromCharCode(97 + k)}`))
        })
        break
      }
      case 5: {
        // 单独成段的图片作为插图（插图栏中可调整位置和大小）
        const { content, figures } = imageParagraphsToFigures(rich(item.name, '知识点'))
        blocks.push(
          createKnowledge({
            content,
            figures,
            layout: { pageBreakBefore: pageBreak, studentSpaceLines: Math.max(0, item.blankArea ?? 0) }
          })
        )
        break
      }
      default: {
        if (item.type_id !== 3) warnings.push(`未知的内容类型 ${item.type_id}（id ${item.id}），按正文段落导入`)
        const heading = headingText(item.name ?? '', sectionNames)
        if (heading !== null) {
          section = heading
          blocks.push({ id: newId(), type: 'section', text: heading, ...(pageBreak ? { pageBreakBefore: true } : {}) })
        } else if (section === '知识梳理') {
          const { content, figures } = imageParagraphsToFigures(rich(item.name, '知识点'))
          blocks.push(
            createKnowledge({
              content,
              figures,
              layout: { pageBreakBefore: pageBreak, studentSpaceLines: Math.max(0, item.blankArea ?? 0) }
            })
          )
        } else {
          const content = rich(item.name, '正文')
          if (content.length === 0) break
          if (pageBreak) content[0] = { ...content[0]!, format: { ...content[0]!.format, pageBreakBefore: true } }
          blocks.push({ id: newId(), type: 'paragraph', content })
        }
      }
    }
  }
  return { title, headerRight, blocks, questionCount, warnings }
}

/**
 * 文字卡片是不是栏目标题：只有一段、字数不多，并且是预设里的栏目名，或是加粗 / 大字号
 * （墨案的栏目标题写作 <span style="font-size: 22px;"><strong>知识梳理</strong></span>）。
 */
export function headingText(html: string, sectionNames: readonly string[]): string | null {
  const text = htmlPlainText(html)
  if (text === '' || text.includes('\n') || [...text].length > 16) return null
  if (sectionNames.includes(text)) return text
  const big = /font-size\s*:\s*(\d+)px/i.exec(html)
  const bold = /<(strong|b)\b/i.test(html)
  if (bold && (big === null || Number(big[1]) >= 18)) return text
  if (big !== null && Number(big[1]) >= 20) return text
  return null
}

function questionBlock(item: MoanItem, variant: boolean, rich: (html: string | null | undefined, where: string) => RichText, where: string): Block {
  let stem = rich(item.name, `${where}题干`)
  // 只有图片的段落作为题图（排在题干下方）
  const figures: QuestionFigure[] = []
  stem = stem.filter((p) => {
    if (p.inlines.length > 0 && p.inlines.every((i) => i.type === 'image')) {
      for (const i of p.inlines) if (i.type === 'image') figures.push({ assetId: i.assetId, widthEmu: i.widthEmu, heightEmu: i.heightEmu, placement: 'below' })
      return false
    }
    return true
  })
  const { stem: extractedBody, options, optionColumns } = extractOptions(stem)
  const body = unwrapOptionTables(extractedBody)
  const split = splitReview(rich(item.review_topic, `${where}解析`))
  const review = split.review
  // 答案、解析中单独成段的图片作为答案插图 / 解析插图（先取出图片，再在解析第一段前加【解析】）
  const { content: rawAnalysis, figures: analysisFigures } = imageParagraphsToFigures(split.analysis)
  const analysis = unwrapOptionTables(rawAnalysis)
  if (analysis.length > 0) analysis[0] = { ...analysis[0]!, inlines: [{ type: 'text', text: '【解析】' }, ...analysis[0]!.inlines] }
  const { content: rawAnswer, figures: answerFigures } = imageParagraphsToFigures(rich(item.answer, `${where}答案`))
  const answer = unwrapOptionTables(rawAnswer)
  const stars = Number(item.difficultyLevel_id)
  const questionTypeId = Number(item.questionType_id)
  const q = createQuestion({
    kind: kindOf(body, options),
    stem: body,
    options,
    figures,
    answer,
    analysis,
    ...(answerFigures.length > 0 ? { answerFigures } : {}),
    ...(analysisFigures.length > 0 ? { analysisFigures } : {}),
    ...(review.length > 0 ? { review } : {}),
    ...(item.isImportant === 1 ? { important: true } : {}),
    ...(Number.isInteger(stars) && stars >= 1 && stars <= 5 ? { stars } : {}),
    ...(variant ? { numberStyle: 'variant' as const } : {}),
    source: {
      moan: {
        itemId: item.id,
        ...(typeof item.extra_id === 'number' ? { exerciseId: item.extra_id } : {}),
        ...(item.isImportant === 1 ? { important: true } : {}),
        ...(Number.isInteger(questionTypeId) && questionTypeId > 0 ? { questionTypeId } : {})
      }
    },
    layout: { studentSpaceLines: Math.max(0, item.blankArea ?? 0), pageBreakBefore: item.paging === 1, ...(optionColumns !== undefined ? { optionColumns } : {}) }
  })
  return { id: newId(), type: 'question', question: q }
}

const REVIEW_START = /^\s*审题\s*[:：]\s*/
const REVIEW_END = /讲解提要|讲解|注意点/

/**
 * 墨案的解析写作“审题：…／讲解提要：…／注意点：…”。“审题”一段拆出来放进题目的审题（去掉“审题：”），
 * 其余仍是解析。“审题：…讲解提要：”写在同一段时从“讲解提要”处断开。没有“审题”时原样都是解析。
 */
export function splitReview(text: RichText): { review: RichText; analysis: RichText } {
  const textOf = (p: RichParagraph): string => p.inlines.map((i) => (i.type === 'text' ? i.text : i.type === 'math' ? '$' : '')).join('')
  const at = text.findIndex((p) => REVIEW_START.test(textOf(p)))
  if (at === -1 || text.slice(0, at).some((p) => p.inlines.length > 0)) return { review: [], analysis: text }
  const first = text[at]!
  const head = first.inlines[0]
  if (head?.type !== 'text') return { review: [], analysis: text }
  const stripped: RichParagraph = { ...first, inlines: [{ ...head, text: head.text.replace(REVIEW_START, '') }, ...first.inlines.slice(1)].filter((i) => i.type !== 'text' || i.text !== '') }
  // 同一段中“讲解提要”之后的部分归还解析
  let reviewPara = stripped
  let rest: RichParagraph | null = null
  const k = stripped.inlines.findIndex((i) => i.type === 'text' && REVIEW_END.test(i.text))
  if (k !== -1) {
    const t = stripped.inlines[k] as Extract<Inline, { type: 'text' }>
    const cut = t.text.search(REVIEW_END)
    const before = { ...t, text: t.text.slice(0, cut).replace(/\s+$/, '') }
    const after = { ...t, text: t.text.slice(cut) }
    reviewPara = { ...stripped, inlines: [...stripped.inlines.slice(0, k), before].filter((i) => i.type !== 'text' || i.text !== '') }
    rest = { inlines: [after, ...stripped.inlines.slice(k + 1)] }
  }
  const analysis = [...(rest !== null ? [rest] : []), ...text.slice(at + 1)]
  while (analysis.length > 0 && analysis[0]!.inlines.length === 0) analysis.shift()
  return { review: reviewPara.inlines.length > 0 ? [reviewPara] : [], analysis }
}

const OPTION_START = /^\s*([A-H])\s*[.．、:：]\s*/

/**
 * 题干末尾依次以 A. B. C. … 开头的段落是选项。
 * 墨案中从 Word 粘贴的题目，选项常排在一张无框表格里（一行四格、两行两格或一列四行）：
 * 题干最后一段只有一张表格、各格依次以 A. B. C. … 开头时，按格取出选项，并按表格的列数设定选项排列（4 / 2 / 1 列）。
 */
export function extractOptions(stem: RichText): { stem: RichText; options: ChoiceOption[]; optionColumns?: OptionColumns } {
  const fromTable = optionsFromTable(stem)
  if (fromTable !== null) return fromTable
  let start = stem.length
  for (let i = stem.length - 1; i >= 0; i--) {
    const label = optionLabel(stem[i]!)
    if (label === null) break
    start = i
  }
  const tail = stem.slice(start)
  const labels = tail.map((p) => optionLabel(p))
  const sequential = labels.length >= 2 && labels.every((l, k) => l === String.fromCharCode(65 + k))
  if (!sequential || start === 0) return { stem, options: [] }
  const options = tail.map((p, k): ChoiceOption => ({ label: String.fromCharCode(65 + k), content: stripLabel(p) }))
  return { stem: stem.slice(0, start), options }
}

function optionTableCells(table: TableInline): RichParagraph[][] | null {
  // 按阅读顺序（逐行、从左到右）取出非空的格
  const cells = table.rows.flatMap((r) => r.cells).map((c) => c.content.filter((p) => p.inlines.length > 0)).filter((c) => c.length > 0)
  if (cells.length < 2 || !cells.every((c, k) => optionLabel(c[0]!) === String.fromCharCode(65 + k))) return null
  return cells
}

/**
 * 题目中间（如某道小问之下）若仍有用表格排版的选项，去掉表格外框，只保留各选项段落；
 * 题干中的实验数据等普通表格不满足 A./B./… 选项特征，原样保留。
 */
export function unwrapOptionTables(paragraphs: RichText): RichText {
  const out: RichParagraph[] = []
  for (const p of paragraphs) {
    const first = p.inlines[0]
    if (p.inlines.length === 1 && first?.type === 'table') {
      const cells = optionTableCells(first)
      if (cells !== null) {
        for (const c of cells) out.push(...c)
        continue
      }
    }
    out.push(p)
  }
  return out
}

function optionsFromTable(stem: RichText): { stem: RichText; options: ChoiceOption[]; optionColumns?: OptionColumns } | null {
  // 去掉末尾的空段，取最后一段
  let end = stem.length
  while (end > 0 && stem[end - 1]!.inlines.length === 0) end--
  const last = stem[end - 1]
  if (end < 2 || last === undefined || last.inlines.length !== 1 || last.inlines[0]!.type !== 'table') return null
  const table = last.inlines[0] as TableInline
  const cells = optionTableCells(table)
  if (cells === null) return null
  // 一格多段时并成一段（选项只有一段），段间空一格
  const options = cells.map((c, k): ChoiceOption => {
    const first = stripLabel(c[0]!)
    return { label: String.fromCharCode(65 + k), content: { ...first, inlines: [...first.inlines, ...c.slice(1).flatMap((p): Inline[] => [{ type: 'text', text: ' ' }, ...p.inlines])] } }
  })
  const perRow = Math.max(...table.rows.map((r) => r.cells.filter((c) => c.content.some((p) => p.inlines.length > 0)).length))
  const optionColumns: OptionColumns | undefined = perRow === 1 || perRow === 2 || perRow === 4 ? perRow : undefined
  return { stem: stem.slice(0, end - 1), options, ...(optionColumns !== undefined ? { optionColumns } : {}) }
}

function optionLabel(p: RichParagraph): string | null {
  const first = p.inlines[0]
  if (first?.type !== 'text') return null
  return OPTION_START.exec(first.text)?.[1] ?? null
}

function stripLabel(p: RichParagraph): RichParagraph {
  const [first, ...rest] = p.inlines
  if (first?.type !== 'text') return p
  const text = first.text.replace(OPTION_START, '')
  return { inlines: text === '' ? rest : [{ ...first, text }, ...rest] }
}

function kindOf(stem: RichText, options: ChoiceOption[]): QuestionKind {
  if (options.length > 0) return 'single-choice'
  const text = stem.map((p) => p.inlines.map((i) => (i.type === 'text' ? i.text : '')).join('')).join('\n')
  return /_{3,}/.test(text) ? 'fill-blank' : 'solve'
}
