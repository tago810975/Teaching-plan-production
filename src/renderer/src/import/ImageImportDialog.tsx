/**
 * 从图片导入题目：左边是题目图片（选择、粘贴截图或拖入），在图上拖框即框选插图；
 * 右边是识别结果——把“给 AI 的指令”连同图片交给任意 AI（或由 WorkBuddy 自动送回），把结果粘贴进来，
 * 下方即时显示识别到几道题、有哪些问题。确认后插图裁成 PNG，文字按格式预设识别为题目（core/import/text-import.ts）。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { FORMAT_GUIDE, importText, type TextFigure } from '@core/import/text-import'
import { createAsset } from '@core/project-file/codec'
import type { Asset, Block } from '@core/model/types'
import type { ImportReport } from '@shared/ipc'

interface SourceImage {
  key: string
  name: string
  url: string
  width: number
  height: number
}

/** 框选的插图：在第 image 张图上的矩形（原图像素） */
interface Box {
  n: number
  image: string
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  presetId: string | undefined
  onCancel: () => void
  onImport: (blocks: Block[], assets: Record<string, Asset>, report: ImportReport) => void
}

/** 插图导入后的默认宽度上限（厘米），之后可在属性面板或预览中调整 */
const MAX_FIGURE_CM = 6.5
const EMU_PER_CM = 360000
/** 屏幕截图按 96 dpi 估算尺寸 */
const EMU_PER_PX = 9525

let keySeq = 0

