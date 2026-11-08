/**
 * 分页预览。
 *
 * 流程：先把全部段落排进一个看不见的“测量栏”（宽度与 Word 正文区一致），
 * 读出每段高度后用 paginate() 分页，再按页渲染。工程数据一变，
 * DocIR 随之重建，预览即时重排，实现所改即所见。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { DocIR, OptionImageRef } from '@core/document/ir'
import { paginate, type PageSlice } from '@core/document/paginate'
import { STYLE_SPECS } from '@core/document/styles'
import { contentWidthTwip, twipToPt } from '@core/document/units'
import { DocParagraphView, type MathRun, type OptionImageHandlers, type ParagraphFocus } from './DocParagraphView'
import type { FigureChangeHandler } from './FigureImage'
import { PageHeaderView, PageWatermark } from './PageHeaderView'

const PT_TO_PX = 96 / 72

interface Props {
  ir: DocIR
  assetUrls: ReadonlyMap<string, string>
  selectedBlockId: string | null
  onSelect: (blockId: string, focus?: ParagraphFocus) => void
  onSelectHeader: () => void
  headerSelected: boolean
  onPageCount?: (count: number) => void
  onEditMath?: (run: MathRun) => void
  onFigureChange?: FigureChangeHandler
  /** 选项图片缩放后调用：把 ref 处的图缩放到 widthEmu；group 为 true 时全部选项图片按同一比例缩放 */
  onOptionImageResize?: (ref: OptionImageRef, widthEmu: number, group: boolean) => void
  /** 在预览中拖动一张选项图片时，默认是否全部一起缩放 */
  linkOptionImages?: boolean
}

