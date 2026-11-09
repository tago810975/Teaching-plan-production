/**
 * 属性面板中当前工程的格式预设（颜色、重点格式等），供表格编辑器等深层组件使用。
 */
import { createContext } from 'react'
import { getPreset, type FormatPreset } from '@core/presets'

export const PresetContext = createContext<FormatPreset>(getPreset(undefined))
