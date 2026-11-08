/**
 * 题目识别：把 docx-reader 读出的段落组织成教学案的内容块。
 *
 * 两层规则：
 * 1. 样式：文档使用“物理排版”样式体系时，按样式名精确识别（题目、解答、知识点、重点、难点……）。
 * 2. 文字：其他文档按“1.”题号、“A．”选项、“【答案】”“【详解】”等标记识别。
 * 样式规则优先；某段没有可用样式时才看文字。
 */
import { createComposite, createKnowledge, createQuestion, newId } from '../model/factory'
import type {
  Block,
  ChoiceOption,
  CompositeBlock,
  Inline,
  KnowledgeBlock,
  ParagraphBlock,
  Question,
  QuestionFigure,
  RichParagraph
} from '../model/types'
import type { DocxImage, ReadParagraph } from './docx-reader'

type Role =
  | 'title'
  | 'section'
  | 'topic'
  | 'question'
  | 'answer'
  | 'knowledge'
  | 'keyPoint'
  | 'difficultPoint'
  | 'analysis'
  | 'subQuestion'
  | 'compositeTitle'
  | 'compositeBackground'
  | 'body'

/** 样式名 → 角色。按“包含”匹配，兼容样式名的细微差别 */
const STYLE_ROLES: Array<[RegExp, Role]> = [
  [/物理排版\s*大标题/, 'title'],
  [/物理排版\s*标题2/, 'section'],
  [/物理排版\s*题目类型/, 'topic'],
  [/物理排版\s*题目\s*解答/, 'answer'],
  [/物理排版\s*题目\s*知识点/, 'knowledge'],
  [/物理排版\s*题目\s*重点/, 'keyPoint'],
  [/物理排版\s*题目\s*难点/, 'difficultPoint'],
  [/物理排版\s*题目\s*次级题目/, 'subQuestion'],
  [/物理排版\s*详解/, 'analysis'],
  [/物理排版\s*综合题题目/, 'compositeTitle'],
  [/物理排版\s*综合题背景/, 'compositeBackground'],
  [/物理排版\s*题目$/, 'question']
]

/** 常见的栏目标题，在没有样式的文档中按文字识别 */
const SECTION_TITLES = /^(知识梳理|知识点梳理|知识清单|例题精讲|典例精析|典例分析|课堂练习|随堂练习|课堂检测|课后练习|课后作业|巩固练习|课堂总结|作业单|拓展提升|能力提升)$/

/** 知识类栏目：其中按文字规则不识别题号（“1.适用条件”之类是知识要点而非题目） */
const KNOWLEDGE_SECTION = /知识|梳理|清单|总结|要点|归纳|概念|方法/

/** 未使用样式的知识标题：“一、”“二、”开头的短段落 */
const KNOWLEDGE_HEADING = /^\s*[一二三四五六七八九十]{1,3}\s*[、．.]/
const KNOWLEDGE_HEADING_MAX_CHARS = 40

const ANSWER_LABEL = /^\s*【\s*答案\s*】\s*/
const ANALYSIS_LABEL = /^\s*【\s*(详解|解析|分析|点睛|点评|名师点睛|拓展|方法技巧)\s*】/
const KNOWLEDGE_LABEL = /^\s*【\s*(知识点|考点)\s*】\s*/
const KEY_LABEL = /^\s*【\s*重点\s*】\s*/
const DIFFICULT_LABEL = /^\s*【\s*难点\s*】\s*/
const QUESTION_NUMBER = /^\s*(\d{1,3})\s*[．.、]\s*/
const SUB_QUESTION = /^\s*(?:[（(]\s*(\d{1,2})\s*[）)]|([\u2474-\u2487]))\s*/
const DIFFICULTY_TAG = /^\s*【\s*([A-E])\s*】\s*/
const OPTION_START = /^\s*A\s*[．.、]/

export interface RecognizeResult {
  blocks: Block[]
  questionCount: number
  /** 文档中第一个大标题，可作为新教学案的名称 */
  firstTitle?: string
}

