/**
 * 文档中间表示（DocIR）。
 *
 * 由 `build.ts` 根据工程数据和导出版本（教师版 / 学生版）生成，是一份
 * “已经排好版的段落列表”：题号已编好、选项已分好行、学生版已去掉答案、
 * 留白已换算为段后间距。
 *
 * 预览（React）和 Word 导出都只消费 DocIR，不再各自解释工程数据，
 * 这是保证“预览所见即导出所得”的核心约束：任何排版规则只能写在 build.ts 里。
 */
import type { MathInline, PageHeader, TextMarks, Variant } from '../model/types'
import type { StyleKey } from './styles'
import type { PageSetup } from './units'

/**
 * 行内内容在工程数据中的位置：所在块的 ID，以及从块对象出发的属性路径，
 * 如 ['question', 'stem', 0, 'inlines', 3]。用于在预览中点击公式后修改原数据。
 */
export interface InlineRef {
  blockId: string
  path: ReadonlyArray<string | number>
}

export type DocRun =
  | { kind: 'text'; text: string; marks?: TextMarks }
  | ({ kind: 'math'; ref?: InlineRef } & Omit<MathInline, 'type'>)
  | { kind: 'image'; assetId: string; widthEmu: number; heightEmu: number }
  | { kind: 'blank'; widthChars: number }
  /** 制表符，用于选项分列 */
  | { kind: 'tab' }

export interface FloatingImage {
  assetId: string
  widthEmu: number
  heightEmu: number
  /** 目前只支持靠右、文字四周环绕 */
  side: 'right'
}

export interface DocParagraph {
  /** 稳定的唯一键，供 React 渲染 */
  key: string
  /** 来源块的 ID，用于点击预览定位到编辑区 */
  sourceBlockId: string
  style: StyleKey
  /**
   * 编号标签：题号（如 "3."）、小问号（如 "(1)"）、固定前缀（如【答案】）。
   * Word 中由自动编号生成，导出时不写入正文；预览需自行显示。
   */
  label?: string
  runs: DocRun[]
  /**
   * 作答留白：本段是一个固定行高的空段落，高度为该值（twip）。
   * Word 中实现为“行距固定值”的空段落；与题目之间用“与下段同页”相连，
   * 保证题目和作答空间总在同一页。
   */
  spacerTwip?: number
  /** 与下段同页 */
  keepNext?: boolean
  /** 段中不分页 */
  keepLines?: boolean
  /** 段前分页 */
  pageBreakBefore?: boolean
  /** 灰色底纹，用于教师版的答案区 */
  shaded?: boolean
  /** 制表位（twip，相对页边距），用于选项分列 */
  tabStopsTwip?: readonly number[]
  /** 从本段之后重新开始题号（如“作业单”大标题） */
  restartNumbering?: boolean
  /** 锚定在本段的浮动图片 */
  floatingImage?: FloatingImage
}

export interface DocIR {
  variant: Variant
  page: PageSetup
  /** 页眉；右侧文字已追加“(教案)”或“(学案)” */
  header: PageHeader
  /** 正文起点（twip），由页眉高度决定 */
  bodyTopTwip: number
  paragraphs: DocParagraph[]
}
