/**
 * 用户保存的选项间距方案：从设置读取一次，所有用到的地方共享（版式设置、单题的“本题单独设置”）。
 */
import { useSyncExternalStore } from 'react'
import type { OptionStopScheme } from '@core/model/option-stop-schemes'

let schemes: OptionStopScheme[] = []
let loaded = false
const listeners = new Set<() => void>()

function emit(next: OptionStopScheme[]): void {
  schemes = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  if (!loaded) {
    loaded = true
    void window.api.getOptionStopSchemes().then(emit)
  }
  return () => listeners.delete(l)
}

export function useOptionStopSchemes(): [OptionStopScheme[], (next: OptionStopScheme[]) => Promise<void>] {
  const value = useSyncExternalStore(subscribe, () => schemes)
  return [value, async (next) => emit(await window.api.setOptionStopSchemes(next))]
}
