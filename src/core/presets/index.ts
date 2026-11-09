/**
 * 格式预设：一种教学案的整套格式约定，存为 JSON 文件（本目录下，每个预设一个文件）。
 *
 * 包含：大标题 / 二级标题 / 三级标题（题型分类）的格式、常用的二级标题名称、
 * 作业单模块的格式、知识梳理中常用的强调格式、导入时的整理规则、难度等级。
 * 工程记录所用的预设（project.presetId）；新建或从 Word 新建时选择，设置中可指定导入时默认使用的预设。
 *
 * 新增预设：在本目录添加 JSON 文件，并加入下面的 PRESETS。
 */
import { z } from 'zod'
import { DEFAULT_PRESET_ID } from '../model/factory'
import { STYLE_SPECS, type ParagraphStyleSpec, type StyleKey } from '../document/styles'
import type { TextMarks } from '../model/types'
import physicsV1 from './physics-v1.json'

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
  headings: z.object({ title: heading, section: heading, topic: heading }),
  sectionNames: z.array(z.string()),
  worksheet: z.object({
    titlePrefix: z.string(),
    fields: z.array(z.string()).min(1),
    tabStopsTwip: z.array(z.number().min(0)),
    blankChars: z.number().min(1),
    pageBreakBefore: z.boolean()
  }),
  knowledgeEmphasis: z.array(
    z.object({
      label: z.string(),
      marks: z.object({ bold: z.boolean().optional(), underline: z.boolean().optional(), color: z.string().optional() })
    })
  ),
  import: z.object({
    /** 导入时把这些标签改写，如【详解】→【解析】 */
    renameLabels: z.record(z.string(), z.string()),
    /** black：解析统一为黑色（去掉文字颜色）；keep：保留 */
    analysisColor: z.enum(['black', 'keep'])
  }),
  /** 难度等级，每级对应若干颗星（如 A=1 星简单、C=3 星难），从易到难 */
  difficulty: z.object({
    levels: z.array(z.object({ grade: z.string().min(1), stars: z.number().int().min(1).max(5), label: z.string() })).min(1)
  })
})

export type FormatPreset = z.infer<typeof presetSchema>
export type HeadingFormat = FormatPreset['headings']['title']
export type HeadingKey = keyof FormatPreset['headings']

/** 全部预设，按显示顺序 */
export const PRESETS: readonly FormatPreset[] = [presetSchema.parse(physicsV1)]

export { DEFAULT_PRESET_ID }

/** 按 ID 取预设；找不到（如来自更新版本的工程）时用默认预设 */
export function getPreset(id: string | undefined): FormatPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!
}

/** 星级难度的显示：★ 重复 n 次 */
export function starText(n: number | undefined): string {
  return n !== undefined && n > 0 ? '★'.repeat(n) : ''
}

/**
 * 题目的难度：等级与星级按预设一一对应（物理教案 V1.0：A=1 星简单、B=2 星、C=3 星难）。
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

/** 知识梳理强调格式的文字格式（确保类型完整） */
export function emphasisMarks(m: FormatPreset['knowledgeEmphasis'][number]['marks']): TextMarks {
  return { ...m } as TextMarks
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
