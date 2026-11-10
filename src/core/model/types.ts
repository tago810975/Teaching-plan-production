/**
 * 教学案数据模型。
 *
 * 这里描述的是“内容”与“排版意图”，不涉及 Word 的具体实现细节。
 * 预览与 Word 导出都从这份模型出发，经由 `document/build.ts` 生成同一份
 * 文档中间表示（DocIR），以保证两者一致。
 */

// ---------- 行内内容 ----------

/**
 * 中文字体大类：宋体、黑体、楷体、仿宋。只区分大类，导出时写成对应的 Windows 字体，
 * 导入时把“华文仿宋”“楷体_GB2312”“微软雅黑”等归入相应大类。
 */
export type FontFamily = 'song' | 'hei' | 'kai' | 'fang'

export interface TextMarks {
  /** 字体大类；不设时随段落（段落格式的 font，再到样式） */
  font?: FontFamily
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** 上标 / 下标 */
  script?: 'sup' | 'sub'
  /** 十六进制颜色，不含 #，如 "C00000" */
  color?: string
}

export interface TextInline {
  type: 'text'
  text: string
  marks?: TextMarks
}

/**
 * 公式。
 *
 * - `omml`：从 Word 导入的原始 OMML（`<m:oMath>` 元素的 XML）。
 *   公式未被修改时，导出 Word 原样写回，零损失。
 * - `latex`：在软件中新建或修改公式后得到的 LaTeX。
 *
 * 两者至少存在一个；修改公式时应清空 `omml`，表示原始版本已失效。
 */
export interface MathInline {
  type: 'math'
  omml?: string
  latex?: string
  /** 是否为独立成行的公式（对应 `<m:oMathPara>`） */
  display?: boolean
  /** 公式整体加粗 */
  bold?: boolean
  /** 公式整体加下划线 */
  underline?: boolean
  /** 公式颜色，十六进制，不含 # */
  color?: string
}

export interface ImageInline {
  type: 'image'
  /** 资源 ID，即图片内容的 SHA-256 */
  assetId: string
  /** 显示尺寸，单位 EMU（1 cm = 360000 EMU） */
  widthEmu: number
  heightEmu: number
}

/** 填空题的下划线空位 */
export interface BlankInline {
  type: 'blank'
  /** 宽度，单位：汉字字符数 */
  widthChars: number
}

/**
 * 表格单元格：内容为富文本（可有公式、图片、格式）。合并单元格按 HTML 的方式记录：
 * 起始单元格写 colSpan / rowSpan，被它覆盖的位置不出现在 cells 中。
 */
export interface TableCell {
  content: RichText
  colSpan?: number
  rowSpan?: number
  /** 底纹颜色，十六进制，不含 # */
  shading?: string
}

export interface TableRow {
  cells: TableCell[]
}

/**
 * 表格。独占一段（所在段落中只有它），可出现在任何富文本中（知识点、题干、解析……）。
 * 输入框中显示为 ⟦表格N⟧，内容在表格编辑器中修改。
 */
export interface TableInline {
  type: 'table'
  rows: TableRow[]
  /** 各列宽度（twip）；不设时平分栏宽 */
  colWidthsTwip?: number[]
}

export type Inline = TextInline | MathInline | ImageInline | BlankInline | TableInline

/** 段落格式（从 Word 导入时保留，正文类段落使用） */
export interface ParagraphFormat {
  /** 首行缩进，单位：字符 */
  firstLineChars?: number
  align?: 'center' | 'right'
  /** 段后空行（知识点等长内容中插入的留白），单位：行 */
  spaceAfterLines?: number
  /** 从这一段开始换页 */
  pageBreakBefore?: boolean
  /** 整段的字体大类；不设时用样式的字体 */
  font?: FontFamily
}

/** 一个段落的行内内容 */
export interface RichParagraph {
  inlines: Inline[]
  format?: ParagraphFormat
}

/** 多段落富文本 */
export type RichText = RichParagraph[]

// ---------- 题目 ----------

export type QuestionKind = 'single-choice' | 'multi-choice' | 'fill-blank' | 'solve'

export interface ChoiceOption {
  /** 选项字母，如 "A" */
  label: string
  content: RichParagraph
}

