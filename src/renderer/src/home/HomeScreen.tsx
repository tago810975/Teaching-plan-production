/**
 * 首页：管理全部教学案。列出教学案库中的工程和最近打开过的工程，
 * 可以新建、打开、搜索，或在文件夹中找到对应文件。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LibraryListing, ProjectListItem } from '@shared/ipc'

interface Props {
  onOpen: (filePath: string) => void
  onOpenOther: () => void
  onNew: () => void
  onOpenDemo: () => void
  onCreateFromDocx: () => void
}

export function HomeScreen({ onOpen, onOpenOther, onNew, onOpenDemo, onCreateFromDocx }: Props) {
  const [listing, setListing] = useState<LibraryListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    const result = await window.api.listProjects()
    if (result.ok) {
      setListing(result.value)
      setError(null)
    } else setError(result.error)
  }, [])

  useEffect(() => {
    void refresh()
    // 切回窗口时刷新，以反映在资源管理器中做的增删改
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (listing?.items ?? [])
      .filter((item) => q === '' || displayName(item).toLowerCase().includes(q))
      .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
  }, [listing, query])

  const changeLibrary = async (): Promise<void> => {
    const result = await window.api.chooseLibraryDir()
    if (!result.ok) setError(result.error)
    else if (result.value !== null) void refresh()
  }

  return (
    <div className="home">
      <header className="home-head">
        <h1 className="home-title">教学案制作</h1>
        <div className="home-actions">
          <button type="button" className="primary" onClick={onNew}>
            新建教学案
          </button>
          <button type="button" onClick={onCreateFromDocx} title="识别 Word 文档中的题目，生成一份新的教学案">
            从 Word 文档新建…
          </button>
          <button type="button" onClick={onOpenOther}>
            打开其他位置的教学案…
          </button>
          <button type="button" className="link" onClick={onOpenDemo}>
            打开示例
          </button>
        </div>
      </header>

      {error !== null && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            知道了
          </button>
        </div>
      )}

      <section className="home-list" aria-labelledby="home-list-title">
        <div className="home-list-bar">
          <h2 id="home-list-title">我的教学案</h2>
          <input
            type="search"
            className="home-search"
            placeholder="按名称查找"
            aria-label="按名称查找教学案"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {listing !== null && (
            <p className="home-library">
              教学案库：<span className="home-library-path">{listing.libraryDir}</span>
              <button type="button" className="link" onClick={() => window.api.revealInFolder(listing.libraryDir)}>
                打开文件夹
              </button>
              <button type="button" className="link" onClick={() => void changeLibrary()}>
                更改…
              </button>
            </p>
          )}
        </div>

        {listing === null ? (
          <p className="home-empty">正在读取教学案…</p>
        ) : listing.items.length === 0 ? (
          <p className="home-empty">库里还没有教学案。点“新建教学案”开始制作第一份。</p>
        ) : items.length === 0 ? (
          <p className="home-empty">没有名称包含“{query}”的教学案。</p>
        ) : (
          <table className="home-table">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col" className="num">
                  题目
                </th>
                <th scope="col">修改时间</th>
                <th scope="col">位置</th>
                <th scope="col">
                  <span className="visually-hidden">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Row
                  key={item.filePath}
                  item={item}
                  libraryDir={listing.libraryDir}
                  onOpen={onOpen}
                  onRemoved={() => void refresh()}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Row(props: {
  item: ProjectListItem
  libraryDir: string
  onOpen: (filePath: string) => void
  onRemoved: () => void
}) {
  const { item, libraryDir, onOpen, onRemoved } = props
  const usable = item.status === 'ok'
  const open = (): void => {
    if (usable) onOpen(item.filePath)
  }

  return (
    <tr
      className={usable ? 'home-row' : 'home-row is-unavailable'}
      onDoubleClick={open}
      title={usable ? '双击打开' : undefined}
    >
      <td>
        <button type="button" className="home-row-name" disabled={!usable} onClick={open}>
          {displayName(item)}
        </button>
        {item.summary !== undefined && fileStem(item.filePath) !== item.summary.title && (
          <span className="home-row-file">文件：{fileStem(item.filePath)}.tplan</span>
        )}
        {item.status === 'missing' && <span className="home-row-status">文件已被移动或删除</span>}
        {item.status === 'error' && <span className="home-row-status">无法读取：{item.error}</span>}
      </td>
      <td className="num">{item.summary?.questionCount ?? ''}</td>
      <td className="nowrap">{item.modifiedAt === undefined ? '' : formatTime(item.modifiedAt)}</td>
      <td className="home-row-path" title={item.filePath}>
        {item.inLibrary ? relativeToLibrary(item.filePath, libraryDir) : item.filePath}
      </td>
      <td className="home-row-actions">
        {item.status !== 'missing' && (
          <button type="button" className="link" onClick={() => window.api.revealInFolder(item.filePath)}>
            在文件夹中显示
          </button>
        )}
        {!item.inLibrary && (
          <button
            type="button"
            className="link"
            onClick={() => void window.api.removeRecent(item.filePath).then(onRemoved)}
          >
            从列表中移除
          </button>
        )}
      </td>
    </tr>
  )
}

function displayName(item: ProjectListItem): string {
  return item.summary?.title ?? fileStem(item.filePath)
}

function fileStem(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  return name.replace(/\.tplan$/i, '')
}

/** 按“最近修改或最近打开”中较晚的时间排序 */
function sortKey(item: ProjectListItem): string {
  const a = item.modifiedAt ?? ''
  const b = item.openedAt ?? ''
  return a > b ? a : b
}

function relativeToLibrary(filePath: string, libraryDir: string): string {
  const rel = filePath.slice(libraryDir.length).replace(/^[\\/]+/, '')
  const parts = rel.split(/[\\/]/)
  parts.pop()
  return parts.length === 0 ? '教学案库' : `教学案库 › ${parts.join(' › ')}`
}

function formatTime(iso: string): string {
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
