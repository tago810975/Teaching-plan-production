/**
 * 中文字体大类：预览、导出、导入共用的对照表。
 *
 * 只区分宋体、黑体、楷体、仿宋四类。导出写成 Windows 自带的字体名；
 * 导入时把各种具体字体（华文仿宋、楷体_GB2312、微软雅黑……）归入相应大类。
 */
import type { FontFamily } from '../model/types'

export const FONT_FAMILIES: readonly FontFamily[] = ['song', 'hei', 'kai', 'fang']

/** 界面中显示的名称 */
export const FONT_LABELS: Readonly<Record<FontFamily, string>> = { song: '宋体', hei: '黑体', kai: '楷体', fang: '仿宋' }

/** 导出时写入 Word 的东亚字体名 */
export const WORD_FONT_NAMES: Readonly<Record<FontFamily, string>> = { song: '宋体', hei: '黑体', kai: '楷体', fang: '仿宋' }

/**
 * 具体字体名 → 大类；认不出（如 Times New Roman、Cambria Math）时返回 undefined。
 * 注意顺序：“华文仿宋”含“宋”字，要先判断仿宋。
 */
export function fontFamilyOf(name: string | undefined): FontFamily | undefined {
  if (name === undefined) return undefined
  const n = name.toLowerCase().replace(/\s+/g, '')
  if (/仿宋|fangsong/.test(n)) return 'fang'
  if (/楷|kai/.test(n)) return 'kai'
  if (/黑|雅黑|yahei|simhei|heiti|等线|dengxian|pingfang|苹方|sourcehansans|思源黑|notosanscjk/.test(n)) return 'hei'
  if (/宋|simsun|songti|stsong|sourcehanserif|思源宋|notoserifcjk/.test(n)) return 'song'
  return undefined
}
