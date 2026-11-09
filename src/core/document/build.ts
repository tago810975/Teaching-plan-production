/**
 * 排版规则：工程数据 + 导出版本 → DocIR。
 *
 * 所有“怎么排”的决定都集中在这里（题号、选项分列、教师/学生版取舍、
 * 题后留白、防跨页），预览和 Word 导出不得各自另写规则。
 */
import type {
  OptionStops,
  DifficultyDisplay,
  TableInline,
  WorksheetBlock,
  ChoiceOption,
  CompositeBlock,
  KnowledgeBlock,
  QuestionBlock,
  Inline,
  OptionColumns,
  Project,
  Question,
  QuestionFigure,
  RichParagraph,
  RichText,
  Variant
} from '../model/types'
import { bodyTopTwip } from './header'
import type { DocIR, DocParagraph, DocRun, DocTable, FloatingImage } from './ir'
import { columnWidths } from '../model/table'
import { BODY_LINE_HEIGHT_TWIP, STYLE_SPECS, type StyleKey } from './styles'
import { DEFAULT_OPTION_STOPS } from '../model/factory'
import { difficultyOf, getPreset, presetStyles, starText, type FormatPreset } from '../presets'
import { A4_PAGE, contentWidthTwip, emuToTwip } from './units'

const VARIANT_SUFFIX: Record<Variant, string> = { teacher: '(教案)', student: '(学案)' }

export function buildDocument(project: Project, variant: Variant): DocIR {
  const out: DocParagraph[] = []
  let questionNo = 0
  const preset = getPreset(project.presetId)

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
      case 'worksheet':
        questionNo = 0
        out.push(...buildWorksheet(block, preset))
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
            editTarget: { field: 'content', paragraph: i },
            runs: toRuns(p, { blockId: block.id, path: ['content', i] })
          })
          const spacer = spacerAfter(p, `${block.id}:gap${i}`, block.id)
          if (spacer !== null) out.push(spacer)
        })
        break
      case 'knowledge':
        out.push(...buildKnowledge(block, variant, project.layout.keepKnowledgeTogether[variant]))
        break
      case 'composite': {
        const kt = project.layout.keepQuestionTogether[variant]
        out.push(
          ...buildComposite(block, variant, (item) => {
            questionNo += 1
            return buildQuestion(item.id, item.question, questionNo, variant, kt, project.layout.optionStops, preset, project.layout.difficultyDisplay)
          })
        )
        break
      }
      case 'question':
        questionNo += 1
        out.push(...buildQuestion(block.id, block.question, questionNo, variant, project.layout.keepQuestionTogether[variant], project.layout.optionStops, preset, project.layout.difficultyDisplay))
        break
    }
  }

  const { header } = project
  return {
    variant,
    page: A4_PAGE,
    header: { ...header, right: header.right === '' || !preset.header.variantSuffix ? header.right : header.right + VARIANT_SUFFIX[variant] },
    bodyTopTwip: bodyTopTwip(header, A4_PAGE),
    // 知识点手册的学生版：红色加粗的重点挖空成横线，用于默写
    paragraphs: variant === 'student' && preset.dictation.enabled ? out.map((p) => blankKeyPoints(p, preset.dictation)) : out,
    styles: presetStyles(preset)
  }
}

// ---------------- 默写挖空 ----------------

const HEADING_STYLES = new Set(['title', 'section', 'topic'])

/**
 * 默写挖空：段落中加粗且为指定颜色的文字与公式换成横线（填空），相邻的合成一条。
 * 横线长度按内容估算：汉字、全角符号算一个字，字母数字算半个字，公式按 5 个字估计；
 * 至少 minChars 个字，并多留一个字的书写空间。标题不挖空。
 */
