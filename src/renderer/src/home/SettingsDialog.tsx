/**
 * 软件设置（首页左侧栏“设置…”）：本机的偏好，保存在 settings.json，对所有教学案生效。
 * 配色、教学案库位置、导入时默认格式预设、导出 Word 时是否默认勾选“知识点重点难点汇总”。
 */
import { useEffect, useRef, useState } from 'react'
import { allPresets } from '@core/presets'
import { ThemePicker } from './ThemePicker'
import { useDefaultPreset } from './PresetSelect'

interface Props {
  libraryDir: string | null
  /** 教学案库位置改了：首页重新读取 */
  onLibraryChanged: () => Promise<void>
  onClose: () => void
}

export function SettingsDialog({ libraryDir, onLibraryChanged, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [points, setPoints] = useState<boolean | null>(null)
  const [presetId, setPresetId] = useDefaultPreset()
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
    void window.api.getExportPointsDefault().then(setPoints)
  }, [])

  const changeLibrary = async (): Promise<void> => {
    setChoosing(true)
    setLibraryError(null)
    try {
      const result = await window.api.chooseLibraryDir()
      if (!result.ok) setLibraryError(result.error)
      else if (result.value !== null) await onLibraryChanged()
    } finally {
      setChoosing(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <h2 id="settings-title">设置</h2>

      <fieldset className="group">
        <legend>配色</legend>
        <ThemePicker label="配色" />
      </fieldset>

      <fieldset className="group">
        <legend>教学案库</legend>
        <div className="dialog-location">
          <span className="dialog-path" title={libraryDir ?? undefined}>
            {libraryDir ?? '正在读取…'}
          </span>
          {libraryDir !== null && (
            <button type="button" onClick={() => window.api.revealInFolder(libraryDir)}>
              打开文件夹
            </button>
          )}
          <button type="button" disabled={choosing} onClick={() => void changeLibrary()}>
            更改…
          </button>
        </div>
        {libraryError !== null && <p className="field-error">{libraryError}</p>}
        <p className="field-hint">新建的教学案保存在这里，首页会列出其中的全部教学案。</p>
      </fieldset>

      <fieldset className="group">
        <legend>导入</legend>
        <label className="settings-row" htmlFor="default-preset">
          <span>默认格式预设</span>
          <select
            id="default-preset"
            value={presetId}
            onChange={(e) => {
              setPresetId(e.target.value)
              void window.api.setDefaultPreset(e.target.value)
            }}
          >
            {allPresets().map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <p className="field-hint">从 Word 文档新建、新建教学案时默认选中它，每次仍可以改。</p>
      </fieldset>

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
        {/* 打开时焦点放在“完成”上，而不是第一个色块，免得一打开就显示色块的焦点框 */}
        <button type="button" className="primary" autoFocus onClick={onClose}>
          完成
        </button>
      </div>
    </dialog>
  )
}
