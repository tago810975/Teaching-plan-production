/**
 * 软件设置（首页左侧栏“设置…”）：本机的偏好，保存在 settings.json，对所有教学案生效。
 * 配色、教学案库位置、导入时默认格式预设、导出 Word 时是否默认勾选“知识点重点难点汇总”。
 */
import { useEffect, useRef, useState } from 'react'
import { allPresets } from '@core/presets'
import type { McpClientId, WorkBuddyStatus } from '@shared/ipc'
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
          公式中的字母默认用正体（不倾斜）
        </label>
        <p className="field-hint">
          这是默认设置：每份教学案可以在“版式设置 → 公式字母”中单独切换正体或斜体，以教学案中的设置为准。关闭时默认为 Word 的数学斜体。
        </p>
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

/** AI 自动识别（MCP 连接）：支持 WorkBuddy 与 Antigravity（反重力），连接后在“从图片导入”中可直接交给 AI 识别并自动回传 */
function WorkBuddySetting() {
  const [status, setStatus] = useState<WorkBuddyStatus | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    void window.api.workbuddyStatus().then(setStatus)
  }, [])
  const connect = (id: McpClientId, name: string): void => {
    void window.api.workbuddyConnect(id).then((r) => {
      if (r.ok) {
        setStatus(r.value)
        setNote(
          id === 'antigravity'
            ? '已连接 Antigravity（反重力）。请在 Antigravity 中通过右上角“… → MCP Servers”刷新或新开会话确认 teaching-plan 已启用，之后即可直接说“导入题目”或“导入知识点”。'
            : `已连接 ${name}。如果 ${name} 正开着，请在它的“连接器 → MCP”中确认 teaching-plan 已启用（或重启 ${name}）。`
        )
      } else setNote(r.error)
    })
  }
  const disconnect = (id: McpClientId, name: string): void => {
    void window.api.workbuddyDisconnect(id).then((s) => {
      setStatus(s)
      setNote(`已断开 ${name}。`)
    })
  }
  return (
    <fieldset className="group">
      <legend>AI 自动识别（MCP 连接）</legend>
      <p className="field-hint">
        连接后，在“导入题目 → 图片”中点“交给 AI 识别”，再到已连接的客户端里说“导入题目”，识别结果会自动回到软件。
        连接会在对应客户端的 MCP 配置中加入“teaching-plan”一项（其他配置不受影响）。
      </p>
      {status === null ? (
        <div className="settings-row">
          <span>正在检查…</span>
        </div>
      ) : (
        status.clients.map((c) => (
          <div key={c.id} className="settings-row">
            <span>
              <strong>{c.name}</strong>：
              {c.connected ? '已连接' : c.found ? '未连接' : '未检测到（请先安装并打开一次）'}
            </span>
            {!c.connected ? (
              <button type="button" disabled={!c.found} onClick={() => connect(c.id, c.name)}>
                连接
              </button>
            ) : (
              <button type="button" onClick={() => disconnect(c.id, c.name)}>
                断开
              </button>
            )}
          </div>
        ))
      )}
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
