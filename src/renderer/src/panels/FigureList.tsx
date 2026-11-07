/**
 * 题图管理：添加、删除、调整位置（题干下方 / 右侧环绕）与宽度。
 */
import { useRef, useState } from 'react'
import { createAsset } from '@core/project-file/codec'
import type { Asset, QuestionFigure } from '@core/model/types'

interface Props {
  figures: QuestionFigure[]
  assetUrls: ReadonlyMap<string, string>
  onChange: (figures: QuestionFigure[]) => void
  onAddAsset: (asset: Asset) => void
}

const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const EMU_PER_CM = 360000
/** 新加图片的默认宽度：5 厘米 */
const DEFAULT_WIDTH_CM = 5

export function FigureList({ figures, assetUrls, onChange, onAddAsset }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, patch: Partial<QuestionFigure>): void =>
    onChange(figures.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  const setWidthCm = (i: number, cm: number): void => {
    const f = figures[i]!
    const widthEmu = Math.round(cm * EMU_PER_CM)
    update(i, { widthEmu, heightEmu: Math.round((f.heightEmu * widthEmu) / f.widthEmu) })
  }

  const add = async (file: File): Promise<void> => {
    setError(null)
    if (!ACCEPTED.includes(file.type)) {
      setError('请选择 PNG、JPG、GIF 或 WebP 格式的图片。')
      return
    }
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const bitmap = await createImageBitmap(new Blob([data], { type: file.type }))
      const ratio = bitmap.height / bitmap.width
      bitmap.close()
      const asset = await createAsset(data, file.type)
      onAddAsset(asset)
      const widthEmu = DEFAULT_WIDTH_CM * EMU_PER_CM
      onChange([...figures, { assetId: asset.id, widthEmu, heightEmu: Math.round(widthEmu * ratio), placement: 'right' }])
    } catch {
      setError('无法读取这张图片，文件可能已损坏。')
    }
  }

  return (
    <fieldset className="group">
      <legend>题图</legend>
      {figures.length === 0 && <p className="field-hint">没有题图。</p>}
      {figures.map((f, i) => (
        <div key={`${f.assetId}-${i}`} className="figure-row">
          <div className="figure-thumb">
            <img src={assetUrls.get(f.assetId)} alt={`题图 ${i + 1}`} />
          </div>
          <div className="figure-controls">
            <div className="segmented" role="radiogroup" aria-label={`题图 ${i + 1} 的位置`}>
              {(
                [
                  ['below', '题干下方'],
                  ['right', '右侧环绕']
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={f.placement === v}
                  className={f.placement === v ? 'is-active' : ''}
                  onClick={() => update(i, { placement: v })}
                >
                  {label}
                </button>
              ))}
            </div>
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
              <button type="button" className="link danger" onClick={() => onChange(figures.filter((_, j) => j !== i))}>
                删除
              </button>
            </div>
          </div>
        </div>
      ))}
      {figures.filter((f) => f.placement === 'right').length > 1 && (
        <p className="field-hint">右侧环绕只能放一张图，其余的会排在题干下方。</p>
      )}
      <div className="group-actions">
        <button type="button" onClick={() => inputRef.current?.click()}>
          添加题图…
        </button>
      </div>
      {error !== null && <p className="field-error">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file !== undefined) void add(file)
        }}
      />
    </fieldset>
  )
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const out = arr.slice()
  ;[out[a], out[b]] = [out[b]!, out[a]!]
  return out
}
