/**
 * 导入 Word 文档：读取 → 识别 → 整理资源与提示信息。
 */
import { ommlToMathml } from '../math/omml-to-mathml'
import { createEmptyProject } from '../model/factory'
import type { Asset, Block } from '../model/types'
import { collectAssetRefs } from '../project-file/codec'
import { readDocx } from './docx-reader'
import { normalizeFonts } from './normalize-fonts'
import { applyPresetRules } from './preset-rules'
import { getPreset } from '../presets'
import { recognize } from './recognize'
import { gradeOfCoefficient, isZujuan, prepareZujuan } from './zujuan'
import { recognizeAsKnowledge } from './as-knowledge'
import { recognizeHandbook } from './recognize-handbook'

export interface DocxImportResult {
  blocks: Block[]
  assets: Record<string, Asset>
  questionCount: number
  /** 按知识点导入时：知识点的个数 */
  knowledgeCount?: number
  /** 文档中的第一个大标题 */
  firstTitle?: string
  /** 需要用户留意的情况，如矢量图片、文本框、无法识别的公式结构 */
  warnings: string[]
}

export interface DocxImportOptions {
  /** 格式预设，决定作业单、解析等的整理规则；默认物理教学案 V1.0 */
  presetId?: string
  /** 按知识点导入（“导入知识点”）：不识别题目编号，内容都成为知识点 */
  asKnowledge?: boolean
}

export async function importDocx(bytes: Uint8Array, options: DocxImportOptions = {}): Promise<DocxImportResult> {
  const read = await readDocx(bytes)
  const preset = getPreset(options.presetId)
  // 组卷网下载的题目：先按题组整理（见 zujuan.ts）
  const asKnowledge = options.asKnowledge === true && preset.kind !== 'handbook'
  const zujuan = preset.kind !== 'handbook' && !asKnowledge && isZujuan(read.paragraphs) ? prepareZujuan(read.paragraphs) : null
  // 知识点手册只有大标题与知识点，不识别题目
  const recognized =
    preset.kind === 'handbook'
      ? recognizeHandbook(read.paragraphs)
      : asKnowledge
        ? recognizeAsKnowledge(read.paragraphs)
        : recognize(zujuan !== null ? zujuan.paragraphs : read.paragraphs)
  // 组卷网题组的【知识点】是整组共用的，保留在综合题共用解析的开头（只显示一次，与原文一致）
  if (zujuan !== null) applyZujuanDifficulty(recognized.blocks, zujuan.difficulty)
  const { questionCount, firstTitle } = recognized
  // 去掉与样式相同的字体，整段同一字体时提升为段落字体；再按预设整理作业单、难度星级与解析
  const blocks = applyPresetRules(normalizeFonts(recognized.blocks), preset)

  // 只保留被引用的图片（水印、页眉图片等不会进入正文）
  const refs = collectAssetRefs({ ...createEmptyProject(), blocks })
  const assets: Record<string, Asset> = {}
  for (const id of refs) if (read.assets[id] !== undefined) assets[id] = read.assets[id]

  const warnings = [...read.warnings]
  if (zujuan !== null) {
    warnings.unshift(`识别为组卷网下载的题目：${zujuan.groups} 组，带材料或多道小题的组做成综合题（共用答案与解析）；难度按组卷网难度系数换算（0.7 以上为 A，0.5～0.7 为 B，低于 0.5 为 C）。`)
  }
  const unknown = new Set<string>()
  visitMath(blocks, (omml) => ommlToMathml(omml).unknown.forEach((u) => unknown.add(u)))
  if (unknown.size > 0) warnings.push(`部分公式含有暂不支持的结构（${[...unknown].join('、')}），预览中只显示其中的文字。`)
  const knowledgeCount = asKnowledge ? blocks.filter((b) => b.type === 'knowledge').length : undefined
  if (asKnowledge) {
    if (knowledgeCount === 0) warnings.push('没有识别到知识点。')
  } else if (questionCount === 0) warnings.push('没有识别到题目。请确认题目以“1.”这样的题号开头，或使用“物理排版 题目”样式。')

  return { blocks, assets, questionCount, ...(knowledgeCount !== undefined ? { knowledgeCount } : {}), ...(firstTitle !== undefined ? { firstTitle } : {}), warnings }
}

function visitMath(value: unknown, fn: (omml: string) => void): void {
  if (Array.isArray(value)) value.forEach((v) => visitMath(v, fn))
  else if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.type === 'math' && typeof obj.omml === 'string') fn(obj.omml)
    else Object.values(obj).forEach((v) => visitMath(v, fn))
  }
}

/** 按全卷题号给题目写上组卷网换算来的难度等级（已有等级的不改） */
function applyZujuanDifficulty(blocks: Block[], difficulty: Map<number, number>): void {
  let no = 0
  const visit = (q: { difficulty?: string }): void => {
    no += 1
    const c = difficulty.get(no)
    if (c !== undefined && (q.difficulty === undefined || q.difficulty === '')) q.difficulty = gradeOfCoefficient(c)
  }
  for (const b of blocks) {
    if (b.type === 'question') visit(b.question)
    else if (b.type === 'composite') b.items.forEach((it) => visit(it.question))
  }
}
