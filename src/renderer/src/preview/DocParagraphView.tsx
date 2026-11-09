/**
 * 单个段落的预览渲染。只依据 DocIR 与 STYLE_SPECS，不包含任何排版规则。
 */
import { useContext, memo, type CSSProperties, type ReactNode } from 'react'
import type { DocParagraph, DocRun, DocTable, OptionImageRef } from '@core/document/ir'
import { previewCss } from '@core/document/styles'
import { StylesContext } from './styles-context'
import { emuToPt, twipToPt } from '@core/document/units'
import { MathView } from './MathView'
import { FigureImage, type FigureChangeHandler } from './FigureImage'

interface Props {
  paragraph: DocParagraph
  assetUrls: ReadonlyMap<string, string>
  selected: boolean
  onSelect?: (blockId: string, focus?: ParagraphFocus) => void
  /** 点击公式时调用；不提供则公式不可点击（如测量区） */
  onEditMath?: (run: MathRun) => void
  /** 在预览中缩放、拖动图片后调用 */
  onFigureChange?: FigureChangeHandler
  /** 选项图片的缩放（单张或全部一起），见 OptionImageHandlers */
  optionImages?: OptionImageHandlers
}

/** 选择题选项图片在预览中的缩放 */
export interface OptionImageHandlers {
  /** 松开后：把这张图缩放到 widthEmu；group 为 true 时全部选项图片按同一比例缩放 */
  onResize: (ref: OptionImageRef, widthEmu: number, group: boolean) => void
  /** 拖动中：全部一起缩放时的比例（结束时为 null），用于其他选项图片同步显示 */
  onDraft: (ref: OptionImageRef, scale: number | null, group: boolean) => void
  /** 默认是否全部一起缩放 */
  groupByDefault: boolean
  /** 本段所属题目的选项图片正在被“全部一起缩放”时的比例 */
  groupScale?: number
}

interface FigureOptions {
  active: boolean
  onChange: FigureChangeHandler | undefined
  optionImages: OptionImageHandlers | undefined
}

export type MathRun = Extract<DocRun, { kind: 'math' }>

/** 点击段落时要定位到的输入框、段落与点击处前后的文字 */
export interface ParagraphFocus {
  field: string
  paragraph: number
  before: string
  after: string
}

/** 点击处前后各取几个字 */
const SNIPPET = 6

function focusFromClick(p: DocParagraph, e: MouseEvent): ParagraphFocus | undefined {
  const target = p.editTarget
  if (target === undefined) return undefined
  let field = target.field
  let paragraph = target.paragraph
  // 选项行：按点击的那一列确定是第几个选项
  if (field === 'option') {
    const cell = (e.target as Element).closest('[data-cell]') as HTMLElement | null
    field = `option:${paragraph + Number(cell?.dataset.cell ?? 0)}`
    paragraph = 0
  }
  let before = ''
  let after = ''
  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY)
  const node = range?.startContainer
  if (node !== undefined && node !== null && node.nodeType === Node.TEXT_NODE && !(node.parentElement?.closest('math') ?? null)) {
    const text = node.textContent ?? ''
    const offset = range!.startOffset
    before = text.slice(Math.max(0, offset - SNIPPET), offset)
    after = text.slice(offset, offset + SNIPPET)
  }
  return { field, paragraph, before, after }
}

