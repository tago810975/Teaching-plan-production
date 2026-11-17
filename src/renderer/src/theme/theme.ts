/**
 * 界面配色主题：写在根元素的 data-theme 上，颜色由 app.css 按主题给出。
 * 启动时主进程把已保存的主题放在地址参数里，首帧即可用对的颜色；切换后保存到 settings.json。
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_THEME, isThemeId, type ThemeEffectsOff, type ThemeId } from '@shared/themes'

const listeners = new Set<() => void>()

function read(): ThemeId {
  const v = document.documentElement.dataset['theme']
  return isThemeId(v) ? v : DEFAULT_THEME
}

/**
 * 风格主题中关掉的动效。当前主题的那份写在根元素的 data-fx-off 上（空格分隔），
 * app.css 用 [data-fx-off~='编号'] 把对应的效果换回常规主题的样子。
 */
let effectsOff: ThemeEffectsOff = {}

function applyEffects(): void {
  const list = effectsOff[read()] ?? []
  document.documentElement.dataset['fxOff'] = list.join(' ')
}

/** 启动时调用：按地址参数设好主题与当前主题关掉的动效，再读回全部主题的设置 */
export function initTheme(): void {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('theme')
  document.documentElement.dataset['theme'] = isThemeId(fromUrl) ? fromUrl : DEFAULT_THEME
  document.documentElement.dataset['fxOff'] = params.get('fxoff') ?? ''
  void window.api
    .getThemeEffectsOff()
    .then((v) => {
      effectsOff = v
      version++
      applyEffects()
      listeners.forEach((l) => l())
    })
    .catch((err: unknown) => console.error('读取主题动效设置失败', err))
}

/** 某个主题的某项动效是否开着 */
export function effectOn(theme: ThemeId, effect: string): boolean {
  return !(effectsOff[theme] ?? []).includes(effect)
}

export function setEffect(theme: ThemeId, effect: string, on: boolean): void {
  const list = new Set(effectsOff[theme] ?? [])
  if (on) list.delete(effect)
  else list.add(effect)
  effectsOff = { ...effectsOff, [theme]: [...list] }
  applyEffects()
  version++
  listeners.forEach((l) => l())
  void window.api.setThemeEffectsOff(effectsOff).catch((err: unknown) => console.error('保存主题动效设置失败', err))
}

let version = 0
/** 动效设置变了就重新渲染（返回一个随设置变化的版本号） */
export function useEffectsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version
  )
}

let switchTimer: number | undefined

export function setTheme(id: ThemeId): void {
  if (id === read()) return
  // 切换的一瞬间加上过渡，颜色平滑变过去，结束后去掉
  const root = document.documentElement
  root.classList.add('is-theme-switching')
  window.clearTimeout(switchTimer)
  switchTimer = window.setTimeout(() => root.classList.remove('is-theme-switching'), 300)
  root.dataset['theme'] = id
  applyEffects()
  listeners.forEach((l) => l())
  void window.api.setTheme(id).catch((err: unknown) => console.error('保存配色主题失败', err))
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    read
  )
}
