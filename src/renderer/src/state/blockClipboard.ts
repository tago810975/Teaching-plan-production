/**
 * 应用内共享的内容块剪贴板（跨标签页 / 跨不同学案通用）：
 * 复制或剪切题目、综合题、知识点、标题、正文等任意内容块时连同引用的图片资源一起保存，粘贴时生成全新 ID。
 */
import { useSyncExternalStore } from 'react'
import { cloneBlocksWithNewIds, extractBlockAssets } from '@core/model/block-clipboard'
import type { Asset, Block } from '@core/model/types'

export interface CutSource {
  editorKey: string
  blockIds: string[]
  /** 跨教学案粘贴时触发，用来移除源教学案中被剪切的块 */
  commit: () => void
}

export interface BlockClipboard {
  blocks: Block[]
  assets: Record<string, Asset>
  mode: 'copy' | 'cut'
  cutSource?: CutSource
}

let clipboard: BlockClipboard | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function setBlockClipboard(
  blocks: readonly Block[],
  allAssets: Readonly<Record<string, Asset>>,
  mode: 'copy' | 'cut',
  cutSource?: CutSource
): void {
  if (blocks.length === 0) return
  const cloned = cloneBlocksWithNewIds(blocks)
  const assets = extractBlockAssets(cloned, allAssets)
  clipboard = { blocks: cloned, assets, mode, ...(mode === 'cut' && cutSource !== undefined ? { cutSource } : {}) }
  emit()
}

export function getBlockClipboard(): BlockClipboard | null {
  return clipboard
}

export function clearBlockClipboard(): void {
  if (clipboard === null) return
  clipboard = null
  emit()
}

/** 取出供本次粘贴的新副本（每次粘贴都重新生成 ID，可连续多次粘贴） */
export function takeBlocksForPaste(): { blocks: Block[]; assets: Record<string, Asset> } | null {
  if (clipboard === null) return null
  return {
    blocks: cloneBlocksWithNewIds(clipboard.blocks),
    assets: clipboard.assets
  }
}

export function useBlockClipboard(): BlockClipboard | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => clipboard
  )
}
