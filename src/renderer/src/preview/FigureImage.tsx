/**
 * 预览中属于题图、插图的图片：所在内容被选中时可以直接操作。
 *
 * - 右下角缩放手柄：按住拖动，等比例调整大小；
 * - 自由位置的图片：按住图片拖动，摆放到任意位置。
 * 拖动过程中只在本地显示效果，松开后才写回工程数据，避免每一像素都触发重新排版。
 */
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { FigureRef } from '@core/document/ir'
import { emuToPt } from '@core/document/units'

export interface FigurePatch {
  widthEmu?: number
  heightEmu?: number
  offsetXEmu?: number
  offsetYEmu?: number
}

export type FigureChangeHandler = (ref: FigureRef, patch: FigurePatch) => void

interface Props {
  src: string | undefined
  widthEmu: number
  heightEmu: number
  figureRef: FigureRef | undefined
  /** 所在内容是否被选中；选中时才显示手柄 */
  active: boolean
  onChange: FigureChangeHandler | undefined
  /** 自由位置：相对所在段落的偏移 */
  free?: { offsetXEmu: number; offsetYEmu: number }
  className: string
  style?: CSSProperties
}

/** 屏幕像素 → EMU：先除以预览缩放，再按 96 DPI 换算 */
const PX_TO_EMU = 9525
/** 最小尺寸：0.5 厘米 */
const MIN_EMU = 180000

function previewZoom(el: Element): number {
  const pages = el.closest('.preview-pages') as HTMLElement | null
  const z = pages === null ? 1 : parseFloat(pages.style.zoom)
  return Number.isFinite(z) && z > 0 ? z : 1
}

export function FigureImage(props: Props) {
  const { src, widthEmu, heightEmu, figureRef, active, onChange, free, className, style } = props
  const [draft, setDraft] = useState<FigurePatch | null>(null)
  const start = useRef<{ x: number; y: number; zoom: number; mode: 'move' | 'resize' } | null>(null)
  const interactive = active && figureRef !== undefined && onChange !== undefined

  const w = draft?.widthEmu ?? widthEmu
  const h = draft?.heightEmu ?? heightEmu
  const ox = draft?.offsetXEmu ?? free?.offsetXEmu ?? 0
  const oy = draft?.offsetYEmu ?? free?.offsetYEmu ?? 0

  const begin = (e: PointerEvent<HTMLElement>, mode: 'move' | 'resize'): void => {
    if (!interactive || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, y: e.clientY, zoom: previewZoom(e.currentTarget), mode }
  }

  const move = (e: PointerEvent<HTMLElement>): void => {
    const s = start.current
    if (s === null) return
    const dx = ((e.clientX - s.x) / s.zoom) * PX_TO_EMU
    const dy = ((e.clientY - s.y) / s.zoom) * PX_TO_EMU
    if (s.mode === 'resize') {
      // 等比例：以拖动距离较大的方向为准
      const scale = Math.max((widthEmu + dx) / widthEmu, (heightEmu + dy) / heightEmu)
      const nw = Math.max(MIN_EMU, Math.round(widthEmu * scale))
      setDraft({ widthEmu: nw, heightEmu: Math.round((heightEmu * nw) / widthEmu) })
    } else {
      setDraft({ offsetXEmu: Math.round((free?.offsetXEmu ?? 0) + dx), offsetYEmu: Math.round((free?.offsetYEmu ?? 0) + dy) })
    }
  }

  const end = (e: PointerEvent<HTMLElement>): void => {
    if (start.current === null) return
    start.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (draft !== null && figureRef !== undefined) onChange?.(figureRef, draft)
    setDraft(null)
  }

  const boxStyle: CSSProperties = {
    ...style,
    width: `${emuToPt(w)}pt`,
    height: `${emuToPt(h)}pt`,
    ...(free !== undefined ? { left: `${emuToPt(ox)}pt`, top: `${emuToPt(oy)}pt` } : {})
  }

  return (
    <span
      className={[className, 'figure', interactive ? 'figure--active' : '', free !== undefined ? 'figure--free' : ''].filter(Boolean).join(' ')}
      style={boxStyle}
      onPointerDown={free !== undefined ? (e) => begin(e, 'move') : undefined}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      title={interactive ? (free !== undefined ? '拖动摆放；拖动右下角调整大小' : '拖动右下角调整大小') : undefined}
    >
      <img src={src} alt="" draggable={false} />
      {interactive && (
        <span
          className="figure-handle"
          role="slider"
          aria-label="调整图片大小"
          aria-valuenow={Math.round(w / 3600) / 100}
          onPointerDown={(e) => begin(e, 'resize')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      )}
    </span>
  )
}