export function blankKeyPoints(p: DocParagraph, d: FormatPreset['dictation']): DocParagraph {
  if (HEADING_STYLES.has(p.style)) return p
  const colors = new Set(d.colors.map((c) => c.toUpperCase()))
  const isKey = (r: DocRun): boolean => {
    if (r.kind === 'text') return r.text.trim() !== '' && (!d.bold || r.marks?.bold === true) && colors.has((r.marks?.color ?? '').toUpperCase())
    if (r.kind === 'math') return (!d.bold || r.bold === true) && colors.has((r.color ?? '').toUpperCase())
    return false
  }
  // 表格单元格中的重点同样挖空
  const blankRuns = (input: DocRun[]): DocRun[] => {
    const runs: DocRun[] = []
    let width = 0
    const flush = (): void => {
      if (width > 0) runs.push({ kind: 'blank', widthChars: Math.max(d.minChars, Math.ceil(width) + 1) })
      width = 0
    }
    for (const r of input) {
      if (isKey(r)) width += r.kind === 'text' ? textWidthChars(r.text) : 5
      else {
        flush()
        runs.push(
          r.kind === 'table'
            ? {
                ...r,
                table: {
                  ...r.table,
                  rows: r.table.rows.map((row) => ({ cells: row.cells.map((c) => ({ ...c, paragraphs: c.paragraphs.map((cp) => ({ ...cp, runs: blankRuns(cp.runs) })) })) }))
                }
              }
            : r
        )
      }
    }
    flush()
    return runs
  }
  const hasKey = (runs: DocRun[]): boolean => runs.some((r) => isKey(r) || (r.kind === 'table' && r.table.rows.some((row) => row.cells.some((c) => c.paragraphs.some((cp) => hasKey(cp.runs))))))
  if (!hasKey(p.runs)) return p
  return { ...p, runs: blankRuns(p.runs) }
}

/** 文字宽度（以字为单位）：汉字与全角符号 1，其余 0.5 */
function textWidthChars(s: string): number {
  let w = 0
  for (const ch of s) w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch) ? 1 : 0.5
  return w
}

// ---------------- 作业单 ----------------

/**
 * 作业单：与示例文档一致——（分页）大标题、空行、“姓名：____ 教室：____ 正确率：____”、空行。
 * 姓名栏各项之间用制表位对齐，填写处是带下划线的空白；之后的题目从 1 重新编号。
 */
function buildWorksheet(w: WorksheetBlock, preset: FormatPreset): DocParagraph[] {
  const cfg = preset.worksheet
  const line = (key: string): DocParagraph => ({ key: `${w.id}:${key}`, sourceBlockId: w.id, style: 'body', runs: [], spacerTwip: BODY_LINE_HEIGHT_TWIP, keepNext: true })
  const runs: DocRun[] = []
  w.fields.forEach((f, i) => {
    if (i > 0) runs.push({ kind: 'tab' })
    runs.push({ kind: 'text', text: `${f}：` }, { kind: 'blank', widthChars: cfg.blankChars })
  })
  const tabs = cfg.tabStopsTwip.slice(0, Math.max(0, w.fields.length - 1))
  return [
    {
      ...textPara(w.id, 'title', w.title),
      restartNumbering: true,
      ...(cfg.pageBreakBefore ? { pageBreakBefore: true } : {})
    },
    line('gap1'),
    {
      key: `${w.id}:fields`,
      sourceBlockId: w.id,
      style: 'body',
      keepNext: true,
      noWrap: true,
      ...(tabs.length > 0 ? { tabStopsTwip: tabs } : {}),
      runs
    },
    line('gap2')
  ]
}

// ---------------- 题目 ----------------

