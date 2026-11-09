/**
 * 表格编辑器：每个单元格一个输入框（与其他输入框一样可写 $公式$，⟦⟧ 标记为导入的公式、图片或格式文字）。
 * 光标所在的单元格可在上方 / 下方插入行、左侧 / 右侧插入列、删除所在行 / 列。
 * 有合并单元格的表格只能修改内容（增删行列会破坏合并关系）。
 */
import { useEffect, useRef, useState } from 'react'
import { fromEditable, toEditable } from '@core/model/markup'
import { deleteColumn, deleteRow, hasMerges, insertColumn, insertRow, layoutTable, normalizeTable } from '@core/model/table'
import type { Inline, TableInline } from '@core/model/types'

interface Props {
  table: TableInline
  title: string
  onSave: (table: TableInline) => void
  onCancel: () => void
}

/** 编辑中的单元格：可编辑文字与其中的标记对象 */
interface CellDraft {
  text: string
  objects: Map<number, Inline>
}

const toDraft = (t: TableInline): CellDraft[][] =>
  t.rows.map((r) =>
    r.cells.map((c) => {
      const e = toEditable(c.content)
      return { text: e.text, objects: new Map(e.objects) }
    })
  )

export function TableEditor({ table, title, onSave, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [shape, setShape] = useState<TableInline>(() => normalizeTable(table))
  const [cells, setCells] = useState<CellDraft[][]>(() => toDraft(normalizeTable(table)))
  const [focus, setFocus] = useState<{ row: number; index: number }>({ row: 0, index: 0 })
  const merged = hasMerges(shape)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  /** 把当前输入的内容写回表格 */
  const current = (): TableInline => ({
    ...shape,
    rows: shape.rows.map((r, i) => ({ cells: r.cells.map((c, j) => ({ ...c, content: fromEditable(cells[i]?.[j]?.text ?? '', cells[i]?.[j]?.objects ?? new Map()) })) }))
  })
  /** 改结构：先写回内容，再按新结构重建草稿 */
  const reshape = (fn: (t: TableInline) => TableInline, next?: { row: number; index: number }): void => {
    const t = fn(current())
    setShape(t)
    setCells(toDraft(t))
    if (next !== undefined) setFocus(next)
  }
  const grid = layoutTable(shape.rows)
  const col = grid.placed[focus.row]?.[focus.index]?.col ?? 0

  return (
    <dialog
      ref={dialogRef}
      className="dialog table-editor"
      aria-labelledby="table-editor-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id="table-editor-title">{title}</h2>
      <div className="table-editor-tools" role="toolbar" aria-label="行与列">
        <span className="table-editor-size">
          {grid.rows} 行 × {grid.cols} 列
        </span>
        <button type="button" disabled={merged} onClick={() => reshape((t) => insertRow(t, focus.row), { row: focus.row + 1, index: focus.index })}>
          上方插入行
        </button>
        <button type="button" disabled={merged} onClick={() => reshape((t) => insertRow(t, focus.row + 1), { row: focus.row + 1, index: focus.index })}>
          下方插入行
        </button>
        <button type="button" disabled={merged} onClick={() => reshape((t) => insertColumn(t, col), { row: focus.row, index: focus.index + 1 })}>
          左侧插入列
        </button>
        <button type="button" disabled={merged} onClick={() => reshape((t) => insertColumn(t, col + 1), { row: focus.row, index: focus.index + 1 })}>
          右侧插入列
        </button>
        <button type="button" disabled={merged || grid.rows <= 1} onClick={() => reshape((t) => deleteRow(t, focus.row), { row: Math.max(0, focus.row - 1), index: focus.index })}>
          删除所在行
        </button>
        <button type="button" disabled={merged || grid.cols <= 1} onClick={() => reshape((t) => deleteColumn(t, col), { row: focus.row, index: Math.max(0, focus.index - 1) })}>
          删除所在列
        </button>
      </div>
      {merged && <p className="field-hint">这个表格有合并单元格，只能修改内容。</p>}
      <div className="table-editor-grid">
        <table>
          <tbody>
            {grid.placed.map((row, r) => (
              <tr key={r}>
                {row.map((p, j) => (
                  <td key={j} {...(p.colSpan > 1 ? { colSpan: p.colSpan } : {})} {...(p.rowSpan > 1 ? { rowSpan: p.rowSpan } : {})}>
                    <textarea
                      rows={2}
                      spellCheck={false}
                      aria-label={`第 ${r + 1} 行第 ${p.col + 1} 列`}
                      className={focus.row === r && focus.index === j ? 'is-focused' : undefined}
                      value={cells[r]?.[j]?.text ?? ''}
                      autoFocus={r === focus.row && j === focus.index}
                      onFocus={() => setFocus({ row: r, index: j })}
                      onChange={(e) => {
                        const text = e.target.value
                        setCells((all) => all.map((line, i) => (i !== r ? line : line.map((c, k) => (k !== j ? c : { ...c, text })))))
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-hint">单元格中换行即分段；公式写作 $LaTeX$。</p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="primary" onClick={() => onSave(current())}>
          确定
        </button>
      </div>
    </dialog>
  )
}
