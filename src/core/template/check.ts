/**
 * 检查用户模板中的 Word 模板（template.docx）是否满足导出的硬性要求（模板制作指南第 4 节）：
 * 正文中有 {{body}} 占位符，程序用到的样式名一个不少。
 */
import JSZip from 'jszip'
import { STYLE_SPECS } from '../document/styles'

/** Word 模板必须有的样式名（导出靠样式名找样式） */
const REQUIRED_STYLE_NAMES = [...new Set(Object.values(STYLE_SPECS).map((s) => s.wordStyleName))]

/** 检查 Word 模板：正文占位符与必需的样式名（详见模板制作指南第 4 节） */
export async function checkWordTemplate(bytes: Uint8Array): Promise<string | null> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    return 'template.docx 不是有效的 Word 文档'
  }
  const doc = await zip.file('word/document.xml')?.async('string')
  const styles = await zip.file('word/styles.xml')?.async('string')
  if (doc === undefined || styles === undefined) return 'template.docx 缺少正文或样式'
  if (!doc.includes('{{body}}')) return 'template.docx 的正文中没有 {{body}} 占位符'
  const missing = REQUIRED_STYLE_NAMES.filter((name) => !styles.includes(`w:val="${name}"`))
  if (missing.length > 0) return `template.docx 缺少样式：${missing.slice(0, 4).join('、')}${missing.length > 4 ? ` 等 ${missing.length} 个` : ''}`
  return null
}