/**
 * 图片位置：
 * - below：题目中为“题干下方”（选项之前）；知识点中为“第 anchorParagraph 段之后”
 * - right：锚定段落右侧，文字环绕
 * - right-items：题干下方，位于选项或小问右侧（文字环绕）
 * - below-item：第 anchorItem 个小问之后
 * - below-all：全部题目文字（选项与小问）之后
 * - free：自由位置，浮于文字上方，在预览中拖动摆放
 */
export type FigurePlacement = 'below' | 'right' | 'right-items' | 'below-item' | 'below-all' | 'free'

export interface QuestionFigure {
  assetId: string
  widthEmu: number
  heightEmu: number
  placement: FigurePlacement
  /**
   * 锚定的段落序号（题干或知识点正文）：
   * right / free 时为图片所在的段落；知识点的 below 时图片排在这一段之后（不填则在正文末尾）
   */
  anchorParagraph?: number
  /** below-item：排在第几个小问之后 */
  anchorItem?: number
  /** free：相对锚定段落左上角（栏左侧、段落顶端）的偏移，单位 EMU */
  offsetXEmu?: number
  offsetYEmu?: number
}

export interface SubQuestion {
  id: string
  content: RichText
}

export type KeepTogether = 'auto' | 'always' | 'never'

/**
 * 选项分列时第 2 列起各列的起始位置（twip，相对左页边距；对应 Word 的制表位）：
 * 每行 2 项时 1 个，每行 4 项时 3 个，从小到大。
 */
export interface OptionStops {
  two: [number]
  four: [number, number, number]
}

/** 选项排布：自动根据选项长度决定，或手动指定每行几项 */
export type OptionColumns = 'auto' | 1 | 2 | 4

/** 知识点等内容块的版式（与题目相同，但没有选项排列） */
export type BlockLayout = Omit<QuestionLayout, 'optionColumns' | 'optionStops'>

export interface QuestionLayout {
  /** 学生版题后留白（作答空间），单位：行（按正文行高折算） */
  studentSpaceLines: number
  /** 教师版题后留白，单位：行 */
  teacherSpaceLines: number
  optionColumns: OptionColumns
  /** 本题自定义的选项列位置；不设时用工程版式设置中的位置 */
  optionStops?: OptionStops
  /**
   * 整题是否排在同一页：
   * - auto：跟随工程的版式设置（教案、学案分别设置）
   * - always：整道题（含答案、详解）排在同一页
   * - never：允许跨页，但题干、题图、选项等题目主体仍保持在同一页
   */
  keepTogether: KeepTogether
  /** 从新页开始：对应 Word 的“段前分页” */
  pageBreakBefore: boolean
}

export interface Question {
  id: string
  kind: QuestionKind
  /** 难度标记，如 "B"、"C"；样例中写作题干前缀【B】 */
  difficulty?: string
  /** 星级难度，1～5 颗星（星越多越难）；与等级 difficulty 可同时使用 */
  stars?: number
  /** 题干，第一段紧跟题号 */
  stem: RichText
  figures: QuestionFigure[]
  options: ChoiceOption[]
  subQuestions: SubQuestion[]
  // 以下为仅教师版可见的内容
  answer: RichText
  knowledgePoints: string[]
  keyPoint?: string
  difficultPoint?: string
  /** 详解，包括【详解】【点睛】等段落 */
  analysis: RichText
  /** 来源信息，便于去重与溯源 */
  source?: {
    /** 题库导出的题目标识，样例图片替代文字中的 @@@<uuid> */
    bankId?: string
    /** 导入时的源文件名 */
    fileName?: string
  }
  layout: QuestionLayout
}

// ---------- 文档块 ----------

/** 大标题，如“动态圆专题”“作业单-动态圆” */
export interface TitleBlock {
  id: string
  type: 'title'
  text: string
  /** 是否从此处重新开始题号 */
  restartNumbering?: boolean
  /** 是否从新的一页开始（如知识点手册的第二章） */
  pageBreakBefore?: boolean
}

/** 二级标题，如“知识梳理”“例题精讲”“课堂练习” */
export interface SectionBlock {
  id: string
  type: 'section'
  text: string
  /** 是否从此处重新开始题号 */
  restartNumbering?: boolean
  /** 是否从新的一页开始 */
  pageBreakBefore?: boolean
}

/** 题目类型分组，如“放缩圆”“旋转圆” */
export interface TopicBlock {
  id: string
  type: 'topic'
  text: string
  /** 是否从此处重新开始题号 */
  restartNumbering?: boolean
  /** 是否从新的一页开始 */
  pageBreakBefore?: boolean
}

