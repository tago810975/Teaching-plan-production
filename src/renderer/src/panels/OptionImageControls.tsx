/**
 * 选项是图片的选择题：调整选项图片的大小。
 *
 * - 单张：每张图的宽度（等比例）；
 * - 全部一起缩放：按同一比例放大或缩小，彼此的大小关系不变；
 * - 统一大小：以某个选项的图为准，其余等比例缩放到恰好放进它的宽、高之内。
 * 预览中也可拖动图片右下角缩放；“拖动时全部一起缩放”决定默认行为，按住 Shift 临时反过来。
 */
import { useState } from 'react'
import { optionImages, resizeOptionImage, scaleOptionImages, unifyOptionImages } from '@core/model/option-images'
import type { Question } from '@core/model/types'

interface Props {
  question: Question
  assetUrls: ReadonlyMap<string, string>
  onUpdate: (fn: (q: Question) => Question) => void
  /** 预览中拖动一张时是否全部一起缩放 */
  linked: boolean
  onLinkedChange: (value: boolean) => void
}

const EMU_PER_CM = 360000
/** 整体缩放每次的步长 */
const STEP = 0.1

const cm = (emu: number): number => Math.round((emu / EMU_PER_CM) * 100) / 100

export function OptionImageControls({ question, assetUrls, onUpdate, linked, onLinkedChange }: Props) {
  const images = optionImages(question)
  const [reference, setReference] = useState(0)
  if (images.length === 0) return null
  const ref = images[Math.min(reference, images.length - 1)]!
  /** 同一选项里有多张图时，在字母后加序号区分 */
  const name = (i: number): string => {
    const x = images[i]!
    const label = question.options[x.option]?.label ?? '?'
    const sameOption = images.filter((y) => y.option === x.option)
    return sameOption.length > 1 ? `${label}${sameOption.indexOf(x) + 1}` : label
  }

  return (
    <fieldset className="group option-images">
      <legend>选项图片</legend>
      {images.map((x, i) => (
        <div key={`${x.option}-${x.inline}`} className="option-image-row">
          <span className="option-label">{name(i)}</span>
          <div className="option-image-thumb">
            <img src={assetUrls.get(x.image.assetId)} alt={`选项 ${name(i)} 的图片`} />
          </div>
          <label className="option-image-size">
            宽
            <input
              type="number"
              min={0.5}
              max={18}
              step={0.1}
              aria-label={`选项 ${name(i)} 图片的宽度（厘米）`}
              value={cm(x.image.widthEmu)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v >= 0.5 && v <= 18) {
                  onUpdate((q) => resizeOptionImage(q, { option: x.option, inline: x.inline }, Math.round(v * EMU_PER_CM)))
                }
              }}
            />
            <span className="option-image-height">× {cm(x.image.heightEmu)} 厘米</span>
          </label>
        </div>
      ))}

      <div className="option-image-tools">
        <span className="option-image-tools-label">全部一起</span>
        <button type="button" onClick={() => onUpdate((q) => scaleOptionImages(q, 1 - STEP))}>
          缩小 10%
        </button>
        <button type="button" onClick={() => onUpdate((q) => scaleOptionImages(q, 1 + STEP))}>
          放大 10%
        </button>
      </div>

      {images.length > 1 && (
        <div className="option-image-tools">
          <span className="option-image-tools-label">统一大小</span>
          <select
            aria-label="统一大小的基准"
            value={Math.min(reference, images.length - 1)}
            onChange={(e) => setReference(Number(e.target.value))}
          >
            {images.map((_, i) => (
              <option key={i} value={i}>
                以 {name(i)} 为准
              </option>
            ))}
          </select>
          <button type="button" onClick={() => onUpdate((q) => unifyOptionImages(q, { option: ref.option, inline: ref.inline }))}>
            统一
          </button>
        </div>
      )}

      <label className="checkbox">
        <input type="checkbox" checked={linked} onChange={(e) => onLinkedChange(e.target.checked)} />
        在预览中拖动时，全部选项图片一起缩放
      </label>
      <p className="field-hint">
        选中本题后，在预览中拖动选项图片的右下角即可缩放；按住 Shift 拖动，可在“只缩放这一张”与“全部一起缩放”之间临时切换。
        统一大小时每张图保持自身宽高比，不会被拉变形。
      </p>
    </fieldset>
  )
}
