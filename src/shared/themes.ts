/**
 * 界面配色主题。具体颜色写在 renderer 的 app.css（:root[data-theme='…']），
 * 这里只登记主题的编号、名称，以及首页色块与窗口底色要用到的几个颜色。
 * 主题只改软件界面；预览中的 A4 页面与导出的 Word 不受影响。
 */
export interface ThemeInfo {
  id: ThemeId
  name: string
  /** 色块：工作台底色、面板色、强调色 */
  swatch: { desk: string; panel: string; accent: string }
  /** 窗口启动时的底色（与工作台底色一致，避免打开时闪一下） */
  windowBackground: string
}

export type ThemeId = 'slate' | 'paper' | 'mist' | 'plain' | 'dark'

export const DEFAULT_THEME: ThemeId = 'slate'

export const THEMES: readonly ThemeInfo[] = [
  { id: 'slate', name: '青灰', swatch: { desk: '#d6dedb', panel: '#f3f5f4', accent: '#b3261e' }, windowBackground: '#d6dedb' },
  { id: 'paper', name: '暖纸', swatch: { desk: '#e3dccf', panel: '#f7f3ec', accent: '#a5381f' }, windowBackground: '#e3dccf' },
  { id: 'mist', name: '雾蓝', swatch: { desk: '#d5dde8', panel: '#f2f5f9', accent: '#b3261e' }, windowBackground: '#d5dde8' },
  { id: 'plain', name: '素白', swatch: { desk: '#e2e2e2', panel: '#f6f6f6', accent: '#c0281f' }, windowBackground: '#e2e2e2' },
  { id: 'dark', name: '深色', swatch: { desk: '#14181a', panel: '#1c2225', accent: '#ef6b5f' }, windowBackground: '#14181a' }
]

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}

export function themeInfo(id: unknown): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!
}