export interface ParagraphBlock {
  id: string
  type: 'paragraph'
  content: RichText
  /** 仅在某一版本中出现；不填则两版都有 */
  onlyIn?: Variant
}

export interface QuestionBlock {
  id: string
  type: 'question'
  question: Question
}

/**
 * 知识点：一个知识标题（如“一、带电粒子在匀强磁场中的圆周运动”）连同其下的文字与图片。
 * 与题目一样可以设置留白、跨页与换页。
 */
export interface KnowledgeBlock {
  id: string
  type: 'knowledge'
  /** 知识标题；为空时只有正文 */
  title: string
  content: RichText
  figures: QuestionFigure[]
  layout: BlockLayout
}

/**
 * 综合题：标题（如“材料一”）+ 可选的背景材料与配图 + 若干小题（题号与全卷连续）
 * + 共用的答案与详解（仅教师版）。
 */
export interface CompositeBlock {
  id: string
  type: 'composite'
  title: string
  background: RichText
  /** 背景配图，位置选项与知识点插图相同（锚定背景段落） */
  figures: QuestionFigure[]
  items: QuestionBlock[]
  answer: RichText
  analysis: RichText
  layout: BlockLayout
}

/**
 * 作业单：预制模块。导出为“分页 → 大标题 → 空行 → 姓名栏 → 空行”，其后的题目重新从 1 编号。
 * 格式（姓名栏的制表位、下划线长度）由格式预设决定。
 */
export interface WorksheetBlock {
  id: string
  type: 'worksheet'
  /** 大标题，如“作业单-动态圆” */
  title: string
  /** 姓名栏中的各项，如 ["姓名", "教室", "正确率"]，每项后面是供填写的下划线 */
  fields: string[]
}

export type Block =
  | TitleBlock
  | SectionBlock
  | TopicBlock
  | ParagraphBlock
  | QuestionBlock
  | KnowledgeBlock
  | CompositeBlock
  | WorksheetBlock

// ---------- 工程 ----------

/** 导出版本：教师版（教案）/ 学生版（学案） */
export type Variant = 'teacher' | 'student'

export interface ProjectMeta {
  title: string
  createdAt: string
  updatedAt: string
}

/** 页眉中的图片 */
export interface HeaderImage {
  assetId: string
  widthEmu: number
  heightEmu: number
}

/**
 * 页眉。布局沿用参考样例：
 *   第一行：机构 Logo
 *   第二行：左侧文字　　　电话图标 + 电话（居中）　　　右侧文字
 *   水印：铺满页面、衬于文字下方的图片
 * 各项留空或不设置时，导出的 Word 中对应元素会被删除。
 */
export interface PageHeader {
  logo?: HeaderImage
  /** 如“墨帝教育秋季学期” */
  left: string
  phoneIcon?: HeaderImage
  phone: string
  /** 如“高二物理勤敏”；导出时自动追加“(教案)”或“(学案)” */
  right: string
  watermark?: HeaderImage
}

/** 工程级的版式设置 */
export interface ProjectLayout {
  /** 每道题默认是否整题排在同一页，教案与学案分别设置 */
  keepQuestionTogether: Record<Variant, boolean>
  /** 每个知识点默认是否整块排在同一页 */
  keepKnowledgeTogether: Record<Variant, boolean>
  /** 选项分列的列位置（单道题可另行设置） */
  optionStops: OptionStops
  /** 题干开头的难度显示：等级和星级（【B】★★）、只显示等级、只显示星级、不显示 */
  difficultyDisplay: DifficultyDisplay
}

export type DifficultyDisplay = 'both' | 'grade' | 'stars' | 'none'

export interface Project {
  meta: ProjectMeta
  header: PageHeader
  layout: ProjectLayout
  /** 使用的 Word 模板标识，对应 resources/templates 下的目录名 */
  templateId: string
  /** 格式预设（标题格式、作业单模块、导入规则等），见 core/presets */
  presetId: string
  blocks: Block[]
}

/** 图片等二进制资源 */
export interface Asset {
  /** 内容的 SHA-256（十六进制） */
  id: string
  mime: string
  data: Uint8Array
}

/** 一份完整的教学案：工程数据 + 资源。工程文件读写的基本单位。 */
export interface ProjectBundle {
  project: Project
  assets: Record<string, Asset>
}
