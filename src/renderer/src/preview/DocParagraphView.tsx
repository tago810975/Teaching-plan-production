/**
 * 单个段落的预览渲染。只依据 DocIR 与 STYLE_SPECS，不包含任何排版规则。
 */
import { memo, type CSSProperties, type ReactNode } from 'react'
import type { DocParagraph, DocRun } from '@core/document/ir'
import { previewCss, STYLE_SPECS } from '@core/document/styles'
import { emuToPt, twipToPt } from '@core/document/units'
import { MathView } from './MathView'

interface Props {
  paragraph: DocParagraph
  assetUrls: ReadonlyMap<string, string>
  selected: boolean
  onSelect?: (blockId: string) => void
}

export const DocParagraphView = memo(function DocParagraphView({
  paragraph: p,
  assetUrls,
  selected,
  onSelect
}: Props) {
  const spec = STYLE_SPECS[p.style]
  const css = previewCss(spec)
  // Word 中相邻段落的段后、段前间距是相加的，CSS 的 margin 会合并，所以改用 padding
  const style: CSSProperties = {
    fontSize: css.fontSize,
    fontWeight: css.fontWeight,
    color: css.color,
    textAlign: css.textAlign,
    lineHeight: css.lineHeight,
    paddingTop: css.marginTop,
    paddingBottom: css.marginBottom,
    paddingLeft: css.paddingLeft,
    textIndent: css.textIndent
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

  const floating =
    p.floatingImage === undefined ? null : (
      <img
        className="para-float"
        src={assetUrls.get(p.floatingImage.assetId)}
        alt=""
        style={{
          width: `${emuToPt(p.floatingImage.widthEmu)}pt`,
          height: `${emuToPt(p.floatingImage.heightEmu)}pt`
        }}
      />
    )

  const className = [
    'para',
    `para--${p.style}`,
    p.style === 'title' || p.style === 'section' ? 'font-hei' : 'font-song',
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
      onClick={onSelect === undefined ? undefined : () => onSelect(p.sourceBlockId)}
    >
      {floating}
      {label}
      {p.tabStopsTwip === undefined ? (
        renderRuns(p.runs, assetUrls)
      ) : (
        <TabbedRuns runs={p.runs} stops={p.tabStopsTwip} indentTwip={spec.indentLeftTwip} assetUrls={assetUrls} />
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
            className="tab-cell"
            style={width === undefined ? { flex: 1 } : { width: `${twipToPt(width)}pt` }}
          >
            {renderRuns(seg, props.assetUrls)}
          </span>
        )
      })}
    </span>
  )
}

function renderRuns(runs: DocRun[], assetUrls: ReadonlyMap<string, string>): ReactNode[] {
  return runs.map((run, i) => {
    switch (run.kind) {
      case 'text': {
        const m = run.marks
        if (m === undefined) return run.text
        const style: CSSProperties = {
          fontWeight: m.bold === true ? 700 : undefined,
          fontStyle: m.italic === true ? 'italic' : undefined,
          textDecoration: m.underline === true ? 'underline' : undefined,
          color: m.color !== undefined ? `#${m.color}` : undefined
        }
        const Tag = m.script === 'sup' ? 'sup' : m.script === 'sub' ? 'sub' : 'span'
        return (
          <Tag key={i} style={style}>
            {run.text}
          </Tag>
        )
      }
      case 'math':
        return <MathView key={i} latex={run.latex} omml={run.omml} display={run.display} />
      case 'image':
        return (
          <img
            key={i}
            className="run-image"
            src={assetUrls.get(run.assetId)}
            alt=""
            style={{ width: `${emuToPt(run.widthEmu)}pt`, height: `${emuToPt(run.heightEmu)}pt` }}
          />
        )
      case 'blank':
        return <span key={i} className="run-blank" style={{ width: `${run.widthChars}em` }} />
      case 'tab':
        return <span key={i} className="run-tab" />
    }
  })
}
