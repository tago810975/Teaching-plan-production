/**
 * 批量处理插图：列出整份教学案的插图（题图、答案 / 解析插图、知识点插图、背景配图），勾选后
 * “变清晰”（后台处理，一步撤销）或“让 AI 重绘”（支持 WorkBuddy / Antigravity 反重力，逐张收到 SVG，与原图对照后选用，统一应用、一步撤销）。
 * 属性栏与预览右键菜单中的单张“AI 重绘”也打开这里：只勾选那一张并立即交出；等待期间可收起到后台继续编辑。
 */
import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import type { FigureRef } from '@core/document/ir'
import { listFigures, type FigureEntry } from '@core/model/figure-refs'
import type { Asset, Block } from '@core/model/types'
import type { McpClientStatus } from '@shared/ipc'
import { createAsset } from '@core/project-file/codec'
import type { EditorAction } from '../state/store'
import type { FigureRedrawSessionPatch } from '../state/figureRedrawSession'
import { useAssetUrls } from '../preview/assets'
import { figureForRedraw, isVector, sharpenAsset, svgAspect } from './figure-actions'
import type { EnhanceOptions } from '@core/image/enhance'

interface Props {
  blocks: Block[]
  assets: Record<string, Asset>
  questionNumbers: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
  /** 打开时只勾选这些；redraw 为真时立即交给 AI 重绘 */
  initial?: { refs?: FigureRef[]; redraw?: boolean }
  minimized?: boolean
  onMinimize?: () => void
  targetTitle?: string | null
  targetMissing?: boolean
  reopenHint?: string | null
  onSessionUpdate?: (patch: FigureRedrawSessionPatch) => void
  onClose: () => void
}

const opName = (mode: 'normal' | 'none', o: EnhanceOptions): string =>
  mode === 'none' ? (o.transparent === true ? '去白底' : o.autoLevels === true ? '加深' : '处理') : `变清晰${o.transparent === true ? '并去白底' : ''}`

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

