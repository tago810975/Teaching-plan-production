/**
 * Word 不支持的图片格式（SVG、WebP）在导出前转成 PNG。
 * 按显示尺寸的 3 倍分辨率绘制（约 300 DPI），打印清晰。
 */
import type { Asset, ProjectBundle } from '@core/model/types'

const NEEDS_RASTER = new Set(['image/svg+xml', 'image/webp'])
const SCALE = 3

export async function rasterizeForWord(bundle: ProjectBundle): Promise<Record<string, Asset>> {
  const sizes = displaySizes(bundle)
  const out: Record<string, Asset> = {}
  for (const asset of Object.values(bundle.assets)) {
    if (!NEEDS_RASTER.has(asset.mime)) continue
    const size = sizes.get(asset.id)
    if (size === undefined) continue // 未被引用
    out[asset.id] = { id: asset.id, mime: 'image/png', data: await toPng(asset, size) }
  }
  return out
}

/** 资源在工程中的最大显示宽度（像素，96 DPI） */
function displaySizes(bundle: ProjectBundle): Map<string, number> {
  const sizes = new Map<string, number>()
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit)
    else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.assetId === 'string' && typeof o.widthEmu === 'number') {
        sizes.set(o.assetId, Math.max(sizes.get(o.assetId) ?? 0, o.widthEmu / 9525))
      }
      Object.values(o).forEach(visit)
    }
  }
  visit(bundle.project)
  return sizes
}

async function toPng(asset: Asset, widthPx: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([asset.data as Uint8Array<ArrayBuffer>], { type: asset.mime }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const ratio = img.naturalHeight > 0 && img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1
    const w = Math.max(1, Math.round(widthPx * SCALE))
    const h = Math.max(1, Math.round(w * ratio))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('无法创建画布')
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}
