/**
 * 从图片导入题目：左边是题目图片（选择、粘贴截图或拖入），软件自动框出其中的插图（core/import/figure-detect.ts），
 * 框的编号按阅读顺序（图片顺序，同一张图先上后下、先左后右）排列，与识别结果中的 [图1]、[图2] 对应；
 * 框可以拖动、拖角调整、删除，在图上拖动画新框（自动收紧到墨迹边缘）。
 * 右边是识别结果——把“给 AI 的指令”连同图片交给任意 AI（或由 WorkBuddy 自动送回），把结果粘贴进来，
 * 下方即时显示识别到几道题、有哪些问题。确认后插图裁成 PNG（选项图去掉底部单独的字母），文字按格式预设识别为题目。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { detectFigures, padBox, snapToFigure, sortReading, trimBottomLabel, type Box as Rect, type Pixels } from '@core/import/figure-detect'
import { FORMAT_GUIDE, importText, KNOWLEDGE_GUIDE, type TextFigure } from '@core/import/text-import'
import { redrawSizes } from '@core/import/svg-redraw'
import { createAsset } from '@core/project-file/codec'
import type { Asset, Block } from '@core/model/types'
import type { ImportReport } from '@shared/ipc'
import { enhance, readPixels, toObjectUrl, toPng } from './enhance-client'

interface SourceImage {
  key: string
  name: string
  url: string
  width: number
  height: number
  /** 检测用的像素（长边超过 MAX_DETECT 时缩小），scale = 像素宽 / 原图宽 */
  pixels: Pixels | null
  scale: number
  textHeight: number
  /** 整页检测得到的插图候选块（检测像素坐标），供随手拖的框收紧 */
  pieces: Rect[]
  /** 正在自动框选 */
  detecting: boolean
}

/** 框选的插图：在某张图上的矩形（原图像素）；编号按阅读顺序另行计算 */
interface Box extends Rect {
  id: string
  image: string
}

interface Props {
  /** 导入题目或知识点（格式说明、检查、提示随之不同） */
  kind?: 'questions' | 'knowledge'
  presetId: string | undefined
  onCancel: () => void
  onImport: (blocks: Block[], assets: Record<string, Asset>, report: ImportReport) => void
}

/** 插图导入后的默认宽度上限（厘米），之后可在属性面板或预览中调整 */
const MAX_FIGURE_CM = 6.5
const EMU_PER_CM = 360000
/** 屏幕截图按 96 dpi 估算尺寸 */
const EMU_PER_PX = 9525
/** 自动框选时图片的最大边长（手机照片先缩小，避免卡顿） */
const MAX_DETECT = 2400

let keySeq = 0

/** 读取图片像素（缩小到 MAX_DETECT 以内） */
async function loadPixels(url: string, width: number, height: number): Promise<{ pixels: Pixels; scale: number }> {
  const img = new Image()
  img.src = url
  await img.decode()
  const scale = Math.min(1, MAX_DETECT / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  return { pixels: { data, width: w, height: h }, scale }
}

const scaleRect = (r: Rect, k: number): Rect => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k })

