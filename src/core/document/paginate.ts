/**
 * 预览分页：模拟 Word 按“与下段同页”“段前分页”规则分页。
 *
 * 输入为每段的实测高度（由预览在隐藏的测量区中排版后得出），
 * 输出为每页包含的段落下标。与 Word 的已知差异：
 * - 不会把单个段落拆到两页（Word 在未设置“段中不分页”时会拆分）；
 * - 不处理孤行控制。
 * 这两点使预览偏保守：预览中同页的内容，在 Word 中不会被挤到下一页。
 *
 * 与 Word 一致的规则：页面最后一段的段后间距可以超出页底（被截掉），
 * 不会因此把该段推到下一页。
 */
export interface MeasuredParagraph {
  /** 段落占用的高度（含段前段后间距），单位任意，与 pageHeight 一致即可 */
  height: number
  /** 其中段后间距的高度；排在页底时这部分可以超出页面 */
  spaceAfter?: number
  keepNext?: boolean
  pageBreakBefore?: boolean
}

export function paginate(items: readonly MeasuredParagraph[], pageHeight: number): number[][] {
  const pages: number[][] = [[]]
  let used = 0
  const current = (): number[] => pages[pages.length - 1]!
  const newPage = (): void => {
    if (current().length > 0) {
      pages.push([])
      used = 0
    }
  }
  const place = (i: number): void => {
    current().push(i)
    used += items[i]!.height
  }

  /** 从 used 开始依次放入 from..to，是否放得下（最后一段的段后间距不计） */
  const fits = (from: number, to: number): boolean => {
    let h = used
    for (let k = from; k <= to; k++) h += items[k]!.height
    return h - (items[to]!.spaceAfter ?? 0) <= pageHeight
  }

  let i = 0
  while (i < items.length) {
    // “与下段同页”串起来的一组段落
    let end = i
    while (items[end]!.keepNext === true && end + 1 < items.length) end += 1

    if (items[i]!.pageBreakBefore === true) newPage()

    if (fits(i, end)) {
      for (let k = i; k <= end; k++) place(k)
    } else {
      newPage()
      if (fits(i, end)) {
        for (let k = i; k <= end; k++) place(k)
      } else {
        // 整组比一页还高，只能逐段排
        for (let k = i; k <= end; k++) {
          if (!fits(k, k)) newPage()
          place(k)
        }
      }
    }
    i = end + 1
  }
  return pages
}
