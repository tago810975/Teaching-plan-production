/**
 * 格式预设：一种教学案的整套格式约定，存为 JSON 文件（本目录下，每个预设一个文件）。
 *
 * 包含：大标题 / 二级标题 / 三级标题（题型分类）的格式、常用的二级标题名称、
 * 作业单模块的格式、导入时的整理规则、难度等级。
 * 工程记录所用的预设（project.presetId）；新建或从 Word 新建时选择，设置中可指定导入时默认使用的预设。
 *
 * 新增预设：在本目录添加 JSON 文件，并加入下面的 PRESETS。
 */
import { z } from 'zod'
import { DEFAULT_PRESET_ID } from '../model/factory'
import { lineSpacing } from '../model/schema'
import type { LineSpacing, ProjectLayout } from '../model/types'
import { STYLE_SPECS, type ParagraphStyleSpec, type StyleKey } from '../document/styles'
import physicsV1 from './physics-v1.json'
import physicsHandbookV1 from './physics-handbook-v1.json'
import physicsTypeSummaryV1 from './physics-typesummary-v1.json'
import mathV1 from './math-v1.json'

const heading = z.object({
  font: z.enum(['song', 'hei', 'kai', 'fang']),
  sizeHalfPt: z.number().int().min(10).max(144),
  bold: z.boolean(),
  color: z.string().regex(/^[0-9A-Fa-f]{6}$/).optional(),
  align: z.enum(['left', 'center']),
  spaceBeforeTwip: z.number().min(0),
  spaceAfterTwip: z.number().min(0)
})

const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  subject: z.string(),
  description: z.string(),
  templateId: z.string(),
  /**
   * 文档类型。lesson：教学案（知识梳理、例题、练习……，识别题目）；
   * handbook：知识点手册（只有大标题与知识点，导入时不识别题目）；
   * typeSummary：题型整理（一道母题配“审题 / 解题 / 题后归纳”，导入时按教学案识别题目，
   * “添加”菜单有题型整理的预制模块：审题注释框、思维过程 / 书写过程对照表、整份骨架）
   */
  kind: z.enum(['lesson', 'handbook', 'typeSummary']),
  /** 题干前是否显示题号（默认显示；题型整理一份只讲一道母题，不编号） */
  numberQuestions: z.boolean().optional(),
  /** 默认行距（倍数）；工程的版式设置中可另行设置。不设时为单倍 */
  lineSpacing: lineSpacing.optional(),
  header: z.object({
    /** 页眉右侧是否加“(教案)”“(学案)” */
    variantSuffix: z.boolean(),
    /** 新建时页眉左侧的文字（不设则用模板的） */
    left: z.string().optional()
  }),
  headings: z.object({ title: heading, section: heading, topic: heading }),
  sectionNames: z.array(z.string()),
  worksheet: z.object({
    titlePrefix: z.string(),
    fields: z.array(z.string()).min(1),
    tabStopsTwip: z.array(z.number().min(0)),
    blankChars: z.number().min(1),
    pageBreakBefore: z.boolean()
  }),
  /** 格式工具中的文字颜色；不设 color 的一项表示黑色（去掉颜色） */
  textColors: z.array(z.object({ label: z.string().min(1), color: z.string().regex(/^[0-9A-Fa-f]{6}$/).optional() })),
  /**
   * 重点（知识梳理中需要记忆、以后做默写单时挖空的内容）：一组格式，格式工具中的快捷按钮一次设好。
   * 默写单将按这组格式找出挖空内容。
   */
  keyPoint: z.object({
    label: z.string().min(1),
    description: z.string(),
    marks: z.object({ bold: z.literal(true), underline: z.literal(true), color: z.string().regex(/^[0-9A-Fa-f]{6}$/) })
  }),
  import: z.object({
    /** 导入时把这些标签改写，如【详解】→【解析】 */
    renameLabels: z.record(z.string(), z.string()),
    /** black：解析统一为黑色（去掉文字颜色）；keep：保留 */
    analysisColor: z.enum(['black', 'keep'])
  }),
  /** 难度等级，每级对应若干颗星（如 A=1 星简单、C=3 星难），从易到难 */
  /**
   * 默写挖空（学生版）：加粗且为这些颜色的文字与公式换成横线；横线至少 minChars 个字宽，
   * 字多时按字数加一个字（相邻的重点合成一条横线）
   */
  dictation: z.object({
    enabled: z.boolean(),
    colors: z.array(z.string().regex(/^[0-9A-Fa-f]{6}$/)),
    bold: z.boolean(),
    minChars: z.number().min(1)
  }),
  difficulty: z.object({
    levels: z.array(z.object({ grade: z.string().min(1), stars: z.number().int().min(1).max(5), label: z.string() })).min(1)
  })
})

export type FormatPreset = z.infer<typeof presetSchema>
export type HeadingFormat = FormatPreset['headings']['title']
export type HeadingKey = keyof FormatPreset['headings']

/** 内置预设（随软件发布，只读），按显示顺序 */
export const PRESETS: readonly FormatPreset[] = [presetSchema.parse(physicsV1), presetSchema.parse(physicsHandbookV1), presetSchema.parse(physicsTypeSummaryV1), presetSchema.parse(mathV1)]

export { DEFAULT_PRESET_ID }

/**
 * 用户模板中的预设（“文档\教学案\模板”下各文件夹的 preset.json），由主进程读取后在启动时登记。
 * 主进程与界面各自登记一份（两边是不同的 JS 环境）。
 */
let userPresets: readonly FormatPreset[] = []