function buildQuestion(
  blockId: string,
  q: Question,
  no: number,
  variant: Variant,
  keepTogetherByDefault: boolean,
  projectStops: OptionStops = DEFAULT_OPTION_STOPS,
  preset: FormatPreset = getPreset(undefined),
  difficultyDisplay: DifficultyDisplay = 'both'
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
    // 难度：等级写作【B】，其后是对应的星级，如【B】★★（等级与星级的对应见格式预设）
    // 显示哪些由版式设置决定（等级和星级 / 只显示等级 / 只显示星级 / 不显示）
    const d = difficultyOf(q, preset)
    const showGrade = difficultyDisplay === 'both' || difficultyDisplay === 'grade'
    const showStars = difficultyDisplay === 'both' || difficultyDisplay === 'stars'
    const prefix = (showGrade && d.grade !== undefined ? `【${d.grade}】` : '') + (showStars ? starText(d.stars) : '')
    if (i === 0 && prefix !== '') runs.unshift({ kind: 'text', text: prefix })
    push({
      key: key(`stem${i}`),
      anchorIndex: i,
      editTarget: { field: 'stem', paragraph: i },
      style: i === 0 ? 'question' : 'questionContinued',
      ...(i === 0 ? { label: `${no}.` } : {}),
      ...fontProp(p),
      runs
    })
  })

  // ---- 题图 ----
  const stemParas = paras.slice()
  const figs = q.figures.map((fig, index) => ({ fig, index }))
  const hasItems = q.options.length > 0 || q.subQuestions.length > 0
  /** 按位置分组；放不下的（如同一段已有右侧图）退回题干下方 */
  const below: FigItem[] = []
  const rightItems: FigItem[] = []
  const belowItem = new Map<number, FigItem[]>()
  const belowAll: FigItem[] = []
  for (const item of figs) {
    const { fig } = item
    const host = stemParas[Math.min(fig.anchorParagraph ?? 0, stemParas.length - 1)]
    if (fig.placement === 'right' && host !== undefined && !hasRightAligned(host)) {
      addFloating(host, rightFloating(fig, blockId, item.index, 'vertical'))
    } else if (fig.placement === 'free' && host !== undefined) {
      addFloating(host, freeFloating(fig, blockId, item.index))
    } else if (fig.placement === 'right-items' && hasItems) {
      rightItems.push(item)
    } else if (fig.placement === 'below-item' && fig.anchorItem !== undefined && fig.anchorItem < q.subQuestions.length) {
      const list = belowItem.get(fig.anchorItem) ?? []
      list.push(item)
      belowItem.set(fig.anchorItem, list)
    } else if (fig.placement === 'below-all' || fig.placement === 'below-item') {
      belowAll.push(item)
    } else {
      below.push(item)
    }
  }
  if (below.length > 0) push(imageParagraph(key('fig-below'), below, blockId))

  /** 选项或小问的第一段：挂“位于选项/小问右侧”的图（多张时其余排在全部文字之后） */
  let itemsHostKey: string | null = null
  const attachRightItems = (p: DocParagraph): void => {
    if (itemsHostKey !== null || rightItems.length === 0) return
    itemsHostKey = p.key
    const [firstFig, ...rest] = rightItems
    addFloating(p, rightFloating(firstFig!.fig, blockId, firstFig!.index, 'vertical'))
    belowAll.unshift(...rest)
  }

  // 选项：右侧有图时自动排成每行 1 项，避免与图重叠
  if (q.options.length > 0) {
    const setting = rightItems.length > 0 && q.layout.optionColumns === 'auto' ? 1 : q.layout.optionColumns
    const stops = q.layout.optionStops ?? projectStops
    const columns = resolveOptionColumns(q.options, setting, stops)
    chunk(q.options, columns).forEach((row, i) => {
      const runs: DocRun[] = []
      row.forEach((opt, j) => {
        if (j > 0) runs.push({ kind: 'tab' })
        const option = q.options.indexOf(opt)
        // 选项中的图片记下位置，预览中可单独或整体缩放
        // 一行中可能有几个选项，选项的整段字体落到各自的文字上
        const optFont = opt.content.format?.font
        const optRuns = toRuns(opt.content, at('options', option, 'content')).map((r, inline): DocRun =>
          r.kind === 'image'
            ? { ...r, optionRef: { blockId, option, inline } }
            : r.kind === 'text' && optFont !== undefined && r.marks?.font === undefined
              ? { ...r, marks: { ...r.marks, font: optFont } }
              : r
        )
        runs.push({ kind: 'text', text: `${opt.label}．` }, ...optRuns)
      })
      push({
        key: key(`opt${i}`),
        style: 'option',
        // 选项行：paragraph 为本行第一个选项的序号，点击时再加上所在列
        editTarget: { field: 'option', paragraph: q.options.indexOf(row[0]!) },
        runs,
        ...(columns > 1 ? { tabStopsTwip: columns === 2 ? stops.two : stops.four } : {})
      })
      attachRightItems(paras[paras.length - 1]!)
    })
  }

  // 小问，及排在各小问之后的图
  q.subQuestions.forEach((sq, i) => {
    sq.content.forEach((p, j) => {
      push({
        key: key(`sub${i}-${j}`),
        style: j === 0 ? 'subQuestion' : 'questionContinued',
        ...(j === 0 ? { label: `(${i + 1})` } : {}),
        ...fontProp(p),
        editTarget: { field: `sub:${i}`, paragraph: j },
        runs: toRuns(p, at('subQuestions', i, 'content', j))
      })
      attachRightItems(paras[paras.length - 1]!)
    })
    const list = belowItem.get(i)
    if (list !== undefined) push(imageParagraph(key(`fig-sub${i}`), list, blockId))
  })

  if (belowAll.length > 0) push(imageParagraph(key('fig-all'), belowAll, blockId))

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
        ...fontProp(p),
        editTarget: { field: 'answer', paragraph: i },
        runs: toRuns(p, at('answer', i))
      })
    })
    if (q.knowledgePoints.length > 0) {
      push({ ...fixedLabelPara(key('kp'), 'knowledge', q.knowledgePoints.join('；')), editTarget: { field: 'knowledgePoints', paragraph: 0 } })
    }
    if (q.keyPoint !== undefined && q.keyPoint !== '') {
      push({ ...fixedLabelPara(key('key'), 'keyPoint', q.keyPoint), editTarget: { field: 'keyPoint', paragraph: 0 } })
    }
    if (q.difficultPoint !== undefined && q.difficultPoint !== '') {
      push({ ...fixedLabelPara(key('diff'), 'difficultPoint', q.difficultPoint), editTarget: { field: 'difficultPoint', paragraph: 0 } })
    }
    q.analysis.forEach((p, i) => {
      push({ key: key(`ana${i}`), style: 'analysis', ...formatProps(p), editTarget: { field: 'analysis', paragraph: i }, runs: toRuns(p, at('analysis', i)) })
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
  const firstPara = paras[0]
  if (q.layout.pageBreakBefore && firstPara !== undefined) firstPara.pageBreakBefore = true

  return paras
}

// ---------------- 知识点 ----------------

function buildKnowledge(k: KnowledgeBlock, variant: Variant, keepTogetherByDefault: boolean): DocParagraph[] {
  const paras: DocParagraph[] = []
  const key = (suffix: string): string => `${k.id}:${suffix}`
  if (k.title.trim() !== '') {
    paras.push({ key: key('title'), sourceBlockId: k.id, style: 'topic', runs: [{ kind: 'text', text: k.title }], keepNext: true, editTarget: { field: 'title', paragraph: 0 } })
  }
  const content: RichText = k.content.length > 0 ? k.content : k.title.trim() === '' ? [{ inlines: [] }] : []
  paras.push(...contentWithFigures(k.id, 'content', content, k.figures, 'body'))

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

/**
 * 正文段落与锚定在其上的图（知识点正文、综合题背景共用）：
 * 右侧环绕与自由位置的图挂在锚定段落上；“第 N 段之后”的图紧跟该段（同一位置的多张并排）；段后空行。
 */
function contentWithFigures(
  blockId: string,
  field: string,
  content: RichText,
  figures: QuestionFigure[],
  style: StyleKey
): DocParagraph[] {
  const out: DocParagraph[] = []
  const last = Math.max(0, content.length - 1)
  const key = (suffix: string): string => `${blockId}:${field}:${suffix}`
  const paras: DocParagraph[] = content.map((p, i) => ({
    key: key(`c${i}`),
    anchorIndex: i,
    editTarget: { field, paragraph: i },
    sourceBlockId: blockId,
    style,
    ...formatProps(p),
    runs: toRuns(p, { blockId, path: [field, i] })
  }))
  const after = new Map<number, FigItem[]>()
  for (const [index, fig] of figures.entries()) {
    const anchor = Math.min(fig.anchorParagraph ?? last, last)
    const host = paras[anchor]
    if (fig.placement === 'right' && host !== undefined && !hasRightAligned(host)) {
      addFloating(host, rightFloating(fig, blockId, index, 'vertical'))
    } else if (fig.placement === 'free' && host !== undefined) {
      addFloating(host, freeFloating(fig, blockId, index))
    } else {
      const list = after.get(anchor) ?? []
      list.push({ fig, index })
      after.set(anchor, list)
    }
  }
  paras.forEach((p, i) => {
    out.push(p)
    const figsAfter = after.get(i)
    if (figsAfter !== undefined) out.push(imageParagraph(key(`fig${i}`), figsAfter, blockId))
    const spacer = spacerAfter(content[i], key(`gap${i}`), blockId)
    if (spacer !== null) out.push(spacer)
  })
  if (paras.length === 0) {
    const figsAfter = after.get(0)
    if (figsAfter !== undefined) out.push(imageParagraph(key('fig0'), figsAfter, blockId))
  }
  return out
}

// ---------------- 综合题 ----------------

function buildComposite(
  c: CompositeBlock,
  variant: Variant,
  buildItem: (item: QuestionBlock) => DocParagraph[]
): DocParagraph[] {
  const paras: DocParagraph[] = []
  const key = (suffix: string): string => `${c.id}:${suffix}`
  if (c.title.trim() !== '') {
    paras.push({ key: key('title'), sourceBlockId: c.id, style: 'compositeTitle', runs: [{ kind: 'text', text: c.title }], keepNext: true, editTarget: { field: 'title', paragraph: 0 } })
  }
  const background = contentWithFigures(c.id, 'background', c.background, c.figures, 'compositeBackground')
  // 背景与第一道小题保持在同一页
  background.forEach((p) => (p.keepNext = true))
  paras.push(...background)
  for (const item of c.items) paras.push(...buildItem(item))

  if (variant === 'teacher') {
    const start = paras.length
    c.answer.forEach((p, i) => {
      paras.push({
        key: key(`ans${i}`),
        sourceBlockId: c.id,
        style: 'answer',
        ...(i === 0 ? { label: '【答案】' } : {}),
        ...fontProp(p),
        editTarget: { field: 'answer', paragraph: i },
        runs: toRuns(p, { blockId: c.id, path: ['answer', i] })
      })
    })
    c.analysis.forEach((p, i) => {
      paras.push({ key: key(`ana${i}`), sourceBlockId: c.id, style: 'analysis', ...formatProps(p), editTarget: { field: 'analysis', paragraph: i }, runs: toRuns(p, { blockId: c.id, path: ['analysis', i] }) })
    })
    for (let i = start; i < paras.length; i++) paras[i]!.shaded = true
  }

  const spaceLines = variant === 'student' ? c.layout.studentSpaceLines : c.layout.teacherSpaceLines
  if (spaceLines > 0) {
    paras.push({ key: key('space'), sourceBlockId: c.id, style: 'body', runs: [], spacerTwip: Math.round(spaceLines * BODY_LINE_HEIGHT_TWIP) })
    const prev = paras[paras.length - 2]
    if (prev !== undefined) prev.keepNext = true
  }
  // 综合题通常较长：只有设为“整题同页”时才整体保持在同一页
  if (c.layout.keepTogether === 'always') {
    paras.forEach((p, i) => {
      p.keepLines = true
      if (i < paras.length - 1) p.keepNext = true
    })
  }
  const first = paras[0]
  if (c.layout.pageBreakBefore && first !== undefined) first.pageBreakBefore = true
  return paras
}

// ---------------- 选项分列 ----------------

/**
 * 决定选项每行几项。
 *
 * 自动模式下估算每个选项的宽度：能放进四分之一栏就排 4 列，
 * 能放进半栏就排 2 列，否则每行 1 项。列的位置由 OptionStops 决定（对应 Word 制表位）。
 */
export function resolveOptionColumns(options: ChoiceOption[], setting: OptionColumns, stops: OptionStops = DEFAULT_OPTION_STOPS): 1 | 2 | 4 {
  if (setting !== 'auto') return setting
  const indent = STYLE_SPECS.option.indentLeftTwip
  const right = contentWidthTwip(A4_PAGE)
  /** 各列中最窄的一列，留一个字的间隙 */
  const narrowest = (edges: readonly number[]): number =>
    Math.min(...edges.slice(0, -1).map((e, i) => edges[i + 1]! - e)) - CHAR_TWIP
  const quarter = narrowest([indent, ...stops.four, right])
  const half = narrowest([indent, ...stops.two, right])
  const widest = Math.max(...options.map((o) => estimateWidthTwip(o.content) + LABEL_TWIP))
  if (options.length === 4 && widest <= quarter) return 4
  if (widest <= half) return 2
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
    case 'table':
      // 表格占满一行：含表格的选项只能每行一项
      return contentWidthTwip(A4_PAGE)
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
      case 'table':
        return { kind: 'table', table: toDocTable(i) }
    }
  })
}

