/**
 * 排版规则：工程数据 + 导出版本 → DocIR。
 *
 * 所有“怎么排”的决定都集中在这里（题号、选项分列、教师/学生版取舍、
 * 题后留白、防跨页），预览和 Word 导出不得各自另写规则。
 */
import type {
  ChoiceOption,
  KnowledgeBlock,
  Inline,
  OptionColumns,
  Project,
  Question,
  RichParagraph,
  RichText,
  Variant
} from '../model/types'
import { bodyTopTwip } from './header'
import type { DocIR, DocParagraph, DocRun } from './ir'
import { BODY_LINE_HEIGHT_TWIP, OPTION_TAB_STOPS, STYLE_SPECS, type StyleKey } from './styles'
import { A4_PAGE, contentWidthTwip, emuToTwip } from './units'

const VARIANT_SUFFIX: Record<Variant, string> = { teacher: '(教案)', student: '(学案)' }

export function buildDocument(project: Project, variant: Variant): DocIR {
  const out: DocParagraph[] = []
  let questionNo = 0

  for (const block of project.blocks) {
    switch (block.type) {
      case 'title':
        if (block.restartNumbering === true) {
          questionNo = 0
          out.push({ ...textPara(block.id, 'title', block.text), restartNumbering: true })
        } else {
          out.push(textPara(block.id, 'title', block.text))
        }
        break
      case 'section':
        out.push(textPara(block.id, 'section', block.text))
        break
      case 'topic':
        out.push(textPara(block.id, 'topic', block.text))
        break
      case 'paragraph':
        if (block.onlyIn !== undefined && block.onlyIn !== variant) break
        block.content.forEach((p, i) => {
          out.push({
            key: `${block.id}:${i}`,
            sourceBlockId: block.id,
            style: 'body',
            ...formatProps(p),
            runs: toRuns(p, { blockId: block.id, path: ['content', i] })
          })
        })
        break
      case 'knowledge':
        out.push(...buildKnowledge(block, variant, project.layout.keepKnowledgeTogether[variant]))
        break
      case 'question':
        questionNo += 1
        out.push(...buildQuestion(block.id, block.question, questionNo, variant, project.layout.keepQuestionTogether[variant]))
        break
    }
  }

  const { header } = project
  return {
    variant,
    page: A4_PAGE,
    header: { ...header, right: header.right === '' ? '' : header.right + VARIANT_SUFFIX[variant] },
    bodyTopTwip: bodyTopTwip(header, A4_PAGE),
    paragraphs: out
  }
}

// ---------------- 题目 ----------------