export function FigureBatchDialog({
  blocks,
  assets,
  questionNumbers,
  dispatch,
  initial,
  minimized = false,
  onMinimize,
  targetTitle,
  targetMissing = false,
  reopenHint = null,
  onSessionUpdate,
  onClose
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const entries = useMemo(() => listFigures(blocks), [blocks])
  const urls = useAssetUrls(assets)
  const [picked, setPicked] = useState<Set<string>>(() => new Set((initial?.refs ?? []).map(keyOf)))
  const [progress, setProgress] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [connectClients, setConnectClients] = useState<McpClientStatus[]>([])
  const [copiedPhrase, setCopiedPhrase] = useState(false)
  // 重绘：交出时的图号 → 插图；收到的 SVG；选用的
  const [redraw, setRedraw] = useState<{ taskId: string; byNumber: Map<number, string> } | null>(null)
  const redrawRef = useRef<typeof redraw>(null)
  redrawRef.current = redraw
  const [svgs, setSvgs] = useState<Map<string, string>>(new Map())
  const svgsRef = useRef<Map<string, string>>(svgs)
  svgsRef.current = svgs
  const [useSvg, setUseSvg] = useState<Set<string>>(new Set())
  const onSessionUpdateRef = useRef(onSessionUpdate)
  onSessionUpdateRef.current = onSessionUpdate

  useEffect(() => {
    const el = dialogRef.current
    if (el === null) return
    if (minimized) {
      if (el.open) el.close()
    } else if (!el.open) {
      el.showModal()
    }
  }, [minimized])
  useEffect(
    () =>
      window.api.onWorkbuddyRedrawResult((r) => {
        const cur = redrawRef.current
        if (cur === null || r.taskId !== cur.taskId) return
        const key = cur.byNumber.get(r.figure)
        if (key === undefined) return
        const nextSvgs = new Map(svgsRef.current).set(key, r.svg)
        svgsRef.current = nextSvgs
        setSvgs(nextSvgs)
        setUseSvg((s) => new Set(s).add(key))
        const total = cur.byNumber.size
        const receivedCount = [...cur.byNumber.values()].filter((k) => nextSvgs.has(k)).length
        onSessionUpdateRef.current?.({
          redrawProgress: { received: receivedCount, total },
          unappliedCount: nextSvgs.size,
          ...(receivedCount >= total ? { arrived: true } : {})
        })
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

  const sharpen = async (mode: 'normal' | 'none', options: EnhanceOptions = {}): Promise<void> => {
    setNote(null)
    const newAssets: Asset[] = []
    const changes: Array<{ ref: FigureRef; assetId: string }> = []
    // 同一张图片被多处使用时只处理一次
    const done = new Map<string, Asset>()
    for (let k = 0; k < selected.length; k++) {
      const e = selected[k]!
      setProgress(`正在${opName(mode, options)} ${k + 1}/${selected.length}…`)
      const asset = assetOf(e)
      if (asset === undefined) continue
      let next = done.get(asset.id)
      if (next === undefined) {
        const r = await sharpenAsset(asset, mode, options)
        if (r === null) continue
        next = r
        done.set(asset.id, r)
        newAssets.push(r)
      }
      changes.push({ ref: e.ref, assetId: next.id })
    }
    dispatch({ type: 'replace-figure-assets', assets: newAssets, changes })
    setProgress(null)
    setNote(`已${opName(mode, options)} ${changes.length} 张插图（可用 Ctrl+Z 撤销）。`)
  }

  const sendRedraw = async (only?: FigureEntry[]): Promise<void> => {
    setNote(null)
    setConnectClients([])
    const list = only ?? selected
    const status = await window.api.workbuddyStatus()
    if (!status.connected) {
      setConnectClients(status.clients.filter((c) => c.found && !c.connected))
      setNote(
        status.found
          ? '还没有连接 WorkBuddy 或 Antigravity（反重力）。点击下方按钮连接一次后，即可直接交给 AI 重绘。'
          : '没有找到 WorkBuddy 或 Antigravity（反重力），请先安装并打开一次其中任意一个。'
      )
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

  const connectClient = async (client: McpClientStatus): Promise<void> => {
    const r = await window.api.workbuddyConnect(client.id)
    if (!r.ok) {
      setNote(r.error)
      return
    }
    setConnectClients([])
    setNote(
      client.id === 'antigravity'
        ? '已连接 Antigravity（反重力）。请在 Antigravity 的“… → MCP Servers”刷新或新开会话确认 teaching-plan 已启用，然后再点“让 AI 重绘”。'
        : '已连接 WorkBuddy。如果 WorkBuddy 正开着，请在它的“连接器 → MCP”中确认 teaching-plan 已启用（或重启 WorkBuddy），然后再点“让 AI 重绘”。'
    )
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
  const redrawProgress = redraw === null ? null : { received, total: redraw.byNumber.size }
  useEffect(() => {
    onSessionUpdateRef.current?.({
      redrawProgress,
      unappliedCount: svgs.size
    })
  }, [redrawProgress?.received, redrawProgress?.total, svgs.size])
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
        if (onMinimize !== undefined && (redraw !== null || svgs.size > 0)) {
          onMinimize()
        } else {
          onClose()
        }
      }}
    >
      <div className="image-import-head">
        <div className="image-import-head-title">
          <h2 id="figure-batch-title">批量处理插图</h2>
          {targetTitle !== undefined && (
            <span className="field-hint">
              {targetTitle !== null ? `目标教学案：《${targetTitle}》` : '原教学案已关闭'}
            </span>
          )}
        </div>
        {onMinimize !== undefined && (
          <button
            type="button"
            onClick={onMinimize}
            title="先收起到后台，等待期间可以继续编辑教学案、切换标签页；收齐重绘插图后会自动提示"
          >
            收起到后台
          </button>
        )}
      </div>
      {reopenHint !== null && (
        <p className="image-import-wb" role="status">
          {reopenHint}
        </p>
      )}
      {targetMissing && (
        <p className="image-import-wb" role="status">
          原教学案已被关闭，无法直接应用；请重新打开原教学案，或关闭本窗口。
        </p>
      )}
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
            已交给 AI 重绘 {redraw.byNumber.size} 张，请到 WorkBuddy 或 Antigravity（反重力）中说：<strong>重绘插图</strong>（已收到 {received}/{redraw.byNumber.size}）
          </span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText('重绘插图').then(() => {
                setCopiedPhrase(true)
                setTimeout(() => setCopiedPhrase(false), 2000)
              })
            }}
          >
            {copiedPhrase ? '已复制 ✓' : '复制这句话'}
          </button>
          {onMinimize !== undefined && (
            <button type="button" className="primary" onClick={onMinimize}>
              后台等待
            </button>
          )}
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
      {(progress ?? note) !== null && (
        <div className={connectClients.length > 0 ? 'image-import-wb' : undefined} role="status">
          <span className={connectClients.length > 0 ? undefined : 'field-hint'}>{progress ?? note}</span>
          {connectClients.map((c) => (
            <button key={c.id} type="button" onClick={() => void connectClient(c)}>
              连接 {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" disabled={progress !== null || selected.length === 0} onClick={() => void sharpen('normal')} title="去掉灰底与杂点、放大（不改变内容）">
          变清晰（{selected.length}）
        </button>
        <button
          type="button"
          disabled={progress !== null || selected.length === 0}
          onClick={() => void sharpen('none', { transparent: true })}
          title="去掉白色底色：白色变为透明（线条边缘半透明，放在任何底色上都没有白边）；不做其他处理"
        >
          去白底（{selected.length}）
        </button>
        <button
          type="button"
          disabled={progress !== null || selected.length === 0}
          onClick={() => void sharpen('none', { autoLevels: true })}
          title="扫描件发灰时：最深的线条拉到接近黑、纸张拉到白，颜色更鲜明（不改变内容）"
        >
          一键加深（{selected.length}）
        </button>
        <button type="button" disabled={progress !== null || selected.length === 0} onClick={() => void sendRedraw()} title="交给 WorkBuddy 或 Antigravity（反重力）重绘为 SVG；收到后与原图对照，选用哪一个">
          让 AI 重绘（{selected.length}）
        </button>
        {svgs.size > 0 && (
          <button type="button" className="primary" disabled={chosen === 0 || targetMissing} onClick={() => void apply()}>
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
