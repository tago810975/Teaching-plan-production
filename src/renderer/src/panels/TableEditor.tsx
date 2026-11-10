/**
 * 表格编辑器：每个单元格一个输入框（可写 $公式$；⟦⟧ 为公式、图片或带格式文字）。
 *
 * - 格式：加粗、倾斜、下划线、重点、颜色（工具条或 Ctrl+B / I / U），表格中的重点在学生版中同样挖空；
 * - 结构：上下插入行、左右插入列、删除所在行列（穿过合并单元格时把它拉长或缩短）；
 *   按住 Shift 点另一个单元格选中矩形范围后合并，光标在合并单元格中时可拆分；
 * - 列宽：以厘米设置，可平均分布或恢复为平分版心；
 * - 撤销：编辑器内 Ctrl+Z / Ctrl+Y（或 Ctrl+Shift+Z），同一单元格中连续输入合为一步。
 *   点“确定”后整个修改在教学案中也是一步，可以再撤销。
 */
import { useContext, useEffect, useRef, useState } from 'react'
import { fromEditable, toEditable } from '@core/model/markup'
import {
  columnWidths,
  deleteColumn,
  deleteRow,
  expandRect,
  insertColumn,
  insertRow,
  layoutTable,
  mergeCells,
  normalizeTable,
  setColumnWidths,
  splitCell,
  type CellRect
} from '@core/model/table'
import { A4_PAGE, contentWidthTwip } from '@core/document/units'
import type { Inline, TableInline } from '@core/model/types'
import { FormatTargetProvider, FormatToolbar, useFormatTargets, useFormattable } from './FormatToolbar'
import { PresetContext } from './preset-context'

interface Props {
  table: TableInline
  title: string
  onSave: (table: TableInline) => void
  onCancel: () => void
}

/** 编辑中的单元格：可编辑文字与其中的标记对象（改格式时换成新的对象表，不在原表上修改） */
interface CellDraft {
  text: string
  objects: Map<number, Inline>
}

interface EditState {
  shape: TableInline
  cells: CellDraft[][]
}

const MERGE_MS = 1000

const toDraft = (t: TableInline): CellDraft[][] =>
  t.rows.map((r) =>
    r.cells.map((c) => {
      const e = toEditable(c.content)
      return { text: e.text, objects: new Map(e.objects) }
    })
  )

/** 把输入的内容写回表格 */
const toTable = (s: EditState): TableInline => ({
  ...s.shape,
  rows: s.shape.rows.map((r, i) => ({
    cells: r.cells.map((c, j) => ({ ...c, content: fromEditable(s.cells[i]?.[j]?.text ?? '', s.cells[i]?.[j]?.objects ?? new Map()) }))
  }))
})