function buildQuestion(
  blockId: string,
  q: Question,
  no: number,
  variant: Variant,
  keepTogetherByDefault: boolean
): DocParagraph[] {
  const paras: DocParagraph[] = []
  const key = (suffix: string): string => `${blockId}:${suffix}`
  /** 题目中某段富文本的位置，供公式回写 */
  const at = (...path: Array<string | number>): RefBase => ({ blockId, path: ['question', ...path] })
  const push = (p: Omit<DocParagraph, 'sourceBlockId'>): void => {
    paras.push({ ...p, sourceBlockId: blockId })
  }

  // 题干：第一段带题号，难度标记写作【B】前缀
  const stem: RichText = q.stem.length > 0 ? q.stem : [{ inlines: [] }]
  stem.forEach((p, i) => {
    const runs = toRuns(p, q.stem.length > 0 ? at('stem', i) : undefined)
    if (i === 0 && q.difficulty !== undefined && q.difficulty !== '') {
      runs.unshift({ kind: 'text', text: `【${q.difficulty}】` })
    }
    push({
      key: key(`stem${i}`),
      style: i === 0 ? 'question' : 'questionContinued',
      ...(i === 0 ? { label: `${no}.` } : {}),
      runs
    })
  })

  // 题图：靠右浮动的图挂在锚定的题干段落上（默认第一段）；下方的图各占一段
  const first = paras[0]
  for (const [i, fig] of q.figures.entries()) {
    const host = paras[Math.min(fig.anchorParagraph ?? 0, stem.length - 1)] ?? first
    if (fig.placement === 'right' && host !== undefined && host.floatingImage === undefined) {
      host.floatingImage = {
        assetId: fig.assetId,
        widthEmu: fig.widthEmu,
        heightEmu: fig.heightEmu,
        side: 'right'
      }
    } else {
      push({
        key: key(`fig${i}`),
        style: 'body',
        runs: [{ kind: 'image', assetId: fig.assetId, widthEmu: fig.widthEmu, heightEmu: fig.heightEmu }]
      })
    }
  }

  // 选项
  if (q.options.length > 0) {
    const columns = resolveOptionColumns(q.options, q.layout.optionColumns)
    chunk(q.options, columns).forEach((row, i) => {
      const runs: DocRun[] = []
      row.forEach((opt, j) => {
        if (j > 0) runs.push({ kind: 'tab' })
        runs.push({ kind: 'text', text: `${opt.label}．` }, ...toRuns(opt.content, at('options', q.options.indexOf(opt), 'content')))
      })
      push({
        key: key(`opt${i}`),
        style: 'option',
        runs,
        ...(columns > 1 ? { tabStopsTwip: OPTION_TAB_STOPS[columns as 2 | 4] } : {})
      })
    })
  }

  // 小问
  q.subQuestions.forEach((sq, i) => {
    sq.content.forEach((p, j) => {
      push({
        key: key(`sub${i}-${j}`),
        style: j === 0 ? 'subQuestion' : 'questionContinued',
        ...(j === 0 ? { label: `(${i + 1})` } : {}),
        runs: toRuns(p, at('subQuestions', i, 'content', j))
      })
    })
  })

  /** 题目主体（题干、题图、选项、小问）的段落数，主体始终保持在同一页 */
  const bodyCount = paras.length

  // 教师版内容
  if (variant === 'teacher') {
    const teacherStart = paras.length
    q.answer.forEach((p, i) => {
      push({
        key: key(`ans${i}`),
        style: 'answer',
        ...(i === 0 ? { label: '【答案】' } : {}),
        runs: toRuns(p, at('answer', i))
      })
    })
    if (q.knowledgePoints.length > 0) {
      push(fixedLabelPara(key('kp'), 'knowledge', q.knowledgePoints.join('；')))
    }
    if (q.keyPoint !== undefined && q.keyPoint !== '') {
      push(fixedLabelPara(key('key'), 'keyPoint', q.keyPoint))
    }
    if (q.difficultPoint !== undefined && q.difficultPoint !== '') {
      push(fixedLabelPara(key('diff'), 'difficultPoint', q.difficultPoint))
    }
    q.analysis.forEach((p, i) => {
      push({ key: key(`ana${i}`), style: 'analysis', ...formatProps(p), runs: toRuns(p, at('analysis', i)) })
    })
    for (let i = teacherStart; i < paras.length; i++) paras[i]!.shaded = true
  }

  // 作答留白：在题目末尾追加一个固定高度的空段落。
  // 不用段后间距实现，因为 Word 会在页底截掉段后间距，作答空间会凭空消失。
  const spaceLines = variant === 'student' ? q.layout.studentSpaceLines : q.layout.teacherSpaceLines
  if (spaceLines > 0) {
    push({
      key: key('space'),
      style: 'body',
      runs: [],
      spacerTwip: Math.round(spaceLines * BODY_LINE_HEIGHT_TWIP)
    })
  }

  // 防跨页。整题同页：除最后一段外都“与下段同页”，所有段“段中不分页”。
  // 允许跨页：只把题目主体连在一起（不会出现题干在页底、选项在下一页），答案与详解可以跨页。
  // 作答留白无论哪种设置都与前一段同页。
  const keepAll = q.layout.keepTogether === 'always' || (q.layout.keepTogether === 'auto' && keepTogetherByDefault)
  const keptCount = keepAll ? paras.length : bodyCount
  paras.forEach((p, i) => {
    const nextIsSpacer = paras[i + 1]?.spacerTwip !== undefined
    if (i < keptCount) {
      p.keepLines = true
      if (i < keptCount - 1) p.keepNext = true
    }
    if (nextIsSpacer) p.keepNext = true
  })
  if (q.layout.pageBreakBefore && first !== undefined) first.pageBreakBefore = true

  return paras
}

