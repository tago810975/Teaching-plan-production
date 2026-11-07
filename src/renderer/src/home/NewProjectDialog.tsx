/**
 * 新建教学案对话框：输入名称，默认保存到教学案库，也可以改到其他文件夹。
 */
import { useEffect, useRef, useState } from 'react'

interface Props {
  onCreate: (title: string, dir: string | null) => Promise<void>
  onCancel: () => void
}

export function NewProjectDialog({ onCreate, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState('')
  const [dir, setDir] = useState<string | null>(null)
  const [libraryDir, setLibraryDir] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
    void window.api.listProjects().then((r) => {
      if (r.ok) setLibraryDir(r.value.libraryDir)
    })
  }, [])

  const submit = async (): Promise<void> => {
    if (title.trim() === '' || busy) return
    setBusy(true)
    try {
      await onCreate(title.trim(), dir)
    } finally {
      setBusy(false)
    }
  }

  const changeDir = async (): Promise<void> => {
    const picked = await window.api.chooseFolder(dir ?? libraryDir)
    if (picked !== null) setDir(picked)
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="new-project-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id="new-project-title">新建教学案</h2>
      <div className="field">
        <label className="field-label" htmlFor="new-project-name">
          名称
        </label>
        <input
          id="new-project-name"
          type="text"
          autoFocus
          placeholder="例如：动态圆专题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <p className="field-hint">同时作为文件名，以后在编辑界面顶部可以修改名称</p>
      </div>
      <div className="field">
        <span className="field-label">保存位置</span>
        <div className="dialog-location">
          <span className="dialog-path" title={dir ?? libraryDir}>
            {dir ?? (libraryDir === '' ? '教学案库' : `教学案库（${libraryDir}）`)}
          </span>
          <button type="button" className="link" onClick={() => void changeDir()}>
            更改…
          </button>
          {dir !== null && (
            <button type="button" className="link" onClick={() => setDir(null)}>
              改回教学案库
            </button>
          )}
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="primary" disabled={title.trim() === '' || busy} onClick={() => void submit()}>
          {busy ? '正在创建…' : '创建'}
        </button>
      </div>
    </dialog>
  )
}
