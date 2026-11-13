/**
 * 公式字母是否用正体（不倾斜）：本机设置，所有标签页的预览共用；导出时主进程按同一设置写 Word。
 * 首页“设置…”中修改后立即在打开的预览中生效。
 */
import { useSyncExternalStore } from 'react'

let value = true
let loaded = false
const listeners = new Set<() => void>()

function load(): void {
  if (loaded) return
  loaded = true
  void window.api.getMathUpright().then((v) => {
    value = v
    listeners.forEach((l) => l())
  })
}

export function setMathUpright(on: boolean): void {
  value = on
  listeners.forEach((l) => l())
  void window.api.setMathUpright(on)
}

export function useMathUpright(): boolean {
  load()
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => value
  )
}
