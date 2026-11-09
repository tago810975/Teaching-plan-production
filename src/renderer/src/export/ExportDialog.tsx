/**
 * 导出 Word 对话框：选择版本（教案 / 学案）与保存位置。
 */
import { useEffect, useRef, useState } from 'react'
import type { ProjectBundle, Variant } from '@core/model/types'
import { rasterizeForWord } from './rasterize'
import { exportFileName } from '@shared/export-name'

interface Props {
  bundle: ProjectBundle
  projectPath: string | null
  onDone: (files: string[]) => void
  onCancel: () => void
}

const VERSIONS: ReadonlyArray<readonly [Variant, string, string]> = [
  ['teacher', '教案', '教师版：含答案、知识点、重点难点与详解'],
  ['student', '学案', '学生版：只有题目，题后留出作答空间']
]

export function ExportDialog({ bundle, projectPath, onDone, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [variants, setVariants] = useState<Variant[]>(['teacher', 'student'])
  const [dir, setDir] = useState<string>('')
  const [baseName, setBaseName] = useState(bundle.project.meta.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
    void window.api.defaultExportDir(projectPath).then(setDir)
  }, [projectPath])

  const toggle = (v: Variant): void =>
    setVariants((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : VERSIONS.map(([x]) => x).filter((x) => x === v || cur.includes(x))))

  const submit = async (): Promise<void> => {
    if (variants.length === 0 || dir === '' || baseName.trim() === '' || busy) return
    setError(null)
    const existing = await window.api.exportCheck(dir, baseName.trim(), variants)
    if (existing.length > 0 && !window.confirm(`以下文件已存在，要覆盖吗？\n\n${existing.join('\n')}`)) return
    setBusy(true)
    try {
      const replacementAssets = await rasterizeForWord(bundle)
      const result = await window.api.exportWord({ bundle, variants, dir, baseName: baseName.trim(), replacementAssets })
      if (result.ok) onDone(result.value.files)
      else setError(result.error)
    } catch (err) {
      setError(`导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="export-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <h2 id="export-title">导出 Word</h2>

      <div className="field">
        <span className="field-label">导出版本</span>
        {VERSIONS.map(([v, name, hint]) => (
          <label key={v} className="checkbox export-version">
            <input type="checkbox" checked={variants.includes(v)} onChange={() => toggle(v)} />
            <span>
              {name}
              <span className="field-hint export-version-hint">{hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="export-name">
          文件名
        </label>
        <input id="export-name" type="text" value={baseName} onChange={(e) => setBaseName(e.target.value)} />
        <p className="field-hint">
          {variants.length === 0
            ? '请至少选择一个版本'
            : variants.map((v) => exportFileName(baseName.trim() || '…', v)).join('、')}
        </p>
      </div>

      <div className="field">
        <span className="field-label">保存位置</span>
        <div className="dialog-location">
          <span className="dialog-path" title={dir}>
            {dir || '…'}
          </span>
          <button
            type="button"
            className="link"
            onClick={() => void window.api.chooseFolder(dir).then((d) => d !== null && setDir(d))}
          >
            更改…
          </button>
        </div>
      </div>

      {error !== null && <p className="field-error">{error}</p>}

      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || variants.length === 0 || baseName.trim() === '' || dir === ''}
          onClick={() => void submit()}
        >
          {busy ? '正在导出…' : '导出'}
        </button>
      </div>
    </dialog>
  )
}

/** 导出完成提示：可直接用 Word 打开或打开所在文件夹 */
export function ExportDoneNotice({ files, onDismiss }: { files: string[]; onDismiss: () => void }) {
  const [openError, setOpenError] = useState<string | null>(null)
  return (
    <div className="notice notice--success" role="status">
      <div>
        <p className="notice-title">已导出 {files.length} 个 Word 文档。</p>
        <ul className="notice-files">
          {files.map((f) => (
            <li key={f}>
              <span className="notice-file-name">{f.split(/[\\/]/).pop()}</span>
              <button
                type="button"
                className="link"
                onClick={() => void window.api.openPath(f).then((e) => setOpenError(e === null ? null : `无法打开：${e}`))}
              >
                打开
              </button>
            </li>
          ))}
        </ul>
        {openError !== null && <p className="field-error">{openError}</p>}
      </div>
      <div className="notice-actions">
        <button type="button" onClick={() => window.api.revealInFolder(files[0]!)}>
          打开所在文件夹
        </button>
        <button type="button" onClick={onDismiss}>
          知道了
        </button>
      </div>
    </div>
  )
}