// ---------------- 知识点 ----------------

function buildKnowledge(k: KnowledgeBlock, variant: Variant, keepTogetherByDefault: boolean): DocParagraph[] {
  const paras: DocParagraph[] = []
  const key = (suffix: string): string => `${k.id}:${suffix}`
  if (k.title.trim() !== '') {
    paras.push({ key: key('title'), sourceBlockId: k.id, style: 'topic', runs: [{ kind: 'text', text: k.title }], keepNext: true })
  }
  const contentStart = paras.length
  const content: RichText = k.content.length > 0 ? k.content : k.title.trim() === '' ? [{ inlines: [] }] : []
  content.forEach((p, i) => {
    paras.push({
      key: key(`c${i}`),
      sourceBlockId: k.id,
      style: 'body',
      ...formatProps(p),
      runs: toRuns(p, { blockId: k.id, path: ['content', i] })
    })
  })

  // 图：右侧环绕的挂在锚定段落上，其余排在正文之后
  for (const [i, fig] of k.figures.entries()) {
    const host = paras[contentStart + Math.min(fig.anchorParagraph ?? 0, Math.max(0, content.length - 1))]
    if (fig.placement === 'right' && host !== undefined && host.floatingImage === undefined) {
      host.floatingImage = { assetId: fig.assetId, widthEmu: fig.widthEmu, heightEmu: fig.heightEmu, side: 'right' }
    } else {
      paras.push({
        key: key(`fig${i}`),
        sourceBlockId: k.id,
        style: 'body',
        runs: [{ kind: 'image', assetId: fig.assetId, widthEmu: fig.widthEmu, heightEmu: fig.heightEmu }]
      })
    }
  }

  const spaceLines = variant === 'student' ? k.layout.studentSpaceLines : k.layout.teacherSpaceLines
  if (spaceLines > 0) {
    paras.push({ key: key('space'), sourceBlockId: k.id, style: 'body', runs: [], spacerTwip: Math.round(spaceLines * BODY_LINE_HEIGHT_TWIP) })
  }

  const keepAll = k.layout.keepTogether === 'always' || (k.layout.keepTogether === 'auto' && keepTogetherByDefault)
  paras.forEach((p, i) => {
    const isLast = i === paras.length - 1
    if (keepAll) {
      p.keepLines = true
      if (!isLast) p.keepNext = true
    }
    if (paras[i + 1]?.spacerTwip !== undefined) p.keepNext = true
  })
  const first = paras[0]
  if (k.layout.pageBreakBefore && first !== undefined) first.pageBreakBefore = true
  return paras
}

// ---------------- 选项分列 ----------------

/**
 * 决定选项每行几项。
 *
 * 自动模式下估算每个选项的宽度：能放进四分之一栏就排 4 列，
 * 能放进半栏就排 2 列，否则每行 1 项。与 Word 制表位（OPTION_TAB_STOPS）对应。
 */
export function resolveOptionColumns(options: ChoiceOption[], setting: OptionColumns): 1 | 2 | 4 {
  if (setting !== 'auto') return setting
  const indent = STYLE_SPECS.option.indentLeftTwip
  const quarter = OPTION_TAB_STOPS[4][0]! - indent - CHAR_TWIP // 留一个字的间隙
  const half = OPTION_TAB_STOPS[2][0]! - indent - CHAR_TWIP
  const widest = Math.max(...options.map((o) => estimateWidthTwip(o.content) + LABEL_TWIP))
  const full = contentWidthTwip(A4_PAGE) - indent
  if (options.length === 4 && widest <= quarter) return 4
  if (widest <= half && widest <= full / 2) return 2
  return 1
}

