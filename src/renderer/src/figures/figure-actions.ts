/**
 * 插图的变清晰与 WorkBuddy 重绘：属性栏、右键快捷栏、“批量处理插图”窗口共用。
 */
import { createContext } from 'react'
import type { FigureRef } from '@core/document/ir'
import { detectFigures } from '@core/import/figure-detect'
import type { EnhanceMode } from '@core/image/enhance'
import { redrawSizes } from '@core/import/svg-redraw'
import type { Asset } from '@core/model/types'
import { createAsset } from '@core/project-file/codec'
import { enhance, toPng, type Rgba } from '../import/enhance-client'

export interface FigureActions {
  /**
   * 变清晰（一步撤销；矢量图跳过）；mode 为 'none' 时不处理；
   * transparent：去白底（白色变透明）。返回处理与跳过的张数
   */
  sharpen: (refs: FigureRef[], mode?: EnhanceMode, transparent?: boolean) => Promise<{ done: number; skipped: number }>
  /** 打开“批量处理插图”；给出 refs 时只勾选这些，redraw 为真时立即交给 WorkBuddy 重绘 */
  openBatch: (options?: { refs?: FigureRef[]; redraw?: boolean }) => void
}

export const FigureActionsContext = createContext<FigureActions | null>(null)

export const isVector = (asset: Asset | undefined): boolean => asset !== undefined && asset.mime.includes('svg')

/** 图片资源 → 像素 */
export async function pixelsOfAsset(asset: Asset, maxSide = Infinity): Promise<Rgba> {
  const bitmap = await createImageBitmap(new Blob([asset.data as Uint8Array<ArrayBuffer>], { type: asset.mime }))
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * k))
  const h = Math.max(1, Math.round(bitmap.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
}

/** 变清晰后的新图片资源；矢量图返回 null */
export async function sharpenAsset(asset: Asset, mode: EnhanceMode = 'normal', transparent = false): Promise<Asset | null> {
  if (isVector(asset)) return null
  const px = await enhance(await pixelsOfAsset(asset), mode, transparent)
  return createAsset(await toPng(px), 'image/png')
}

/** 字节 → base64 */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** 交给 WorkBuddy 重绘的一张图：PNG（长边不超过 2000）、尺寸与按原图换算的字号线宽 */
export async function figureForRedraw(asset: Asset, n: number): Promise<{ n: number; mime: string; data: string; width: number; height: number; fontSize: number; stroke: number; thin: number }> {
  const px = await pixelsOfAsset(asset, 2000)
  const { textHeight } = detectFigures(px)
  return { n, mime: 'image/png', data: toBase64(await toPng(px)), width: px.width, height: px.height, ...redrawSizes(px.width, textHeight) }
}

/** SVG 的宽高比（按 width / height 或 viewBox） */
export function svgAspect(svg: string): number | undefined {
  const w = parseFloat(/\swidth="([\d.]+)"/.exec(svg)?.[1] ?? '')
  const h = parseFloat(/\sheight="([\d.]+)"/.exec(svg)?.[1] ?? '')
  return w > 0 && h > 0 ? w / h : undefined
}
