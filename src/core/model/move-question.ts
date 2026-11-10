/**
 * 题目的移动：小题可以移出综合题、独立题目可以移进综合题（答案与解析分到各小题后，带着自己的答案一起走）。
 *
 * moveQuestion（上移 / 下移一步，像在文档中一步步挪动）：
 * - 综合题中的小题：在综合题内交换；已是第一道还要上移 → 移到这道综合题前面，成为独立的题目；
 *   已是最后一道还要下移 → 移到综合题后面；
 * - 独立的题目：紧挨着综合题时，下移进入下一道综合题成为第一道小题，上移进入上一道综合题成为最后一道小题；
 *   否则与相邻内容交换。
 * moveQuestionTo：一步移到某道综合题的最后（target 为综合题 ID），或移出综合题（target 为 null）。
 */
import type { Block, CompositeBlock, QuestionBlock } from './types'

/** 题目所在的位置：顶层第 index 个，或某道综合题（顶层第 index 个）中的第 item 道 */
function locate(blocks: readonly Block[], id: string): { index: number; item?: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    if (b.id === id) return b.type === 'question' ? { index: i } : null
    if (b.type === 'composite') {
      const k = b.items.findIndex((it) => it.id === id)
      if (k !== -1) return { index: i, item: k }
    }
  }
  return null
}

const withItems = (c: CompositeBlock, items: QuestionBlock[]): CompositeBlock => ({ ...c, items })

export function moveQuestion(blocks: Block[], id: string, delta: -1 | 1): Block[] {
  const at = locate(blocks, id)
  if (at === null) return blocks
  const out = blocks.slice()

  if (at.item !== undefined) {
    const c = blocks[at.index] as CompositeBlock
    const k = at.item
    const q = c.items[k]!
    const j = k + delta
    if (j >= 0 && j < c.items.length) {
      const items = c.items.slice()
      ;[items[k], items[j]] = [items[j]!, items[k]!]
      out[at.index] = withItems(c, items)
      return out
    }
    // 移出综合题：放在综合题前面或后面
    out[at.index] = withItems(
      c,
      c.items.filter((_, i) => i !== k)
    )
    out.splice(delta < 0 ? at.index : at.index + 1, 0, q)
    return out
  }

  const q = blocks[at.index] as QuestionBlock
  const nb = blocks[at.index + delta]
  if (nb === undefined) return blocks
  if (nb.type === 'composite') {
    // 进入相邻的综合题：下移成为第一道小题，上移成为最后一道小题
    out[at.index + delta] = withItems(nb, delta > 0 ? [q, ...nb.items] : [...nb.items, q])
    out.splice(at.index, 1)
    return out
  }
  ;[out[at.index], out[at.index + delta]] = [nb, q]
  return out
}

export function moveQuestionTo(blocks: Block[], id: string, target: string | null): Block[] {
  const at = locate(blocks, id)
  if (at === null) return blocks
  const from = blocks[at.index]!
  const q = (at.item !== undefined ? (from as CompositeBlock).items[at.item]! : from) as QuestionBlock
  if (target === null) {
    if (at.item === undefined) return blocks
    // 移出综合题：放在综合题后面
    const c = from as CompositeBlock
    const out = blocks.slice()
    out[at.index] = withItems(c, c.items.filter((_, i) => i !== at.item))
    out.splice(at.index + 1, 0, q)
    return out
  }
  if (at.item !== undefined && from.id === target) return blocks
  const ti = blocks.findIndex((b) => b.id === target)
  const tb = blocks[ti]
  if (tb?.type !== 'composite') return blocks
  // 先从原处取出，再放到目标综合题的最后
  let out: Block[] =
    at.item !== undefined
      ? blocks.map((b, i) => (i === at.index ? withItems(b as CompositeBlock, (b as CompositeBlock).items.filter((_, k) => k !== at.item)) : b))
      : blocks.filter((_, i) => i !== at.index)
  out = out.map((b) => (b.id === target && b.type === 'composite' ? withItems(b, [...b.items, q]) : b))
  return out
}