/** 表格 → DocTable：列宽不超过栏宽，单元格内容转为 DocRun */
function toDocTable(t: TableInline): DocTable {
  return {
    colWidthsTwip: columnWidths(t, contentWidthTwip(A4_PAGE)),
    rows: t.rows.map((r) => ({
      cells: r.cells.map((c) => ({
        paragraphs: (c.content.length > 0 ? c.content : [{ inlines: [] }]).map((p) => ({
          runs: toRuns(p),
          ...(p.format?.align !== undefined ? { align: p.format.align } : {})
        })),
        ...(c.colSpan !== undefined && c.colSpan > 1 ? { colSpan: c.colSpan } : {}),
        ...(c.rowSpan !== undefined && c.rowSpan > 1 ? { rowSpan: c.rowSpan } : {}),
        ...(c.shading !== undefined ? { shading: c.shading } : {})
      }))
    }))
  }
}

/** 标题类段落（大标题、栏目标题、题型分组）一律与下段同页，避免标题孤零零留在页底 */
/** 五号字一个汉字的宽度（twip），用于把“首行缩进 N 字符”换算为长度 */
const INDENT_CHAR_TWIP = 210

/** 段落格式 → DocIR 字段 */
function formatProps(p: RichParagraph): Pick<DocParagraph, 'firstLineIndentTwip' | 'align' | 'pageBreakBefore' | 'font'> {
  const f = p.format
  if (f === undefined) return {}
  return {
    ...fontProp(p),
    ...(f.pageBreakBefore === true ? { pageBreakBefore: true } : {}),
    ...(f.firstLineChars !== undefined && f.firstLineChars > 0 ? { firstLineIndentTwip: Math.round(f.firstLineChars * INDENT_CHAR_TWIP) } : {}),
    ...(f.align !== undefined ? { align: f.align } : {})
  }
}