export function recognize(paragraphs: ReadParagraph[]): RecognizeResult {
  const usesStyles = paragraphs.some((p) => p.styleName !== undefined && /物理排版\s*题目$/.test(p.styleName))
  const blocks: Block[] = []
  let current: { q: Question; stage: 'stem' | 'options' | 'teacher' } | null = null
  let firstTitle: string | undefined
  /** 正在收集内容的知识点 */
  let knowledge: KnowledgeBlock | null = null
  /** 可以继续合并普通段落的正文块（中间出现其他内容时清空） */
  let openParagraph: ParagraphBlock | null = null
  let inKnowledgeSection = false
  /** 正在收集小题的综合题；sharedAnswer 为 true 时答案与详解归综合题共用 */
  let composite: CompositeBlock | null = null
  let sharedAnswer = false
  const closeOpen = (): void => {
    knowledge = null
    openParagraph = null
    composite = null
    sharedAnswer = false
  }

  /** 第 index 段之后的第一个非空段落 */
  const nextContent = (index: number): ReadParagraph | undefined => {
    for (let j = index + 1; j < paragraphs.length; j++) if (!isBlank(paragraphs[j]!)) return paragraphs[j]
    return undefined
  }
  const startsQuestion = (p: ReadParagraph): boolean => {
    if (styleRole(p.styleName) === 'question') return true
    const t = textOf(p)
    return !usesStyles && !inKnowledgeSection && QUESTION_NUMBER.test(t) && !OPTION_START.test(t)
  }
  const isHeading = (p: ReadParagraph): boolean => {
    const r = styleRole(p.styleName)
    return r === 'title' || r === 'section' || r === 'topic' || (!usesStyles && SECTION_TITLES.test(textOf(p).trim()))
  }

  const finishQuestion = (): void => {
    if (current === null) return
    finalizeQuestion(current.q)
    const block: Block = { id: newId(), type: 'question', question: current.q }
    const c: CompositeBlock | null = composite
    if (c !== null) c.items.push(block)
    else blocks.push(block)
    current = null
  }

  for (let index = 0; index < paragraphs.length; index++) {
    const para = paragraphs[index]!
    const text = textOf(para)
    if (isBlank(para)) continue
    const role = styleRole(para.styleName)

    // ---------- 综合题标题 ----------
    if (role === 'compositeTitle') {
      finishQuestion()
      closeOpen()
      const c = createComposite({ title: text.trim() })
      composite = c
      blocks.push(c)
      continue
    }

    // ---------- 标题类 ----------
    if (role === 'title' || role === 'section' || role === 'topic' || (!usesStyles && SECTION_TITLES.test(text.trim()))) {
      finishQuestion()
      closeOpen()
      const kind = role === 'title' ? 'title' : role === 'topic' ? 'topic' : 'section'
      if (kind === 'title') {
        if (firstTitle === undefined) firstTitle = text.trim()
        blocks.push({
          id: newId(),
          type: 'title',
          text: text.trim(),
          ...(blocks.some((b) => b.type === 'title') ? { restartNumbering: true } : {})
        })
      } else if (kind === 'topic') {
        // 标题后面跟的是题目：题型分组；跟的是正文：知识点
        const next = nextContent(index)
        if (next !== undefined && !startsQuestion(next) && !isHeading(next)) {
          knowledge = createKnowledge({ title: text.trim() })
          blocks.push(knowledge)
        } else {
          blocks.push({ id: newId(), type: 'topic', text: text.trim() })
        }
      } else {
        inKnowledgeSection = KNOWLEDGE_SECTION.test(text)
        blocks.push({ id: newId(), type: 'section', text: text.trim() })
      }
      continue
    }

    // ---------- 新题目 ----------
    const startsByStyle = role === 'question'
    const startsByNumber = !usesStyles && !inKnowledgeSection && QUESTION_NUMBER.test(text) && !OPTION_START.test(text)
    if (startsByStyle || startsByNumber) {
      finishQuestion()
      // 综合题仍在收集小题时继续收集；共用答案出现后，下一题已在综合题之外
      const c: CompositeBlock | null = composite
      if (c === null || sharedAnswer) closeOpen()
      else {
        knowledge = null
        openParagraph = null
      }
      const q = createQuestion({ kind: 'solve' })
      let inlines = para.inlines
      if (startsByNumber) inlines = stripPrefix(inlines, QUESTION_NUMBER)
      const diff = DIFFICULTY_TAG.exec(textOf({ ...para, inlines }))
      if (diff !== null) {
        q.difficulty = diff[1]!
        inlines = stripPrefix(inlines, DIFFICULTY_TAG)
      }
      q.stem.push(clean(inlines))
      addFloating(q, para.floating)
      current = { q, stage: 'stem' }
      continue
    }

    // ---------- 综合题背景：标题与第一道小题之间的内容 ----------
    {
      const c: CompositeBlock | null = composite
      if (c !== null && current === null && c.items.length === 0) {
        if (isImageOnly(para)) {
          for (const i of para.inlines) {
            if (i.type !== 'image') continue
            c.figures.push({ assetId: i.assetId, widthEmu: i.widthEmu, heightEmu: i.heightEmu, placement: 'below', anchorParagraph: Math.max(0, c.background.length - 1) })
          }
        } else {
          const rp = withFormat(clean(para.inlines), para)
          if (rp.inlines.length > 0) c.background.push(rp)
        }
        for (const img of para.floating) {
          c.figures.push({ assetId: img.assetId, widthEmu: img.widthEmu, heightEmu: img.heightEmu, placement: 'right', anchorParagraph: Math.max(0, c.background.length - 1) })
        }
        continue
      }
    }

    // ---------- 不在题目中：未使用样式的知识标题（“一、……”） ----------
    if (current === null && role === undefined && KNOWLEDGE_HEADING.test(text) && [...text.trim()].length <= KNOWLEDGE_HEADING_MAX_CHARS) {
      const next = nextContent(index)
      if (next !== undefined && !startsQuestion(next) && !isHeading(next)) {
        closeOpen()
        knowledge = createKnowledge({ title: text.trim() })
        blocks.push(knowledge)
        continue
      }
    }

    // ---------- 不在题目中：知识点内容或正文 ----------
    if (current === null) {
      const rp = withFormat(clean(para.inlines), para)
      const k: KnowledgeBlock | null = knowledge
      if (k !== null) {
        if (isImageOnly(para)) {
          // 单独成段的图片 → 知识点插图，排在前一段之后（同一段中的多张图并排）
          for (const i of para.inlines) {
            if (i.type !== 'image') continue
            k.figures.push({
              assetId: i.assetId,
              widthEmu: i.widthEmu,
              heightEmu: i.heightEmu,
              placement: 'below',
              anchorParagraph: Math.max(0, k.content.length - 1)
            })
          }
        } else if (rp.inlines.length > 0) {
          k.content.push(rp)
        }
        // 浮在文字旁的图：作为知识点的右侧环绕图，锚定在当前段落
        for (const img of para.floating) {
          k.figures.push({
            assetId: img.assetId,
            widthEmu: img.widthEmu,
            heightEmu: img.heightEmu,
            placement: 'right',
            anchorParagraph: Math.max(0, k.content.length - 1)
          })
        }
        continue
      }
      // 连续的普通段落合并为一个正文块
      let target: ParagraphBlock | null = openParagraph
      if (target === null) {
        target = { id: newId(), type: 'paragraph', content: [] }
        blocks.push(target)
        openParagraph = target
      }
      if (rp.inlines.length > 0) target.content.push(rp)
      for (const img of para.floating) target.content.push({ inlines: [imageInline(img)] })
      continue
    }

    // ---------- 题目内部 ----------
    const cur: { q: Question; stage: 'stem' | 'options' | 'teacher' } = current
    const { q } = cur

    const teacherRole =
      role === 'answer' || ANSWER_LABEL.test(text)
        ? 'answer'
        : role === 'knowledge' || KNOWLEDGE_LABEL.test(text)
          ? 'knowledge'
          : role === 'keyPoint' || KEY_LABEL.test(text)
            ? 'keyPoint'
            : role === 'difficultPoint' || DIFFICULT_LABEL.test(text)
              ? 'difficultPoint'
              : role === 'analysis' || ANALYSIS_LABEL.test(text)
                ? 'analysis'
                : null

    // 综合题中一次写出多道小题答案的，归综合题共用（其后的详解也一并归入）
    const comp: CompositeBlock | null = composite
    if (comp !== null && (sharedAnswer || (teacherRole === 'answer' && isSharedAnswer(text)))) {
      cur.stage = 'teacher'
      if (!sharedAnswer && teacherRole === 'answer') comp.answer.push(clean(stripPrefix(para.inlines, ANSWER_LABEL)))
      else if (teacherRole === 'answer') comp.answer.push(clean(stripPrefix(para.inlines, ANSWER_LABEL)))
      else {
        const p = withFormat(clean(para.inlines), para)
        if (p.inlines.length > 0) comp.analysis.push(p)
        for (const img of para.floating) comp.analysis.push({ inlines: [imageInline(img)] })
      }
      sharedAnswer = true
      continue
    }

    if (teacherRole !== null) {
      cur.stage = 'teacher'
      switch (teacherRole) {
        case 'answer':
          q.answer.push(clean(stripPrefix(para.inlines, ANSWER_LABEL)))
          break
        case 'knowledge':
          q.knowledgePoints.push(...splitPoints(text.replace(KNOWLEDGE_LABEL, '')))
          break
        case 'keyPoint':
          q.keyPoint = joinPoint(q.keyPoint, text.replace(KEY_LABEL, ''))
          break
        case 'difficultPoint':
          q.difficultPoint = joinPoint(q.difficultPoint, text.replace(DIFFICULT_LABEL, ''))
          break
        case 'analysis':
          pushAnalysis(q, para)
          break
      }
      continue
    }

    if (cur.stage === 'teacher') {
      // 答案之后的其他内容都归入详解
      pushAnalysis(q, para)
      continue
    }

    // 选项。“A．”由 Word 自动编号生成时文字里没有它，只能看到其后的“B．”
    const numberedOptions = para.numbered && q.options.length === 0 && !OPTION_START.test(text) && /[\t\s　]B\s*[．.]/.test(text)
    if (OPTION_START.test(text) || numberedOptions || (cur.stage === 'options' && /^\s*[B-H]\s*[．.、]/.test(text))) {
      const inlines: Inline[] = numberedOptions ? [{ type: 'text', text: 'A．' }, ...para.inlines] : para.inlines
      const options = splitOptions(inlines, q.options.length)
      if (options.length > 0) {
        q.options.push(...options)
        addFloating(q, para.floating, 0, 'right-items')
        cur.stage = 'options'
        continue
      }
    }

    // 小问
    if (role === 'subQuestion' || SUB_QUESTION.test(text)) {
      const inlines = role === 'subQuestion' ? para.inlines : stripPrefix(para.inlines, SUB_QUESTION)
      q.subQuestions.push({ id: newId(), content: [clean(inlines)] })
      addFloating(q, para.floating, 0, 'right-items')
      continue
    }

    // 单独成段的图片 → 题图
    if (isImageOnly(para)) {
      // 题干之后：题干下方；小问之后：该小问下方；选项之后：全部题目文字下方
      const subCount = q.subQuestions.length
      const placement: QuestionFigure['placement'] = subCount > 0 ? 'below-item' : cur.stage === 'options' ? 'below-all' : 'below'
      for (const i of para.inlines) {
        if (i.type !== 'image') continue
        q.figures.push({
          assetId: i.assetId,
          widthEmu: i.widthEmu,
          heightEmu: i.heightEmu,
          placement,
          ...(placement === 'below-item' ? { anchorItem: subCount - 1 } : {})
        })
      }
      addFloating(q, para.floating)
      continue
    }

    // 其余：题干续行（选项之后出现的文字也算题干，如综合题的补充说明）
    if (q.subQuestions.length > 0) {
      q.subQuestions[q.subQuestions.length - 1]!.content.push(clean(para.inlines))
      addFloating(q, para.floating)
    } else {
      q.stem.push(clean(para.inlines))
      addFloating(q, para.floating, q.stem.length - 1)
    }
  }
  finishQuestion()

  return {
    blocks,
    questionCount: blocks.reduce((n, b) => n + (b.type === 'question' ? 1 : b.type === 'composite' ? b.items.length : 0), 0),
    ...(firstTitle !== undefined ? { firstTitle } : {})
  }
}