export function TableEditor({ table, title, onSave, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const preset = useContext(PresetContext)
  const format = useFormatTargets()
  const [state, setState] = useState<EditState>(() => {
    const shape = normalizeTable(table)
    return { shape, cells: toDraft(shape) }
  })
  const history = useRef<{ past: EditState[]; future: EditState[]; key: string | null; at: number }>({ past: [], future: [], key: null, at: 0 })
  const [, setTick] = useState(0)
  const [focus, setFocus] = useState<{ row: number; index: number }>({ row: 0, index: 0 })
  /** Shift+点击选中的矩形范围（格子坐标） */
  const [sel, setSel] = useState<CellRect | null>(null)
  const cellRefs = useRef(new Map<string, HTMLTextAreaElement>())

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  /** 记下一步修改；key 相同且间隔很短的连续修改（同一单元格中打字）合为一步 */
  const commit = (next: EditState, key: string | null = null): void => {
    const h = history.current
    const now = Date.now()
    if (!(key !== null && key === h.key && now - h.at < MERGE_MS)) h.past.push(state)
    h.future = []
    h.key = key
    h.at = now
    setState(next)
    setTick((t) => t + 1)
  }
  const travel = (kind: 'undo' | 'redo'): void => {
    const h = history.current
    const from = kind === 'undo' ? h.past : h.future
    const target = from.pop()
    if (target === undefined) return
    ;(kind === 'undo' ? h.future : h.past).push(state)
    h.key = null
    setState(target)
    setSel(null)
    // 单元格可能变多变少：光标落在仍存在的单元格上
    const rows = target.shape.rows
    setFocus((f) => (rows[f.row]?.cells[f.index] !== undefined ? f : { row: 0, index: 0 }))
    pendingFocus.current = true
    setTick((t) => t + 1)
  }
  /** 改结构：先写回内容，再按新结构重建 */
  const reshape = (fn: (t: TableInline) => TableInline, next?: { row: number; index: number }, key: string | null = null): void => {
    const shape = fn(toTable(state))
    commit({ shape, cells: toDraft(shape) }, key)
    setSel(null)
    if (next !== undefined) setFocus(next)
    pendingFocus.current = true
  }

  const grid = layoutTable(state.shape.rows)
  const focused = grid.placed[focus.row]?.[focus.index]
  const col = focused?.col ?? 0
  // 列宽（厘米）：当前实际列宽，总宽超出版心时导出按比例缩小
  const effective = columnWidths(state.shape, CONTENT_TWIP)
  // 设过列宽时为原值（可能超出版心），否则为平分版心的宽度
  const widths = state.shape.colWidthsTwip !== undefined && state.shape.colWidthsTwip.length === grid.cols ? state.shape.colWidthsTwip.slice() : effective
  const totalCm = cm(widths.reduce((a, b) => a + b, 0))
  const rect = sel !== null ? expandRect(grid, sel) : null
  const rectCells = rect === null ? 0 : new Set(grid.owner.slice(rect.r0, rect.r1 + 1).flatMap((row) => row.slice(rect.c0, rect.c1 + 1))).size
  const inRect = (p: { row: number; col: number; rowSpan: number; colSpan: number }): boolean =>
    rect !== null && p.row <= rect.r1 && p.row + p.rowSpan - 1 >= rect.r0 && p.col <= rect.c1 && p.col + p.colSpan - 1 >= rect.c0

  // 撤销 / 重做快捷键：在窗口上监听（焦点不一定在对话框中的输入框里）
  const travelRef = useRef(travel)
  travelRef.current = travel
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      const kind = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : k === 'y' && !e.shiftKey ? 'redo' : null
      if (kind === null) return
      e.preventDefault()
      e.stopPropagation()
      travelRef.current(kind)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // 改结构、撤销后把光标放回对应的单元格
  const pendingFocus = useRef(false)
  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    const el = cellRefs.current.get(`${focus.row}:${focus.index}`) ?? cellRefs.current.get('0:0')
    el?.focus()
  })

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
      <div className="table-editor-tools" role="toolbar" aria-label="撤销与表格结构">
        <button type="button" className="icon-button" onClick={() => travel('undo')} disabled={history.current.past.length === 0} title="撤销（Ctrl+Z）" aria-label="撤销">
          ↶
        </button>
        <button type="button" className="icon-button" onClick={() => travel('redo')} disabled={history.current.future.length === 0} title="重做（Ctrl+Y）" aria-label="重做">
          ↷
        </button>
        <span className="table-editor-size">
          {grid.rows} 行 × {grid.cols} 列
        </span>
        <button type="button" onClick={() => reshape((t) => insertRow(t, focus.row), { row: focus.row + 1, index: focus.index })}>
          上方插入行
        </button>
        <button type="button" onClick={() => reshape((t) => insertRow(t, focus.row + 1), { row: focus.row + 1, index: focus.index })}>
          下方插入行
        </button>
        <button type="button" onClick={() => reshape((t) => insertColumn(t, col), { row: focus.row, index: focus.index + 1 })}>
          左侧插入列
        </button>
        <button type="button" onClick={() => reshape((t) => insertColumn(t, col + 1), { row: focus.row, index: focus.index + 1 })}>
          右侧插入列
        </button>
        <button type="button" disabled={grid.rows <= 1} onClick={() => reshape((t) => deleteRow(t, focus.row), { row: Math.max(0, focus.row - 1), index: focus.index })}>
          删除所在行
        </button>
        <button type="button" disabled={grid.cols <= 1} onClick={() => reshape((t) => deleteColumn(t, col), { row: focus.row, index: Math.max(0, focus.index - 1) })}>
          删除所在列
        </button>
        <button
          type="button"
          disabled={rect === null || rectCells < 2}
          title="按住 Shift 点另一个单元格，选中要合并的范围"
          onClick={() => {
            if (rect === null) return
            const next = mergeCells(toTable(state), rect)
            const g = layoutTable(next.rows)
            const p = g.owner[rect.r0]?.[rect.c0]
            reshape(() => next, p !== undefined ? { row: p.row, index: g.placed[p.row]!.indexOf(p) } : undefined)
          }}
        >
          合并单元格
        </button>
        <button
          type="button"
          disabled={focused === undefined || (focused.colSpan === 1 && focused.rowSpan === 1)}
          onClick={() => focused !== undefined && reshape((t) => splitCell(t, focused.row, focused.col))}
        >
          拆分单元格
        </button>
      </div>
      <FormatToolbar active={format.active} onApply={format.apply} colors={preset.textColors} keyPoint={preset.keyPoint} />
      <div className="table-editor-widths" role="group" aria-label="列宽">
        <span className="table-editor-size">列宽（厘米）</span>
        {widths.map((w, i) => (
          <WidthInput
            key={`${grid.cols}-${i}`}
            label={`第 ${i + 1} 列的宽度（厘米）`}
            cm={cm(w)}
            onCommit={(v) => {
              const next = widths.slice()
              next[i] = Math.round(v * TWIP_PER_CM)
              reshape((t) => setColumnWidths(t, next), undefined, `width:${i}`)
            }}
          />
        ))}
        <button type="button" onClick={() => reshape((t) => setColumnWidths(t, Array.from({ length: grid.cols }, () => Math.floor(CONTENT_TWIP / grid.cols))))}>
          平均分布
        </button>
        <button type="button" disabled={state.shape.colWidthsTwip === undefined} onClick={() => reshape((t) => setColumnWidths(t, undefined))} title="不设列宽：平分版心宽度">
          自动
        </button>
        <span className={totalCm > cm(CONTENT_TWIP) + 0.01 ? 'table-editor-total is-over' : 'table-editor-total'}>
          共 {totalCm} / {cm(CONTENT_TWIP)} 厘米
          {totalCm > cm(CONTENT_TWIP) + 0.01 ? '（超出版心，导出时按比例缩小）' : ''}
        </span>
      </div>
      <div className="table-editor-widths" role="group" aria-label="学生版书写横线">
        <label title="学生版中，这个单元格的内容换成若干行虚线，供学生书写；教师版照常显示内容。0 表示两版相同">
          当前单元格在学生版换成书写横线
          <input
            type="number"
            min={0}
            max={60}
            value={focused?.cell.studentLines ?? 0}
            disabled={focused === undefined}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              if (focused === undefined || !Number.isFinite(n) || n < 0) return
              const { row, index } = { row: focus.row, index: focus.index }
              reshape(
                (t) => ({
                  ...t,
                  rows: t.rows.map((r, i) =>
                    i !== row
                      ? r
                      : {
                          cells: r.cells.map((c, j) => {
                            if (j !== index) return c
                            const { studentLines: _l, ...rest } = c
                            return n > 0 ? { ...rest, studentLines: Math.min(60, n) } : rest
                          })
                        }
                  )
                }),
                { row, index },
                `lines:${row}:${index}`
              )
            }}
          />
          行
        </label>
      </div>
      <p className="field-hint">
        按住 Shift 点另一个单元格可选中一片范围（用于合并）。
      </p>
      <FormatTargetProvider value={format.provider}>
        <div className="table-editor-grid">
          <table>
            <colgroup>
              {effective.map((w, i) => (
                <col key={i} style={{ width: `${(w / effective.reduce((a, b) => a + b, 0)) * 100}%` }} />
              ))}
            </colgroup>
            <tbody>
              {grid.placed.map((row, r) => (
                <tr key={r}>
                  {row.map((p, j) => (
                    <td
                      key={j}
                      {...(p.colSpan > 1 ? { colSpan: p.colSpan } : {})}
                      {...(p.rowSpan > 1 ? { rowSpan: p.rowSpan } : {})}
                      className={inRect(p) ? 'is-selected' : undefined}
                      onMouseDownCapture={(e) => {
                        if (!e.shiftKey || focused === undefined) return
                        // Shift+点击：从当前单元格到这里选中一片范围
                        e.preventDefault()
                        setSel({ r0: focused.row, c0: focused.col, r1: p.row + p.rowSpan - 1, c1: p.col + p.colSpan - 1 })
                      }}
                    >
                      <CellInput
                        cell={state.cells[r]?.[j] ?? { text: '', objects: new Map() }}
                        label={`第 ${r + 1} 行第 ${p.col + 1} 列`}
                        focused={focus.row === r && focus.index === j}
                        autoFocus={r === focus.row && j === focus.index}
                        inputRef={(el) => {
                          if (el !== null) cellRefs.current.set(`${r}:${j}`, el)
                          else cellRefs.current.delete(`${r}:${j}`)
                        }}
                        onFocus={() => {
                          setFocus({ row: r, index: j })
                          setSel(null)
                        }}
                        onChange={(cell, typing) => {
                          const cells = state.cells.map((line, i) => (i !== r ? line : line.map((c, k) => (k !== j ? c : cell))))
                          commit({ ...state, cells }, typing ? `cell:${r}:${j}` : null)
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FormatTargetProvider>
      <p className="field-hint">单元格中换行即分段；公式写作 $LaTeX$。</p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="primary" onClick={() => onSave(toTable(state))}>
          确定
        </button>
      </div>
    </dialog>
  )
}

const TWIP_PER_CM = 567
const CONTENT_TWIP = contentWidthTwip(A4_PAGE)
const cm = (twip: number): number => Math.round((twip / TWIP_PER_CM) * 100) / 100

/** 列宽输入框：输入过程中允许暂时无效的数字，有效时立即生效，离开时恢复为实际值 */
function WidthInput({ cm: value, label, onCommit }: { cm: number; label: string; onCommit: (cm: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="number"
      step={0.1}
      min={0.5}
      max={30}
      aria-label={label}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = Number(e.target.value)
        if (e.target.value !== '' && Number.isFinite(v) && v >= 0.5 && v <= 30) onCommit(v)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/** 单元格输入框：接入格式工具（改格式时在新的对象表上修改，便于撤销） */
function CellInput(props: {
  cell: CellDraft
  label: string
  focused: boolean
  autoFocus: boolean
  inputRef: (el: HTMLTextAreaElement | null) => void
  onFocus: () => void
  onChange: (cell: CellDraft, typing: boolean) => void
}) {
  const { cell, label, focused, autoFocus, inputRef, onFocus, onChange } = props
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const working = useRef<Map<number, Inline>>(cell.objects)
  const formattable = useFormattable(
    ref,
    () => {
      working.current = new Map(cell.objects)
      return { text: cell.text, objects: working.current }
    },
    (text) => onChange({ text, objects: working.current }, false)
  )
  return (
    <textarea
      ref={(el) => {
        ref.current = el
        inputRef(el)
      }}
      rows={2}
      spellCheck={false}
      aria-label={label}
      className={focused ? 'is-focused' : undefined}
      value={cell.text}
      autoFocus={autoFocus}
      onChange={(e) => onChange({ text: e.target.value, objects: cell.objects }, true)}
      onFocus={() => {
        onFocus()
        formattable.onFocus()
      }}
      onBlur={formattable.onBlur}
      onKeyDown={formattable.onKeyDown}
    />
  )
}
