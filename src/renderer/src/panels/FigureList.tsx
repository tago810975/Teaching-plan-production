/**
 * 题图管理：添加、删除、调整位置（题干下方 / 右侧环绕）与宽度。
 */
import { useContext, useEffect, useRef, useState } from 'react'
import type { Asset, FigurePlacement, QuestionFigure, RichText } from '@core/model/types'
import { EMU_PER_CM, excerpt, KNOWLEDGE_PLACEMENTS, needsParagraph, placementPatch, QUESTION_PLACEMENTS, swap, toCm } from './figure-options'
import { assetMime } from '../preview/assets'
import { ImageImportDialog, type AddedFigure } from '../import/ImageImportDialog'
import { FigureActionsContext } from '../figures/figure-actions'
import type { EnhanceOptions } from '@core/image/enhance'
import { FieldFocusContext } from './fieldFocus'
import type { FigureListName, FigureRef } from '@core/document/ir'

interface Props {
  /** 所在内容（题目、知识点、综合题）的 ID：用于定位、变清晰、WorkBuddy 重绘 */
  blockId?: string
  /** 答案 / 解析插图 */
  list?: FigureListName
  /** 分组标题，默认“题图” */
  title?: string
  /** 题目与知识点可选的位置不同 */
  kind: 'question' | 'knowledge'
  /** 可锚定的段落（题干或知识点正文），用于“第 N 段”选择 */
  paragraphs: RichText
  /** 小问数量，用于“第 N 小问下方” */
  subQuestionCount?: number
  figures: QuestionFigure[]
  assetUrls: ReadonlyMap<string, string>
  onChange: (figures: QuestionFigure[]) => void
  onAddAsset: (asset: Asset) => void
}