export function ImageImportDialog({ kind = 'questions', presetId, onCancel, onImport }: Props) {
  const asKnowledge = kind === 'knowledge'
  const guide = asKnowledge ? KNOWLEDGE_GUIDE : FORMAT_GUIDE
  const opts = { ...(presetId !== undefined ? { presetId } : {}), ...(asKnowledge ? { asKnowledge: true } : {}) }
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [images, setImages] = useState<SourceImage[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 插图变清晰（清理底色 + 放大），默认打开；选中的框显示处理前后对比
  const [enhanceOn, setEnhanceOn] = useState(true)
  // 去白底（白色变透明），可与变清晰搭配
  const [transparent, setTransparent] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  // 让 WorkBuddy 重绘为 SVG：交出时的图号 → 框；收到的 SVG；选用 SVG 的框
  const [redraw, setRedraw] = useState<{ taskId: string; byNumber: Map<number, string>; total: number; note?: string } | null>(null)
  const [svgs, setSvgs] = useState<Map<string, string>>(new Map())
  const [useSvg, setUseSvg] = useState<Set<string>>(new Set())
  // 要交给 WorkBuddy 重绘的框（在框上点“重绘”勾选；本来就清晰的图不用重绘）
  const [redrawPick, setRedrawPick] = useState<Set<string>>(new Set())
  const redrawRef = useRef<typeof redraw>(null)
  redrawRef.current = redraw
  // 交给 WorkBuddy 识别：等待中的任务、状态提示
  const [wb, setWb] = useState<{ state: 'idle' | 'need-connect' | 'waiting' | 'received'; taskId?: string; note?: string }>({ state: 'idle' })
  const wbTask = useRef<string | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])
  // 关闭时回收图片地址
  const urlsRef = useRef<string[]>([])
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), [])

  /** 自动框选一张图（替换这张图上原有的框） */
  const autoDetect = async (img: SourceImage): Promise<void> => {
    setImages((all) => all.map((i) => (i.key === img.key ? { ...i, detecting: true } : i)))
    // 让“正在找图…”先显示出来
    await new Promise((r) => setTimeout(r, 30))
    let loaded = img.pixels !== null ? { pixels: img.pixels, scale: img.scale } : null
    try {
      loaded ??= await loadPixels(img.url, img.width, img.height)
      const r = detectFigures(loaded.pixels)
      // 四周留白，免得裁出的图边缘的线条紧贴图片边界
      const found = r.boxes.map((b) => ({ ...scaleRect(padBox(b, r.textHeight, loaded!.pixels.width, loaded!.pixels.height), 1 / loaded!.scale), id: `b${++keySeq}`, image: img.key }))
      setBoxes((all) => [...all.filter((b) => b.image !== img.key), ...found])
      setImages((all) => all.map((i) => (i.key === img.key ? { ...i, pixels: loaded!.pixels, scale: loaded!.scale, textHeight: r.textHeight / loaded!.scale, pieces: r.pieces, detecting: false } : i)))
    } catch {
      setImages((all) => all.map((i) => (i.key === img.key ? { ...i, detecting: false } : i)))
    }
  }

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
      added.push({ key: `img${++keySeq}`, name: f.name || '粘贴的图片', url, width: size.w, height: size.h, pixels: null, scale: 1, textHeight: 16, pieces: [], detecting: true })
    }
    if (added.length === 0) return
    setImages((all) => [...all, ...added])
    setCurrent((c) => c ?? added[0]!.key)
    for (const img of added) await autoDetect(img)
  }

  // WorkBuddy 送回的识别结果
  useEffect(
    () =>
      window.api.onWorkbuddyResult((r) => {
        if (r.taskId !== wbTask.current) return
        setText(r.text)
        setWb({ state: 'received', taskId: r.taskId })
      }),
    []
  )
  // 关闭窗口时取消任务
  useEffect(
    () => () => {
      if (wbTask.current !== null) void window.api.workbuddyCancel(wbTask.current)
      if (redrawRef.current !== null) void window.api.workbuddyRedrawCancel(redrawRef.current.taskId)
    },
    []
  )
  // WorkBuddy 交回的 SVG（已检查、净化）：默认选用，由老师与原图对照后决定
  useEffect(
    () =>
      window.api.onWorkbuddyRedrawResult((r) => {
        const cur = redrawRef.current
        if (cur === null || r.taskId !== cur.taskId) return
        const boxId = cur.byNumber.get(r.figure)
        if (boxId === undefined) return
        setSvgs((m) => new Map(m).set(boxId, r.svg))
        setUseSvg((s) => new Set(s).add(boxId))
      }),
    []
  )

  const sendRedraw = async (): Promise<void> => {
    setError(null)
    const status = await window.api.workbuddyStatus()
    if (!status.connected) {
      setWb({ state: 'need-connect', note: status.found ? undefined : '没有找到 WorkBuddy（请先安装并打开一次 WorkBuddy）。' })
      return
    }
    try {
      const byNumber = new Map<number, string>()
      const figures: Array<{ n: number; mime: string; data: string; width: number; height: number; fontSize: number; stroke: number; thin: number }> = []
      for (const b of boxes.filter((x) => redrawPick.has(x.id))) {
        const n = numbers.get(b.id)
        const src = images.find((i) => i.key === b.image)
        if (n === undefined || src === undefined) continue
        let px = await readPixels(src.url, b)
        if (enhanceOn) px = await enhance(px)
        // 字号、线宽按原图换算，使重绘后文字和线条与原图的比例一致
        figures.push({ n, mime: 'image/png', data: toBase64(await toPng(px)), width: Math.round(b.w), height: Math.round(b.h), ...redrawSizes(b.w, src.textHeight) })
        byNumber.set(n, b.id)
      }
      figures.sort((a, b) => a.n - b.n)
      if (redrawRef.current !== null) await window.api.workbuddyRedrawCancel(redrawRef.current.taskId)
      const taskId = await window.api.workbuddyRedrawStart(figures)
      setRedraw({ taskId, byNumber, total: figures.length })
    } catch (e) {
      setError(`交给 WorkBuddy 失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // 等待期间增删了插图框：告诉 WorkBuddy 插图数
  useEffect(() => {
    if (wbTask.current !== null) void window.api.workbuddyUpdate(wbTask.current, boxes.length)
  }, [boxes.length])

  const sendToWorkBuddy = async (): Promise<void> => {
    setError(null)
    const status = await window.api.workbuddyStatus()
    if (!status.connected) {
      setWb({ state: 'need-connect', note: status.found ? undefined : '没有找到 WorkBuddy（请先安装并打开一次 WorkBuddy）。' })
      return
    }
    try {
      const encoded = await Promise.all(images.map((i) => encodeForAi(i.url, i.width, i.height).then((data) => ({ name: i.name, mime: 'image/jpeg', data }))))
      if (wbTask.current !== null) await window.api.workbuddyCancel(wbTask.current)
      const taskId = await window.api.workbuddyStart({ images: encoded, figureCount: boxes.length, ...(presetId !== undefined ? { presetId } : {}), ...(asKnowledge ? { kind: 'knowledge' as const } : {}) })
      wbTask.current = taskId
      setWb({ state: 'waiting', taskId })
    } catch (e) {
      setError(`交给 WorkBuddy 失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const connectWorkBuddy = async (): Promise<void> => {
    const r = await window.api.workbuddyConnect()
    if (!r.ok) {
      setWb({ state: 'need-connect', note: r.error })
      return
    }
    setWb({ state: 'idle', note: '已连接。如果 WorkBuddy 正开着，请在它的“连接器 → MCP”中确认 teaching-plan 已启用（或重启 WorkBuddy），然后再点“交给 WorkBuddy 识别”。' })
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

  /** 框的编号：按图片顺序，同一张图按阅读顺序 */
  const numbers = useMemo(() => {
    const out = new Map<string, number>()
    let n = 0
    for (const img of images) {
      // sortReading 返回原来的对象（只是排序）
      for (const b of sortReading(boxes.filter((x) => x.image === img.key), img.textHeight) as Box[]) out.set(b.id, ++n)
    }
    return out
  }, [images, boxes])

  // 识别结果即时检查（插图用占位资源，只看编号是否对应）
  const check = useMemo(() => {
    if (text.trim() === '') return null
    const figures = new Map<number, TextFigure>(
      [...numbers.values()].map((n) => [n, { asset: { id: `box-${n}`, mime: 'image/png', data: new Uint8Array() }, widthEmu: 1, heightEmu: 1 }])
    )
    try {
      return importText(text, { ...opts, figures })
    } catch (e) {
      return { blocks: [], assets: {}, questionCount: 0, issues: [`识别出错：${e instanceof Error ? e.message : String(e)}`] }
    }
  }, [text, numbers, presetId])

  const doImport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // 用作选项的图（“A．[图2]”）：去掉图底部单独的选项字母（排版时选项本身会显示“A．”）
      const optionFigures = new Set([...text.matchAll(/(?:^|\s)[A-H]\s*[．.、]\s*\[\s*图\s*(\d+)\s*\]/gm)].map((m) => Number(m[1])))
      const figures = new Map<number, TextFigure>()
      for (const b of boxes) {
        const n = numbers.get(b.id)
        const src = images.find((i) => i.key === b.image)
        if (n === undefined || src === undefined) continue
        let rect: Rect = b
        if (optionFigures.has(n) && src.pixels !== null) rect = scaleRect(trimBottomLabel(src.pixels, scaleRect(b, src.scale), src.textHeight * src.scale), 1 / src.scale)
        // 选用了 WorkBuddy 重绘的 SVG：以矢量图导入（显示尺寸按原图）
        const svg = useSvg.has(b.id) ? svgs.get(b.id) : undefined
        let asset: Asset
        if (svg !== undefined) {
          rect = b
          asset = await createAsset(new TextEncoder().encode(svg), 'image/svg+xml')
        } else {
          let px = await readPixels(src.url, rect)
          if (enhanceOn || transparent) px = await enhance(px, enhanceOn ? 'normal' : 'none', transparent)
          asset = await createAsset(await toPng(px), 'image/png')
        }
        let widthEmu = rect.w * EMU_PER_PX
        let heightEmu = rect.h * EMU_PER_PX
        const max = MAX_FIGURE_CM * EMU_PER_CM
        if (widthEmu > max) {
          heightEmu = (heightEmu * max) / widthEmu
          widthEmu = max
        }
        figures.set(n, { asset, widthEmu: Math.round(widthEmu), heightEmu: Math.round(heightEmu) })
      }
      const r = importText(text, { ...opts, figures })
      if (r.blocks.length === 0) {
        setError('没有可导入的内容。')
        return
      }
      onImport(r.blocks, r.assets, { fileNames: images.map((i) => i.name), questionCount: r.questionCount, ...(r.knowledgeCount !== undefined ? { knowledgeCount: r.knowledgeCount } : {}), warnings: r.issues })
    } catch (e) {
      setError(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const img = images.find((i) => i.key === current) ?? null
  const figureCount = boxes.length

  return (
    <dialog
      ref={dialogRef}
      className="dialog image-import"
      aria-labelledby="image-import-title"
      onCancel={(e) => {
        // 文件选择框点“取消”也会发出 cancel 事件并冒泡到这里：只响应窗口自己的（Esc），否则整个窗口连同识别结果被关掉
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id="image-import-title">{asKnowledge ? '从图片导入知识点' : '从图片导入题目'}</h2>
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
            {img !== null && (
              <button type="button" disabled={img.detecting} onClick={() => void autoDetect(img)} title="重新找出这张图中的插图（替换这张图上的框）">
                重新自动框选
              </button>
            )}
            {boxes.length > 0 && (
              <button
                type="button"
                disabled={boxes.every((b) => !redrawPick.has(b.id))}
                onClick={() => void sendRedraw()}
                title={boxes.some((b) => redrawPick.has(b.id)) ? '把勾选的插图交给 WorkBuddy 重绘为 SVG；收到后与原图逐张对照，选用哪一个' : '先在框上点“重绘”勾选要重绘的插图（本来就清晰的图不用重绘）'}
              >
                让 WorkBuddy 重绘（{boxes.filter((b) => redrawPick.has(b.id)).length}）
              </button>
            )}
            <label className="checkbox" title="导入时去掉插图的灰底与杂点、放大 3 倍（不改变内容），打印更清楚">
              <input type="checkbox" checked={enhanceOn} onChange={(e) => setEnhanceOn(e.target.checked)} />
              插图变清晰
            </label>
            <label className="checkbox" title="白色底色变为透明（线条边缘半透明，放在任何底色上都没有白边）">
              <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
              去白底
            </label>
            <span className="field-hint">
              {images.length === 0 ? '也可以 Ctrl+V 粘贴截图，或把图片拖到这里' : `共框选 ${figureCount} 张插图`}
            </span>
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
              <p className="field-hint">软件会自动框出其中的插图，编号按阅读顺序排列，与识别结果中的 [图1]、[图2] 对应</p>
            </div>
          ) : (
            <BoxCanvas
              image={img}
              boxes={boxes.filter((b) => b.image === img.key)}
              numbers={numbers}
              onAdd={(r) => {
                // 新画的框收紧到墨迹边缘
                const snapped =
                  img.pixels !== null
                    ? scaleRect(padBox(snapToFigure(img.pixels, scaleRect(r, img.scale), img.pieces, 0), img.textHeight * img.scale, img.pixels.width, img.pixels.height), 1 / img.scale)
                    : r
                setBoxes((all) => [...all, { ...snapped, id: `b${++keySeq}`, image: img.key }])
              }}
              onChange={(id, r) => setBoxes((all) => all.map((b) => (b.id === id ? { ...b, ...r } : b)))}
              onRemove={(id) => setBoxes((all) => all.filter((b) => b.id !== id))}
              svgBoxes={useSvg}
              redrawPick={redrawPick}
              onToggleRedraw={(id) =>
                setRedrawPick((s) => {
                  const next = new Set(s)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {redraw !== null && (
            <div className="image-import-wb is-waiting" role="status">
              <span>
                已交给 WorkBuddy 重绘 {redraw.total} 张插图，请到 WorkBuddy 里说：<strong>重绘插图</strong>（已收到 {[...redraw.byNumber.values()].filter((id) => svgs.has(id)).length}/{redraw.total}）
              </span>
              <button
                type="button"
                onClick={() => {
                  void window.api.workbuddyRedrawCancel(redraw.taskId)
                  setRedraw(null)
                }}
              >
                结束
              </button>
            </div>
          )}
          {img !== null && (() => {
            const box = boxes.find((b) => b.id === selected && b.image === img.key)
            if (box === undefined) return null
            const svg = svgs.get(box.id)
            if (svg !== undefined) {
              return (
                <SvgChoice
                  url={img.url}
                  box={box}
                  n={numbers.get(box.id)}
                  svg={svg}
                  use={useSvg.has(box.id)}
                  onUse={(on) =>
                    setUseSvg((s) => {
                      const next = new Set(s)
                      if (on) next.add(box.id)
                      else next.delete(box.id)
                      return next
                    })
                  }
                />
              )
            }
            return enhanceOn || transparent ? (
              <EnhancePreview
                enhanceOn={enhanceOn}
                transparent={transparent}
                url={img.url}
                box={box}
                n={numbers.get(box.id)}
              />
            ) : null
          })()}
        </section>

        <section className="image-import-right" aria-label="识别结果">
          <div className="image-import-tools">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(guide).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2500)
                })
              }}
              title="把这段指令连同题目图片一起发给 AI（WorkBuddy、豆包、Kimi 等），再把它的回复粘贴到下面"
            >
              {copied ? '已复制 ✓' : '复制给 AI 的指令'}
            </button>
            <button type="button" disabled={images.length === 0} onClick={() => void sendToWorkBuddy()} title="把图片交给 WorkBuddy 识别，结果自动回到这里">
              交给 WorkBuddy 识别
            </button>
          </div>
          <WorkBuddyNotice
            wb={wb}
            phrase={asKnowledge ? '导入知识点' : '导入题目'}
            onConnect={() => void connectWorkBuddy()}
            onCancel={() => {
              if (wbTask.current !== null) void window.api.workbuddyCancel(wbTask.current)
              wbTask.current = null
              setWb({ state: 'idle' })
            }}
          />
          <textarea
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
                <strong>
                  {check.knowledgeCount !== undefined
                    ? `识别到 ${check.knowledgeCount} 个知识点${check.questionCount > 0 ? `、${check.questionCount} 道题` : ''}`
                    : check.questionCount > 0
                      ? `识别到 ${check.questionCount} 道题`
                      : `识别到 ${check.blocks.length} 项内容（没有题目）`}
                </strong>
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
          {busy
            ? '正在导入…'
            : `导入${check?.knowledgeCount !== undefined && check.knowledgeCount > 0 ? ` ${check.knowledgeCount} 个知识点` : check !== null && check.questionCount > 0 ? ` ${check.questionCount} 道题` : ''}`}
        </button>
      </div>
    </dialog>
  )
}

/** WorkBuddy 状态提示 */
function WorkBuddyNotice({ wb, phrase, onConnect, onCancel }: { wb: { state: string; note?: string }; phrase: string; onConnect: () => void; onCancel: () => void }) {
  const [copied, setCopied] = useState(false)
  if (wb.state === 'idle') return wb.note !== undefined ? <p className="image-import-wb">{wb.note}</p> : null
  if (wb.state === 'need-connect') {
    return (
      <div className="image-import-wb" role="status">
        {wb.note ?? '还没有连接 WorkBuddy。连接一次后，就可以把图片直接交给 WorkBuddy 识别，结果自动回到这里。'}
        <button type="button" onClick={onConnect}>
          连接 WorkBuddy
        </button>
      </div>
    )
  }
  if (wb.state === 'waiting') {
    return (
      <div className="image-import-wb is-waiting" role="status">
        <span>
          已交给 WorkBuddy。请到 WorkBuddy 里说：<strong>{phrase}</strong>
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(phrase).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
          }}
        >
          {copied ? '已复制 ✓' : '复制这句话'}
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    )
  }
  return (
    <div className="image-import-wb is-received" role="status">
      已收到 WorkBuddy 的识别结果，请对照原图检查文字和插图，然后导入。
    </div>
  )
}

/** 交给 AI 的图片：长边不超过 2000 像素，JPEG */
async function encodeForAi(url: string, width: number, height: number): Promise<string> {
  const img = new Image()
  img.src = url
  await img.decode()
  const k = Math.min(1, 2000 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * k))
  canvas.height = Math.max(1, Math.round(height * k))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9).replace(/^data:image\/jpeg;base64,/, '')
}

