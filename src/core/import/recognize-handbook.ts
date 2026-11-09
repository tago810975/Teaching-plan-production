/**
 * 识别知识点手册（知识单）：只有大标题与知识点，没有题目、也没有“知识梳理”等二级标题。
 *
 * - “物理排版 大标题”样式 → 大标题；
 * - “物理排版 题目类型”样式，或“一、”“二、”开头的短段落 → 新的知识点，以它为知识点标题；
 * - 其余段落（包括“1．光的反射”这类带编号的段落）都是当前知识点的内容；单独成段的图片、
 *   浮在文字旁的图片作为知识点插图。标题之前的内容放进一个没有标题的知识点。
 * - 二级标题（“物理排版 标题2”，如“知识梳理”）在知识点手册中不用，略去。
 */
import { createKnowledge, newId } from '../model/factory'
import type { Block, KnowledgeBlock } from '../model/types'
import type { ReadParagraph } from './docx-reader'
import { clean, isBlank, isImageOnly, KNOWLEDGE_HEADING, styleRole, textOf, withFormat, type RecognizeResult } from './recognize'

/** “一、”开头的段落不超过这么多字时，看作知识点标题 */
const HEADING_MAX_CHARS = 30

export function recognizeHandbook(paragraphs: ReadParagraph[]): RecognizeResult {
  const blocks: Block[] = []
  let knowledge: KnowledgeBlock | null = null
  let firstTitle: string | undefined

  const ensureKnowledge = (): KnowledgeBlock => {
    if (knowledge === null) {
      knowledge = createKnowledge({ title: '' })
      blocks.push(knowledge)
    }
    return knowledge
  }

  for (const para of paragraphs) {
    const role = styleRole(para.styleName)
    const text = textOf(para).trim()

    if (role === 'title' && text !== '') {
      blocks.push({ id: newId(), type: 'title', text })
      firstTitle ??= text
      knowledge = null
      continue
    }
    if (role === 'section') continue
    const looksLikeHeading = role === undefined || role === 'body' ? KNOWLEDGE_HEADING.test(text) && [...text].length <= HEADING_MAX_CHARS && !isImageOnly(para) : false
    if ((role === 'topic' && text !== '') || looksLikeHeading) {
      knowledge = createKnowledge({ title: text })
      blocks.push(knowledge)
      // 标题段中的图片（如示例中第一个标题段落里的光路图）作为插图
      for (const i of para.inlines) {
        if (i.type === 'image') knowledge.figures.push({ assetId: i.assetId, widthEmu: i.widthEmu, heightEmu: i.heightEmu, placement: 'below', anchorParagraph: 0 })
      }
      continue
    }
    if (isBlank(para)) continue

    const k = ensureKnowledge()
    if (isImageOnly(para)) {
      // 单独成段的图片 → 插图，排在前一段之后（同一段中的多张图并排）
      for (const i of para.inlines) {
        if (i.type !== 'image') continue
        k.figures.push({ assetId: i.assetId, widthEmu: i.widthEmu, heightEmu: i.heightEmu, placement: 'below', anchorParagraph: Math.max(0, k.content.length - 1) })
      }
    } else {
      const rp = withFormat(clean(para.inlines), para)
      if (rp.inlines.length > 0) k.content.push(rp)
    }
    // 浮在文字旁的图：右侧环绕图，锚定在当前段落
    for (const img of para.floating) {
      k.figures.push({ assetId: img.assetId, widthEmu: img.widthEmu, heightEmu: img.heightEmu, placement: 'right', anchorParagraph: Math.max(0, k.content.length - 1) })
    }
  }
  return { blocks, questionCount: 0, ...(firstTitle !== undefined ? { firstTitle } : {}) }
}
