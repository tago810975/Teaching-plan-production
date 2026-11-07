import { useEffect, useMemo } from 'react'
import type { Asset } from '@core/model/types'

/** 为图片资源创建 blob URL，资源变化时自动回收旧的 URL */
export function useAssetUrls(assets: Record<string, Asset>): ReadonlyMap<string, string> {
  const urls = useMemo(() => {
    const map = new Map<string, string>()
    for (const asset of Object.values(assets)) {
      const blob = new Blob([asset.data as Uint8Array<ArrayBuffer>], { type: asset.mime })
      map.set(asset.id, URL.createObjectURL(blob))
    }
    return map
  }, [assets])

  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls])
  return urls
}