// ---------------- 题目收尾 ----------------

function finalizeQuestion(q: Question): void {
  const stemText = q.stem.map((p) => textOf({ inlines: p.inlines, numbered: false, floating: [] })).join('')
  if (q.options.length > 0) {
    q.kind = /多选|不定项/.test(stemText) ? 'multi-choice' : 'single-choice'
  } else if (/_{3,}|＿{2,}/.test(stemText)) {
    q.kind = 'fill-blank'
  } else {
    q.kind = 'solve'
  }
  // 题库导出的图片替代文字 @@@<uuid> 用作题目来源标识
  const figures = q.figures as FigureWithDescription[]
  const bankId = figures.map((f) => f.description).find((d) => d !== undefined && /^@@@/.test(d))
  if (bankId !== undefined) q.source = { bankId: bankId.replace(/^@@@/, '') }
  for (const f of figures) delete f.description
}

type FigureWithDescription = QuestionFigure & { description?: string }

function addFloating(
  q: Question,
  floating: DocxImage[],
  anchorParagraph = 0,
  placement: QuestionFigure['placement'] = 'right'
): void {
  for (const img of floating) {
    const fig: FigureWithDescription = {
      assetId: img.assetId,
      widthEmu: img.widthEmu,
      heightEmu: img.heightEmu,
      placement,
      ...(anchorParagraph > 0 ? { anchorParagraph } : {}),
      ...(img.description !== undefined ? { description: img.description } : {})
    }
    q.figures.push(fig)
  }
}