/** 登记用户模板的预设（整体替换）；与内置预设 ID 相同的忽略 */
export function setUserPresets(list: readonly FormatPreset[]): void {
  userPresets = list.filter((p) => !isBuiltinPreset(p.id))
}

/** 全部预设：内置的在前，其后是用户模板 */
export function allPresets(): readonly FormatPreset[] {
  return [...PRESETS, ...userPresets]
}

export function isBuiltinPreset(id: string): boolean {
  return PRESETS.some((p) => p.id === id)
}

/** 按 ID 取预设；找不到（如来自更新版本的工程，或用户模板已删除）时用默认预设 */
export function getPreset(id: string | undefined): FormatPreset {
  return allPresets().find((p) => p.id === id) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!
}

/** 预设 ID 与用户模板的 Word 模板 ID 只能用小写字母、数字和连字符（用作文件夹名、写进工程文件） */
export const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * 校验一份预设 JSON（用户模板的 preset.json）。返回预设，或用中文说明的错误
 * （列出前几处字段问题，便于老师对照修改）。
 */
export function parsePreset(json: unknown): { ok: true; preset: FormatPreset } | { ok: false; error: string } {
  const r = presetSchema.safeParse(json)
  if (!r.success) {
    const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '（整个文件）'}${issueText(i)}`)
    return { ok: false, error: `preset.json 的内容不正确——${issues.join('；')}` }
  }
  if (!PRESET_ID_PATTERN.test(r.data.id)) return { ok: false, error: `preset.json 的 id“${r.data.id}”只能用小写字母、数字和连字符` }
  return { ok: true, preset: r.data }
}

/** 星级难度的显示：★ 重复 n 次 */
export function starText(n: number | undefined): string {
  return n !== undefined && n > 0 ? '★'.repeat(n) : ''
}

/**
 * 题目的难度：等级与星级按预设一一对应（物理教学案 V1.0：A=1 星简单、B=2 星、C=3 星难）。
 * 数据中通常只存等级，星级由此得出；只有星级时换算成等级。
 * 预设中没有的等级（如手填的 D）原样保留，不显示星级。
 */
export function difficultyOf(q: { difficulty?: string; stars?: number }, preset: FormatPreset): { grade?: string; stars?: number; label?: string } {
  const levels = preset.difficulty.levels
  const grade = q.difficulty !== undefined && q.difficulty !== '' ? q.difficulty : undefined
  const byGrade = grade !== undefined ? levels.find((l) => l.grade === grade) : undefined
  if (byGrade !== undefined) return { grade: byGrade.grade, stars: byGrade.stars, label: byGrade.label }
  if (grade !== undefined) return { grade, ...(q.stars !== undefined ? { stars: q.stars } : {}) }
  const byStars = q.stars !== undefined ? levels.find((l) => l.stars === q.stars) : undefined
  if (byStars !== undefined) return { grade: byStars.grade, stars: byStars.stars, label: byStars.label }
  return q.stars !== undefined ? { stars: q.stars } : {}
}

/** 星数 → 等级（预设中没有对应等级时为 undefined） */
export function gradeForStars(stars: number, preset: FormatPreset): string | undefined {
  return preset.difficulty.levels.find((l) => l.stars === stars)?.grade
}


/**
 * 预设对应的段落样式表：在 STYLE_SPECS 的基础上换成预设中的标题格式。
 * 预览按它显示；导出时把这些格式写进模板的同名样式，两边一致。
 */
export function presetStyles(preset: FormatPreset): Readonly<Record<StyleKey, ParagraphStyleSpec>> {
  const out = { ...STYLE_SPECS }
  for (const key of ['title', 'section', 'topic'] as const) {
    const h = preset.headings[key]
    const { color: _c, ...base } = STYLE_SPECS[key]
    out[key] = {
      ...base,
      fontRole: h.font,
      sizeHalfPt: h.sizeHalfPt,
      bold: h.bold,
      ...(h.color !== undefined ? { color: h.color.toUpperCase() } : {}),
      align: h.align,
      spaceBeforeTwip: h.spaceBeforeTwip,
      spaceAfterTwip: h.spaceAfterTwip
    }
  }
  return out
}

/** 实际使用的行距：工程版式设置中设了的项优先，其次是格式预设，都没有时为单倍 */
export function resolveLineSpacing(layout: Pick<ProjectLayout, 'lineSpacing'>, preset: FormatPreset): LineSpacing {
  const pick = (k: keyof LineSpacing): number => layout.lineSpacing?.[k] ?? preset.lineSpacing?.[k] ?? 1
  return { heading: pick('heading'), question: pick('question'), knowledge: pick('knowledge'), body: pick('body') }
}

/** zod 校验问题的中文说明（老师照着改 preset.json） */
function issueText(i: z.core.$ZodIssue): string {
  switch (i.code) {
    case 'invalid_type':
      return i.input === undefined ? ' 缺少这一项' : ` 类型不对（应为 ${TYPE_NAMES[i.expected] ?? i.expected}）`
    case 'invalid_value':
      return ` 只能是 ${i.values.map((v) => JSON.stringify(v)).join(' / ')}`
    case 'too_small':
      return ` 太小（至少 ${String(i.minimum)}）`
    case 'too_big':
      return ` 太大（至多 ${String(i.maximum)}）`
    case 'invalid_format':
      return ' 格式不对（颜色写 6 位十六进制，如 C00000）'
    case 'unrecognized_keys':
      return ` 有无法识别的字段：${i.keys.join('、')}`
    default:
      return `：${i.message}`
  }
}

const TYPE_NAMES: Record<string, string> = { string: '文字', number: '数字', boolean: 'true / false', object: '对象 {…}', array: '数组 […]' }
