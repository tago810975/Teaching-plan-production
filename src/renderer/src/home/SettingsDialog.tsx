/**
 * 软件设置（首页左侧栏“设置…”）：本机的偏好，保存在 settings.json，对所有教学案生效。
 * 配色、教学案库位置、导入时默认格式预设、导出 Word 时是否默认勾选“知识点重点难点汇总”。
 */
import { useEffect, useRef, useState } from 'react'
import { allPresets } from '@core/presets'
import { ThemePicker } from './ThemePicker'
import { themeInfo } from '@shared/themes'
import { effectOn, setEffect, useEffectsVersion, useTheme } from '../theme/theme'
import { useDefaultPreset } from './PresetSelect'
import { setMathUpright, useMathUpright } from '../state/mathUpright'
import { CollageText } from '../theme/CollageText'

interface Props {
  libraryDir: string | null
  /** 教学案库位置改了：首页重新读取 */
  onLibraryChanged: () => Promise<void>
  onClose: () => void
}

export function SettingsDialog({ libraryDir, onLibraryChanged, onClose }: Props) {
  const mathUpright = useMathUpright()
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
      <h2 id="settings-title"><CollageText text="设置" /></h2>

      <fieldset className="group">
        <legend>配色</legend>
        <ThemePicker label="配色" />
        <ThemeEffects />
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
        <legend>公式</legend>
        <label className="checkbox">
          <input type="checkbox" checked={mathUpright} onChange={(e) => setMathUpright(e.target.checked)} />
          公式中的字母用正体（不倾斜）
        </label>
        <p className="field-hint">预览与导出的 Word 都按这里显示；不改动公式本身，随时可以切换。关闭时为 Word 默认的数学斜体。</p>
      </fieldset>
      <WorkBuddySetting />

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

/** WorkBuddy 自动识别：连接后，在“从图片导入”中可以把图片交给 WorkBuddy 识别，结果自动回到软件 */
function WorkBuddySetting() {
  const [status, setStatus] = useState<{ found: boolean; connected: boolean; configPath: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    void window.api.workbuddyStatus().then(setStatus)
  }, [])
  return (
    <fieldset className="group">
      <legend>WorkBuddy 自动识别</legend>
      <p className="field-hint">
        连接后，在“导入题目 → 图片”中点“交给 WorkBuddy 识别”，再到 WorkBuddy 里说“导入题目”，识别结果会自动回到软件。
        连接会在 WorkBuddy 的配置中加入“teaching-plan”一项（其他连接器不受影响）。
      </p>
      <div className="settings-row">
        <span>
          {status === null
            ? '正在检查…'
            : status.connected
              ? '已连接'
              : status.found
                ? '未连接'
                : '没有找到 WorkBuddy（请先安装并打开一次 WorkBuddy）'}
        </span>
        {status !== null && !status.connected && (
          <button
            type="button"
            disabled={!status.found}
            onClick={() => {
              void window.api.workbuddyConnect().then((r) => {
                if (r.ok) {
                  setStatus(r.value)
                  setNote('已连接。如果 WorkBuddy 正开着，请在它的“连接器 → MCP”中确认 teaching-plan 已启用，或重启 WorkBuddy。')
                } else setNote(r.error)
              })
            }}
          >
            连接 WorkBuddy
          </button>
        )}
        {status?.connected === true && (
          <button
            type="button"
            onClick={() => {
              void window.api.workbuddyDisconnect().then((s) => {
                setStatus(s)
                setNote('已断开。')
              })
            }}
          >
            断开
          </button>
        )}
      </div>
      {note !== null && <p className="field-hint">{note}</p>}
    </fieldset>
  )
}

/** 当前主题若是风格主题：逐项开关它的动效；关掉的改用常规主题的效果 */
function ThemeEffects() {
  const theme = useTheme()
  useEffectsVersion()
  const info = themeInfo(theme)
  if (info.effects === undefined) return null
  return (
    <div className="theme-effects">
      <p className="theme-effects-title">“{info.name}”的动效</p>
      <div className="theme-effects-list">
        {info.effects.map((fx) => (
          <label key={fx.id} className="checkbox">
            <input type="checkbox" checked={effectOn(theme, fx.id)} onChange={(e) => setEffect(theme, fx.id, e.target.checked)} />
            {fx.name}
          </label>
        ))}
      </div>
      <p className="field-hint">关掉的一项改用常规主题的效果。系统开启“减弱动态效果”时，所有动效都会关闭。</p>
    </div>
  )
}
