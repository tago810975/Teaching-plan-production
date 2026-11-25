/**
 * 左侧大纲多选辅助函数：按视觉顺序枚举内容块（或仅题目）、计算 Shift 区间选择、Ctrl/Cmd 切换选中与去重收集。
 */
import { collectBlocksByIds } from '@core/model/block-clipboard'
import type { Block } from '@core/model/types'

const EMPTY_IDS: string[] = []

/** 按大纲显示顺序列出全部内容块 ID（含顶层块与综合题中的小题） */
export function listOutlineBlockIds(blocks: readonly Block[]): string[] {
  const ids: string[] = []
  for (const b of blocks) {
    ids.push(b.id)
    if (b.type === 'composite') {
      for (const it of b.items) ids.push(it.id)
    }
  }
  return ids
}

/** 按大纲显示顺序列出所有题目 ID（顶层题目及综合题中的小题） */
export function listOutlineQuestionIds(blocks: readonly Block[]): string[] {
  const ids: string[] = []
  for (const b of blocks) {
    if (b.type === 'question') ids.push(b.id)
    else if (b.type === 'composite') {
      for (const it of b.items) ids.push(it.id)
    }
  }
  return ids
}

/** 仅保留仍存在于大纲中的块 ID，并按当前大纲顺序排列 */
export function pruneBlockSelection(selected: readonly string[], orderedIds: readonly string[]): string[] {
  if (selected.length === 0) return EMPTY_IDS
  const set = new Set(selected)
  const next = orderedIds.filter((id) => set.has(id))
  return next.length === 0 ? EMPTY_IDS : next
}

export const pruneQuestionSelection = pruneBlockSelection

/** Shift + 点击：选中锚点与目标项闭区间内的全部内容块（按大纲顺序） */
export function selectBlockRange(orderedIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const ti = orderedIds.indexOf(targetId)
  if (ti === -1) return EMPTY_IDS
  const ai = anchorId !== null ? orderedIds.indexOf(anchorId) : -1
  if (ai === -1) return [targetId]
  const start = Math.min(ai, ti)
  const end = Math.max(ai, ti)
  return orderedIds.slice(start, end + 1)
}

export const selectQuestionRange = selectBlockRange

/** Ctrl / Cmd + 点击：切换目标项的选中状态，并按大纲顺序返回结果 */
export function toggleBlockSelection(
  current: readonly string[],
  primarySelectedId: string | null,
  orderedIds: readonly string[],
  targetId: string
): string[] {
  const valid = new Set(orderedIds)
  if (!valid.has(targetId)) return pruneBlockSelection(current, orderedIds)
  const base = current.length > 0 ? current : primarySelectedId !== null && valid.has(primarySelectedId) ? [primarySelectedId] : []
  const set = new Set(base.filter((id) => valid.has(id)))
  if (set.has(targetId)) set.delete(targetId)
  else set.add(targetId)
  if (set.size === 0) return EMPTY_IDS
  return orderedIds.filter((id) => set.has(id))
}

export const toggleQuestionSelection = toggleBlockSelection

/** 按大纲顺序取出选中的有效内容块（若综合题本身已选中，自动忽略其下重复选中的小题） */
export function effectiveSelectedBlocks(blocks: readonly Block[], selectedIds: readonly string[]): Block[] {
  return collectBlocksByIds(blocks, selectedIds)
}
