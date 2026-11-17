/// <reference lib="webworker" />
/** 后台线程：插图变清晰（清理底色 + FSRCNN 放大），不阻塞界面 */
import { enhanceFigure, type EnhanceMode, type EnhanceOptions } from '@core/image/enhance'

const ctx = self as unknown as DedicatedWorkerGlobalScope
ctx.onmessage = (e: MessageEvent<{ id: number; data: Uint8ClampedArray; width: number; height: number; mode?: EnhanceMode; options?: EnhanceOptions }>) => {
  const { id, data, width, height, mode, options } = e.data
  try {
    const r = enhanceFigure({ data, width, height }, mode ?? 'normal', options ?? {})
    const out = r.data instanceof Uint8ClampedArray ? r.data : new Uint8ClampedArray(r.data)
    ctx.postMessage({ id, data: out, width: r.width, height: r.height }, [out.buffer])
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
