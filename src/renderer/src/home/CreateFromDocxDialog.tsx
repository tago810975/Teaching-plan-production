/**
 * 从 Word 文档新建：先选格式预设（默认为设置中的“导入时默认预设”），再选择文件。
 */
import { useEffect, useRef, useState } from 'react'
import { PresetSelect, useDefaultPreset } from './PresetSelect'

interface Props {
  /** 首页中选中的 Word 文档；不设时点按钮后选择文件 */
  filePath?: string
  onChoose: (presetId: string) => Promise<void>
  onCancel: () => void
}

export function CreateFromDocxDialog({ filePath, onChoose, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [presetId, setPresetId] = useDefaultPreset()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="from-docx-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id="from-docx-title">从 Word 文档新建</h2>
      {filePath !== undefined && (
        <p className="from-docx-file" title={filePath}>
          文档：{filePath.split(/[\\/]/).pop()}
        </p>
      )}
      <div className="field">
        <label className="field-label" htmlFor="from-docx-preset">
          格式预设
        </label>
        <PresetSelect id="from-docx-preset" value={presetId} onChange={setPresetId} />
      </div>
      <p className="field-hint">按预设识别作业单、整理解析（如【详解】改为【解析】、解析统一为黑色），新的教学案也使用这套格式。</p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onChoose(presetId)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '正在导入…' : filePath !== undefined ? '导入' : '选择 Word 文档…'}
        </button>
      </div>
    </dialog>
  )
}
