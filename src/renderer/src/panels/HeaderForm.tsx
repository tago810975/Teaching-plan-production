/**
 * 页眉设置：Logo、左侧文字、电话（含图标）、右侧文字、水印。
 * 图片随工程文件保存，换电脑打开时页眉保持不变。
 */
import { useRef, useState, type Dispatch } from 'react'
import { createAsset } from '@core/project-file/codec'
import type { HeaderImage, PageHeader } from '@core/model/types'
import type { EditorAction, HeaderImageSlot } from '../state/store'

interface Props {
  header: PageHeader
  assetUrls: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
}

/** 更换图片时保持的尺寸基准：Logo 与电话图标保持高度，水印保持宽度 */
const SLOT_RULES: Record<HeaderImageSlot, { keep: 'height' | 'width'; fallbackEmu: number }> = {
  logo: { keep: 'height', fallbackEmu: 304800 },
  phoneIcon: { keep: 'height', fallbackEmu: 111125 },
  watermark: { keep: 'width', fallbackEmu: 6352540 }
}

const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export function HeaderForm({ header, assetUrls, dispatch }: Props) {
  const setText = (patch: Partial<Pick<PageHeader, 'left' | 'phone' | 'right'>>): void =>
    dispatch({ type: 'update-header', patch })

  return (
    <>
      <ImageField label="机构 Logo" slot="logo" header={header} assetUrls={assetUrls} dispatch={dispatch} />
      <div className="field">
        <label className="field-label" htmlFor="header-left">
          左侧文字
        </label>
        <input id="header-left" type="text" value={header.left} onChange={(e) => setText({ left: e.target.value })} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="header-phone">
          电话
        </label>
        <input
          id="header-phone"
          type="text"
          value={header.phone}
          onChange={(e) => setText({ phone: e.target.value })}
        />
        <p className="field-hint">显示在页眉正中，留空则不显示电话和图标</p>
      </div>
      <ImageField label="电话图标" slot="phoneIcon" header={header} assetUrls={assetUrls} dispatch={dispatch} compact />
      <div className="field">
        <label className="field-label" htmlFor="header-right">
          右侧文字
        </label>
        <input id="header-right" type="text" value={header.right} onChange={(e) => setText({ right: e.target.value })} />
        <p className="field-hint">导出时自动在后面加上“(教案)”或“(学案)”</p>
      </div>
      <ImageField label="水印" slot="watermark" header={header} assetUrls={assetUrls} dispatch={dispatch} />
    </>
  )
}

function ImageField(props: {
  label: string
  slot: HeaderImageSlot
  header: PageHeader
  assetUrls: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
  compact?: boolean
}) {
  const { label, slot, header, assetUrls, dispatch } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const image = header[slot]

  const replace = async (file: File): Promise<void> => {
    setError(null)
    if (!ACCEPTED.includes(file.type)) {
      setError('请选择 PNG、JPG、GIF 或 WebP 格式的图片。')
      return
    }
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const bitmap = await createImageBitmap(new Blob([data], { type: file.type }))
      const ratio = bitmap.width / bitmap.height
      bitmap.close()
      const asset = await createAsset(data, file.type)
      dispatch({ type: 'update-header', image: { slot, value: sizedLike(image, slot, ratio, asset.id), asset } })
    } catch {
      setError('无法读取这张图片，文件可能已损坏。')
    }
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className={`image-field${props.compact === true ? ' image-field--compact' : ''}`}>
        <div className="image-field-preview">
          {image === undefined ? (
            <span className="image-field-empty">未设置</span>
          ) : (
            <img src={assetUrls.get(image.assetId)} alt={label} />
          )}
        </div>
        <div className="image-field-actions">
          <button type="button" onClick={() => inputRef.current?.click()}>
            {image === undefined ? '选择图片…' : '更换…'}
          </button>
          {image !== undefined && (
            <button
              type="button"
              className="danger"
              onClick={() => dispatch({ type: 'update-header', image: { slot, value: null } })}
            >
              移除
            </button>
          )}
        </div>
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
          if (file !== undefined) void replace(file)
        }}
      />
    </div>
  )
}

/** 按图片比例计算新尺寸：沿用原图的高度（或宽度），没有原图时用默认值 */
function sizedLike(old: HeaderImage | undefined, slot: HeaderImageSlot, ratio: number, assetId: string): HeaderImage {
  const rule = SLOT_RULES[slot]
  if (rule.keep === 'height') {
    const heightEmu = old?.heightEmu ?? rule.fallbackEmu
    return { assetId, heightEmu, widthEmu: Math.round(heightEmu * ratio) }
  }
  const widthEmu = old?.widthEmu ?? rule.fallbackEmu
  return { assetId, widthEmu, heightEmu: Math.round(widthEmu / ratio) }
}
