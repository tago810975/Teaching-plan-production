/**
 * 按知识点导入（“导入知识点”）：内容前面虚拟一个“知识梳理”栏目，让识别器按知识栏目的规则处理——
 * “一、……”短标题后跟正文的成为知识点，“1.”开头的行不当成题目；识别后去掉这个栏目，
 * 开头或标题之间零散的正文合并成知识点（没有标题）。
 */
import { createKnowledge } from '../model/factory'
import type { Block } from '../model/types'
import type { ReadParagraph } from './docx-reader'
import { recognize, type RecognizeResult } from './recognize'

/** 虚拟的栏目标题：带“标题2”样式，无论文档是否使用样式都会被识别为栏目 */
const SECTION: ReadParagraph = { numbered: false, inlines: [{ type: 'text', text: '知识梳理' }], floating: [], styleName: '物理排版 标题2' }

export function recognizeAsKnowledge(paragraphs: ReadParagraph[]): RecognizeResult & { knowledgeCount: number } {
  const r = recognize([SECTION, ...paragraphs])
  const blocks = toKnowledgeBlocks(r.blocks)
  return { ...r, blocks, knowledgeCount: blocks.filter((b) => b.type === 'knowledge').length }
}

/** 去掉虚拟的栏目；连续的正文合并成一个知识点 */
function toKnowledgeBlocks(blocks: Block[]): Block[] {
  const rest = blocks[0]?.type === 'section' && blocks[0].text === '知识梳理' ? blocks.slice(1) : blocks
  const out: Block[] = []
  for (const b of rest) {
    if (b.type === 'paragraph') {
      const last = out[out.length - 1]
      if (last?.type === 'knowledge' && last.title === '' && last.figures.length === 0) last.content.push(...b.content)
      else out.push(createKnowledge({ content: [...b.content] }))
    } else out.push(b)
  }
  return out
}
