/**
 * 导入 Word 文档：读取 → 识别 → 整理资源与提示信息。
 */
import { ommlToMathml } from '../math/omml-to-mathml'
import { createEmptyProject } from '../model/factory'
import type { Asset, Block } from '../model/types'
import { collectAssetRefs } from '../project-file/codec'
import { readDocx } from './docx-reader'
import { normalizeFonts } from './normalize-fonts'
import { recognize } from './recognize'

export interface DocxImportResult {
  blocks: Block[]
  assets: Record<string, Asset>
  questionCount: number
  /** 文档中的第一个大标题 */
  firstTitle?: string
  /** 需要用户留意的情况，如矢量图片、文本框、无法识别的公式结构 */
  warnings: string[]
}

export async function importDocx(bytes: Uint8Array): Promise<DocxImportResult> {
  const read = await readDocx(bytes)
  const recognized = recognize(read.paragraphs)
  const { questionCount, firstTitle } = recognized
  // 去掉与样式相同的字体，整段同一字体时提升为段落字体
  const blocks = normalizeFonts(recognized.blocks)

  // 只保留被引用的图片（水印、页眉图片等不会进入正文）
  const refs = collectAssetRefs({ ...createEmptyProject(), blocks })
  const assets: Record<string, Asset> = {}
  for (const id of refs) if (read.assets[id] !== undefined) assets[id] = read.assets[id]

  const warnings = [...read.warnings]
  const unknown = new Set<string>()
  visitMath(blocks, (omml) => ommlToMathml(omml).unknown.forEach((u) => unknown.add(u)))
  if (unknown.size > 0) warnings.push(`部分公式含有暂不支持的结构（${[...unknown].join('、')}），预览中只显示其中的文字。`)
  if (questionCount === 0) warnings.push('没有识别到题目。请确认题目以“1.”这样的题号开头，或使用“物理排版 题目”样式。')

  return { blocks, assets, questionCount, ...(firstTitle !== undefined ? { firstTitle } : {}), warnings }
}

function visitMath(value: unknown, fn: (omml: string) => void): void {
  if (Array.isArray(value)) value.forEach((v) => visitMath(v, fn))
  else if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (obj.type === 'math' && typeof obj.omml === 'string') fn(obj.omml)
    else Object.values(obj).forEach((v) => visitMath(v, fn))
  }
}
