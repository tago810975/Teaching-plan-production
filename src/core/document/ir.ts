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
  | { kind: 'image'; assetId: string; widthEmu: number; heightEmu: number; ref?: FigureRef }
  | { kind: 'blank'; widthChars: number }
  /** 制表符，用于选项分列 */
  | { kind: 'tab' }

/**
 * 浮动图片：四周型环绕，文字绕开图片排布（右侧图与自由位置的图都是这种）。
 * 位置用“靠哪一侧 + 距该侧栏边的距离 + 距锚定段落顶端的距离”描述，预览与 Word 导出共用。
 */
export interface FloatingImage {
  assetId: string
  widthEmu: number
  heightEmu: number
  /** 图片靠栏的哪一侧；文字从另一侧绕过 */
  side: 'left' | 'right'
  /** 距该侧栏边的距离（EMU） */
  edgeEmu: number
  /** 距锚定段落顶端的距离（EMU） */
  offsetYEmu: number
  /** 在预览中如何拖动：free 可上下左右移动；vertical 只能上下移动（右侧图） */
  movable: 'free' | 'vertical'
  ref?: FigureRef
}

/** 图片在工程数据中的位置：所在内容（块或综合题中的小题）的 ID 与 figures 中的序号 */
export interface FigureRef {
  blockId: string
  figureIndex: number
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
  /** 首行缩进（twip），来自段落格式 */
  firstLineIndentTwip?: number
  /** 对齐方式，覆盖样式中的对齐 */
  align?: 'center' | 'right'
  /** 从本段之后重新开始题号（如“作业单”大标题） */
  restartNumbering?: boolean
  /** 锚定在本段的浮动图片（文字环绕） */
  floatingImages?: FloatingImage[]
  /**
   * 本段在属性面板中对应的输入框与段落，供“点击预览定位到编辑框”使用。
   * field 如 stem、answer、analysis、content、background、title、text、sub:1、option:2。
   */
  editTarget?: EditTarget
  /**
   * 本段是可锚定图片的段落（题干、知识点正文、综合题背景）时，它在原字段中的序号。
   * 预览中拖动图片越过段落边界时，据此改换锚定段落。
   */
  anchorIndex?: number
}

export interface EditTarget {
  field: string
  /** 输入框中的第几段 */
  paragraph: number
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
