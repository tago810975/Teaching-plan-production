/**
 * 转移插图对话框：当图片识别或导入把某张图放错题目 / 放错分组（题图、答案、解析）时，
 * 一键或按下拉选择将它移到目标题目 / 知识点 / 综合题与目标插图组（一步 Ctrl+Z 撤销）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FigureListName, FigureRef } from '@core/document/ir'
import { listFigureTargets, type FigureTargetBlock, type MoveFigureTarget } from '@core/model/figure-lists'
import type { Asset, Block } from '@core/model/types'
import { useAssetUrls } from '../preview/assets'

interface Props {
  blocks: Block[]
  assets: Record<string, Asset>
  questionNumbers: ReadonlyMap<string, string>
  from: FigureRef
  assetId: string
  sourceLabel: string
  onConfirm: (to: MoveFigureTarget) => void
  onClose: () => void
}

function defaultListFor(target: FigureTargetBlock, preferred: FigureListName | undefined): FigureListName | undefined {
  if (target.lists.some((item) => item.list === preferred)) return preferred
  return target.lists[0]?.list
}

function initialSelection(
  targets: FigureTargetBlock[],
  from: FigureRef
): { blockId: string; list: FigureListName | undefined } {
  const curIdx = targets.findIndex((t) => t.blockId === from.blockId)
  const next = curIdx >= 0 && curIdx < targets.length - 1 ? targets[curIdx + 1] : undefined
  const prev = curIdx > 0 ? targets[curIdx - 1] : undefined
  if (next !== undefined) {
    return { blockId: next.blockId, list: defaultListFor(next, from.list) }
  }
  if (prev !== undefined) {
    return { blockId: prev.blockId, list: defaultListFor(prev, from.list) }
  }
  const current = curIdx >= 0 ? targets[curIdx] : targets[0]
  if (current !== undefined) {
    const otherList = current.lists.find((item) => item.list !== from.list)
    return { blockId: current.blockId, list: otherList !== undefined ? otherList.list : current.lists[0]?.list }
  }
  return { blockId: from.blockId, list: from.list }
}

export function FigureTransferDialog({ blocks, assets, questionNumbers, from, assetId, sourceLabel, onConfirm, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const urls = useAssetUrls(assets)
  const targets = useMemo(() => listFigureTargets(blocks, questionNumbers), [blocks, questionNumbers])

  const initial = useMemo(() => initialSelection(targets, from), [targets, from])
  const [targetBlockId, setTargetBlockId] = useState<string>(initial.blockId)
  const [targetList, setTargetList] = useState<FigureListName | undefined>(initial.list)

  useEffect(() => {
    const el = dialogRef.current
    if (el !== null && !el.open) el.showModal()
  }, [])

  useEffect(() => {
    setTargetBlockId(initial.blockId)
    setTargetList(initial.list)
  }, [initial])

  const currentIdx = targets.findIndex((t) => t.blockId === from.blockId)
  const prevTarget = currentIdx > 0 ? targets[currentIdx - 1] : undefined
  const nextTarget = currentIdx >= 0 && currentIdx < targets.length - 1 ? targets[currentIdx + 1] : undefined
  const selectedTarget = targets.find((t) => t.blockId === targetBlockId) ?? targets[0]
  const isSameSlot = selectedTarget !== undefined && selectedTarget.blockId === from.blockId && targetList === from.list
  const thumbUrl = urls.get(assetId)

  const handleSelectBlock = (nextId: string) => {
    setTargetBlockId(nextId)
    const found = targets.find((t) => t.blockId === nextId)
    if (found !== undefined) {
      setTargetList((cur) => defaultListFor(found, cur))
    }
  }

  const quickMove = (target: FigureTargetBlock) => {
    onConfirm({
      blockId: target.blockId,
      list: defaultListFor(target, from.list)
    })
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog figure-transfer"
      aria-labelledby="figure-transfer-title"
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        onClose()
      }}
    >
      <h2 id="figure-transfer-title">转移插图</h2>

      <div className="figure-transfer-preview">
        <div className="figure-transfer-thumb">
          {thumbUrl !== undefined ? <img src={thumbUrl} alt={sourceLabel} /> : <span>无预览</span>}
        </div>
        <div className="figure-transfer-meta">
          <div className="figure-transfer-current-label">当前位置</div>
          <div className="figure-transfer-current">{sourceLabel}</div>
        </div>
      </div>

      {(prevTarget !== undefined || nextTarget !== undefined) && (
        <div className="figure-transfer-quick">
          <button
            type="button"
            disabled={prevTarget === undefined}
            title={prevTarget?.label ?? '没有上一个内容块'}
            onClick={() => prevTarget !== undefined && quickMove(prevTarget)}
          >
            ← 移到{prevTarget?.kind === 'question' ? '上一题' : '上一项'}
          </button>
          <button
            type="button"
            disabled={nextTarget === undefined}
            title={nextTarget?.label ?? '没有下一个内容块'}
            onClick={() => nextTarget !== undefined && quickMove(nextTarget)}
          >
            移到{nextTarget?.kind === 'question' ? '下一题' : '下一项'} →
          </button>
        </div>
      )}

      <div className="figure-transfer-form">
        <label className="figure-transfer-field">
          <span>目标内容块</span>
          <select value={selectedTarget?.blockId ?? ''} onChange={(e) => handleSelectBlock(e.target.value)}>
            {targets.map((t) => (
              <option key={t.blockId} value={t.blockId}>
                {t.label}
                {t.blockId === from.blockId ? '（当前）' : ''}
              </option>
            ))}
          </select>
        </label>

        {selectedTarget !== undefined && (
          <div className="figure-transfer-field">
            <span>目标插图组</span>
            <div className="seg" role="group" aria-label="目标插图组">
              {selectedTarget.lists.map((item) => {
                const active = targetList === item.list
                return (
                  <button
                    key={item.list ?? 'body'}
                    type="button"
                    className={active ? 'active' : undefined}
                    aria-pressed={active}
                    onClick={() => setTargetList(item.list)}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <p className="field-hint">
          {isSameSlot
            ? '不能转移到完全相同的插图组，请选择其他题目、内容块或切换插图组。'
            : '转移后将自动切换到目标位置并高亮该图，可用 Ctrl+Z 一步撤销。'}
        </p>
      </div>

      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={selectedTarget === undefined || isSameSlot}
          onClick={() => {
            if (selectedTarget === undefined) return
            onConfirm({ blockId: selectedTarget.blockId, list: targetList })
          }}
        >
          确认转移
        </button>
      </div>
    </dialog>
  )
}