/** 整段字体（不设则随样式） */
function fontProp(p: RichParagraph): Pick<DocParagraph, 'font'> {
  const font = p.format?.font
  return font !== undefined ? { font } : {}
}

/** 段后空行：一个固定高度的空段落，与前一段同页 */
function spacerAfter(p: RichParagraph | undefined, key: string, blockId: string): DocParagraph | null {
  const lines = p?.format?.spaceAfterLines ?? 0
  if (lines <= 0) return null
  return { key, sourceBlockId: blockId, style: 'body', runs: [], spacerTwip: Math.round(lines * BODY_LINE_HEIGHT_TWIP) }
}

interface FigItem {
  fig: QuestionFigure
  index: number
}

/** 栏宽（EMU）：自由位置的图片据此判断靠哪一侧 */
const COLUMN_EMU = contentWidthTwip(A4_PAGE) * 635

/** 靠右的图（题干右侧、选项/小问右侧）：贴栏右边，可上下移动 */
function rightFloating(fig: QuestionFigure, blockId: string, figureIndex: number, movable: FloatingImage['movable']): FloatingImage {
  return {
    assetId: fig.assetId,
    widthEmu: fig.widthEmu,
    heightEmu: fig.heightEmu,
    side: 'right',
    edgeEmu: 0,
    offsetYEmu: Math.max(0, fig.offsetYEmu ?? 0),
    movable,
    ref: { blockId, figureIndex }
  }
}