export const DocParagraphView = memo(function DocParagraphView({
  paragraph: p,
  assetUrls,
  selected,
  onSelect,
  onEditMath,
  onFigureChange,
  optionImages
}: Props) {
  const spec = useContext(StylesContext)[p.style]
  const css = previewCss(spec)
  // Word 中相邻段落的段后、段前间距是相加的，CSS 的 margin 会合并，所以改用 padding
  const style: CSSProperties = {
    fontSize: css.fontSize,
    fontWeight: css.fontWeight,
    color: css.color,
    textAlign: p.align ?? css.textAlign,
    lineHeight: css.lineHeight,
    paddingTop: css.marginTop,
    paddingBottom: css.marginBottom,
    paddingLeft: css.paddingLeft,
    textIndent: p.firstLineIndentTwip !== undefined ? `${twipToPt(p.firstLineIndentTwip)}pt` : css.textIndent
  }

  if (p.spacerTwip !== undefined) {
    return (
      <div
        className={`para para--spacer${selected ? ' is-selected' : ''}`}
        style={{ height: `${twipToPt(p.spacerTwip)}pt` }}
        data-block-id={p.sourceBlockId}
        title="作答留白"
        onClick={onSelect === undefined ? undefined : () => onSelect(p.sourceBlockId)}
      />
    )
  }

  const hasHanging = spec.hangingTwip > 0
  const label =
    p.label === undefined ? null : (
      <span
        className={hasHanging ? 'para-label para-label--hanging' : 'para-label'}
        style={hasHanging ? { width: `${twipToPt(spec.hangingTwip)}pt` } : undefined}
      >
        {p.label}
      </span>
    )

  // 浮动图（右侧图、自由位置）：文字绕开图片
  const figures: FigureOptions = { active: selected, onChange: onFigureChange, optionImages }
  const floating = (p.floatingImages ?? []).map((f, i) => (
    <FigureImage
      key={`float-${f.ref?.figureIndex ?? i}`}
      className="para-float"
      src={assetUrls.get(f.assetId)}
      widthEmu={f.widthEmu}
      heightEmu={f.heightEmu}
      figureRef={f.ref}
      active={selected}
      onChange={onFigureChange}
      float={f}
    />
  ))

  const className = [
    'para',
    `para--${p.style}`,
    // 字体：段落自身的字体，否则样式的字体（与导出、模板一致）
    `font-${p.font ?? spec.fontRole}`,
    p.shaded === true ? 'para--shaded' : '',
    selected ? 'is-selected' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      style={style}
      data-block-id={p.sourceBlockId}
      data-anchor-index={p.anchorIndex}
      onClick={
        onSelect === undefined
          ? undefined
          : (e) => {
              // 选中了文字（要用浮动工具条改格式）：只选中内容，不跳到属性面板的输入框，以免选区被取消
              const sel = window.getSelection()
              if (sel !== null && !sel.isCollapsed) onSelect(p.sourceBlockId)
              else onSelect(p.sourceBlockId, focusFromClick(p, e.nativeEvent))
            }
      }
    >
      {floating}
      {label}
      {p.tabStopsTwip === undefined ? (
        renderRuns(p.runs, assetUrls, onEditMath, figures)
      ) : (
        <TabbedRuns
          runs={p.runs}
          stops={p.tabStopsTwip}
          indentTwip={spec.indentLeftTwip}
          assetUrls={assetUrls}
          onEditMath={onEditMath}
          figures={figures}
          {...(p.noWrap === true ? { noWrap: true } : {})}
        />
      )}
    </div>
  )
})

/** 按制表位分列显示（用于选项），每一列宽度等于相邻制表位的间距 */
function TabbedRuns(props: {
  runs: DocRun[]
  stops: readonly number[]
  indentTwip: number
  assetUrls: ReadonlyMap<string, string>
  onEditMath: ((run: MathRun) => void) | undefined
  figures: FigureOptions
  noWrap?: boolean
}): ReactNode {
  const segments: DocRun[][] = [[]]
  for (const run of props.runs) {
    if (run.kind === 'tab') segments.push([])
    else segments[segments.length - 1]!.push(run)
  }
  const edges = [props.indentTwip, ...props.stops]
  return (
    <span className="tab-row">
      {segments.map((seg, i) => {
        const width = i + 1 < edges.length ? edges[i + 1]! - edges[i]! : undefined
        return (
          <span
            key={i}
            data-cell={i}
            className="tab-cell"
            style={{
              ...(width === undefined ? { flex: 1 } : { width: `${twipToPt(width)}pt` }),
              ...(props.noWrap === true ? { whiteSpace: 'nowrap' as const } : {})
            }}
          >
            {renderRuns(seg, props.assetUrls, props.onEditMath, props.figures)}
          </span>
        )
      })}
    </span>
  )
}

