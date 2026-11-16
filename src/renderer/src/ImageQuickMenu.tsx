/**
 * 图片的快捷窗口：在预览中右键题图 / 插图、或选项中的图片时弹出（不会弹出题目的快捷窗口）。
 *
 * - 题图 / 插图：位置（同属性面板）、所在段落或小问、宽度（等比例）、调整顺序、删除；
 * - 选项图片：这张的宽度、全部一起缩小 / 放大、以这张为准统一大小。
 * 修改都可撤销。
 */
import { useState, type Dispatch } from 'react'
import type { FigureListName, OptionImageRef } from '@core/document/ir'
import { figuresOf, withFigures } from '@core/model/figure-lists'
import { optionImages, resizeOptionImage, scaleOptionImages, unifyOptionImages } from '@core/model/option-images'
import type { Block, Question, QuestionFigure } from '@core/model/types'
import { QuickPopover, Row } from './BlockQuickMenu'
import { EMU_PER_CM, excerpt, KNOWLEDGE_PLACEMENTS, needsParagraph, placementPatch, QUESTION_PLACEMENTS, swap, toCm, widthPatch } from './panels/figure-options'
import type { EditorAction } from './state/store'

export function FigureQuickMenu(props: {
  block: Block
  figureIndex: number
  /** 答案 / 解析中的插图 */
  list?: FigureListName
  x: number
  y: number
  dispatch: Dispatch<EditorAction>
  onClose: () => void
  /** 调整顺序后，窗口跟着这张图 */
  onIndexChange: (index: number) => void
}) {
  const { block, figureIndex, list, x, y, dispatch, onClose, onIndexChange } = props
  const figures = figuresOf(block, list)
  const f = figures[figureIndex]
  if (f === undefined) return null
  // 答案、解析插图与知识点插图的位置选项相同（某段之后 / 某段右侧 / 自由位置）
  const kind = block.type === 'question' && list === undefined ? 'question' : 'knowledge'
  const paragraphs =
    block.type === 'question'
      ? list === 'answer' ? block.question.answer : list === 'analysis' ? block.question.analysis : block.question.stem
      : block.type === 'knowledge' ? block.content : block.type === 'composite' ? block.background : []
  const subCount = block.type === 'question' ? block.question.subQuestions.length : 0
  const name = list === 'answer' ? '答案插图' : list === 'analysis' ? '解析插图' : block.type === 'question' ? '题图' : block.type === 'composite' ? '背景配图' : '插图'

  const setFigures = (fn: (figs: QuestionFigure[]) => QuestionFigure[]): void =>
    dispatch({ type: 'update-block', blockId: block.id, update: (b) => withFigures(b, list, fn) })
  const patch = (p: Partial<QuestionFigure>): void => setFigures((figs) => figs.map((g, i) => (i === figureIndex ? { ...g, ...p } : g)))
  const move = (delta: number): void => {
    const to = figureIndex + delta
    if (to < 0 || to >= figures.length) return
    setFigures((figs) => swap(figs, figureIndex, to))
    onIndexChange(to)
  }

  return (
    <QuickPopover x={x} y={y} title={`${name} ${figureIndex + 1}${figures.length > 1 ? `（共 ${figures.length} 张）` : ''}`} label="图片快捷设置" onClose={onClose}>
      <Row label="位置">
        <select
          aria-label="图片位置"
          value={f.placement}
          onChange={(e) => patch(placementPatch(f, e.target.value as QuestionFigure['placement']))}
        >
          {(kind === 'question' ? QUESTION_PLACEMENTS : KNOWLEDGE_PLACEMENTS)
            .filter(([v]) => v !== 'below-item' || subCount > 0 || f.placement === 'below-item')
            .map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
        </select>
      </Row>
      {needsParagraph(kind, f.placement) && paragraphs.length > 1 && (
        <Row label="段落">
          <select
            aria-label="图片所在段落"
            value={Math.min(f.anchorParagraph ?? (kind === 'knowledge' && f.placement === 'below' ? paragraphs.length - 1 : 0), paragraphs.length - 1)}
            onChange={(e) => patch({ anchorParagraph: Number(e.target.value) })}
          >
            {paragraphs.map((p, j) => (
              <option key={j} value={j}>
                第 {j + 1} 段：{excerpt(p)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {f.placement === 'below-item' && subCount > 0 && (
        <Row label="小问">
          <select aria-label="图片所在小问" value={Math.min(f.anchorItem ?? 0, subCount - 1)} onChange={(e) => patch({ anchorItem: Number(e.target.value) })}>
            {Array.from({ length: subCount }, (_, j) => (
              <option key={j} value={j}>
                第 ({j + 1}) 小问下方
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="宽度">
        <CmStepper label="图片宽度" value={toCm(f.widthEmu)} min={1} max={18} onChange={(cm) => patch(widthPatch(f, cm))} />
      </Row>
      <div className="quick-menu-actions">
        <button type="button" disabled={figureIndex === 0} onClick={() => move(-1)} title="与前一张图交换顺序">
          ↑ 前移
        </button>
        <button type="button" disabled={figureIndex === figures.length - 1} onClick={() => move(1)} title="与后一张图交换顺序">
          ↓ 后移
        </button>
        <button
          type="button"
          className="danger"
          title="删除后可用 Ctrl+Z 撤销"
          onClick={() => {
            setFigures((figs) => figs.filter((_, i) => i !== figureIndex))
            onClose()
          }}
        >
          删除图片
        </button>
      </div>
    </QuickPopover>
  )
}

export function OptionImageQuickMenu(props: { block: Block; optionRef: OptionImageRef; x: number; y: number; dispatch: Dispatch<EditorAction>; onClose: () => void }) {
  const { block, optionRef, x, y, dispatch, onClose } = props
  if (block.type !== 'question') return null
  const q = block.question
  const image = q.options[optionRef.option]?.content.inlines[optionRef.inline]
  if (image?.type !== 'image') return null
  const label = q.options[optionRef.option]?.label ?? ''
  const count = optionImages(q).length
  const at = { option: optionRef.option, inline: optionRef.inline }
  const update = (fn: (q: Question) => Question): void =>
    dispatch({ type: 'update-block', blockId: block.id, update: (b) => (b.type === 'question' ? { ...b, question: fn(b.question) } : b) })
  return (
    <QuickPopover x={x} y={y} title={`选项 ${label} 的图片`} label="图片快捷设置" onClose={onClose}>
      <Row label="宽度">
        <CmStepper label="这张图片的宽度" value={toCm(image.widthEmu)} min={0.5} max={18} onChange={(cm) => update((qq) => resizeOptionImage(qq, at, Math.round(cm * EMU_PER_CM)))} />
      </Row>
      {count > 1 && (
        <Row label="全部">
          <span className="quick-menu-inline">
            <button type="button" onClick={() => update((qq) => scaleOptionImages(qq, 0.9))}>
              一起缩小 10%
            </button>
            <button type="button" onClick={() => update((qq) => scaleOptionImages(qq, 1.1))}>
              一起放大 10%
            </button>
            <button type="button" onClick={() => update((qq) => unifyOptionImages(qq, at))} title="其余选项图片等比例缩放到这张的宽、高之内">
              以这张为准统一大小
            </button>
          </span>
        </Row>
      )}
    </QuickPopover>
  )
}

/** 厘米：− / + （每次 0.5 厘米）与输入框；输入过程中的无效数字不生效 */
function CmStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (cm: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const set = (v: number): void => onChange(Math.max(min, Math.min(max, Math.round(v * 10) / 10)))
  return (
    <span className="quick-menu-stepper">
      <button type="button" aria-label={`${label}减少 0.5 厘米`} disabled={value <= min} onClick={() => set(value - 0.5)}>
        −
      </button>
      <input
        type="number"
        step={0.1}
        min={min}
        max={max}
        aria-label={`${label}（厘米）`}
        value={draft ?? value}
        onChange={(e) => {
          setDraft(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(v) && v >= min && v <= max) set(v)
        }}
        onBlur={() => setDraft(null)}
      />
      <button type="button" aria-label={`${label}增加 0.5 厘米`} disabled={value >= max} onClick={() => set(value + 0.5)}>
        +
      </button>
      厘米
    </span>
  )
}
