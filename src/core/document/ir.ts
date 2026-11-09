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
import type { FontFamily, MathInline, PageHeader, TextMarks, Variant } from '../model/types'
import type { ParagraphStyleSpec, StyleKey } from './styles'
import type { PageSetup } from './units'

/**
 * 行内内容在工程数据中的位置：所在块的 ID，以及从块对象出发的属性路径，
 * 如 ['question', 'stem', 0, 'inlines', 3]。用于在预览中点击公式后修改原数据。
 */
export interface InlineRef {
  blockId: string
  path: ReadonlyArray<string | number>
}

/**
 * 文字在工程数据中的来源：所在段落的路径（如 ['question', 'stem', 0]）与第几个行内元素。
 * 用于在预览中选中文字后直接改格式。
 */
export interface TextSrc {
  blockId: string
  path: ReadonlyArray<string | number>
  inline: number
}

export type DocRun =
  | { kind: 'text'; text: string; marks?: TextMarks; src?: TextSrc }
  | ({ kind: 'math'; ref?: InlineRef } & Omit<MathInline, 'type'>)
  | { kind: 'image'; assetId: string; widthEmu: number; heightEmu: number; ref?: FigureRef; optionRef?: OptionImageRef }
  | { kind: 'blank'; widthChars: number }
  /** 表格：独占一段；预览中画成表格，导出为 <w:tbl> */
  | { kind: 'table'; table: DocTable }
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

/**
 * 选择题选项中的图片在工程数据中的位置：所在题目（块或综合题中的小题）的 ID、
 * 第几个选项、该选项内容中第几个行内元素。预览中据此缩放单张或全部选项图片。
 */
export interface OptionImageRef {
  blockId: string
  option: number
  inline: number
}

/** 图片在工程数据中的位置：所在内容（块或综合题中的小题）的 ID 与 figures 中的序号 */
export interface FigureRef {
  blockId: string
  figureIndex: number
}

/** 表格单元格中的一段：文字等内容与对齐 */
export interface DocCellParagraph {
  runs: DocRun[]
  align?: 'center' | 'right'
}

export interface DocTableCell {
  paragraphs: DocCellParagraph[]
  colSpan?: number
  rowSpan?: number
  shading?: string
}

export interface DocTable {
  rows: Array<{ cells: DocTableCell[] }>
  /** 各列宽度（twip），总和不超过栏宽 */
  colWidthsTwip: number[]
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
  /**
   * 整段排在一行内（如作业单的姓名栏）：预览中按制表位分开的各段不折行。
   * Word 中行尾带下划线的空格可以略超出右边距，不会折到下一行；预览照此显示。
   */
  noWrap?: boolean
  /** 首行缩进（twip），来自段落格式 */
  firstLineIndentTwip?: number
  /** 对齐方式，覆盖样式中的对齐 */
  align?: 'center' | 'right'
  /** 整段字体大类，覆盖样式中的字体（文字自身的 marks.font 优先） */
  font?: FontFamily
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
  /** 本工程的段落样式表（标题格式来自格式预设）；不设时为 STYLE_SPECS */
  styles?: Readonly<Record<StyleKey, ParagraphStyleSpec>>
}
