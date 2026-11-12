/**
 * 界面配色主题：写在根元素的 data-theme 上，颜色由 app.css 按主题给出。
 * 启动时主进程把已保存的主题放在地址参数里，首帧即可用对的颜色；切换后保存到 settings.json。
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_THEME, isThemeId, type ThemeId } from '@shared/themes'

const listeners = new Set<() => void>()

function read(): ThemeId {
  const v = document.documentElement.dataset['theme']
  return isThemeId(v) ? v : DEFAULT_THEME
}

/** 启动时调用：按地址参数设好主题 */
export function initTheme(): void {
  const fromUrl = new URLSearchParams(window.location.search).get('theme')
  document.documentElement.dataset['theme'] = isThemeId(fromUrl) ? fromUrl : DEFAULT_THEME
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
