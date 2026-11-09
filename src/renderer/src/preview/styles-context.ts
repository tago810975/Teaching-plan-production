/**
 * 预览使用的段落样式表：来自 DocIR（标题格式由格式预设决定），默认为 STYLE_SPECS。
 */
import { createContext } from 'react'
import { STYLE_SPECS, type ParagraphStyleSpec, type StyleKey } from '@core/document/styles'

export const StylesContext = createContext<Readonly<Record<StyleKey, ParagraphStyleSpec>>>(STYLE_SPECS)
