/**
 * 预览中的选区工具条（参照 WPS）：选中文字后在选区上方出现，可加粗、倾斜、下划线、设为重点、改颜色。
 * 选区按预览元素上的来源标记（data-src-*）换算成工程数据中的范围；跨几段时每段一个范围，合为一步撤销。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import type { FormatOp } from '@core/model/markup'
import type { FormatPreset } from '@core/presets'
import type { TextRange } from '../state/store'
import { AlignIcon } from '../panels/FormatToolbar'

interface Props {
  container: RefObject<HTMLElement | null>
  onApply: (ranges: TextRange[], op: FormatOp) => void
  /** 段落对齐：选区涉及的各段 */
  onAlign?: (ranges: TextRange[], align: 'left' | 'center' | 'right') => void
  colors: FormatPreset['textColors']
  keyPoint: FormatPreset['keyPoint'] | undefined
}

export function SelectionToolbar({ container, onApply, onAlign, colors, keyPoint }: Props) {
  const [state, setState] = useState<{ rect: DOMRect; ranges: TextRange[] } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let raf = 0
    const update = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = container.current
        setState(el === null ? null : selectionRanges(el))
      })
    }
    document.addEventListener('selectionchange', update)
    const scroller = container.current
    scroller?.addEventListener('scroll', update, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('selectionchange', update)
      scroller?.removeEventListener('scroll', update)
    }
  }, [container])

  // 放在选区上方居中；上方放不下时放到下方
  useLayoutEffect(() => {
    const bar = barRef.current
    if (state === null || bar === null) {
      setPos(null)
      return
    }
    const w = bar.offsetWidth
    const h = bar.offsetHeight
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, state.rect.left + state.rect.width / 2 - w / 2))
    const top = state.rect.top - h - 8 >= 8 ? state.rect.top - h - 8 : state.rect.bottom + 8
    setPos({ left, top })
  }, [state])

  if (state === null) return null
  const apply = (op: FormatOp): void => {
    onApply(state.ranges, op)
    window.getSelection()?.removeAllRanges()
    setState(null)
  }
  const btn = (label: string, title: string, op: FormatOp, className = ''): ReactElement => (
    <button type="button" className={`sel-btn ${className}`} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(op)}>
      {label}
    </button>
  )
  return (
    <div
      ref={barRef}
      className="selection-toolbar"
      role="toolbar"
      aria-label="选中文字的格式"
      style={pos === null ? { visibility: 'hidden', left: 0, top: 0 } : { left: pos.left, top: pos.top }}
    >
      {btn('B', '加粗', { mark: 'bold' }, 'sel-btn--bold')}
      {btn('I', '倾斜（只作用于文字）', { mark: 'italic' }, 'sel-btn--italic')}
      {btn('U', '下划线', { mark: 'underline' }, 'sel-btn--underline')}
      {keyPoint !== undefined && btn(keyPoint.label, `${keyPoint.label}：${keyPoint.description}；再点一次取消`, { combo: keyPoint.marks }, 'sel-btn--key')}
      <span className="sel-divider" aria-hidden="true" />
      {colors.map((c) =>
        btn(c.label, c.color !== undefined ? `文字颜色：${c.label}色` : '恢复黑色', { color: c.color }, c.color !== undefined ? '' : 'sel-btn--black')
      )}
      {onAlign !== undefined && (
        <>
          <span className="sel-divider" aria-hidden="true" />
          {(
            [
              ['left', '左对齐（恢复默认）'],
              ['center', '居中'],
              ['right', '右对齐']
            ] as const
          ).map(([align, title]) => (
            <button
              key={align}
              type="button"
              className="sel-btn sel-btn--align"
              title={`${title}：选中文字所在的段`}
              aria-label={title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onAlign(state.ranges, align)
                window.getSelection()?.removeAllRanges()
                setState(null)
              }}
            >
              <AlignIcon align={align} />
            </button>
          ))}
        </>
      )}
    </div>
  )
}

/** 当前选区 → 各段落中的范围；选区不在预览页面中、或没有可改的文字时为 null */
export function selectionRanges(container: HTMLElement): { rect: DOMRect; ranges: TextRange[] } | null {
  const sel = window.getSelection()
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const els = [...container.querySelectorAll<HTMLElement>('.page [data-src-inline]')].filter((el) => range.intersectsNode(el))
  if (els.length === 0) return null
  // 按段落分组（保持文档顺序）
  const groups = new Map<string, HTMLElement[]>()
  for (const el of els) {
    const key = `${el.dataset.srcBlock}|${el.dataset.srcPath}`
    groups.set(key, [...(groups.get(key) ?? []), el])
  }
  const ranges: TextRange[] = []
  for (const list of groups.values()) {
    const first = list[0]!
    const last = list[list.length - 1]!
    const isMath = (el: HTMLElement): boolean => el.dataset.srcMath === '1'
    const startOffset = isMath(first) || !first.contains(range.startContainer) ? 0 : textOffset(first, range.startContainer, range.startOffset)
    const endOffset = isMath(last) ? 1 : last.contains(range.endContainer) ? textOffset(last, range.endContainer, range.endOffset) : (last.textContent ?? '').length
    ranges.push({
      blockId: first.dataset.srcBlock!,
      path: JSON.parse(first.dataset.srcPath!) as Array<string | number>,
      start: { inline: Number(first.dataset.srcInline), offset: startOffset },
      end: { inline: Number(last.dataset.srcInline), offset: endOffset }
    })
  }
  return { rect: range.getBoundingClientRect(), ranges }
}

/** 选区边界（node, offset）在元素文字中的位置 */
function textOffset(el: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange()
  r.setStart(el, 0)
  r.setEnd(node, offset)
  return r.toString().length
}
