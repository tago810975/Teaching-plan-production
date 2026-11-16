/**
 * 大纲：按顺序列出全部内容块，用于定位、选择和调整顺序。
 */
import { useRef, type Dispatch, type MouseEvent as ReactMouseEvent } from 'react'
import { useOutlineDrag } from './useOutlineDrag'
import { plainText } from '@core/model/factory'
import type { Block } from '@core/model/types'
import { difficultyOf, type FormatPreset } from '@core/presets'
import { HEADER_SELECTION, LAYOUT_SELECTION, type EditorAction } from '../state/store'
import { CollageText } from '../theme/CollageText'

interface Props {
  blocks: Block[]
  /** 题目块 ID → 题号，取自 DocIR，保证与预览一致 */
  questionNumbers: ReadonlyMap<string, string>
  selectedBlockId: string | null
  dispatch: Dispatch<EditorAction>
  /** 格式预设：等级与星级的对应 */
  preset: FormatPreset
  /** 右键内容：弹出快捷版式窗口 */
  onBlockMenu?: (blockId: string, x: number, y: number) => void
  /** 打开“批量处理插图” */
  onOpenFigureBatch?: () => void
}

export function Outline({ blocks, questionNumbers, selectedBlockId, dispatch, preset, onBlockMenu, onOpenFigureBatch }: Props) {
  const menu = (id: string) => (e: ReactMouseEvent): void => {
    if (onBlockMenu === undefined) return
    e.preventDefault()
    dispatch({ type: 'select', blockId: id })
    onBlockMenu(id, e.clientX, e.clientY)
  }
  // 上移、下移：顶层块在大纲中移动；综合题中的小题在综合题内移动
  const parent = blocks.find((b) => b.type === 'composite' && b.items.some((it) => it.id === selectedBlockId))
  const siblings: Array<{ id: string }> = parent?.type === 'composite' ? parent.items : blocks
  const selectedIndex = siblings.findIndex((b) => b.id === selectedBlockId)
  const listRef = useRef<HTMLOListElement>(null)
  const { drag, onItemPointerDown, consumeClick } = useOutlineDrag(listRef, (blockId, target, isQuestion) =>
    // 题目可进出综合题；其他内容只在顶层移动
    isQuestion ? dispatch({ type: 'move-question-at', blockId, drop: target }) : target.kind === 'top' && dispatch({ type: 'move-block-to', blockId, toIndex: target.index })
  )

  return (
    <nav className="panel outline" aria-label="大纲">
      <h2 className="panel-title"><CollageText text="大纲" /></h2>
      <div className="outline-fixed">
        <button
          type="button"
          className={`outline-item outline-item--header${selectedBlockId === HEADER_SELECTION ? ' is-selected' : ''}`}
          onClick={() => dispatch({ type: 'select', blockId: HEADER_SELECTION })}
        >
          <span className="outline-text">页眉与水印</span>
        </button>
        <button
          type="button"
          className={`outline-item outline-item--header${selectedBlockId === LAYOUT_SELECTION ? ' is-selected' : ''}`}
          onClick={() => dispatch({ type: 'select', blockId: LAYOUT_SELECTION })}
        >
          <span className="outline-text">版式设置</span>
        </button>
        {onOpenFigureBatch !== undefined && (
          <button type="button" className="outline-item outline-item--header" onClick={onOpenFigureBatch} title="勾选多张插图，一起变清晰或交给 WorkBuddy 重绘">
            <span className="outline-text">批量处理插图…</span>
          </button>
        )}
      </div>
      {blocks.length === 0 ? (
        <p className="panel-empty">还没有内容。导入题目文档的功能完成后，可以从这里开始。</p>
      ) : (
        <ol className="outline-list" ref={listRef}>
          {blocks.flatMap((block, topIndex) => [
            <li
              key={block.id}
              data-top-index={topIndex}
              {...(block.type === 'composite' ? { 'data-composite-id': block.id, 'data-item-count': block.items.length } : {})}
              className={drag?.blockId === block.id ? 'is-dragging' : undefined}
            >
              <button
                type="button"
                className={`outline-item outline-item--${block.type}${block.id === selectedBlockId ? ' is-selected' : ''}`}
                title="点击选中；按住拖动可调整顺序；右键快捷设置"
                onPointerDown={(e) => onItemPointerDown(e, block.id, describe(block), block.type === 'question')}
                onContextMenu={menu(block.id)}
                onClick={() => {
                  if (consumeClick()) return
                  dispatch({ type: 'select', blockId: block.id })
                }}
              >
                {block.type === 'question' && <span className="outline-no">{questionNumbers.get(block.id) ?? ''}</span>}
                <span className="outline-text">{describe(block)}</span>
                {block.type === 'question' && <Difficulty {...difficultyOf(block.question, preset)} />}
              </button>
            </li>,
            // 综合题的小题：缩进列在综合题之下；拖综合题时一起移动，也可单独拖进拖出
            ...(block.type === 'composite'
              ? block.items.map((item, itemIndex) => (
                  <li
                    key={item.id}
                    data-parent-id={block.id}
                    data-item-index={itemIndex}
                    className={drag?.blockId === block.id || drag?.blockId === item.id ? 'outline-nested is-dragging' : 'outline-nested'}
                  >
                    <button
                      type="button"
                      className={`outline-item outline-item--question outline-item--nested${item.id === selectedBlockId ? ' is-selected' : ''}`}
                      title="点击选中；按住拖动可移到别处（可拖出或拖进综合题）；右键快捷设置"
                      onPointerDown={(e) => onItemPointerDown(e, item.id, describe(item), true)}
                      onContextMenu={menu(item.id)}
                      onClick={() => {
                        if (consumeClick()) return
                        dispatch({ type: 'select', blockId: item.id })
                      }}
                    >
                      <span className="outline-no">{questionNumbers.get(item.id) ?? ''}</span>
                      <span className="outline-text">{describe(item)}</span>
                      <Difficulty {...difficultyOf(item.question, preset)} />
                    </button>
                  </li>
                ))
              : [])
          ])}
          {drag !== null && <div className={drag.nested ? 'outline-drop-line is-nested' : 'outline-drop-line'} style={{ top: `${drag.lineTop}px` }} aria-hidden="true" />}
        </ol>
      )}
      {drag !== null && (
        <div className="outline-ghost" style={{ left: drag.ghostX + 12, top: drag.ghostY - 12 }} aria-hidden="true">
          {(() => {
            const no = questionNumbers.get(drag.blockId)
            return `${no !== undefined ? `${no} ` : ''}${drag.label}`
          })()}
        </div>
      )}
      <p className="visually-hidden" role="status" aria-live="polite">
        {drag !== null ? `正在移动“${drag.label}”，松开放到插入线处${drag.nested ? '（放进综合题）' : ''}，按 Esc 取消` : ''}
      </p>

      <div className="outline-actions">
        <button
          type="button"
          disabled={selectedIndex <= 0}
          onClick={() => selectedBlockId && dispatch({ type: 'move-block', blockId: selectedBlockId, delta: -1 })}
        >
          上移
        </button>
        <button
          type="button"
          disabled={selectedIndex === -1 || selectedIndex >= siblings.length - 1}
          onClick={() => selectedBlockId && dispatch({ type: 'move-block', blockId: selectedBlockId, delta: 1 })}
        >
          下移
        </button>
        <button
          type="button"
          className="danger"
          disabled={selectedIndex === -1}
          onClick={() => selectedBlockId && dispatch({ type: 'delete-block', blockId: selectedBlockId })}
        >
          删除
        </button>
      </div>
    </nav>
  )
}

