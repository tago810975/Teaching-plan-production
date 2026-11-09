/**
 * 表格的网格计算：合并单元格按 HTML 的方式记录（起始单元格写 colSpan / rowSpan，被覆盖的位置不出现），
 * 导入、预览、导出、编辑都要知道每个单元格实际占哪些格子。
 */
import type { TableCell, TableInline } from './types'

/** 只需要合并信息的单元格（工程数据中的单元格、排版数据中的单元格都可以） */
export interface SpanCell {
  colSpan?: number
  rowSpan?: number
}

export interface PlacedCell<C extends SpanCell = TableCell> {
  cell: C
  row: number
  col: number
  colSpan: number
  rowSpan: number
}

export interface TableGrid<C extends SpanCell = TableCell> {
  rows: number
  cols: number
  /** 按行列出的单元格（位置已算好） */
  placed: Array<Array<PlacedCell<C>>>
  /** owner[r][c]：占据该格的单元格；没有单元格的空位为 undefined */
  owner: Array<Array<PlacedCell<C> | undefined>>
}

export function layoutTable<C extends SpanCell = TableCell>(rows: ReadonlyArray<{ cells: readonly C[] }>): TableGrid<C> {
  const owner: Array<Array<PlacedCell<C> | undefined>> = rows.map(() => [])
  const placed: Array<Array<PlacedCell<C>>> = []
  let cols = 0
  rows.forEach((row, r) => {
    const line: Array<PlacedCell<C>> = []
    let c = 0
    for (const cell of row.cells) {
      while (owner[r]![c] !== undefined) c++
      const colSpan = Math.max(1, cell.colSpan ?? 1)
      const rowSpan = Math.max(1, Math.min(cell.rowSpan ?? 1, rows.length - r))
      const p: PlacedCell<C> = { cell, row: r, col: c, colSpan, rowSpan }
      for (let dr = 0; dr < rowSpan; dr++) for (let dc = 0; dc < colSpan; dc++) owner[r + dr]![c + dc] = p
      line.push(p)
      c += colSpan
      cols = Math.max(cols, c)
    }
    placed.push(line)
  })
  for (const o of owner) for (let c = 0; c < cols; c++) o[c] ??= undefined
  return { rows: rows.length, cols, placed, owner }
}

/** 是否有合并单元格 */
export function hasMerges(t: TableInline): boolean {
  return t.rows.some((r) => r.cells.some((c) => (c.colSpan ?? 1) > 1 || (c.rowSpan ?? 1) > 1))
}

const emptyCell = (): TableCell => ({ content: [{ inlines: [] }] })

/** 新建 rows × cols 的空表格 */
export function createTable(rows: number, cols: number): TableInline {
  return { type: 'table', rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: cols }, emptyCell) })) }
}

/** 补齐每一行（没有合并单元格时），使各行单元格数相同 */
export function normalizeTable(t: TableInline): TableInline {
  if (hasMerges(t)) return t
  const cols = Math.max(1, ...t.rows.map((r) => r.cells.length))
  return { ...t, rows: t.rows.map((r) => ({ cells: [...r.cells, ...Array.from({ length: cols - r.cells.length }, emptyCell)] })) }
}

/** 在第 at 行之前插入一行（没有合并单元格时） */
export function insertRow(t: TableInline, at: number): TableInline {
  const cols = layoutTable(t.rows).cols
  const rows = t.rows.slice()
  rows.splice(at, 0, { cells: Array.from({ length: cols }, emptyCell) })
  return { ...t, rows }
}

export function deleteRow(t: TableInline, at: number): TableInline {
  if (t.rows.length <= 1) return t
  return { ...t, rows: t.rows.filter((_, i) => i !== at) }
}

/** 在第 at 列之前插入一列（没有合并单元格时） */
export function insertColumn(t: TableInline, at: number): TableInline {
  const { colWidthsTwip: _w, ...rest } = t
  return { ...rest, rows: t.rows.map((r) => ({ cells: [...r.cells.slice(0, at), emptyCell(), ...r.cells.slice(at)] })) }
}

export function deleteColumn(t: TableInline, at: number): TableInline {
  if (layoutTable(t.rows).cols <= 1) return t
  const { colWidthsTwip: _w, ...rest } = t
  return { ...rest, rows: t.rows.map((r) => ({ cells: r.cells.filter((_, i) => i !== at) })) }
}

/** 各列宽度：表格自带的（列数相符时），否则平分 totalTwip */
export function columnWidths(t: TableInline, totalTwip: number): number[] {
  const cols = Math.max(1, layoutTable(t.rows).cols)
  if (t.colWidthsTwip !== undefined && t.colWidthsTwip.length === cols) {
    const sum = t.colWidthsTwip.reduce((a, b) => a + b, 0)
    // 原表比栏宽还宽时按比例缩到栏宽
    return sum > totalTwip ? t.colWidthsTwip.map((w) => Math.floor((w * totalTwip) / sum)) : t.colWidthsTwip.slice()
  }
  return Array.from({ length: cols }, () => Math.floor(totalTwip / cols))
}
