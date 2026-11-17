/**
 * 手动调色：亮度、对比度、饱和度（灰度，拖到最左为黑白），可先“一键加深”。
 * 拖动滑块时在缩小的图上实时预览；应用时按原尺寸处理（后台线程），换成新图片（一步撤销）。
 */
import { useEffect, useRef, useState } from 'react'
import { adjustPixels, autoLevels, NO_ADJUST, type Adjust } from '@core/image/adjust'
import type { Asset } from '@core/model/types'
import { createAsset } from '@core/project-file/codec'
import { enhance, toPng, type Rgba } from '../import/enhance-client'
import { pixelsOfAsset } from './figure-actions'

interface Props {
  asset: Asset
  /** 这张图的说明，如“第 3 题 题图 1” */
  label: string
  onApply: (asset: Asset) => void
  onClose: () => void
}

const PREVIEW_MAX = 640

const SLIDERS: Array<{ key: keyof Adjust; name: string; min: number; max: number; hint: string }> = [
  { key: 'brightness', name: '亮度', min: -100, max: 100, hint: '往右变亮，往左变暗' },
  { key: 'contrast', name: '对比度', min: -100, max: 100, hint: '往右深浅差别更大（线条更黑、底色更白）' },
  { key: 'saturation', name: '饱和度', min: 0, max: 200, hint: '往左颜色变淡，拖到最左为黑白（灰度）；往右颜色更浓' }
]

export function FigureAdjustDialog({ asset, label, onApply, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [base, setBase] = useState<Rgba | null>(null)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST)
  const [levels, setLevels] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
    const url = URL.createObjectURL(new Blob([asset.data as Uint8Array<ArrayBuffer>], { type: asset.mime }))
    setOriginalUrl(url)
    void pixelsOfAsset(asset, PREVIEW_MAX).then(setBase, () => setError('无法读取这张图片。'))
    return () => URL.revokeObjectURL(url)
  }, [asset])

  // 实时预览（缩小的图，主线程计算；下一帧再画，拖动时不卡）
  useEffect(() => {
    if (base === null) return
    const id = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (canvas === null) return
      const px = adjustPixels(levels ? autoLevels(base) : base, adjust)
      canvas.width = px.width
      canvas.height = px.height
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0)
    })
    return () => cancelAnimationFrame(id)
  }, [base, adjust, levels])

  const changed = levels || adjust.brightness !== 0 || adjust.contrast !== 0 || adjust.saturation !== 100

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const px = await enhance(await pixelsOfAsset(asset), 'none', { autoLevels: levels, adjust })
      onApply(await createAsset(await toPng(px), 'image/png'))
    } catch {
      setError('处理失败，图片可能已损坏。')
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog figure-adjust"
      aria-labelledby="figure-adjust-title"
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        onClose()
      }}
    >
      <h2 id="figure-adjust-title">手动调色：{label}</h2>
      <div className="figure-adjust-compare">
        <figure>
          <figcaption>原图</figcaption>
          {originalUrl !== null && <img src={originalUrl} alt="" />}
        </figure>
        <figure>
          <figcaption>调整后</figcaption>
          <canvas ref={canvasRef} aria-label="调整后的预览" />
        </figure>
      </div>
      <div className="figure-adjust-controls">
        <label className="checkbox" title="最深的线条拉到接近黑、纸张拉到白（扫描件发灰时）；在此基础上再用下面的滑块微调">
          <input type="checkbox" checked={levels} onChange={(e) => setLevels(e.target.checked)} />
          先一键加深
        </label>
        {SLIDERS.map((s) => (
          <label key={s.key} className="figure-adjust-slider" title={`${s.hint}；双击恢复`}>
            <span className="figure-adjust-name">{s.name}</span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={1}
              value={adjust[s.key]}
              onChange={(e) => setAdjust((a) => ({ ...a, [s.key]: Number(e.target.value) }))}
              onDoubleClick={() => setAdjust((a) => ({ ...a, [s.key]: NO_ADJUST[s.key] }))}
            />
            <span className="figure-adjust-value">{s.key === 'saturation' ? `${adjust[s.key]}%` : adjust[s.key] > 0 ? `+${adjust[s.key]}` : adjust[s.key]}</span>
          </label>
        ))}
        <p className="field-hint">饱和度拖到最左即为黑白（灰度）。双击滑块恢复。</p>
      </div>
      {error !== null && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button
          type="button"
          disabled={!changed || busy}
          onClick={() => {
            setAdjust(NO_ADJUST)
            setLevels(false)
          }}
        >
          还原
        </button>
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button type="button" className="primary" disabled={!changed || busy || base === null} onClick={() => void apply()}>
          {busy ? '正在处理…' : '应用'}
        </button>
      </div>
    </dialog>
  )
}
