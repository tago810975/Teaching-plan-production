/**
 * 教学案数据模型。
 *
 * 这里描述的是“内容”与“排版意图”，不涉及 Word 的具体实现细节。
 * 预览与 Word 导出都从这份模型出发，经由 `document/build.ts` 生成同一份
 * 文档中间表示（DocIR），以保证两者一致。
 */

// ---------- 行内内容 ----------

export interface TextMarks {
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

export type Inline = TextInline | MathInline | ImageInline | BlankInline

/** 一个段落的行内内容 */
export interface RichParagraph {
  inlines: Inline[]
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

export interface QuestionFigure {
  assetId: string
  widthEmu: number
  heightEmu: number
  /** 题图位置：题干下方，或浮动在题目右侧（选项在左、题图在右） */
  placement: 'below' | 'right'
}

export interface SubQuestion {
  id: string
  content: RichText
}

export type KeepTogether = 'auto' | 'always' | 'never'

/** 选项排布：自动根据选项长度决定，或手动指定每行几项 */
export type OptionColumns = 'auto' | 1 | 2 | 4

export interface QuestionLayout {
  /** 学生版题后留白（作答空间），单位：行（按正文行高折算） */
  studentSpaceLines: number
  /** 教师版题后留白，单位：行 */
  teacherSpaceLines: number
  optionColumns: OptionColumns
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
}

/** 二级标题，如“知识梳理”“例题精讲”“课堂练习” */
export interface SectionBlock {
  id: string
  type: 'section'
  text: string
}

/** 题目类型分组，如“放缩圆”“旋转圆” */
export interface TopicBlock {
  id: string
  type: 'topic'
  text: string
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

export type Block = TitleBlock | SectionBlock | TopicBlock | ParagraphBlock | QuestionBlock

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
}

export interface Project {
  meta: ProjectMeta
  header: PageHeader
  layout: ProjectLayout
  /** 使用的 Word 模板标识，对应 resources/templates 下的目录名 */
  templateId: string
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
