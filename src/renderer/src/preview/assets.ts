import { useMemo } from 'react'
import type { Asset } from '@core/model/types'

/**
 * 为图片资源创建 blob URL。
 *
 * 资源 ID 是内容的哈希，同一 ID 的内容永远相同，所以全程按 ID 共享一份 URL：所有标签页、反复切换标签页、
 * 编辑器重新挂载时都直接复用，浏览器也不必重新解码图片。URL 在第一次渲染时就同步备好——此前在 effect 中
 * 异步创建，切换标签页时预览先在“没有图片”的状态下排版、测量分页一遍，拿到 URL 后再全部重排一遍。
 * URL 在本次运行期间不回收（内容与工程中的图片数据相同，数量有限）。
 */
const urls = new Map<string, string>()
const mimes = new Map<string, string>()

/** 资源的格式（如 image/svg+xml）；页面的安全策略不允许 fetch blob 地址，所以在生成地址时记下 */
export function assetMime(id: string): string | undefined {
  return mimes.get(id)
}

function urlOf(asset: Asset): string {
  mimes.set(asset.id, asset.mime)
  let url = urls.get(asset.id)
  if (url === undefined) {
    url = URL.createObjectURL(new Blob([asset.data as Uint8Array<ArrayBuffer>], { type: asset.mime }))
    urls.set(asset.id, url)
  }
  return url
}

export function useAssetUrls(assets: Record<string, Asset>): ReadonlyMap<string, string> {
  return useMemo(() => new Map(Object.values(assets).map((a) => [a.id, urlOf(a)] as const)), [assets])
}