export function FigureList({
  blockId,
  list,
  title = '题图',
  kind,
  paragraphs,
  subQuestionCount = 0,
  figures,
  assetUrls,
  onChange,
  onAddAsset
}: Props) {
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, patch: Partial<QuestionFigure>): void =>
    onChange(figures.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  const setWidthCm = (i: number, cm: number): void => {
    const f = figures[i]!
    const widthEmu = Math.round(cm * EMU_PER_CM)
    update(i, { widthEmu, heightEmu: Math.round((f.heightEmu * widthEmu) / f.widthEmu) })
  }

  // 变清晰、WorkBuddy 重绘（与右键快捷栏、“批量处理插图”共用）；矢量图（SVG）本来就清晰，不处理
  const actions = useContext(FigureActionsContext)
  const [sharpening, setSharpening] = useState<number | null>(null)
  const refOf = (i: number): FigureRef => ({ blockId: blockId ?? '', figureIndex: i, ...(list !== undefined ? { list } : {}) })
  const sharpen = async (i: number, mode: 'normal' | 'none' = 'normal', options: EnhanceOptions = {}): Promise<void> => {
    if (actions === null || blockId === undefined) return
    setError(null)
    setSharpening(i)
    try {
      const r = await actions.sharpen([refOf(i)], mode, options)
      if (r.done === 0) setError('这是矢量图，本来就清晰，不需要处理。')
    } catch {
      setError('处理失败，图片可能已损坏。')
    } finally {
      setSharpening(null)
    }
  }

  // 预览中点了这张图：滚动到它的设置并短暂高亮
  const focus = useContext(FieldFocusContext)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const handled = useRef(0)
  useEffect(() => {
    if (focus === null || blockId === undefined || focus.blockId !== blockId || focus.nonce === handled.current) return
    const m = /^figure:(\w+):(\d+)$/.exec(focus.field)
    if (m === null || m[1] !== (list ?? 'figures')) return
    handled.current = focus.nonce
    const row = rowRefs.current[Number(m[2])]
    if (row === null || row === undefined) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.remove('is-located')
    void row.offsetWidth
    row.classList.add('is-located')
  }, [focus, blockId, list])

  // 添加插图：与“从图片导入”同一个窗口（选择、粘贴截图或拖入，自动框选，变清晰、去白底、一键加深）
  const [adding, setAdding] = useState(false)
  const addFigures = (added: AddedFigure[]): void => {
    for (const a of added) onAddAsset(a.asset)
    // 一张时沿用原来的默认位置（右侧环绕）；多张时放在下方（每个段落右侧只能环绕一张）
    const placement = added.length === 1 ? 'right' : 'below'
    onChange([...figures, ...added.map((a) => ({ assetId: a.asset.id, widthEmu: a.widthEmu, heightEmu: a.heightEmu, placement }) as const)])
    setAdding(false)
  }

  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {figures.length === 0 && <p className="field-hint">没有{title}。</p>}
      {figures.map((f, i) => (
        <div
          key={`${f.assetId}-${i}`}
          className="figure-row"
          ref={(el) => {
            rowRefs.current[i] = el
          }}
        >
          <div className="figure-thumb">
            <img src={assetUrls.get(f.assetId)} alt={`${title} ${i + 1}`} />
          </div>
          <div className="figure-controls">
            <select
              className="figure-placement"
              aria-label={`${title} ${i + 1} 的位置`}
              value={f.placement}
              onChange={(e) => update(i, placementPatch(f, e.target.value as FigurePlacement))}
            >
              {(kind === 'question' ? QUESTION_PLACEMENTS : KNOWLEDGE_PLACEMENTS)
                .filter(([v]) => v !== 'below-item' || subQuestionCount > 0 || f.placement === 'below-item')
                .map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
            </select>
            {needsParagraph(kind, f.placement) && paragraphs.length > 1 && (
              <select
                className="figure-anchor"
                aria-label={`${title} ${i + 1} 所在段落`}
                value={Math.min(f.anchorParagraph ?? (kind === 'knowledge' && f.placement === 'below' ? paragraphs.length - 1 : 0), paragraphs.length - 1)}
                onChange={(e) => update(i, { anchorParagraph: Number(e.target.value) })}
              >
                {paragraphs.map((p, j) => (
                  <option key={j} value={j}>
                    第 {j + 1} 段：{excerpt(p)}
                  </option>
                ))}
              </select>
            )}
            {f.placement === 'below-item' && subQuestionCount > 0 && (
              <select
                className="figure-anchor"
                aria-label={`${title} ${i + 1} 所在小问`}
                value={Math.min(f.anchorItem ?? 0, subQuestionCount - 1)}
                onChange={(e) => update(i, { anchorItem: Number(e.target.value) })}
              >
                {Array.from({ length: subQuestionCount }, (_, j) => (
                  <option key={j} value={j}>
                    第 ({j + 1}) 小问下方
                  </option>
                ))}
              </select>
            )}
            {(f.placement === 'right' || f.placement === 'right-items' || f.placement === 'free') && (
              <div className="figure-offsets">
                <label>
                  距段落顶端
                  <input
                    type="number"
                    min={0}
                    max={25}
                    step={0.1}
                    value={toCm(f.offsetYEmu ?? 0)}
                    onChange={(e) => {
                      const cm = Number(e.target.value)
                      if (Number.isFinite(cm) && cm >= 0) update(i, { offsetYEmu: Math.round(cm * EMU_PER_CM) })
                    }}
                  />
                  厘米
                </label>
                {f.placement === 'free' && (
                  <label>
                    距栏左侧
                    <input
                      type="number"
                      min={0}
                      max={18}
                      step={0.1}
                      value={toCm(f.offsetXEmu ?? 0)}
                      onChange={(e) => {
                        const cm = Number(e.target.value)
                        if (Number.isFinite(cm) && cm >= 0) update(i, { offsetXEmu: Math.round(cm * EMU_PER_CM) })
                      }}
                    />
                    厘米
                  </label>
                )}
              </div>
            )}
            {(f.placement === 'right' || f.placement === 'right-items' || f.placement === 'free') && (
              <p className="field-hint figure-free-hint">
                {f.placement === 'free' ? '文字会绕开图片。选中内容后，在预览中按住图片拖动摆放。' : '选中内容后，在预览中按住图片上下拖动。'}
              </p>
            )}
            <label className="figure-width">
              宽度
              <input
                type="number"
                min={1}
                max={18}
                step={0.1}
                value={Math.round((f.widthEmu / EMU_PER_CM) * 10) / 10}
                onChange={(e) => {
                  const cm = Number(e.target.value)
                  if (Number.isFinite(cm) && cm >= 0.5 && cm <= 18) setWidthCm(i, cm)
                }}
              />
              厘米
            </label>
            <div className="figure-actions">
              <button type="button" className="link" disabled={i === 0} onClick={() => onChange(swap(figures, i, i - 1))}>
                上移
              </button>
              <button
                type="button"
                className="link"
                disabled={i === figures.length - 1}
                onClick={() => onChange(swap(figures, i, i + 1))}
              >
                下移
              </button>
              <button
                type="button"
                className="link"
                disabled={sharpening !== null || actions === null || blockId === undefined}
                onClick={() => void sharpen(i)}
                title="去掉灰底与杂点、放大 3 倍（不改变内容），打印更清楚；可撤销"
              >
                {sharpening === i ? '处理中…' : '变清晰'}
              </button>
              <button
                type="button"
                className="link"
                disabled={sharpening !== null || actions === null || blockId === undefined}
                onClick={() => void sharpen(i, 'none', { transparent: true })}
                title="白色底色变为透明（放在任何底色上都没有白边）；可撤销"
              >
                去白底
              </button>
              <button
                type="button"
                className="link"
                disabled={sharpening !== null || actions === null || blockId === undefined}
                onClick={() => void sharpen(i, 'none', { autoLevels: true })}
                title="扫描件发灰时：最深的线条拉到接近黑、纸张拉到白；可撤销"
              >
                一键加深
              </button>
              <button
                type="button"
                className="link"
                disabled={actions === null || blockId === undefined || (assetMime(f.assetId) ?? '').includes('svg')}
                onClick={() => actions?.openAdjust(refOf(i))}
                title="手动调整亮度、对比度、灰度"
              >
                调整…
              </button>
              <button
                type="button"
                className="link"
                disabled={actions === null || blockId === undefined || (assetMime(f.assetId) ?? '').includes('svg')}
                onClick={() => actions?.openBatch({ refs: [refOf(i)], redraw: true })}
                title="交给 WorkBuddy 重绘为 SVG；收到后与原图对照，选用哪一个"
              >
                WorkBuddy 重绘
              </button>
              <button type="button" className="link danger" onClick={() => onChange(figures.filter((_, j) => j !== i))}>
                删除
              </button>
            </div>
          </div>
        </div>
      ))}
      {figures.filter((f) => f.placement === 'right').length > 1 && (
        <p className="field-hint">每个段落右侧只能环绕一张图，多出的会排在下方。</p>
      )}
      <div className="group-actions">
        <button type="button" onClick={() => setAdding(true)} title="选择图片、粘贴截图或拖入；可框选其中的一部分，并变清晰、去白底、一键加深">
          添加{title}…
        </button>
      </div>
      {error !== null && <p className="field-error">{error}</p>}
      {adding && <ImageImportDialog kind="figures" figureTitle={title} presetId={undefined} onCancel={() => setAdding(false)} onAddFigures={addFigures} />}
    </fieldset>
  )
}
