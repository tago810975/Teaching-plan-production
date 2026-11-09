/**
 * 预览中拖动表格列边框后的回调（由 Preview 提供；没有时不显示拖动手柄）。
 */
import { createContext } from 'react'
import type { InlineRef } from '@core/document/ir'

export const TableResizeContext = createContext<((ref: InlineRef, widthsTwip: number[]) => void) | null>(null)