export function ImageImportDialog({ presetId, onCancel, onImport }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [images, setImages] = useState<SourceImage[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])
  // 关闭时回收图片地址
  const urlsRef = useRef<string[]>([])
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const addFiles = async (files: Iterable<File>): Promise<void> => {
    const added: SourceImage[] = []
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      const url = URL.createObjectURL(f)
      urlsRef.current.push(url)
      const size = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve({ w: 0, h: 0 })
        img.src = url
      })
      if (size.w === 0) continue
      added.push({ key: `img${++keySeq}`, name: f.name || '粘贴的图片', url, width: size.w, height: size.h })
    }
    if (added.length === 0) return
    setImages((all) => [...all, ...added])
    setCurrent((c) => c ?? added[0]!.key)
  }

  // Ctrl+V 粘贴截图
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length === 0) return
      e.preventDefault()
      void addFiles(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  // 识别结果即时检查（插图用占位资源，只看编号是否对应）
  const check = useMemo(() => {
    if (text.trim() === '') return null
    const figures = new Map<number, TextFigure>(
      boxes.map((b) => [b.n, { asset: { id: `box-${b.n}`, mime: 'image/png', data: new Uint8Array() }, widthEmu: 1, heightEmu: 1 }])
    )
    try {
      return importText(text, { ...(presetId !== undefined ? { presetId } : {}), figures })
    } catch (e) {
      return { blocks: [], assets: {}, questionCount: 0, issues: [`识别出错：${e instanceof Error ? e.message : String(e)}`] }
    }
  }, [text, boxes, presetId])

  /** 在文字光标处插入一行 [图N] */
  const insertFigureMark = (n: number): void => {
    const el = textRef.current
    const mark = `[图${n}]`
    setText((t) => {
      const pos = el !== null && document.activeElement === el ? el.selectionStart : t.length
      const before = t.slice(0, pos)
      const after = t.slice(pos)
      const lead = before === '' || before.endsWith('\n') ? '' : '\n'
      const trail = after === '' || after.startsWith('\n') ? '' : '\n'
      return `${before}${lead}${mark}${trail}${after}`
    })
  }

  const doImport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // 插图：从原图裁出，按 96 dpi 估算尺寸，宽度不超过 MAX_FIGURE_CM
      const figures = new Map<number, TextFigure>()
      for (const b of boxes) {
        const src = images.find((i) => i.key === b.image)
        if (src === undefined) continue
        const data = await crop(src.url, b)
        const asset = await createAsset(data, 'image/png')
        let widthEmu = b.w * EMU_PER_PX
        let heightEmu = b.h * EMU_PER_PX
        const max = MAX_FIGURE_CM * EMU_PER_CM
        if (widthEmu > max) {
          heightEmu = (heightEmu * max) / widthEmu
          widthEmu = max
        }
        figures.set(b.n, { asset, widthEmu: Math.round(widthEmu), heightEmu: Math.round(heightEmu) })
      }
      const r = importText(text, { ...(presetId !== undefined ? { presetId } : {}), figures })
      if (r.blocks.length === 0) {
        setError('没有可导入的内容。')
        return
      }
      onImport(r.blocks, r.assets, { fileNames: images.map((i) => i.name), questionCount: r.questionCount, warnings: r.issues })
    } catch (e) {
      setError(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const img = images.find((i) => i.key === current) ?? null

  return (
    <dialog
      ref={dialogRef}
      className="dialog image-import"
      aria-labelledby="image-import-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id="image-import-title">从图片导入题目</h2>
      <div className="image-import-body">
        <section
          className="image-import-left"
          aria-label="题目图片"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void addFiles(e.dataTransfer.files)
          }}
        >
          <div className="image-import-tools">
            <label className="button-like">
              添加图片…
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files !== null) void addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
            <span className="field-hint">也可以 Ctrl+V 粘贴截图，或把图片拖到这里</span>
          </div>
          {images.length > 1 && (
            <div className="image-import-thumbs" role="tablist" aria-label="图片">
              {images.map((i, k) => (
                <button key={i.key} type="button" role="tab" aria-selected={i.key === current} className={i.key === current ? 'is-active' : undefined} onClick={() => setCurrent(i.key)} title={i.name}>
                  <img src={i.url} alt="" />
                  <span>第 {k + 1} 张</span>
                </button>
              ))}
            </div>
          )}
          {img === null ? (
            <div className="image-import-empty">
              <p>把题目图片放到这里</p>
              <p className="field-hint">在图上拖一个框，就把那部分框选为插图（右边的文字中会插入 [图1]、[图2]……）</p>
            </div>
          ) : (
            <BoxCanvas
              image={img}
              boxes={boxes.filter((b) => b.image === img.key)}
              onAdd={(r) => {
                const n = Math.max(0, ...boxes.map((b) => b.n)) + 1
                setBoxes((all) => [...all, { n, image: img.key, ...r }])
                insertFigureMark(n)
              }}
              onRemove={(n) => setBoxes((all) => all.filter((b) => b.n !== n))}
            />
          )}
        </section>

        <section className="image-import-right" aria-label="识别结果">
          <div className="image-import-tools">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(FORMAT_GUIDE).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2500)
                })
              }}
              title="把这段指令连同题目图片一起发给 AI（WorkBuddy、豆包、Kimi 等），再把它的回复粘贴到下面"
            >
              {copied ? '已复制 ✓' : '复制给 AI 的指令'}
            </button>
            <span className="field-hint">指令连同图片发给 AI，再把回复粘贴到下面</span>
          </div>
          <textarea
            ref={textRef}
            className="image-import-text"
            aria-label="识别结果"
            spellCheck={false}
            placeholder={'把 AI 的识别结果粘贴到这里，例如：\n1．如图所示，……（　　）\n[图1]\nA．……　　B．……\n【答案】A'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="image-import-check" role="status" aria-live="polite">
            {check === null ? (
              <span className="field-hint">粘贴后这里会显示识别到几道题、有哪些问题。</span>
            ) : (
              <>
                <strong>{check.questionCount > 0 ? `识别到 ${check.questionCount} 道题` : `识别到 ${check.blocks.length} 项内容（没有题目）`}</strong>
                {check.issues.length === 0 ? <span className="image-import-ok">，没有发现问题</span> : null}
                {check.issues.length > 0 && (
                  <ul>
                    {check.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      {error !== null && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="primary" disabled={busy || check === null || check.blocks.length === 0} onClick={() => void doImport()}>
          {busy ? '正在导入…' : `导入${check !== null && check.questionCount > 0 ? ` ${check.questionCount} 道题` : ''}`}
        </button>
      </div>
    </dialog>
  )
}

/** 图片与框选：在图上拖动画框，框显示编号，点 × 删除 */
function BoxCanvas({ image, boxes, onAdd, onRemove }: { image: SourceImage; boxes: Box[]; onAdd: (r: Omit<Box, 'n' | 'image'>) => void; onRemove: (n: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const toImage = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = wrapRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(image.width, ((e.clientX - r.left) / r.width) * image.width)),
      y: Math.max(0, Math.min(image.height, ((e.clientY - r.top) / r.height) * image.height))
    }
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('.image-box-remove') !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toImage(e)
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (draft === null) return
    const p = toImage(e)
    setDraft({ ...draft, x1: p.x, y1: p.y })
  }
  const onUp = (): void => {
    if (draft === null) return
    const x = Math.min(draft.x0, draft.x1)
    const y = Math.min(draft.y0, draft.y1)
    const w = Math.abs(draft.x1 - draft.x0)
    const h = Math.abs(draft.y1 - draft.y0)
    setDraft(null)
    // 太小的框当作误点
    if (w > image.width * 0.02 && h > image.height * 0.02) onAdd({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
  }
  const pct = (b: { x: number; y: number; w: number; h: number }) => ({
    left: `${(b.x / image.width) * 100}%`,
    top: `${(b.y / image.height) * 100}%`,
    width: `${(b.w / image.width) * 100}%`,
    height: `${(b.h / image.height) * 100}%`
  })
  return (
    <div className="image-import-canvas">
      <div ref={wrapRef} className="image-box-wrap" style={{ aspectRatio: `${image.width} / ${image.height}` }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <img src={image.url} alt="题目图片" draggable={false} />
        {boxes.map((b) => (
          <div key={b.n} className="image-box" style={pct(b)}>
            <span className="image-box-label">图{b.n}</span>
            <button type="button" className="image-box-remove" aria-label={`删除图${b.n}`} title={`删除图${b.n}（文字中的 [图${b.n}] 需要自己删掉）`} onClick={() => onRemove(b.n)}>
              ×
            </button>
          </div>
        ))}
        {draft !== null && (
          <div
            className="image-box is-draft"
            style={pct({ x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) })}
          />
        )}
      </div>
      <p className="field-hint">在图上拖一个框，就把那部分框选为插图。</p>
    </div>
  )
}

/** 从图片中裁出矩形，返回 PNG 数据 */
async function crop(url: string, b: Box): Promise<Uint8Array> {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(b.w))
  canvas.height = Math.max(1, Math.round(b.h))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((x) => (x !== null ? resolve(x) : reject(new Error('无法生成图片'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
