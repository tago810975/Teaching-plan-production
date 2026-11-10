/**
 * 预览分页：模拟 Word 按“与下段同页”“段中不分页”“段前分页”规则分页，
 * 并像 Word 一样把允许拆分的段落按行拆到两页。
 *
 * 输入为每段的实测高度与各行位置（由预览在隐藏的测量区中排版后得出）。
 * 与 Word 一致的规则：
 * - 页面最后一段的段后间距可以超出页底（被截掉），不会因此把该段推到下一页；
 * - 段落拆开后，开启孤行控制的样式两边各至少保留 2 行，否则至少 1 行。
 */

export interface MeasuredParagraph {
  /** 段落占用的高度（含段前段后间距），单位任意，与 pageHeight 一致即可 */
  height: number
  /** 其中段后间距的高度；排在页底时这部分可以超出页面 */
  spaceAfter?: number
  keepNext?: boolean
  /** 段中不分页；为 false 且提供了 lineBreaks 时可以按行拆分 */
  keepLines?: boolean
  pageBreakBefore?: boolean
  /**
   * 可断开的位置：相邻两行之间的分界线距段落顶端的距离，按从上到下排列。
   * n 行的段落有 n-1 个分界线。不提供则视为不可拆分。
   */
  lineBreaks?: readonly number[]
  /** 拆分后每部分至少保留的行数（孤行控制开启时为 2） */
  minLines?: number
}

/** 一页中的一个片段：第 index 段从 from 到 to 的部分（to 缺省表示到段落末尾） */
export interface PageSlice {
  index: number
  from: number
  to?: number
}

export function paginate(items: readonly MeasuredParagraph[], pageHeight: number): PageSlice[][] {
  const pages: PageSlice[][] = [[]]
  let used = 0
  const current = (): PageSlice[] => pages[pages.length - 1]!
  const newPage = (): void => {
    if (current().length > 0) {
      pages.push([])
      used = 0
    }
  }
  const place = (index: number, from = 0): void => {
    current().push(from === 0 ? { index, from } : { index, from })
    used += items[index]!.height - from
  }
  const fitsWhole = (from: number, to: number): boolean => {
    let h = used
    for (let k = from; k <= to; k++) h += items[k]!.height
    return h - (items[to]!.spaceAfter ?? 0) <= pageHeight
  }

  /** 把第 index 段（从 from 开始）放入当前页，必要时按行拆分到后续页 */
  const placeFlowing = (index: number, startFrom = 0): void => {
    const item = items[index]!
    let from = startFrom
    for (;;) {
      const remaining = item.height - from
      if (used + remaining - (item.spaceAfter ?? 0) <= pageHeight) {
        place(index, from)
        return
      }
      const cut = splitPoint(item, from, pageHeight - used)
      if (cut !== null) {
        current().push({ index, from, to: cut })
        pages.push([])
        used = 0
        from = cut
        continue
      }
      // 当前页一行都放不下：换页后再试；已在新页仍放不下则只能溢出
      if (current().length > 0) {
        newPage()
        continue
      }
      place(index, from)
      return
    }
  }

  let i = 0
  while (i < items.length) {
    // “与下段同页”串起来的一组段落
    let end = i
    // “与下段同页”连成一组；遇到段前分页的段落就截止，让它从新的一页开始（与 Word 一致：段前分页优先）
    while (items[end]!.keepNext === true && end + 1 < items.length && items[end + 1]!.pageBreakBefore !== true) end += 1

    if (items[i]!.pageBreakBefore === true) newPage()

    if (fitsWhole(i, end)) {
      for (let k = i; k <= end; k++) place(k)
    } else if (fitsWithFirstLines(i, end)) {
      // 前面几段放得下，且最后一段（或唯一一段）的开头几行也放得下：Word 会把它拆开
      for (let k = i; k < end; k++) place(k)
      placeFlowing(end)
    } else {
      newPage()
      if (fitsWhole(i, end)) {
        for (let k = i; k <= end; k++) place(k)
      } else {
        // 整组比一页还高：逐段排，允许拆分的段落按行拆分
        for (let k = i; k <= end; k++) placeFlowing(k)
      }
    }
    i = end + 1
  }
  return pages

  function fitsWithFirstLines(from: number, last: number): boolean {
    let h = used
    for (let k = from; k < last; k++) h += items[k]!.height
    if (h > pageHeight) return false
    return splitPoint(items[last]!, 0, pageHeight - h) !== null
  }
}

/**
 * 在可用高度 available 内，段落从 from 开始最多能放到哪个分界线。
 * 返回分界线位置；不可拆分或放不下最少行数时返回 null。
 */
function splitPoint(item: MeasuredParagraph, from: number, available: number): number | null {
  const breaks = item.lineBreaks
  if (item.keepLines === true || breaks === undefined || breaks.length === 0) return null
  const minLines = item.minLines ?? 1
  // 只考虑 from 之后的分界线
  const startIdx = breaks.findIndex((b) => b > from + 0.5)
  if (startIdx === -1) return null
  const totalLinesLeft = breaks.length - startIdx + 1
  let best: number | null = null
  for (let k = startIdx; k < breaks.length; k++) {
    const linesHere = k - startIdx + 1
    const linesAfter = totalLinesLeft - linesHere
    if (linesHere < minLines || linesAfter < minLines) continue
    if (breaks[k]! - from <= available) best = breaks[k]!
    else break
  }
  return best
}
