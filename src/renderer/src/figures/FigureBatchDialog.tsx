/**
 * 批量处理插图：列出整份教学案的插图（题图、答案 / 解析插图、知识点插图、背景配图），勾选后
 * “变清晰”（后台处理，一步撤销）或“让 WorkBuddy 重绘”（逐张收到 SVG，与原图对照后选用，统一应用、一步撤销）。
 * 属性栏中单张“WorkBuddy 重绘”也打开这里：只勾选那一张并立即交出。
 */
import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import type { FigureRef } from '@core/document/ir'
import { listFigures, type FigureEntry } from '@core/model/figure-refs'
import type { Asset, Block } from '@core/model/types'
import { createAsset } from '@core/project-file/codec'
import type { EditorAction } from '../state/store'
import { useAssetUrls } from '../preview/assets'
import { figureForRedraw, isVector, sharpenAsset, svgAspect } from './figure-actions'

interface Props {
  blocks: Block[]
  assets: Record<string, Asset>
  questionNumbers: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
  /** 打开时只勾选这些；redraw 为真时立即交给 WorkBuddy */
  initial?: { refs?: FigureRef[]; redraw?: boolean }
  onClose: () => void
}

const keyOf = (ref: FigureRef): string => `${ref.blockId}|${ref.list ?? 'figures'}|${ref.figureIndex}`

/** 插图的说明：第 3 题 解析插图 1、知识点“加速电场”插图 2…… */
export function figureLabel(e: FigureEntry, numbers: ReadonlyMap<string, string>): string {
  const i = e.ref.figureIndex + 1
  if (e.owner === 'question') {
    // 题号映射中的值带着标点（如“1.”）
    const n = numbers.get(e.ref.blockId)?.replace(/[．.、\s]+$/, '')
    const name = e.list === 'answer' ? '答案插图' : e.list === 'analysis' ? '解析插图' : '题图'
    return `${n !== undefined ? `第 ${n} 题` : '题目'} ${name} ${i}`
  }
  if (e.owner === 'knowledge') return `知识点“${e.title ?? ''}”插图 ${i}`
  return `“${e.title ?? '综合题'}”背景配图 ${i}`
}

