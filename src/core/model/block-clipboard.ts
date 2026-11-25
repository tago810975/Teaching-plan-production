/**
 * 内容块（题目、综合题、知识点、标题、段落、作业单等）的复制、剪切与粘贴辅助函数：
 * - extractBlockAssets：遍历待复制块中的全部引用，提取出关联图片资源（支持跨学案/标签页粘贴后图片不丢失）；
 * - cloneBlocksWithNewIds：深拷贝并为各块、题目与小问生成全新 ID，支持反复粘贴；
 * - collectBlocksByIds：按大纲显示顺序列出命中的内容块（顶层块或综合题内小题）。
 */
import { newId } from './factory'
import type { Asset, Block, Question, QuestionBlock } from './types'

/** 递归收集任意内容块中引用的全部资源 ID，并从 allAssets 中抽出对应资源 */
export function extractBlockAssets(blocks: readonly Block[], allAssets: Readonly<Record<string, Asset>>): Record<string, Asset> {
  const refs = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      if (typeof obj.assetId === 'string') refs.add(obj.assetId)
      for (const v of Object.values(obj)) visit(v)
    }
  }
  visit(blocks)
  const out: Record<string, Asset> = {}
  for (const id of refs) {
    const asset = allAssets[id]
    if (asset !== undefined) out[id] = asset
  }
  return out
}

function reidQuestion(q: Question): Question {
  return {
    ...q,
    id: newId(),
    subQuestions: q.subQuestions.map((sq) => ({ ...sq, id: newId() }))
  }
}

function cloneWithNewId(block: Block): Block {
  const copy = structuredClone(block)
  switch (copy.type) {
    case 'question':
      return { ...copy, id: newId(), question: reidQuestion(copy.question) }
    case 'composite':
      return {
        ...copy,
        id: newId(),
        items: copy.items.map((it): QuestionBlock => ({ ...it, id: newId(), question: reidQuestion(it.question) }))
      }
    default:
      return { ...copy, id: newId() }
  }
}

/** 深拷贝一组内容块，并为所有块、题目与小问生成全新 ID */
export function cloneBlocksWithNewIds(blocks: readonly Block[]): Block[] {
  return blocks.map(cloneWithNewId)
}

/** 按大纲显示顺序收集命中 ids 的内容块（可命中顶层块或综合题内的独立小题） */
export function collectBlocksByIds(blocks: readonly Block[], ids: readonly string[]): Block[] {
  const idSet = new Set(ids)
  if (idSet.size === 0) return []
  const picked: Block[] = []
  for (const b of blocks) {
    if (idSet.has(b.id)) {
      picked.push(b)
      continue
    }
    if (b.type === 'composite') {
      for (const it of b.items) {
        if (idSet.has(it.id)) picked.push(it)
      }
    }
  }
  return picked
}
