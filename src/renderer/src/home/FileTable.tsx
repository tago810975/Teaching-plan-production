/**
 * 首页的文件列表（“最近”与各文件夹共用）：双击或回车打开；右键（或“⋯”按钮）弹出菜单——
 * 打开、导出 Word、重命名、在文件夹中显示、删除（移到回收站）等。F2 重命名，Delete 删除。
 */
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ContextMenu, type MenuItem } from './ContextMenu'

export interface FileItem {
  /** 文件或文件夹的完整路径 */
  path: string
  kind: 'folder' | 'project' | 'docx'
  /** 显示的名称：教学案为其中的名称，其余为文件名 */
  name: string
  /** 文件名（教学案的名称与文件名不同时显示） */
  fileName: string
  status: 'ok' | 'missing' | 'error'
  error?: string
  questionCount?: number
  modifiedAt?: string
  /** “最近”中显示的位置 */
  location?: string
  /** 只在最近打开记录中（不在教学案库里），可以从列表中移除 */
  recentOnly?: boolean
}

export interface FileActions {
  open: (item: FileItem) => void
  exportWord: (item: FileItem) => void
  createFromDocx: (item: FileItem) => void
  rename: (item: FileItem, newStem: string) => Promise<string | null>
  remove: (item: FileItem) => void
  forget: (item: FileItem) => void
}

interface Props {
  items: FileItem[]
  actions: FileActions
  showLocation: boolean
  emptyText: string
}

export function FileTable({ items, actions, showLocation, emptyText }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; item: FileItem } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  if (items.length === 0) return <p className="home-empty">{emptyText}</p>

  const menuItems = (item: FileItem): MenuItem[] => {
    const reveal: MenuItem = { label: '在文件夹中显示', onSelect: () => window.api.revealInFolder(item.path) }
    const rename: MenuItem = { label: '重命名', onSelect: () => setRenaming(item.path) }
    const remove: MenuItem = { label: '删除（移到回收站）', danger: true, onSelect: () => actions.remove(item) }
    const forget: MenuItem[] = item.recentOnly === true ? [{ label: '从最近列表中移除', onSelect: () => actions.forget(item) }] : []
    if (item.kind === 'folder') return [{ label: '打开', onSelect: () => actions.open(item) }, reveal]
    // 文件已在别处被删除或移动：只能从列表中移除（不论原来是否在教学案库中）
    if (item.status === 'missing') return [{ label: '从列表中移除', onSelect: () => actions.forget(item) }]
    if (item.kind === 'docx') {
      return [{ label: '用这个 Word 文档新建教学案…', onSelect: () => actions.createFromDocx(item) }, 'separator', rename, reveal, 'separator', remove]
    }
    const ok = item.status === 'ok'
    return [
      { label: '打开', disabled: !ok, onSelect: () => actions.open(item) },
      { label: '导出 Word…', disabled: !ok, onSelect: () => actions.exportWord(item) },
      'separator',
      rename,
      reveal,
      'separator',
      remove,
      ...forget
    ]
  }

  const openMenu = (e: MouseEvent, item: FileItem): void => {
    e.preventDefault()
    setSelected(item.path)
    setMenu({ x: e.clientX, y: e.clientY, item })
  }

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, item: FileItem): void => {
    if (renaming !== null) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (item.kind === 'docx') actions.createFromDocx(item)
      else if (item.status === 'ok') actions.open(item)
    } else if (e.key === 'F2' && item.kind !== 'folder' && item.status !== 'missing') {
      e.preventDefault()
      setRenaming(item.path)
    } else if (e.key === 'Delete' && item.kind !== 'folder') {
      e.preventDefault()
      // 已不存在的文件：Delete 从列表中移除
      if (item.status === 'missing') actions.forget(item)
      else actions.remove(item)
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      setMenu({ x: r.left + 40, y: r.bottom - 4, item })
    }
  }

  return (
    <>
      <table className="home-table">
        <thead>
          <tr>
            <th scope="col">名称</th>
            <th scope="col" className="num">
              题目
            </th>
            <th scope="col">修改时间</th>
            {showLocation && <th scope="col">位置</th>}
            <th scope="col">
              <span className="visually-hidden">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.path}
              tabIndex={0}
              className={[
                'home-row',
                item.status !== 'ok' ? 'is-unavailable' : '',
                selected === item.path ? 'is-selected' : ''
              ].join(' ')}
              onClick={() => setSelected(item.path)}
              onDoubleClick={() => {
                if (renaming === item.path) return
                if (item.kind === 'docx') actions.createFromDocx(item)
                else if (item.status === 'ok') actions.open(item)
              }}
              onContextMenu={(e) => openMenu(e, item)}
              onKeyDown={(e) => onRowKey(e, item)}
              title={item.kind === 'docx' ? '双击：用这个 Word 文档新建教学案' : item.status === 'ok' ? '双击打开；右键查看更多操作' : undefined}
            >
              <td>
                <div className="home-row-main">
                  <span className={`file-icon file-icon--${item.kind}`} aria-hidden="true" />
                  {renaming === item.path ? (
                    <RenameInput
                      item={item}
                      onDone={async (stem) => {
                        if (stem === null) {
                          setRenaming(null)
                          return
                        }
                        const problem = await actions.rename(item, stem)
                        if (problem === null) setRenaming(null)
                      }}
                    />
                  ) : (
                    <span className="home-row-name">{item.name}</span>
                  )}
                </div>
                {item.kind === 'project' && item.name !== stem(item.fileName) && renaming !== item.path && (
                  <span className="home-row-file">文件：{item.fileName}</span>
                )}
                {item.status === 'missing' && <span className="home-row-status">文件已被移动或删除</span>}
                {item.status === 'error' && <span className="home-row-status">无法读取：{item.error}</span>}
              </td>
              <td className="num">{item.questionCount ?? ''}</td>
              <td className="nowrap">{item.modifiedAt === undefined ? '' : formatTime(item.modifiedAt)}</td>
              {showLocation && (
                <td className="home-row-path" title={item.path}>
                  {item.location}
                </td>
              )}
              <td className="home-row-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`“${item.name}”的更多操作`}
                  title="更多操作"
                  onClick={(e) => {
                    e.stopPropagation()
                    const r = e.currentTarget.getBoundingClientRect()
                    setSelected(item.path)
                    setMenu({ x: r.left, y: r.bottom + 2, item })
                  }}
                >
                  ⋯
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.item)} label={`“${menu.item.name}”的操作`} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

/** 就地重命名：回车确定，Esc 取消，离开输入框时确定（名称没变时不改）；失败时可以改了再试 */
function RenameInput({ item, onDone }: { item: FileItem; onDone: (stem: string | null) => Promise<void> }) {
  const original = stem(item.fileName)
  const [value, setValue] = useState(original)
  const busy = useRef(false)
  const finish = (v: string | null): void => {
    if (busy.current) return
    busy.current = true
    void onDone(v === null || v.trim() === original ? null : v.trim()).finally(() => {
      busy.current = false
    })
  }
  return (
    <input
      className="home-rename"
      autoFocus
      aria-label="新名称"
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
    />
  )
}

export function stem(fileName: string): string {
  return fileName.replace(/\.(tplan|docx)$/i, '')
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  if (t >= startOfToday) return `今天 ${hm}`
  if (t >= startOfToday - 86400000) return `昨天 ${hm}`
  const date = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === now.getFullYear() ? date : `${d.getFullYear()}年${date}`
}