export function FigureBatchDialog({ blocks, assets, questionNumbers, dispatch, initial, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const entries = useMemo(() => listFigures(blocks), [blocks])
  const urls = useAssetUrls(assets)
  const [picked, setPicked] = useState<Set<string>>(() => new Set((initial?.refs ?? []).map(keyOf)))
  const [progress, setProgress] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // 重绘：交出时的图号 → 插图；收到的 SVG；选用的
  const [redraw, setRedraw] = useState<{ taskId: string; byNumber: Map<number, string> } | null>(null)
  const redrawRef = useRef<typeof redraw>(null)
  redrawRef.current = redraw
  const [svgs, setSvgs] = useState<Map<string, string>>(new Map())
  const [useSvg, setUseSvg] = useState<Set<string>>(new Set())

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])
  useEffect(
    () =>
      window.api.onWorkbuddyRedrawResult((r) => {
        const cur = redrawRef.current
        if (cur === null || r.taskId !== cur.taskId) return
        const key = cur.byNumber.get(r.figure)
        if (key === undefined) return
        setSvgs((m) => new Map(m).set(key, r.svg))
        setUseSvg((s) => new Set(s).add(key))
      }),
    []
  )
  useEffect(
    () => () => {
      if (redrawRef.current !== null) void window.api.workbuddyRedrawCancel(redrawRef.current.taskId)
    },
    []
  )

  const assetOf = (e: FigureEntry): Asset | undefined => assets[e.figure.assetId]
  const selected = entries.filter((e) => picked.has(keyOf(e.ref)) && !isVector(assetOf(e)))

  const sharpen = async (mode: 'normal' | 'lineart'): Promise<void> => {
    setNote(null)
    const newAssets: Asset[] = []
    const changes: Array<{ ref: FigureRef; assetId: string }> = []
    // 同一张图片被多处使用时只处理一次
    const done = new Map<string, Asset>()
    for (let k = 0; k < selected.length; k++) {
      const e = selected[k]!
      setProgress(`正在${mode === 'lineart' ? '处理为线稿' : '变清晰'} ${k + 1}/${selected.length}…`)
      const asset = assetOf(e)
      if (asset === undefined) continue
      let next = done.get(asset.id)
      if (next === undefined) {
        const r = await sharpenAsset(asset, mode)
        if (r === null) continue
        next = r
        done.set(asset.id, r)
        newAssets.push(r)
      }
      changes.push({ ref: e.ref, assetId: next.id })
    }
    dispatch({ type: 'replace-figure-assets', assets: newAssets, changes })
    setProgress(null)
    setNote(`已把 ${changes.length} 张插图${mode === 'lineart' ? '处理为线稿' : '变清晰'}（可用 Ctrl+Z 撤销）。`)
  }

  const sendRedraw = async (only?: FigureEntry[]): Promise<void> => {
    setNote(null)
    const list = only ?? selected
    const status = await window.api.workbuddyStatus()
    if (!status.connected) {
      setNote(status.found ? '还没有连接 WorkBuddy：请在首页“设置… → WorkBuddy 自动识别”中连接。' : '没有找到 WorkBuddy（请先安装并打开一次 WorkBuddy）。')
      return
    }
    setProgress('正在准备图片…')
    const byNumber = new Map<number, string>()
    const figures = []
    for (let k = 0; k < list.length; k++) {
      const asset = assetOf(list[k]!)
      if (asset === undefined) continue
      figures.push(await figureForRedraw(asset, k + 1))
      byNumber.set(k + 1, keyOf(list[k]!.ref))
    }
    if (redrawRef.current !== null) await window.api.workbuddyRedrawCancel(redrawRef.current.taskId)
    const taskId = await window.api.workbuddyRedrawStart(figures)
    setRedraw({ taskId, byNumber })
    setProgress(null)
  }

  // 属性栏中单张“WorkBuddy 重绘”：打开即交出
  const started = useRef(false)
  useEffect(() => {
    if (started.current || initial?.redraw !== true) return
    started.current = true
    const only = entries.filter((e) => picked.has(keyOf(e.ref)) && !isVector(assetOf(e)))
    if (only.length > 0) void sendRedraw(only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apply = async (): Promise<void> => {
    const newAssets: Asset[] = []
    const changes: Array<{ ref: FigureRef; assetId: string; aspect?: number }> = []
    for (const e of entries) {
      const key = keyOf(e.ref)
      const svg = svgs.get(key)
      if (svg === undefined || !useSvg.has(key)) continue
      const asset = await createAsset(new TextEncoder().encode(svg), 'image/svg+xml')
      newAssets.push(asset)
      const aspect = svgAspect(svg)
      changes.push({ ref: e.ref, assetId: asset.id, ...(aspect !== undefined ? { aspect } : {}) })
    }
    dispatch({ type: 'replace-figure-assets', assets: newAssets, changes })
    // 已应用的不再显示
    setSvgs((m) => {
      const next = new Map(m)
      for (const c of changes) next.delete(keyOf(c.ref))
      return next
    })
    setNote(`已换成重绘的 SVG：${changes.length} 张（可用 Ctrl+Z 撤销）。`)
  }

  const received = redraw === null ? 0 : [...redraw.byNumber.values()].filter((k) => svgs.has(k)).length
  const chosen = [...svgs.keys()].filter((k) => useSvg.has(k)).length
  const toggle = (key: string, on: boolean): void =>
    setPicked((s) => {
      const next = new Set(s)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  return (
    <dialog
      ref={dialogRef}
      className="dialog figure-batch"
      aria-labelledby="figure-batch-title"
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        onClose()
      }}
    >
      <h2 id="figure-batch-title">批量处理插图</h2>
      <div className="figure-batch-tools">
        <span>共 {entries.length} 张，已选 {selected.length} 张</span>
        <button type="button" className="link" onClick={() => setPicked(new Set(entries.filter((e) => !isVector(assetOf(e))).map((e) => keyOf(e.ref))))}>
          全选
        </button>
        <button type="button" className="link" onClick={() => setPicked(new Set())}>
          全不选
        </button>
        <span className="field-hint">矢量图本来就清晰，不能变清晰、也不需要重绘。</span>
      </div>
      {redraw !== null && (
        <div className="image-import-wb is-waiting" role="status">
          <span>
            已交给 WorkBuddy 重绘 {redraw.byNumber.size} 张，请到 WorkBuddy 里说：<strong>重绘插图</strong>（已收到 {received}/{redraw.byNumber.size}）
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
      {entries.length === 0 ? (
        <p className="field-hint">这份教学案中还没有插图。</p>
      ) : (
        <div className="figure-batch-grid">
          {entries.map((e) => {
            const key = keyOf(e.ref)
            const asset = assetOf(e)
            const vector = isVector(asset)
            const svg = svgs.get(key)
            return (
              <div key={key} className={['figure-card', picked.has(key) && !vector ? 'is-picked' : '', svg !== undefined ? 'has-svg' : ''].join(' ')}>
                <label className="figure-card-head">
                  <input type="checkbox" disabled={vector} checked={picked.has(key) && !vector} onChange={(ev) => toggle(key, ev.target.checked)} />
                  <span>{figureLabel(e, questionNumbers)}</span>
                  {vector && <span className="figure-card-tag">矢量图</span>}
                </label>
                {svg === undefined ? (
                  <img src={urls.get(e.figure.assetId)} alt="" />
                ) : (
                  <div className="figure-card-compare" role="radiogroup" aria-label="用原图还是重绘的 SVG">
                    <label className={useSvg.has(key) ? '' : 'is-chosen'}>
                      <input type="radio" checked={!useSvg.has(key)} onChange={() =>
                          setUseSvg((s) => {
                            const next = new Set(s)
                            next.delete(key)
                            return next
                          })
                        } /> 原图
                      <img src={urls.get(e.figure.assetId)} alt="" />
                    </label>
                    <label className={useSvg.has(key) ? 'is-chosen' : ''}>
                      <input type="radio" checked={useSvg.has(key)} onChange={() => setUseSvg((s) => new Set(s).add(key))} /> 重绘的 SVG
                      <SvgImage svg={svg} />
                    </label>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {(progress ?? note) !== null && <p className="field-hint" role="status">{progress ?? note}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={progress !== null || selected.length === 0} onClick={() => void sharpen('normal')} title="去掉灰底与杂点、放大（不改变内容）">
          变清晰（{selected.length}）
        </button>
        <button
          type="button"
          disabled={progress !== null || selected.length === 0}
          onClick={() => void sharpen('lineart')}
          title="变清晰后再把线条压成纯黑（彩色线条保持原色）、纸张纯白；成片的填充保持原样。适合黑白线条图"
        >
          线稿（{selected.length}）
        </button>
        <button type="button" disabled={progress !== null || selected.length === 0} onClick={() => void sendRedraw()} title="交给 WorkBuddy 重绘为 SVG；收到后与原图对照，选用哪一个">
          让 WorkBuddy 重绘（{selected.length}）
        </button>
        {svgs.size > 0 && (
          <button type="button" className="primary" disabled={chosen === 0} onClick={() => void apply()}>
            应用选用的 SVG（{chosen}）
          </button>
        )}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </dialog>
  )
}

function SvgImage({ svg }: { svg: string }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), [svg])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img src={url} alt="" />
}