function renderRuns(
  runs: DocRun[],
  assetUrls: ReadonlyMap<string, string>,
  onEditMath?: (run: MathRun) => void,
  figures?: FigureOptions
): ReactNode[] {
  return runs.map((run, i) => {
    switch (run.kind) {
      case 'text': {
        const m = run.marks
        // 带来源的文字加上标记，预览中选中后可换算回工程数据（见 Preview 的选区工具条）
        const src = run.src !== undefined ? srcAttrs(run.src.blockId, run.src.path, run.src.inline) : {}
        if (m === undefined) return run.src === undefined ? run.text : <span key={i} {...src}>{run.text}</span>
        const style: CSSProperties = {
          fontWeight: m.bold === true ? 700 : undefined,
          fontStyle: m.italic === true ? 'italic' : undefined,
          textDecoration: m.underline === true ? 'underline' : undefined,
          color: m.color !== undefined ? `#${m.color}` : undefined
        }
        const Tag = m.script === 'sup' ? 'sup' : m.script === 'sub' ? 'sub' : 'span'
        return (
          <Tag key={i} style={style} {...(m.font !== undefined ? { className: `font-${m.font}` } : {})} {...src}>
            {run.text}
          </Tag>
        )
      }
      case 'math': {
        const view = (
          <MathView
            key={i}
            latex={run.latex}
            omml={run.omml}
            display={run.display}
            {...(onEditMath !== undefined && run.ref !== undefined ? { onEdit: () => onEditMath(run) } : {})}
          />
        )
        // 公式整体加粗、加下划线、设颜色；带来源的公式加上标记（预览中可与文字一起选中改格式）
        const msrc = run.ref !== undefined && run.ref.path.length >= 2 ? srcAttrs(run.ref.blockId, run.ref.path.slice(0, -2), Number(run.ref.path[run.ref.path.length - 1]), true) : {}
        if (run.bold !== true && run.underline !== true && run.color === undefined) return run.ref === undefined ? view : <span key={i} {...msrc}>{view}</span>
        const cls = [run.bold === true ? 'math-bold' : '', run.underline === true ? 'math-underline' : ''].filter(Boolean).join(' ')
        return (
          <span key={i} className={cls} {...(run.color !== undefined ? { style: { color: `#${run.color}` } } : {})} {...msrc}>
            {view}
          </span>
        )
      }
      case 'image': {
        // 选项中的图片：可单张缩放，或全部一起缩放
        const opt = figures?.optionImages
        if (run.optionRef !== undefined && opt !== undefined) {
          const ref = run.optionRef
          return (
            <FigureImage
              key={i}
              className="run-image"
              src={assetUrls.get(run.assetId)}
              widthEmu={run.widthEmu}
              heightEmu={run.heightEmu}
              figureRef={undefined}
              active={figures!.active}
              onChange={undefined}
              onResizeEnd={(size, group) => opt.onResize(ref, size.widthEmu, group)}
              onResizeDraft={(scale, group) => opt.onDraft(ref, scale, group)}
              groupByDefault={opt.groupByDefault}
              {...(opt.groupScale !== undefined ? { groupScale: opt.groupScale } : {})}
            />
          )
        }
        // 属于题图、插图的图片可在预览中缩放；正文中的行内图片保持普通显示
        if (run.ref !== undefined && figures !== undefined) {
          return (
            <FigureImage
              key={i}
              className="run-image"
              src={assetUrls.get(run.assetId)}
              widthEmu={run.widthEmu}
              heightEmu={run.heightEmu}
              figureRef={run.ref}
              active={figures.active}
              onChange={figures.onChange}
            />
          )
        }
        return (
          <img
            key={i}
            className="run-image"
            src={assetUrls.get(run.assetId)}
            alt=""
            style={{ width: `${emuToPt(run.widthEmu)}pt`, height: `${emuToPt(run.heightEmu)}pt` }}
          />
        )
      }
      case 'blank':
        return <span key={i} className="run-blank" style={{ width: `${run.widthChars}em` }} />
      case 'tab':
        return <span key={i} className="run-tab" />
      case 'table':
        return <TableView key={i} table={run.table} assetUrls={assetUrls} onEditMath={onEditMath} />
    }
  })
}

/** 文字、公式在工程数据中的来源，写在预览元素上（data-src-*） */
function srcAttrs(blockId: string, path: ReadonlyArray<string | number>, inline: number, math = false): Record<string, string> {
  return {
    'data-src-block': blockId,
    'data-src-path': JSON.stringify(path),
    'data-src-inline': String(inline),
    ...(math ? { 'data-src-math': '1' } : {})
  }
}

/** 表格：与导出一致——细实线边框、固定列宽、居中；单元格内容垂直居中，不首行缩进 */
function TableView({ table, assetUrls, onEditMath }: { table: DocTable; assetUrls: ReadonlyMap<string, string>; onEditMath: ((run: MathRun) => void) | undefined }) {
  const total = table.colWidthsTwip.reduce((a, b) => a + b, 0)
  return (
    <span className="doc-table-wrap">
      <table className="doc-table" style={{ width: `${twipToPt(total)}pt` }}>
        <colgroup>
          {table.colWidthsTwip.map((w, i) => (
            <col key={i} style={{ width: `${twipToPt(w)}pt` }} />
          ))}
        </colgroup>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.cells.map((c, j) => (
                <td
                  key={j}
                  {...(c.colSpan !== undefined ? { colSpan: c.colSpan } : {})}
                  {...(c.rowSpan !== undefined ? { rowSpan: c.rowSpan } : {})}
                  style={c.shading !== undefined ? { background: `#${c.shading}` } : undefined}
                >
                  {c.paragraphs.map((cp, k) => (
                    <div key={k} className="doc-table-para" style={cp.align !== undefined ? { textAlign: cp.align } : undefined}>
                      {cp.runs.length > 0 ? renderRuns(cp.runs, assetUrls, onEditMath) : '\u00a0'}
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  )
}