function pushAnalysis(q: Question, para: ReadParagraph): void {
  const p = withFormat(clean(para.inlines), para)
  if (p.inlines.length > 0) q.analysis.push(p)
  for (const img of para.floating) q.analysis.push({ inlines: [imageInline(img)] })
}

// ---------------- 选项拆分 ----------------

/**
 * 把一段中的选项拆开：“A．xx　B．yy”或“A．[图]B．[图]C．[图]”。
 * 选项字母必须按顺序出现（从 startIndex 对应的字母开始），且前面不能紧挨着字母或数字，
 * 以免把题干中的“点B.”误认为选项。
 */
export function splitOptions(inlines: Inline[], startIndex = 0): ChoiceOption[] {
  const options: ChoiceOption[] = []
  let expected = startIndex
  let currentInlines: Inline[] | null = null
  let prevChar = ''
  /** 第一个选项字母后的点号；字母前紧挨文字时，要求点号与它一致，以免误拆“点B.” */
  let firstPunct: string | null = null

  for (const inline of inlines) {
    if (inline.type !== 'text') {
      currentInlines?.push(inline)
      prevChar = '\uFFFC'
      continue
    }
    const text = inline.text
    let segmentStart = 0
    for (let i = 0; i < text.length; i++) {
      const label = String.fromCharCode(65 + expected)
      if (text[i] !== label) continue
      const m = /^\s*([．.、])\s*/.exec(text.slice(i + 1))
      if (m === null) continue
      const before = i === 0 ? prevChar : text[i - 1]!
      if (/[A-Za-z0-9]/.test(before)) continue
      const glued = before !== '' && !/[\s\u3000\uFFFC]/.test(before)
      if (glued && firstPunct !== null && m[1] !== firstPunct) continue

      if (currentInlines !== null && i > segmentStart) {
        ;(currentInlines as Inline[]).push({ ...inline, text: text.slice(segmentStart, i) })
      }
      firstPunct ??= m[1]!
      currentInlines = []
      options.push({ label, content: { inlines: currentInlines } })
      expected += 1
      i += m[0].length
      segmentStart = i + 1
    }
    if (currentInlines !== null && segmentStart < text.length) {
      ;(currentInlines as Inline[]).push({ ...inline, text: text.slice(segmentStart) })
    }
    prevChar = text[text.length - 1] ?? prevChar
  }
  for (const opt of options) opt.content = clean(opt.content.inlines)
  return options
}

