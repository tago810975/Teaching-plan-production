/**
 * 工程内容的统计。
 */
import type { Block } from './types'

/**
 * 题目总数：按题号计——凡是排版时会分到题号的都算一道，即独立的题目，
 * 以及综合题中的每道小题（小题题号与全卷连续，见 build.ts）。综合题本身不编号，不计入。
 * 首页列表、导入提示都用它，保证与预览中的题号一致。
 */
export function countQuestions(blocks: readonly Block[]): number {
  let n = 0
  for (const b of blocks) {
    if (b.type === 'question') n += 1
    else if (b.type === 'composite') n += b.items.length
  }
  return n
}
