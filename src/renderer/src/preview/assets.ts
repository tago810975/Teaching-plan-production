import { useEffect, useRef, useState } from 'react'
import type { Asset } from '@core/model/types'

/**
 * 为图片资源创建 blob URL。
 *
 * 资源 ID 是内容的哈希，同一 ID 的内容永远相同，所以按 ID 缓存 URL，
 * 只为新增资源创建、为移除的资源回收。URL 的创建和回收都放在 effect 中成对进行，
 * 开发模式下 React 有意重复执行 effect（挂载→卸载→再挂载）时也不会留下失效的 URL。
 */
export function useAssetUrls(assets: Record<string, Asset>): ReadonlyMap<string, string> {
  const cacheRef = useRef(new Map<string, string>())
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map())

  useEffect(() => {
    const cache = cacheRef.current
    for (const [id, url] of cache) {
      if (assets[id] === undefined) {
        URL.revokeObjectURL(url)
        cache.delete(id)
      }
    }
    for (const asset of Object.values(assets)) {
      if (!cache.has(asset.id)) {
        const blob = new Blob([asset.data as Uint8Array<ArrayBuffer>], { type: asset.mime })
        cache.set(asset.id, URL.createObjectURL(blob))
      }
    }
    setUrls(new Map(cache))
  }, [assets])

  // 卸载时全部回收
  useEffect(() => {
    const cache = cacheRef.current
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url))
      cache.clear()
    }
  }, [])

  return urls
}