// ---------------- 工具函数 ----------------

/** 答案中出现两个以上的题号（如“1.横波 2. 1.8 3.A”）：综合题的共用答案 */
function isSharedAnswer(text: string): boolean {
  return (text.match(/(^|[\s　])\d{1,2}\s*[.．、]/g) ?? []).length >= 2
}

/** 带上原段落的格式（首行缩进、对齐） */
function withFormat(rp: RichParagraph, para: ReadParagraph): RichParagraph {
  return para.format !== undefined && Object.keys(para.format).length > 0 ? { ...rp, format: { ...para.format } } : rp
}

function styleRole(styleName: string | undefined): Role | undefined {
  if (styleName === undefined) return undefined
  for (const [re, role] of STYLE_ROLES) if (re.test(styleName)) return role
  return undefined
}

function textOf(p: Pick<ReadParagraph, 'inlines'> & Partial<ReadParagraph>): string {
  return p.inlines.map((i) => (i.type === 'text' ? i.text : i.type === 'math' ? '\uFFFC' : '')).join('')
}

function isBlank(p: ReadParagraph): boolean {
  return p.floating.length === 0 && p.inlines.every((i) => i.type === 'text' && i.text.trim() === '')
}

function isImageOnly(p: ReadParagraph): boolean {
  const hasImage = p.inlines.some((i) => i.type === 'image')
  return hasImage && p.inlines.every((i) => i.type === 'image' || (i.type === 'text' && i.text.trim() === ''))
}

