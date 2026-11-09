/**
 * 表格的网格计算：合并单元格按 HTML 的方式记录（起始单元格写 colSpan / rowSpan，被覆盖的位置不出现），
 * 导入、预览、导出、编辑都要知道每个单元格实际占哪些格子。
 */
import type { RichParagraph, TableCell, TableInline } from './types'

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

/** 表格中的矩形范围（格子坐标，含两端） */
export interface CellRect {
  r0: number
  c0: number
  r1: number
  c1: number
}

/** 把范围扩大到完整包住碰到的合并单元格 */
export function expandRect<C extends SpanCell>(grid: TableGrid<C>, rect: CellRect): CellRect {
  let { r0, c0, r1, c1 } = { r0: Math.min(rect.r0, rect.r1), c0: Math.min(rect.c0, rect.c1), r1: Math.max(rect.r0, rect.r1), c1: Math.max(rect.c0, rect.c1) }
  for (let changed = true; changed; ) {
    changed = false
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const p = grid.owner[r]?.[c]
        if (p === undefined) continue
        const pr1 = p.row + p.rowSpan - 1
        const pc1 = p.col + p.colSpan - 1
        if (p.row < r0 || p.col < c0 || pr1 > r1 || pc1 > c1) {
          r0 = Math.min(r0, p.row)
          c0 = Math.min(c0, p.col)
          r1 = Math.max(r1, pr1)
          c1 = Math.max(c1, pc1)
          changed = true
        }
      }
    }
  }
  return { r0, c0, r1, c1 }
}

/**
 * 合并单元格：范围先扩大到完整包住碰到的合并单元格；保留左上角的单元格（底纹等），
 * 其余单元格的内容依次接在后面（空的略去）。范围内只有一个单元格时原样返回。
 */
export function mergeCells(t: TableInline, rect: CellRect): TableInline {
  const grid = layoutTable(t.rows)
  const { r0, c0, r1, c1 } = expandRect(grid, rect)
  const owners: PlacedCell[] = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const p = grid.owner[r]?.[c]
    if (p !== undefined && !owners.includes(p)) owners.push(p)
  }
  if (owners.length <= 1 && r0 === r1 && c0 === c1) return t
  const first = grid.owner[r0]?.[c0] ?? owners[0]
  if (first === undefined) return t
  const isEmpty = (p: RichParagraph): boolean => p.inlines.every((i) => i.type === 'text' && i.text.trim() === '')
  const content = owners.flatMap((o) => o.cell.content).filter((p) => !isEmpty(p))
  const rows = r1 - r0 + 1
  const cols = c1 - c0 + 1
  const merged: TableCell = {
    ...first.cell,
    content: content.length > 0 ? content : [{ inlines: [] }],
    ...(cols > 1 ? { colSpan: cols } : {}),
    ...(rows > 1 ? { rowSpan: rows } : {})
  }
  if (cols === 1) delete merged.colSpan
  if (rows === 1) delete merged.rowSpan
  const removed = new Set(owners.filter((o) => o !== first).map((o) => o.cell))
  return {
    ...t,
    rows: t.rows.map((r) => ({ cells: r.cells.filter((c) => !removed.has(c)).map((c) => (c === first.cell ? merged : c)) }))
  }
}

/** 拆分单元格：(row, col) 所在的合并单元格还原为 1×1，被它覆盖的位置补上空单元格 */
export function splitCell(t: TableInline, row: number, col: number): TableInline {
  const grid = layoutTable(t.rows)
  const p = grid.owner[row]?.[col]
  if (p === undefined || (p.colSpan === 1 && p.rowSpan === 1)) return t
  const { colSpan: _c, rowSpan: _r, ...single } = p.cell
  const rows = t.rows.map((r) => ({ cells: r.cells.slice() }))
  for (let r = p.row; r < p.row + p.rowSpan; r++) {
    // 插在这一行中位于合并单元格左边的单元格之后
    const before = grid.placed[r]!.filter((x) => x.col < p.col).length
    const added = Array.from({ length: r === p.row ? p.colSpan - 1 : p.colSpan }, () => ({ content: [{ inlines: [] }] }) as TableCell)
    if (r === p.row) {
      rows[r]!.cells.splice(before, 1, single, ...added)
    } else {
      rows[r]!.cells.splice(before, 0, ...added)
    }
  }
  return { ...t, rows }
}