/** 五号字一个汉字的宽度（twip） */
const CHAR_TWIP = 210
/** “A．”标签宽度 */
const LABEL_TWIP = CHAR_TWIP * 1.5

/** 粗略估算一段行内内容的排版宽度（twip） */
export function estimateWidthTwip(p: RichParagraph): number {
  let w = 0
  for (const inline of p.inlines) w += estimateInlineTwip(inline)
  return w
}

function estimateInlineTwip(i: Inline): number {
  switch (i.type) {
    case 'text':
      return textWidth(i.text)
    case 'math': {
      // 只是估算：取 LaTeX 去掉命令后的字符数，或 OMML 中 <m:t> 的文字
      const visible =
        i.latex !== undefined
          ? i.latex.replace(/\\[a-zA-Z]+|[{}^_]/g, '')
          : [...(i.omml ?? '').matchAll(/<m:t[^>]*>([^<]*)<\/m:t>/g)].map((m) => m[1]).join('')
      return textWidth(visible) * 1.1
    }
    case 'image':
      return emuToTwip(i.widthEmu)
    case 'blank':
      return i.widthChars * CHAR_TWIP
  }
}

function textWidth(text: string): number {
  let w = 0
  for (const ch of text) w += /[\u0000-\u00ff]/.test(ch) ? CHAR_TWIP / 2 : CHAR_TWIP
  return w
}

// ---------------- 工具函数 ----------------

interface RefBase {
  blockId: string
  path: Array<string | number>
}

/** 行内内容 → DocRun；提供 base 时为公式记下其在工程数据中的位置 */
function toRuns(p: RichParagraph, base?: RefBase): DocRun[] {
  return p.inlines.map((i, index): DocRun => {
    switch (i.type) {
      case 'text':
        return { kind: 'text', text: i.text, ...(i.marks !== undefined ? { marks: i.marks } : {}) }
      case 'math': {
        const { type: _type, ...rest } = i
        const ref = base === undefined ? undefined : { blockId: base.blockId, path: [...base.path, 'inlines', index] }
        return { kind: 'math', ...rest, ...(ref !== undefined ? { ref } : {}) }
      }
      case 'image':
        return { kind: 'image', assetId: i.assetId, widthEmu: i.widthEmu, heightEmu: i.heightEmu }
      case 'blank':
        return { kind: 'blank', widthChars: i.widthChars }
    }
  })
}

/** 标题类段落（大标题、栏目标题、题型分组）一律与下段同页，避免标题孤零零留在页底 */
/** 五号字一个汉字的宽度（twip），用于把“首行缩进 N 字符”换算为长度 */
const INDENT_CHAR_TWIP = 210

/** 段落格式 → DocIR 字段 */
function formatProps(p: RichParagraph): Pick<DocParagraph, 'firstLineIndentTwip' | 'align'> {
  const f = p.format
  if (f === undefined) return {}
  return {
    ...(f.firstLineChars !== undefined && f.firstLineChars > 0 ? { firstLineIndentTwip: Math.round(f.firstLineChars * INDENT_CHAR_TWIP) } : {}),
    ...(f.align !== undefined ? { align: f.align } : {})
  }
}

function textPara(blockId: string, style: StyleKey, text: string): DocParagraph {
  return { key: blockId, sourceBlockId: blockId, style, runs: [{ kind: 'text', text }], keepNext: true }
}

function fixedLabelPara(
  key: string,
  style: StyleKey,
  text: string
): Omit<DocParagraph, 'sourceBlockId'> {
  const label = STYLE_SPECS[style].fixedLabel
  return { key, style, ...(label !== undefined ? { label } : {}), runs: [{ kind: 'text', text }] }
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}
