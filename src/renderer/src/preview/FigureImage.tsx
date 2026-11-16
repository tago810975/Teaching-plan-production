/**
 * 预览中属于题图、插图的图片：所在内容被选中时可以直接操作。
 *
 * - 右下角缩放手柄：按住拖动，等比例调整大小；
 * - 自由位置的图片：按住图片拖动，摆放到任意位置。
 * 拖动过程中只在本地显示效果，松开后才写回工程数据，避免每一像素都触发重新排版。
 *
 * 选择题的选项图片也用这个组件（只有缩放，没有拖动摆放）：此时不提供 figureRef，
 * 改用 onResizeEnd / onResizeDraft；“全部一起缩放”时，拖动过程中其他选项图片按 groupScale 同步显示。
 */
import { useContext, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { FigureRef, OptionImageRef, FloatingImage } from '@core/document/ir'
import { emuToPt } from '@core/document/units'
import { FLOAT_GAP_EMU } from '@core/document/styles'
import { FigureClickContext, ImageMenuContext, type ImageTarget } from './image-menu'

export interface FigurePatch {
  widthEmu?: number
  heightEmu?: number
  offsetXEmu?: number
  offsetYEmu?: number
  anchorParagraph?: number
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
  /** 浮动图（右侧图、自由位置）：可拖动摆放，文字绕开 */
  float?: FloatingImage
  className: string
  style?: CSSProperties
  /** 不写回题图，而是把缩放结果交给调用方（选项图片）。group：是否全部一起缩放 */
  onResizeEnd?: (size: { widthEmu: number; heightEmu: number }, group: boolean) => void
  /** 拖动缩放过程中的比例（松开或取消时为 null），供其他图片同步显示 */
  onResizeDraft?: (scale: number | null, group: boolean) => void
  /** 默认是否全部一起缩放；按住 Shift 拖动时临时反过来 */
  groupByDefault?: boolean
  /** 别的图片正在“全部一起缩放”时，本图按此比例显示 */
  groupScale?: number
  /** 选项中的图片：右键时弹出选项图片的快捷窗口 */
  optionRef?: OptionImageRef
}

/** 屏幕像素 → EMU：先除以预览缩放，再按 96 DPI 换算 */
const PX_TO_EMU = 9525
/** 最小尺寸：0.5 厘米 */
const MIN_EMU = 180000

export function previewZoom(el: Element): number {
  // 预览缩放写在 data-zoom 上（页面用 transform 缩放，鼠标移动的距离要除以它换算回页面上的距离）
  const pages = el.closest('.preview-pages') as HTMLElement | null
  const z = pages === null ? 1 : parseFloat(pages.dataset['zoom'] ?? '1')
  return Number.isFinite(z) && z > 0 ? z : 1
}

export function FigureImage(props: Props) {
  const { src, widthEmu, heightEmu, figureRef, active, onChange, float, className, style, onResizeEnd, onResizeDraft, groupByDefault = false, groupScale, optionRef } = props
  const openMenu = useContext(ImageMenuContext)
  const onFigureClick = useContext(FigureClickContext)
  // 左键点一下（不是拖动、缩放）：属性栏定位到这张图的设置
  const downAt = useRef<{ x: number; y: number } | null>(null)
  const target: ImageTarget | null = figureRef !== undefined ? { kind: 'figure', ref: figureRef } : optionRef !== undefined ? { kind: 'option', ref: optionRef } : null
  const [draft, setDraft] = useState<{ widthEmu?: number; heightEmu?: number; dx?: number; dy?: number } | null>(null)
  const start = useRef<{ x: number; y: number; zoom: number; mode: 'move' | 'resize'; group: boolean } | null>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const interactive = active && ((figureRef !== undefined && onChange !== undefined) || onResizeEnd !== undefined)

  const w = draft?.widthEmu ?? (groupScale !== undefined ? Math.round(widthEmu * groupScale) : widthEmu)
  const h = draft?.heightEmu ?? (groupScale !== undefined ? Math.round(heightEmu * groupScale) : heightEmu)

  const begin = (e: PointerEvent<HTMLElement>, mode: 'move' | 'resize'): void => {
    if (!interactive || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, y: e.clientY, zoom: previewZoom(e.currentTarget), mode, group: groupByDefault !== e.shiftKey }
  }

  const move = (e: PointerEvent<HTMLElement>): void => {
    const s = start.current
    if (s === null) return
    const dxPx = (e.clientX - s.x) / s.zoom
    const dyPx = (e.clientY - s.y) / s.zoom
    if (s.mode === 'resize') {
      const dx = dxPx * PX_TO_EMU
      const dy = dyPx * PX_TO_EMU
      // 等比例：以拖动距离较大的方向为准
      const scale = Math.max((widthEmu + dx) / widthEmu, (heightEmu + dy) / heightEmu)
      const nw = Math.max(MIN_EMU, Math.round(widthEmu * scale))
      setDraft({ widthEmu: nw, heightEmu: Math.round((heightEmu * nw) / widthEmu) })
      onResizeDraft?.(nw / widthEmu, s.group)
    } else {
      // 拖动中只做视觉位移，松开后再重新排版
      setDraft({ dx: float?.movable === 'free' ? dxPx : 0, dy: dyPx })
    }
  }

  const end = (e: PointerEvent<HTMLElement>): void => {
    const s = start.current
    if (s === null) return
    start.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (s.mode === 'resize') onResizeDraft?.(null, s.group)
    if (draft !== null && s.mode === 'resize' && onResizeEnd !== undefined) {
      onResizeEnd({ widthEmu: draft.widthEmu!, heightEmu: draft.heightEmu! }, s.group)
    } else if (draft !== null && figureRef !== undefined) {
      if (s.mode === 'resize') onChange?.(figureRef, { widthEmu: draft.widthEmu!, heightEmu: draft.heightEmu! })
      else if (boxRef.current !== null && float !== undefined) onChange?.(figureRef, placeAfterDrag(boxRef.current, figureRef, float, s.zoom))
    }
    setDraft(null)
  }

  const boxStyle: CSSProperties = {
    ...style,
    width: `${emuToPt(w)}pt`,
    height: `${emuToPt(h)}pt`,
    ...(float !== undefined
      ? {
          float: float.side,
          clear: float.side,
          [float.side === 'right' ? 'marginRight' : 'marginLeft']: `${emuToPt(float.edgeEmu)}pt`,
          // 与导出的 distL / distR 一致
          [float.side === 'right' ? 'marginLeft' : 'marginRight']: `${emuToPt(FLOAT_GAP_EMU)}pt`
        }
      : {}),
    ...(draft?.dx !== undefined || draft?.dy !== undefined ? { transform: `translate(${draft.dx ?? 0}px, ${draft.dy ?? 0}px)` } : {})
  }

  const image = (
    <span
      ref={boxRef}
      className={[className, 'figure', interactive ? 'figure--active' : '', float !== undefined ? 'figure--movable' : ''].filter(Boolean).join(' ')}
      style={boxStyle}
      onPointerDownCapture={(e) => {
        downAt.current = { x: e.clientX, y: e.clientY }
      }}
      onClick={
        figureRef === undefined || onFigureClick === null
          ? undefined
          : (e) => {
              // 不再冒泡到所在段落（否则会定位到题干等输入框）
              e.stopPropagation()
              const d = downAt.current
              if (d !== null && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return
              onFigureClick(figureRef)
            }
      }
      onPointerDown={float !== undefined ? (e) => begin(e, 'move') : undefined}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onContextMenu={
        openMenu === null || target === null
          ? undefined
          : (e) => {
              // 只弹出图片的快捷窗口，不再冒泡到所在段落（否则会弹出题目的快捷窗口）
              e.preventDefault()
              e.stopPropagation()
              openMenu(target, e.clientX, e.clientY)
            }
      }
      title={interactive ? (onResizeEnd !== undefined ? (groupByDefault ? '拖动右下角，全部选项图片一起缩放；按住 Shift 只缩放这一张' : '拖动右下角调整这一张的大小；按住 Shift 全部选项图片一起缩放') : float !== undefined ? (float.movable === 'free' ? '拖动摆放；拖动右下角调整大小' : '上下拖动调整位置；拖动右下角调整大小') : '拖动右下角调整大小') : undefined}
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

  if (float === undefined) return image
  // 浮动图之前放一个宽度为 0、高度等于上下偏移的浮动占位条：图片停在任意高度，
  // 文字只在图片实际占据的几行绕开
  return (
    <>
      <span className="float-strut" style={{ float: float.side, height: `${emuToPt(float.offsetYEmu)}pt` }} aria-hidden="true" />
      {image}
    </>
  )
}

/**
 * 松开鼠标后，根据图片的实际位置计算新的锚定段落与偏移：
 * 拖过所在段落的边界时，改为锚定在图片顶端所在的那一段（同一内容中可锚定的段落）。
 */
function placeAfterDrag(box: HTMLElement, ref: FigureRef, float: FloatingImage, zoom: number): FigurePatch {
  const rect = box.getBoundingClientRect()
  const host = box.closest('.para') as HTMLElement | null
  const toEmu = (px: number): number => Math.round((px / zoom) * PX_TO_EMU)
  const canReanchor = host?.dataset.anchorIndex !== undefined
  let anchor: HTMLElement | null = host
  if (canReanchor) {
    const candidates = Array.from(
      // 只在同一组段落中换锚定：题图在题干中，答案插图在答案中，解析插图在解析中
      document.querySelectorAll<HTMLElement>(
        `.page [data-block-id="${CSS.escape(ref.blockId)}"][data-anchor-index]` + (ref.list !== undefined ? `[data-anchor-group="${ref.list}"]` : ':not([data-anchor-group])')
      )
    )
    for (const c of candidates) {
      if (c.getBoundingClientRect().top <= rect.top + 1) anchor = c
    }
    anchor ??= candidates[0] ?? host
  }
  if (anchor === null) return {}
  const a = anchor.getBoundingClientRect()
  const patch: FigurePatch = { offsetYEmu: Math.max(0, toEmu(rect.top - a.top)) }
  if (canReanchor) patch.anchorParagraph = Number(anchor.dataset.anchorIndex)
  if (float.movable === 'free') patch.offsetXEmu = Math.max(0, toEmu(rect.left - a.left))
  return patch
}