/**
 * 自由位置的图：文字绕开图片。图片中心在栏的右半边时靠右（文字在左），否则靠左（文字在右），
 * 与 Word“四周型环绕、文字只在较宽一侧”的效果一致。
 */
function freeFloating(fig: QuestionFigure, blockId: string, figureIndex: number): FloatingImage {
  const x = Math.max(0, Math.min(fig.offsetXEmu ?? 0, COLUMN_EMU - fig.widthEmu))
  const right = x + fig.widthEmu / 2 > COLUMN_EMU / 2
  return {
    assetId: fig.assetId,
    widthEmu: fig.widthEmu,
    heightEmu: fig.heightEmu,
    side: right ? 'right' : 'left',
    edgeEmu: Math.round(right ? Math.max(0, COLUMN_EMU - x - fig.widthEmu) : x),
    offsetYEmu: Math.max(0, fig.offsetYEmu ?? 0),
    movable: 'free',
    ref: { blockId, figureIndex }
  }
}

function addFloating(p: DocParagraph, f: FloatingImage): void {
  ;(p.floatingImages ??= []).push(f)
}

/** 每段只放一张“贴右边”的图，多出的退回下方 */
function hasRightAligned(p: DocParagraph): boolean {
  return (p.floatingImages ?? []).some((f) => f.movable === 'vertical')
}

/** 同一位置的一张或多张图：放在同一段里并排显示 */
function imageParagraph(key: string, items: FigItem[], blockId: string): Omit<DocParagraph, 'sourceBlockId'> & { sourceBlockId: string } {
  const runs: DocRun[] = []
  items.forEach(({ fig, index }, j) => {
    if (j > 0) runs.push({ kind: 'text', text: '\u3000' })
    runs.push({ kind: 'image', assetId: fig.assetId, widthEmu: fig.widthEmu, heightEmu: fig.heightEmu, ref: { blockId, figureIndex: index } })
  })
  return { key, sourceBlockId: blockId, style: 'body', runs }
}

function textPara(blockId: string, style: StyleKey, text: string): DocParagraph {
  return { key: blockId, sourceBlockId: blockId, style, runs: [{ kind: 'text', text }], keepNext: true, editTarget: { field: 'text', paragraph: 0 } }
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