/** 大纲中的摘要：公式（$…$ 与 [公式]）显示为“…”，图片显示为“[图]” */
function summary(text: string): string {
  return text
    .replace(/\$[^$]*\$/g, '…')
    .replace(/\[公式\]/g, '…')
    .replace(/\s+/g, ' ')
    .slice(0, 40)
}

/** 大纲中的难度：等级与星级，便于浏览 */
function Difficulty({ grade, stars, label: name }: { grade?: string; stars?: number; label?: string }) {
  if ((grade === undefined || grade === '') && stars === undefined) return null
  const label = [grade !== undefined && grade !== '' ? `难度 ${grade}` : '', stars !== undefined ? `${stars} 星` : '', name ?? ''].filter(Boolean).join('，')
  return (
    <span className="outline-difficulty" title={label} aria-label={label}>
      {grade !== undefined && grade !== '' && <span className="outline-grade">{grade}</span>}
      {stars !== undefined && <span className="outline-stars">{'★'.repeat(stars)}</span>}
    </span>
  )
}

function describe(block: Block): string {
  switch (block.type) {
    case 'title':
    case 'section':
    case 'topic':
      return block.text || '（无标题）'
    case 'paragraph':
      return summary(plainText(block.content)) || '（空段落）'
    case 'question':
      return summary(plainText(block.question.stem)) || '（空题目）'
    case 'knowledge':
      return block.title.trim() || summary(plainText(block.content)) || '（知识点）'
    case 'composite':
      return `综合题　${block.title.trim() || summary(plainText(block.background)) || ''}`.trim()
    case 'worksheet':
      return block.title.trim() || '作业单'
  }
}
