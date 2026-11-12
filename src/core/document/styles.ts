/**
 * 段落样式表：预览与 Word 导出共用的唯一样式来源。
 *
 * 数值取自参考样例 reference/samples/.../教案_T_动态圆专题.docx 的 styles.xml，
 * 单位与 Word 保持一致（twip、半磅），避免换算误差在两端累积。
 *
 * - Word 导出：按 `wordStyleName` 引用模板中的同名样式，样式本身由模板提供。
 * - 预览：用 `previewCss()` 把这里的数值换算为 CSS。
 *
 * TODO（导出阶段）：改为启动时从模板 styles.xml 解析生成，彻底消除两份数据。
 */
import type { FontFamily } from '../model/types'
import type { CSSLength } from './units'
import { halfPtToPt, twipToPt } from './units'

export type StyleKey =
  | 'title'
  | 'section'
  | 'topic'
  | 'compositeTitle'
  | 'compositeBackground'
  | 'body'
  | 'question'
  /** 题干第二段起：正文样式加上与题干对齐的缩进（不能用“次级题目”，否则会被 Word 编上小问号） */
  | 'questionContinued'
  | 'subQuestion'
  | 'option'
  | 'answer'
  | 'knowledge'
  | 'keyPoint'
  | 'difficultPoint'
  | 'analysis'

/** 中文字体大类（宋体、黑体、楷体、仿宋），须与模板 styles.xml 中各样式的东亚字体一致（有测试检查） */
export type FontRole = FontFamily

export interface ParagraphStyleSpec {
  /** 模板中的样式名称 */
  wordStyleName: string
  fontRole: FontRole
  /** 字号，单位半磅（21 = 五号 10.5pt） */
  sizeHalfPt: number
  bold?: boolean
  /** 文字颜色，十六进制，不含 # */
  color?: string
  align: 'left' | 'center' | 'both'
  spaceBeforeTwip: number
  spaceAfterTwip: number
  /** 行距，240 = 单倍行距；与 Word 的 lineRule="auto" 一致 */
  lineAuto: number
  /**
   * 段落对齐文档网格（模板的 docGrid 为每行 DOC_GRID_PITCH_TWIP）：Word 中每行的高度取网格行距的整数倍，
   * 比自然行高（约字号的 1.3 倍）高。模板中只有“物理排版 题目”没有关闭对齐网格（Word 默认对齐）。
   * 须与模板一致（test/fonts.test.ts 对照），否则预览中题干的行比 Word 矮，锚定在题干上的右侧图片在 Word 中位置偏上。
   */
  snapToGrid?: boolean
  indentLeftTwip: number
  /** 悬挂缩进（编号悬挂在左侧） */
  hangingTwip: number
  /** 由 Word 自动编号生成的固定前缀，如【答案】；预览需自行显示 */
  fixedLabel?: string
  /**
   * 模板中该样式带有自动编号（题号、小问号、【答案】等）。
   * 导出时不写入 DocParagraph.label，由 Word 生成；预览则显示 label。
   */
  autoNumbered?: boolean
  /**
   * 孤行控制：开启时段落跨页后两边各至少保留 2 行。取自模板（WPS 生成的样式大多关闭）。
   */
  widowControl?: boolean
  /**
   * 模板样式本身没有、需要在段落上直接设置的左缩进（twip）。
   * 用于“题干续行”这类借用正文样式但需要缩进的段落。
   */
  directIndentTwip?: number
}

const base = {
  fontRole: 'song',
  sizeHalfPt: 21,
  align: 'both',
  spaceBeforeTwip: 0,
  spaceAfterTwip: 0,
  lineAuto: 240,
  indentLeftTwip: 0,
  hangingTwip: 0
} as const satisfies Partial<ParagraphStyleSpec>

export const STYLE_SPECS: Readonly<Record<StyleKey, ParagraphStyleSpec>> = {
  title: {
    ...base,
    wordStyleName: '物理排版 大标题',
    // 模板中为宋体加粗（大标题用主题字体，主题的中文字体也是宋体）
    fontRole: 'song',
    sizeHalfPt: 36,
    bold: true,
    align: 'center',
    spaceBeforeTwip: 160,
    spaceAfterTwip: 160
  },
  section: {
    ...base,
    wordStyleName: '物理排版 标题2 知识梳理、例题精讲、课堂总结、课后练习',
    // 模板中为宋体加粗（大标题用主题字体，主题的中文字体也是宋体）
    fontRole: 'song',
    sizeHalfPt: 28,
    bold: true,
    align: 'left',
    spaceBeforeTwip: 160,
    spaceAfterTwip: 160
  },
  topic: {
    ...base,
    wordStyleName: '物理排版 题目类型',
    bold: true,
    align: 'left',
    spaceBeforeTwip: 120,
    spaceAfterTwip: 120
  },
  compositeTitle: {
    ...base,
    wordStyleName: '物理排版 综合题题目',
    bold: true,
    align: 'center',
    spaceBeforeTwip: 120,
    spaceAfterTwip: 120
  },
  compositeBackground: { ...base, wordStyleName: '物理排版 综合题背景', fontRole: 'kai', align: 'left', lineAuto: 312 },
  body: { ...base, wordStyleName: '物理排版 正文' },
  question: {
    ...base,
    wordStyleName: '物理排版 题目',
    snapToGrid: true,
    spaceBeforeTwip: 160,
    spaceAfterTwip: 120,
    indentLeftTwip: 333,
    hangingTwip: 394,
    autoNumbered: true
  },
  questionContinued: { ...base, wordStyleName: '物理排版 正文', indentLeftTwip: 333, directIndentTwip: 333 },
  subQuestion: {
    ...base,
    wordStyleName: '物理排版 题目 次级题目',
    indentLeftTwip: 333,
    autoNumbered: true,
    widowControl: true
  },
  option: {
    ...base,
    wordStyleName: '物理排版 题目 选项',
    align: 'left',
    spaceBeforeTwip: 120,
    spaceAfterTwip: 120,
    indentLeftTwip: 480
  },
  answer: {
    ...base,
    wordStyleName: '物理排版 题目 解答',
    bold: true,
    fixedLabel: '【答案】',
    autoNumbered: true
  },
  knowledge: { ...base, wordStyleName: '物理排版 题目 知识点', fixedLabel: '【知识点】', autoNumbered: true },
  keyPoint: {
    ...base,
    wordStyleName: '物理排版 题目 重点',
    color: 'C00000',
    fixedLabel: '【重点】',
    autoNumbered: true
  },
  // 模板中“难点”基于“重点”样式，同为红色（此前预览中漏了颜色，显示为黑色）
  difficultPoint: { ...base, wordStyleName: '物理排版 题目 难点', color: 'C00000', fixedLabel: '【难点】', autoNumbered: true },
  analysis: { ...base, wordStyleName: '物理排版 正文' }
}

