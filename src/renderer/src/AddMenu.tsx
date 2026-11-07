/**
 * “添加”菜单：在当前选中内容之后插入新的题目、标题或段落。
 */
import { useEffect, useRef, useState } from 'react'
import { createQuestion, newId } from '@core/model/factory'
import type { Block } from '@core/model/types'

type Kind = 'choice' | 'multi' | 'fill' | 'solve' | 'topic' | 'section' | 'paragraph' | 'title'

const ITEMS: ReadonlyArray<readonly [Kind, string] | 'divider'> = [
  ['choice', '单选题'],
  ['multi', '多选题'],
  ['fill', '填空题'],
  ['solve', '解答题'],
  'divider',
  ['topic', '题型分组（如“放缩圆”）'],
  ['section', '栏目标题（如“课堂练习”）'],
  ['paragraph', '正文段落'],
  ['title', '大标题（如“作业单”）']
]

export function createBlock(kind: Kind): Block {
  const id = newId()
  const options = ['A', 'B', 'C', 'D'].map((label) => ({ label, content: { inlines: [] } }))
  switch (kind) {
    case 'choice':
      return { id, type: 'question', question: createQuestion({ kind: 'single-choice', options }) }
    case 'multi':
      return {
        id,
        type: 'question',
        question: createQuestion({
          kind: 'multi-choice',
          options,
          stem: [{ inlines: [{ type: 'text', text: '（多选）' }] }]
        })
      }
    case 'fill':
      return { id, type: 'question', question: createQuestion({ kind: 'fill-blank' }) }
    case 'solve':
      return {
        id,
        type: 'question',
        question: createQuestion({ kind: 'solve', layout: { studentSpaceLines: 8 } })
      }
    case 'topic':
      return { id, type: 'topic', text: '新的题型分组' }
    case 'section':
      return { id, type: 'section', text: '新的栏目' }
    case 'paragraph':
      return { id, type: 'paragraph', content: [] }
    case 'title':
      return { id, type: 'title', text: '新的大标题', restartNumbering: true }
  }
}

export function AddMenu({ onAdd }: { onAdd: (block: Block) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="menu" ref={rootRef}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        添加 ▾
      </button>
      {open && (
        <div className="menu-popup" role="menu">
          {ITEMS.map((item, i) =>
            item === 'divider' ? (
              <div key={i} className="menu-divider" role="separator" />
            ) : (
              <button
                key={item[0]}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onAdd(createBlock(item[0]))
                }}
              >
                {item[1]}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