function imageInline(img: DocxImage): Inline {
  return { type: 'image', assetId: img.assetId, widthEmu: img.widthEmu, heightEmu: img.heightEmu }
}

/** 去掉段首匹配 re 的文字（如题号、【答案】） */
function stripPrefix(inlines: Inline[], re: RegExp): Inline[] {
  const first = inlines[0]
  if (first?.type !== 'text') return inlines
  const m = re.exec(first.text)
  if (m === null || m.index !== 0) return inlines
  const rest = first.text.slice(m[0].length)
  return rest === '' ? inlines.slice(1) : [{ ...first, text: rest }, ...inlines.slice(1)]
}

/** 整理行内内容：制表符换成空格，去掉首尾空白，合并相邻文字 */
function clean(inlines: Inline[]): RichParagraph {
  const out: Inline[] = []
  for (const i of inlines) {
    if (i.type !== 'text') {
      out.push(i)
      continue
    }
    const text = i.text.replace(/\t+/g, ' ')
    const last = out[out.length - 1]
    if (last?.type === 'text' && JSON.stringify(last.marks ?? {}) === JSON.stringify(i.marks ?? {})) last.text += text
    else out.push({ ...i, text })
  }
  const first = out[0]
  if (first?.type === 'text') {
    first.text = first.text.replace(/^[\s\u3000]+/, '')
    if (first.text === '') out.shift()
  }
  const last = out[out.length - 1]
  if (last?.type === 'text') {
    last.text = last.text.replace(/[\s\u3000]+$/, '')
    if (last.text === '') out.pop()
  }
  return { inlines: out }
}

function splitPoints(text: string): string[] {
  return text
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function joinPoint(existing: string | undefined, text: string): string {
  const t = text.trim()
  return existing === undefined || existing === '' ? t : `${existing}；${t}`
}