/**
 * 模板“题目 选项”样式自带的制表位（twip，相对页面左边距）。实际的列位置由工程版式设置决定
 * （OptionStops）；导出时段落上的制表位是叠加在样式制表位之上的，所以要把这些清除掉。
 */
export const TEMPLATE_OPTION_TAB_STOPS: readonly number[] = [2310, 4200, 6090]


/** 教师版答案区的底纹颜色，与参考样例一致 */
export const TEACHER_SHADING = 'F2F2F2'

/** 学生版书写横线：每行的高度（twip，28 磅）与虚线颜色（题型整理“书写过程”栏，取自样张的浅蓝虚线） */
export const RULE_LINE_TWIP = 560
export const RULE_LINE_COLOR = '9DB1C5'

/** 彩色边框表格（题型整理对照表）的单元格留白（twip）：上下各 top，左右各 side */
export const ROOMY_CELL_TWIP = { top: 100, side: 160 } as const

/** 不编号的题干（题型整理）：首行缩进两个字，与样张一致 */
export const UNNUMBERED_STEM_INDENT_TWIP = 420

/** 正文单倍行高的近似值（twip），用于把“留白行数”换算为间距 */
export const BODY_LINE_HEIGHT_TWIP = 312

/** 浮动图片与环绕文字之间的距离（EMU）：9 磅，与用户在 Word / WPS 中排好的文档一致；预览用同一数值 */
export const FLOAT_GAP_EMU = 114300

/** 模板的文档网格：每行 312 twip（15.6 磅，五号字的网格行距），见 template.docx 的 <w:docGrid w:linePitch="312"> */
export const DOC_GRID_PITCH_TWIP = 312

/**
 * 预览中的行高（相对字号的倍数）。lineAuto：240 为单倍。
 * - 不对齐网格：约为字号的 1.3 倍乘以行距（Word 中宋体单倍行距的近似值）；
 * - 对齐网格：网格行距乘以行距倍数；自然行高超过它时取网格行距的整数倍（与 Word 一致）。
 *   行中有比这更高的公式时，Word 会再多占一格，预览中按内容撑高（不再取整），这一点仍有差别。
 */
export function lineHeightFor(spec: ParagraphStyleSpec, lineAuto: number = spec.lineAuto): number {
  const fontPt = halfPtToPt(spec.sizeHalfPt)
  const naturalPt = 1.3 * fontPt * (lineAuto / 240)
  if (spec.snapToGrid !== true) return naturalPt / fontPt
  const pitchPt = twipToPt(DOC_GRID_PITCH_TWIP)
  const gridPt = pitchPt * (lineAuto / 240)
  const linePt = naturalPt <= gridPt ? gridPt : Math.ceil(naturalPt / pitchPt) * pitchPt
  return linePt / fontPt
}

/** 预览用的 CSS 数值（不含字体族，字体族由预览样式表统一定义） */
export interface PreviewCss {
  fontSize: CSSLength
  fontWeight: number
  color?: string
  textAlign: 'left' | 'center' | 'justify'
  marginTop: CSSLength
  marginBottom: CSSLength
  lineHeight: number
  paddingLeft: CSSLength
  textIndent: CSSLength
}

export function previewCss(spec: ParagraphStyleSpec): PreviewCss {
  return {
    fontSize: `${halfPtToPt(spec.sizeHalfPt)}pt`,
    fontWeight: spec.bold === true ? 700 : 400,
    ...(spec.color !== undefined ? { color: `#${spec.color}` } : {}),
    textAlign: spec.align === 'both' ? 'justify' : spec.align,
    marginTop: `${twipToPt(spec.spaceBeforeTwip)}pt`,
    marginBottom: `${twipToPt(spec.spaceAfterTwip)}pt`,
    // Word 单倍行距约为字号的 1.3 倍（宋体）；对齐文档网格的样式按网格行距
    lineHeight: lineHeightFor(spec),
    paddingLeft: `${twipToPt(spec.indentLeftTwip)}pt`,
    textIndent: `${-twipToPt(spec.hangingTwip)}pt`
  }
}
