/**
 * 软件设置（首页左侧栏“设置…”）：本机的偏好，保存在 settings.json，对所有教学案生效。
 * 目前有：导出 Word 时是否默认勾选“知识点重点难点汇总”。
 */
import { useEffect, useRef, useState } from 'react'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [points, setPoints] = useState<boolean | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
    void window.api.getExportPointsDefault().then(setPoints)
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <h2 id="settings-title">设置</h2>
      <fieldset className="group">
        <legend>导出 Word</legend>
        <label className="checkbox">
          <input
            type="checkbox"
            disabled={points === null}
            checked={points === true}
            onChange={(e) => {
              setPoints(e.target.checked)
              void window.api.setExportPointsDefault(e.target.checked)
            }}
          />
          默认同时导出“知识点重点难点汇总”
        </label>
        <p className="field-hint">
          汇总按栏目列出每道题的知识点、重点、难点与审题，文件名为“(T)名称(知识点重点难点).docx”。
          这里只决定导出对话框中是否默认勾选，每次导出时仍可以改。
        </p>
      </fieldset>
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={onClose}>
          完成
        </button>
      </div>
    </dialog>
  )
}
