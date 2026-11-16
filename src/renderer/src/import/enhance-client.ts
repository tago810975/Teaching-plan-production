/**
 * 插图变清晰（界面端）：在后台线程中处理（enhance.worker.ts），以及图片与像素、PNG 之间的转换。
 */
export interface Rgba {
  data: Uint8ClampedArray
  width: number
  height: number
}

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { resolve: (p: Rgba) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker !== null) return worker
  worker = new Worker(new URL('./enhance.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; error?: string } & Partial<Rgba>>) => {
    const w = waiting.get(e.data.id)
    if (w === undefined) return
    waiting.delete(e.data.id)
    if (e.data.error !== undefined) w.reject(new Error(e.data.error))
    else w.resolve({ data: e.data.data!, width: e.data.width!, height: e.data.height! })
  }
  return worker
}

/** 变清晰：清理底色，较小的图放大 3 倍 */
export function enhance(px: Rgba): Promise<Rgba> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    const copy = new Uint8ClampedArray(px.data)
    getWorker().postMessage({ id, data: copy, width: px.width, height: px.height }, [copy.buffer])
  })
}

/** 读取图片（url）中一个矩形区域的像素；不给矩形时为整张 */
export async function readPixels(url: string, rect?: { x: number; y: number; w: number; h: number }): Promise<Rgba> {
  const img = new Image()
  img.src = url
  await img.decode()
  const r = rect ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
  const w = Math.max(1, Math.round(r.w))
  const h = Math.max(1, Math.round(r.h))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
}

/** 像素 → PNG 数据 */
export async function toPng(px: Rgba): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = px.width
  canvas.height = px.height
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b !== null ? resolve(b) : reject(new Error('无法生成图片'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

/** 像素 → 可显示的地址（预览用） */
export async function toObjectUrl(px: Rgba): Promise<string> {
  const png = await toPng(px)
  return URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
}
