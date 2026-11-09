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
  difficultPoint: { ...base, wordStyleName: '物理排版 题目 难点', fixedLabel: '【难点】', autoNumbered: true },
  analysis: { ...base, wordStyleName: '物理排版 正文' }
}

/**
 * 模板“题目 选项”样式自带的制表位（twip，相对页面左边距）。实际的列位置由工程版式设置决定
 * （OptionStops）；导出时段落上的制表位是叠加在样式制表位之上的，所以要把这些清除掉。
 */
export const TEMPLATE_OPTION_TAB_STOPS: readonly number[] = [2310, 4200, 6090]


/** 教师版答案区的底纹颜色，与参考样例一致 */
export const TEACHER_SHADING = 'F2F2F2'

/** 正文单倍行高的近似值（twip），用于把“留白行数”换算为间距 */
export const BODY_LINE_HEIGHT_TWIP = 312

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
    // Word 单倍行距约为字号的 1.3 倍（宋体）
    lineHeight: 1.3 * (spec.lineAuto / 240),
    paddingLeft: `${twipToPt(spec.indentLeftTwip)}pt`,
    textIndent: `${-twipToPt(spec.hangingTwip)}pt`
  }
}