export function Preview({
  ir,
  assetUrls,
  selectedBlockId,
  onSelect,
  onSelectHeader,
  headerSelected,
  onPageCount,
  onEditMath,
  onFigureChange,
  onOptionImageResize,
  linkOptionImages = false
}: Props) {
  const measureRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ ir: DocIR; pages: PageSlice[][]; heights: number[] } | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [zoom, setZoom] = useState(1)

  // 选项图片“全部一起缩放”的拖动过程：哪道题、当前比例。松开后由工程数据接手
  const [groupDraft, setGroupDraft] = useState<{ blockId: string; scale: number } | null>(null)
  const optionHandlers = useMemo<OptionImageHandlers | undefined>(
    () =>
      onOptionImageResize === undefined
        ? undefined
        : {
            onResize: onOptionImageResize,
            onDraft: (ref, scale, group) => setGroupDraft(scale !== null && group ? { blockId: ref.blockId, scale } : null),
            groupByDefault: linkOptionImages
          },
    [onOptionImageResize, linkOptionImages]
  )
  const groupHandlers = useMemo(
    () => (optionHandlers !== undefined && groupDraft !== null ? { ...optionHandlers, groupScale: groupDraft.scale } : undefined),
    [optionHandlers, groupDraft]
  )

  const { page } = ir
  const bodyHeightTwip = page.heightTwip - ir.bodyTopTwip - page.marginBottomTwip
  const pageWidthPt = twipToPt(page.widthTwip)
  const pageHeightPt = twipToPt(page.heightTwip)

  useEffect(() => {
    void document.fonts.ready.then(() => setFontsReady(true))
  }, [])

  // 测量并分页（在浏览器绘制前完成，避免闪烁）
  useLayoutEffect(() => {
    const root = measureRef.current
    if (root === null) return
    const els = Array.from(root.children) as HTMLElement[]
    const bottom = root.scrollHeight
    const items = ir.paragraphs.map((p, i) => {
      const el = els[i]
      const top = el?.offsetTop ?? 0
      const next = els[i + 1]?.offsetTop ?? bottom
      const spaceAfter = el === undefined ? 0 : parseFloat(getComputedStyle(el).paddingBottom) || 0
      // 作答留白与带浮动图片的段落不拆分；其余未设“段中不分页”的段落可按行拆分
      const splittable = el !== undefined && p.keepLines !== true && p.spacerTwip === undefined && (p.floatingImages ?? []).length === 0
      return {
        height: next - top,
        spaceAfter,
        keepNext: p.keepNext,
        keepLines: p.keepLines,
        pageBreakBefore: p.pageBreakBefore,
        ...(splittable ? { lineBreaks: measureLineBreaks(el), minLines: STYLE_SPECS[p.style].widowControl === true ? 2 : 1 } : {})
      }
    })
    const bodyHeightPx = twipToPt(bodyHeightTwip) * PT_TO_PX
    setLayout({ ir, pages: paginate(items, bodyHeightPx), heights: items.map((it) => it.height) })
  }, [ir, fontsReady, bodyHeightTwip])

  const pageCount = layout?.pages.length ?? 1
  useEffect(() => onPageCount?.(pageCount), [pageCount, onPageCount])

  // 页面宽度随窗口自适应
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const observer = new ResizeObserver(([entry]) => {
      const available = (entry?.contentRect.width ?? 0) - 64
      const pagePx = pageWidthPt * PT_TO_PX
      setZoom(Math.min(1.5, Math.max(0.4, available / pagePx)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [pageWidthPt])

  // 在大纲中选中（或新添加）内容时，把它滚动到可见位置。
  // 新内容要等重新排版后才出现在页面上，所以选中变化时先记下，排版完成后再滚动。
  const pendingScrollRef = useRef<string | null>(null)
  /** 在预览中点击选中的内容：用户正看着它，不应把预览滚走 */
  const clickedInPreviewRef = useRef<string | null>(null)
  useEffect(() => {
    if (clickedInPreviewRef.current === selectedBlockId) {
      clickedInPreviewRef.current = null
      pendingScrollRef.current = null
      return
    }
    pendingScrollRef.current = selectedBlockId
  }, [selectedBlockId])
  const selectFromPreview = useCallback(
    (blockId: string, focus?: ParagraphFocus) => {
      if (blockId !== selectedBlockId) clickedInPreviewRef.current = blockId
      onSelect(blockId, focus)
    },
    [onSelect, selectedBlockId]
  )
  useEffect(() => {
    const id = pendingScrollRef.current
    if (id === null) return
    const target = scrollRef.current?.querySelector(`.page [data-block-id="${CSS.escape(id)}"]`)
    if (target !== null && target !== undefined) {
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      pendingScrollRef.current = null
    }
  }, [selectedBlockId, layout])

  const bodyStyle: CSSProperties = {
    position: 'absolute',
    top: `${twipToPt(ir.bodyTopTwip)}pt`,
    left: `${twipToPt(page.marginLeftTwip)}pt`,
    width: `${twipToPt(contentWidthTwip(page))}pt`
  }

  // 首次测量完成前用旧的分页结果，避免下标越界
  const current = layout?.ir === ir ? layout.pages : (layout?.pages ?? [[]])
  const heights = layout?.heights ?? []

  return (
    <div className="preview" ref={scrollRef}>
      <div className="preview-measure" aria-hidden="true">
        <div ref={measureRef} style={{ width: bodyStyle.width }}>
          {ir.paragraphs.map((p) => (
            <DocParagraphView key={p.key} paragraph={p} assetUrls={assetUrls} selected={false} />
          ))}
        </div>
      </div>

      <div className="preview-pages" style={{ zoom }}>
        {current.map((indices, pageIndex) => (
          <section
            key={pageIndex}
            className="page"
            aria-label={`第 ${pageIndex + 1} 页`}
            style={{ width: `${pageWidthPt}pt`, height: `${pageHeightPt}pt` }}
          >
            <PageWatermark header={ir.header} page={page} assetUrls={assetUrls} />
            <PageHeaderView
              header={ir.header}
              page={page}
              assetUrls={assetUrls}
              selected={headerSelected}
              onSelect={onSelectHeader}
            />
            <div style={bodyStyle}>
              {indices.map((slice) => {
                const p = ir.paragraphs[slice.index]
                if (p === undefined) return null
                const view = (
                  <DocParagraphView
                    key={p.key}
                    paragraph={p}
                    assetUrls={assetUrls}
                    selected={p.sourceBlockId === selectedBlockId}
                    onSelect={selectFromPreview}
                    {...(onEditMath !== undefined ? { onEditMath } : {})}
                    {...(onFigureChange !== undefined ? { onFigureChange } : {})}
                    {...(p.style === 'option' && optionHandlers !== undefined
                      ? { optionImages: groupHandlers !== undefined && groupDraft?.blockId === p.sourceBlockId ? groupHandlers : optionHandlers }
                      : {})}
                  />
                )
                if (slice.from === 0 && slice.to === undefined) return view
                // 跨页的段落：本页只显示 from 到 to 这一段
                const end = slice.to ?? heights[slice.index] ?? 0
                return (
                  <div key={`${p.key}@${slice.from}`} className="para-slice" style={{ height: `${end - slice.from}px` }}>
                    <div style={{ marginTop: `${-slice.from}px` }}>{view}</div>
                  </div>
                )
              })}
            </div>
            <footer className="page-footer">
              第 {pageIndex + 1} 页 共 {current.length} 页
            </footer>
          </section>
        ))}
      </div>
    </div>
  )
}

/**
 * 段落中相邻两行之间的分界线（相对段落顶端，像素）。
 * 用 Range.getClientRects 取得各行文字、公式、图片的位置，按纵向重叠归并为行。
 */
function measureLineBreaks(el: HTMLElement): number[] {
  const range = document.createRange()
  range.selectNodeContents(el)
  const top = el.getBoundingClientRect().top
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.height > 1 && r.width > 0)
    .sort((a, b) => a.top - b.top)
  const lines: Array<{ top: number; bottom: number }> = []
  for (const r of rects) {
    const last = lines[lines.length - 1]
    if (last === undefined || r.top >= last.bottom - 1) lines.push({ top: r.top, bottom: r.bottom })
    else last.bottom = Math.max(last.bottom, r.bottom)
  }
  const breaks: number[] = []
  for (let i = 0; i + 1 < lines.length; i++) {
    breaks.push((lines[i]!.bottom + lines[i + 1]!.top) / 2 - top)
  }
  return breaks
}
