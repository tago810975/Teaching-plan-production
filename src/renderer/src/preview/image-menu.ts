/**
 * 预览中右键图片：弹出图片的快捷窗口（由 Preview 提供；没有时用系统菜单）。
 */
import { createContext } from 'react'
import type { FigureRef, OptionImageRef } from '@core/document/ir'

export type ImageTarget = { kind: 'figure'; ref: FigureRef } | { kind: 'option'; ref: OptionImageRef }

export const ImageMenuContext = createContext<((target: ImageTarget, x: number, y: number) => void) | null>(null)
