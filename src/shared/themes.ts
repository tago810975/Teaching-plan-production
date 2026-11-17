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
  /** 风格主题可单独开关的动效；关掉的改用常规主题的效果 */
  effects?: readonly ThemeEffect[]
}

export interface ThemeEffect {
  id: string
  name: string
}

export type ThemeId = 'slate' | 'paper' | 'mist' | 'plain' | 'dark' | 'noir' | 'tide'

export const DEFAULT_THEME: ThemeId = 'slate'

export const THEMES: readonly ThemeInfo[] = [
  { id: 'slate', name: '青灰', swatch: { desk: '#d6dedb', panel: '#f3f5f4', accent: '#b3261e' }, windowBackground: '#d6dedb' },
  { id: 'paper', name: '暖纸', swatch: { desk: '#e3dccf', panel: '#f7f3ec', accent: '#a5381f' }, windowBackground: '#e3dccf' },
  { id: 'mist', name: '雾蓝', swatch: { desk: '#d5dde8', panel: '#f2f5f9', accent: '#b3261e' }, windowBackground: '#d5dde8' },
  { id: 'plain', name: '素白', swatch: { desk: '#e2e2e2', panel: '#f6f6f6', accent: '#c0281f' }, windowBackground: '#e2e2e2' },
  { id: 'dark', name: '深色', swatch: { desk: '#14181a', panel: '#1c2225', accent: '#ef6b5f' }, windowBackground: '#14181a' },
  // 赤黑：红、黑、白的高反差风格主题，除配色外还带斜切造型与硬边投影（见 app.css 末尾）
  {
    id: 'noir',
    name: '赤黑',
    swatch: { desk: '#0b0b0b', panel: '#f4f4f4', accent: '#e5191c' },
    windowBackground: '#0b0b0b',
    effects: [
      { id: 'wipe', name: '切换标签页时的斜幕' },
      { id: 'collage', name: '剪报拼贴标题' },
      { id: 'quad', name: '悬停条目下的游移四边形' },
      { id: 'tilt', name: '按钮、选项悬停时倾斜抖动' },
      { id: 'popin', name: '菜单与对话框倾斜甩入' },
      { id: 'stage', name: '预览中右键的战斗指令式菜单' }
    ]
  },
  // 月潮：深海蓝与青色的冷调风格主题，带流光悬停、水平滑入的浮层与青色幕布（见 app.css 末尾）
  {
    id: 'tide',
    name: '月潮',
    swatch: { desk: '#081a3a', panel: '#e8f6ff', accent: '#21c8ff' },
    windowBackground: '#081a3a',
    effects: [
      { id: 'wipe', name: '切换标签页时海水灌入' },
      { id: 'rise', name: '标题逐字浮起、漂动' },
      { id: 'invert', name: '悬停条目反色加边框' },
      { id: 'sheen', name: '按钮悬停流光、上浮' },
      { id: 'popin', name: '菜单滑入、对话框浮出' }
    ]
  }
]

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}

export function themeInfo(id: unknown): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!
}

/** 各主题关掉的动效：主题编号 → 动效编号列表 */
export type ThemeEffectsOff = Partial<Record<ThemeId, string[]>>

/** 清理读进来的设置：只留登记过的主题与动效 */
export function sanitizeEffectsOff(v: unknown): ThemeEffectsOff {
  const out: ThemeEffectsOff = {}
  if (typeof v !== 'object' || v === null) return out
  for (const t of THEMES) {
    const list = (v as Record<string, unknown>)[t.id]
    if (!Array.isArray(list) || t.effects === undefined) continue
    const ids = new Set(t.effects.map((e) => e.id))
    const kept = list.filter((x): x is string => typeof x === 'string' && ids.has(x))
    if (kept.length > 0) out[t.id] = [...new Set(kept)]
  }
  return out
}