/** 收到 WorkBuddy 重绘的 SVG：与原图对照，选用哪一个 */
function SvgChoice({ url, box, n, svg, use, onUse }: { url: string; box: Rect; n: number | undefined; svg: string; use: boolean; onUse: (on: boolean) => void }) {
  const [before, setBefore] = useState<string | null>(null)
  const svgUrl = useMemo(() => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), [svg])
  useEffect(() => () => URL.revokeObjectURL(svgUrl), [svgUrl])
  const key = `${url}|${Math.round(box.x)}|${Math.round(box.y)}|${Math.round(box.w)}|${Math.round(box.h)}`
  useEffect(() => {
    let alive = true
    let made: string | null = null
    void readPixels(url, box)
      .then(toObjectUrl)
      .then((u) => {
        made = u
        if (alive) setBefore(u)
        else URL.revokeObjectURL(u)
      })
    return () => {
      alive = false
      if (made !== null) URL.revokeObjectURL(made)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <div className="enhance-preview svg-choice" role="radiogroup" aria-label={`图${n ?? ''}用原图还是重绘的 SVG`}>
      <figure className={use ? undefined : 'is-chosen'}>
        <figcaption>
          <label>
            <input type="radio" checked={!use} onChange={() => onUse(false)} /> 图{n} 原图
          </label>
        </figcaption>
        {before !== null && <img src={before} alt="" />}
      </figure>
      <figure className={use ? 'is-chosen' : undefined}>
        <figcaption>
          <label>
            <input type="radio" checked={use} onChange={() => onUse(true)} /> WorkBuddy 重绘的 SVG（请核对是否与原图一致）
          </label>
        </figcaption>
        <img src={svgUrl} alt="" />
      </figure>
    </div>
  )
}

/** 字节 → base64 */
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** 选中插图的变清晰效果：处理前 / 处理后（后台处理） */
function EnhancePreview({ url, box, n, enhanceOn, transparent }: { url: string; box: Rect; n: number | undefined; enhanceOn: boolean; transparent: boolean }) {
  const [pair, setPair] = useState<{ before: string; after: string | null } | null>(null)
  const key = `${url}|${Math.round(box.x)}|${Math.round(box.y)}|${Math.round(box.w)}|${Math.round(box.h)}|${enhanceOn}|${transparent}`
  useEffect(() => {
    let alive = true
    const made: string[] = []
    void (async () => {
      const px = await readPixels(url, box)
      const before = await toObjectUrl(px)
      made.push(before)
      if (!alive) return
      setPair({ before, after: null })
      const after = await toObjectUrl(await enhance(px, enhanceOn ? 'normal' : 'none', transparent))
      made.push(after)
      if (alive) setPair({ before, after })
    })()
    return () => {
      alive = false
      made.forEach((u) => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <div className="enhance-preview" aria-label={`图${n ?? ''}变清晰的效果`}>
      <figure>
        <figcaption>图{n} 处理前</figcaption>
        {pair !== null && <img src={pair.before} alt="" />}
      </figure>
      <figure>
        <figcaption>处理后（导入时使用）</figcaption>
        {pair?.after != null ? <img src={pair.after} alt="" className={transparent ? 'checker' : undefined} /> : <span className="field-hint">正在处理…</span>}
      </figure>
    </div>
  )
}

type Drag =
  | { kind: 'new'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'move'; id: string; dx: number; dy: number; start: Rect }
  | { kind: 'resize'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se'; start: Rect }

/** 图片与框：拖动空白处画新框；拖动框移动、拖四角调整；点 × 删除 */
function BoxCanvas({
  image,
  boxes,
  numbers,
  onAdd,
  onChange,
  onRemove,
  svgBoxes,
  redrawPick,
  onToggleRedraw,
  selected,
  onSelect
}: {
  image: SourceImage
  boxes: Box[]
  numbers: ReadonlyMap<string, number>
  onAdd: (r: Rect) => void
  onChange: (id: string, r: Rect) => void
  onRemove: (id: string) => void
  /** 选用了 SVG 的框（标签显示“SVG”） */
  svgBoxes: ReadonlySet<string>
  /** 勾选了“重绘”的框 */
  redrawPick: ReadonlySet<string>
  onToggleRedraw: (id: string) => void
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [live, setLive] = useState<{ id: string; r: Rect } | null>(null)
  const toImage = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = wrapRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(image.width, ((e.clientX - r.left) / r.width) * image.width)),
      y: Math.max(0, Math.min(image.height, ((e.clientY - r.top) / r.height) * image.height))
    }
  }
  const norm = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
  const current = (d: Drag, p: { x: number; y: number }): Rect => {
    if (d.kind === 'move') {
      const x = Math.max(0, Math.min(image.width - d.start.w, p.x - d.dx))
      const y = Math.max(0, Math.min(image.height - d.start.h, p.y - d.dy))
      return { ...d.start, x, y }
    }
    if (d.kind === 'resize') {
      const s = d.start
      const left = d.corner === 'nw' || d.corner === 'sw' ? p.x : s.x
      const right = d.corner === 'ne' || d.corner === 'se' ? p.x : s.x + s.w
      const top = d.corner === 'nw' || d.corner === 'ne' ? p.y : s.y
      const bottom = d.corner === 'sw' || d.corner === 'se' ? p.y : s.y + s.h
      return norm(left, top, right, bottom)
    }
    return norm(d.x0, d.y0, d.x1, d.y1)
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const t = e.target as HTMLElement
    if (t.closest('.image-box-remove, .image-box-redraw') !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toImage(e)
    const handle = t.closest<HTMLElement>('[data-corner]')
    const boxEl = t.closest<HTMLElement>('[data-box]')
    if (handle !== null && boxEl !== null) {
      const b = boxes.find((x) => x.id === boxEl.dataset['box'])!
      setDrag({ kind: 'resize', id: b.id, corner: handle.dataset['corner'] as 'nw', start: b })
    } else if (boxEl !== null) {
      const b = boxes.find((x) => x.id === boxEl.dataset['box'])!
      onSelect(b.id)
      setDrag({ kind: 'move', id: b.id, dx: p.x - b.x, dy: p.y - b.y, start: b })
    } else setDrag({ kind: 'new', x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return
    const p = toImage(e)
    if (drag.kind === 'new') setDrag({ ...drag, x1: p.x, y1: p.y })
    else setLive({ id: drag.id, r: current(drag, p) })
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return
    const p = toImage(e)
    const r = current(drag, p)
    setDrag(null)
    setLive(null)
    // 太小的框当作误点
    const big = r.w > image.width * 0.015 && r.h > image.height * 0.015
    if (drag.kind === 'new') {
      if (big) onAdd({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })
    } else if (big || drag.kind === 'move') onChange(drag.id, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })
  }
  const pct = (b: Rect) => ({
    left: `${(b.x / image.width) * 100}%`,
    top: `${(b.y / image.height) * 100}%`,
    width: `${(b.w / image.width) * 100}%`,
    height: `${(b.h / image.height) * 100}%`
  })
  return (
    <div className="image-import-canvas">
      <div ref={wrapRef} className="image-box-wrap" style={{ aspectRatio: `${image.width} / ${image.height}` }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <img src={image.url} alt="题目图片" draggable={false} />
        {boxes.map((b) => {
          const r = live?.id === b.id ? live.r : b
          const n = numbers.get(b.id)
          return (
            <div key={b.id} className={b.id === selected ? 'image-box is-selected' : 'image-box'} data-box={b.id} style={pct(r)} title="点选可查看变清晰的效果；拖动可移动，拖四角可调整大小">
              <span className="image-box-label">图{n}{svgBoxes.has(b.id) ? ' · SVG' : ''}</span>
              <button type="button" className="image-box-remove" aria-label={`删除图${n}`} title={`删除图${n}`} onClick={() => onRemove(b.id)}>
                ×
              </button>
              <button
                type="button"
                className={redrawPick.has(b.id) ? 'image-box-redraw is-on' : 'image-box-redraw'}
                aria-pressed={redrawPick.has(b.id)}
                title="勾选后，点“让 WorkBuddy 重绘”时交出这张图"
                onClick={() => onToggleRedraw(b.id)}
              >
                {redrawPick.has(b.id) ? '☑ 重绘' : '☐ 重绘'}
              </button>
              {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                <span key={c} className={`image-box-handle is-${c}`} data-corner={c} aria-hidden="true" />
              ))}
            </div>
          )
        })}
        {drag?.kind === 'new' && <div className="image-box is-draft" style={pct(current(drag, { x: drag.x1, y: drag.y1 }))} />}
        {image.detecting && <div className="image-box-busy">正在找图…</div>}
      </div>
      <p className="field-hint">插图已自动框出，请检查：框错的点 × 删除，漏掉的在图上拖一个框（会自动收紧到图的边缘），框可以拖动、拖四角调整。</p>
    </div>
  )
}
