/**
 * 左侧大纲题目多选辅助函数：按视觉顺序枚举题目、计算 Shift 区间选择与 Ctrl/Cmd 切换选中。
 */
import type { Block } from '@core/model/types'

const EMPTY_IDS: string[] = []

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

/** 仅保留仍存在于大纲中的题目 ID，并按当前大纲顺序排列 */
export function pruneQuestionSelection(selected: readonly string[], questionIds: readonly string[]): string[] {
  if (selected.length === 0) return EMPTY_IDS
  const set = new Set(selected)
  const next = questionIds.filter((id) => set.has(id))
  return next.length === 0 ? EMPTY_IDS : next
}

/** Shift + 点击：选中锚点与目标题目闭区间内的全部题目（按大纲顺序） */
export function selectQuestionRange(questionIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const ti = questionIds.indexOf(targetId)
  if (ti === -1) return EMPTY_IDS
  const ai = anchorId !== null ? questionIds.indexOf(anchorId) : -1
  if (ai === -1) return [targetId]
  const start = Math.min(ai, ti)
  const end = Math.max(ai, ti)
  return questionIds.slice(start, end + 1)
}

/** Ctrl / Cmd + 点击：切换目标题目的选中状态，并按大纲顺序返回结果 */
export function toggleQuestionSelection(
  current: readonly string[],
  primarySelectedId: string | null,
  questionIds: readonly string[],
  targetId: string
): string[] {
  const valid = new Set(questionIds)
  if (!valid.has(targetId)) return pruneQuestionSelection(current, questionIds)
  const base = current.length > 0 ? current : primarySelectedId !== null && valid.has(primarySelectedId) ? [primarySelectedId] : []
  const set = new Set(base.filter((id) => valid.has(id)))
  if (set.has(targetId)) set.delete(targetId)
  else set.add(targetId)
  if (set.size === 0) return EMPTY_IDS
  return questionIds.filter((id) => set.has(id))
}
