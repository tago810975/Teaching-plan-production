/**
 * 分页预览。
 *
 * 流程：先把全部段落排进一个看不见的“测量栏”（宽度与 Word 正文区一致），
 * 读出每段高度后用 paginate() 分页，再按页渲染。工程数据一变，
 * DocIR 随之重建，预览即时重排，实现所改即所见。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { DocIR } from '@core/document/ir'
import { paginate, previewBodyFrame } from '@core/document/paginate'
import { contentWidthTwip, twipToPt } from '@core/document/units'
import { DocParagraphView } from './DocParagraphView'

const PT_TO_PX = 96 / 72

interface Props {
  ir: DocIR
  assetUrls: ReadonlyMap<string, string>
  selectedBlockId: string | null
  onSelect: (blockId: string) => void
  onPageCount?: (count: number) => void
}

export function Preview({ ir, assetUrls, selectedBlockId, onSelect, onPageCount }: Props) {
  const measureRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ ir: DocIR; pages: number[][] } | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [zoom, setZoom] = useState(1)

  const { page } = ir
  const frame = previewBodyFrame(page)
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
      const top = els[i]?.offsetTop ?? 0
      const next = els[i + 1]?.offsetTop ?? bottom
      const spaceAfter = els[i] === undefined ? 0 : parseFloat(getComputedStyle(els[i]!).paddingBottom) || 0
      return { height: next - top, spaceAfter, keepNext: p.keepNext, pageBreakBefore: p.pageBreakBefore }
    })
    const bodyHeightPx = twipToPt(frame.heightTwip) * PT_TO_PX
    setLayout({ ir, pages: paginate(items, bodyHeightPx) })
  }, [ir, fontsReady, frame.heightTwip])

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

  // 在大纲中选中时，把对应内容滚动到可见位置
  useEffect(() => {
    if (selectedBlockId === null) return
    const target = scrollRef.current?.querySelector(`.page [data-block-id="${CSS.escape(selectedBlockId)}"]`)
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedBlockId])

  const bodyStyle: CSSProperties = {
    position: 'absolute',
    top: `${twipToPt(frame.topTwip)}pt`,
    left: `${twipToPt(page.marginLeftTwip)}pt`,
    width: `${twipToPt(contentWidthTwip(page))}pt`
  }

  // 首次测量完成前用旧的分页结果，避免下标越界
  const current = layout?.ir === ir ? layout.pages : (layout?.pages ?? [[]])

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
            <header
              className="page-header"
              style={{
                left: `${twipToPt(page.marginLeftTwip)}pt`,
                right: `${twipToPt(page.marginRightTwip)}pt`
              }}
            >
              <span>{ir.header.left}</span>
              <span>{ir.header.right}</span>
            </header>
            <div style={bodyStyle}>
              {indices.map((i) => {
                const p = ir.paragraphs[i]
                if (p === undefined) return null
                return (
                  <DocParagraphView
                    key={p.key}
                    paragraph={p}
                    assetUrls={assetUrls}
                    selected={p.sourceBlockId === selectedBlockId}
                    onSelect={onSelect}
                  />
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
