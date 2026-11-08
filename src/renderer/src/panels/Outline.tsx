/**
 * 大纲：按顺序列出全部内容块，用于定位、选择和调整顺序。
 */
import type { Dispatch } from 'react'
import { plainText } from '@core/model/factory'
import type { Block } from '@core/model/types'
import { HEADER_SELECTION, LAYOUT_SELECTION, type EditorAction } from '../state/store'

interface Props {
  blocks: Block[]
  /** 题目块 ID → 题号，取自 DocIR，保证与预览一致 */
  questionNumbers: ReadonlyMap<string, string>
  selectedBlockId: string | null
  dispatch: Dispatch<EditorAction>
}

export function Outline({ blocks, questionNumbers, selectedBlockId, dispatch }: Props) {
  const selectedIndex = blocks.findIndex((b) => b.id === selectedBlockId)

  return (
    <nav className="panel outline" aria-label="大纲">
      <h2 className="panel-title">大纲</h2>
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
      </div>
      {blocks.length === 0 ? (
        <p className="panel-empty">还没有内容。导入题目文档的功能完成后，可以从这里开始。</p>
      ) : (
        <ol className="outline-list">
          {blocks.map((block) => (
            <li key={block.id}>
              <button
                type="button"
                className={`outline-item outline-item--${block.type}${block.id === selectedBlockId ? ' is-selected' : ''}`}
                onClick={() => dispatch({ type: 'select', blockId: block.id })}
              >
                {block.type === 'question' && (
                  <span className="outline-no">{questionNumbers.get(block.id) ?? ''}</span>
                )}
                <span className="outline-text">{describe(block)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

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
          disabled={selectedIndex === -1 || selectedIndex >= blocks.length - 1}
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
  }
}
