/**
 * 大纲：按顺序列出全部内容块，用于定位、选择和调整顺序。
 */
import type { Dispatch } from 'react'
import { plainText } from '@core/model/factory'
import type { Block } from '@core/model/types'
import type { EditorAction } from '../state/store'

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

function describe(block: Block): string {
  switch (block.type) {
    case 'title':
    case 'section':
    case 'topic':
      return block.text || '（无标题）'
    case 'paragraph':
      return plainText(block.content).slice(0, 40) || '（空段落）'
    case 'question':
      return plainText(block.question.stem).replace(/\$[^$]*\$/g, '…').slice(0, 40) || '（空题目）'
  }
}
