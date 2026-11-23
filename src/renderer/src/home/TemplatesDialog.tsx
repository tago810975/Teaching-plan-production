/**
 * 模板管理（首页左侧栏“模板…”）：内置模板（只读）与自制模板（“教学案库\模板”下的文件夹）。
 *
 * - 复制为新模板：把一个模板复制到模板文件夹，id 加 -copy、名称加“（副本）”，老师在其中修改 preset.json 等；
 * - 导入 / 导出：模板文件夹打包成 zip，发给其他老师；
 * - 重新载入：改了 preset.json 之后；
 * - 删除：自制模板的文件夹移到回收站。
 * 改动后在界面中重新登记用户预设（setUserPresets），预设下拉框随之更新。
 */
import { useEffect, useRef, useState } from 'react'
import { setUserPresets } from '@core/presets'
import type { TemplateCatalog } from '@shared/ipc'
import { CollageText } from '../theme/CollageText'

interface Props {
  onClose: () => void
  /** 模板列表变了（预设下拉框需要刷新） */
  onChanged: () => void
}

export function TemplatesDialog({ onClose, onChanged }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
    void window.api.listTemplates().then(setCatalog)
  }, [])

  const apply = (next: TemplateCatalog): void => {
    setUserPresets(next.presets)
    setCatalog(next)
    onChanged()
  }

  /** 执行一项操作：忙时禁用按钮，结果或错误显示在对话框中 */
  const run = async (fn: () => Promise<string | null>): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const info = await fn()
      if (info !== null) setMessage({ kind: 'info', text: info })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const reload = (): Promise<void> =>
    run(async () => {
      const next = await window.api.reloadTemplates()
      apply(next)
      return next.problems.length === 0 ? `已重新载入，共 ${next.user.length} 个自制模板。` : null
    })

  const duplicate = (id: string, name: string): Promise<void> =>
    run(async () => {
      const r = await window.api.duplicateTemplate(id)
      if (!r.ok) throw new Error(r.error)
      apply(r.value)
      return `已复制“${name}”。打开模板文件夹修改其中的 preset.json，改完后点“重新载入”。`
    })

  const exportOne = (id: string): Promise<void> =>
    run(async () => {
      const r = await window.api.exportTemplate(id)
      if (!r.ok) throw new Error(r.error)
      return r.value === null ? null : `已导出到 ${r.value}`
    })

  const importOne = (): Promise<void> =>
    run(async () => {
      const r = await window.api.importTemplate()
      if (!r.ok) throw new Error(r.error)
      if (r.value === null) return null
      apply(r.value)
      return '导入完成。'
    })

  const remove = (id: string, name: string): Promise<void> =>
    run(async () => {
      if (!window.confirm(`删除自制模板“${name}”？\n模板文件夹会移到回收站；已用它做的教学案仍可打开，但会改用默认格式。`)) return null
      const r = await window.api.deleteTemplate(id)
      if (!r.ok) throw new Error(r.error)
      apply(r.value)
      return `已删除“${name}”。`
    })

  return (
    <dialog
      ref={dialogRef}
      className="dialog templates-dialog"
      aria-labelledby="templates-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <h2 id="templates-title"><CollageText text="模板" /></h2>
      <p className="field-hint">
        内置模板随软件安装，不能修改；要做自己的模板，先把一个模板“复制为新模板”，再修改模板文件夹中的 preset.json
        （格式预设）、template.docx（Word 模板）与 header/（默认页眉：电话、机构标志、水印），说明见文件夹里的 README.md。
        导入模板压缩包时会自动导入其中的页眉电话与机构标志。
      </p>
      {catalog !== null && (
        <p className="templates-dir">
          模板文件夹：<span className="home-library-path">{catalog.dir}</span>{' '}
          <button type="button" className="link" onClick={() => void window.api.openPath(catalog.dir)}>
            打开
          </button>
        </p>
      )}

      {catalog === null ? (
        <p className="field-hint">正在读取…</p>
      ) : (
        <div className="templates-list">
          <h3>内置模板</h3>
          <ul>
            {catalog.builtin.map((t) => (
              <li key={t.id} className="templates-item">
                <div className="templates-item-text">
                  <strong>{t.name}</strong>
                  <span className="field-hint">{t.description}</span>
                </div>
                <span className="templates-item-actions">
                  <button type="button" disabled={busy} onClick={() => void duplicate(t.id, t.name)}>
                    复制为新模板
                  </button>
                  <button type="button" disabled={busy} onClick={() => void exportOne(t.id)}>
                    导出…
                  </button>
                </span>
              </li>
            ))}
          </ul>

          <h3>自制模板</h3>
          {catalog.user.length === 0 ? (
            <p className="field-hint">还没有自制模板。</p>
          ) : (
            <ul>
              {catalog.user.map((t) => (
                <li key={t.id} className="templates-item">
                  <div className="templates-item-text">
                    <strong>{t.name}</strong>
                    <span className="field-hint">
                      {t.description}
                      {t.hasWordTemplate ? '' : '（没有自己的 Word 模板，使用内置的）'}
                    </span>
                  </div>
                  <span className="templates-item-actions">
                    <button type="button" disabled={busy} onClick={() => void window.api.openPath(t.dir)}>
                      打开文件夹
                    </button>
                    <button type="button" disabled={busy} onClick={() => void duplicate(t.id, t.name)}>
                      复制
                    </button>
                    <button type="button" disabled={busy} onClick={() => void exportOne(t.id)}>
                      导出…
                    </button>
                    <button type="button" disabled={busy} onClick={() => void remove(t.id, t.name)}>
                      删除
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {catalog.problems.length > 0 && (
            <div className="templates-problems" role="alert">
              <h3>没能载入的模板</h3>
              <ul>
                {catalog.problems.map((p) => (
                  <li key={p.folder}>
                    <strong>{p.folder}</strong>：{p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {message !== null && <p className={message.kind === 'error' ? 'templates-message is-error' : 'templates-message'}>{message.text}</p>}

      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={() => void importOne()}>
          导入模板…
        </button>
        <button type="button" disabled={busy} onClick={() => void reload()}>
          重新载入
        </button>
        <button type="button" className="primary" onClick={onClose}>
          关闭
        </button>
      </div>
    </dialog>
  )
}
