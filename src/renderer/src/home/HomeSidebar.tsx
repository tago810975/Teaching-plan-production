/**
 * 首页左侧栏（参照 WPS）：新建 / 打开，最近、教学案库，以及“本地”中的桌面、文档、下载与各磁盘。
 * 文件夹可以逐级展开（用到时才读取子文件夹），点击后在右侧列出其中的教学案与 Word 文档。
 */
import { useEffect, useState } from 'react'
import type { LocalPlace } from '@shared/ipc'
import { ThemePicker } from './ThemePicker'

export type HomeView = { kind: 'recent' } | { kind: 'folder'; path: string; title?: string }

interface Props {
  view: HomeView
  places: LocalPlace[]
  libraryDir: string | null
  onView: (view: HomeView) => void
  onNew: () => void
  onCreateFromDocx: () => void
  onOpenOther: () => void
  /** 打开模板管理 */
  onTemplates: () => void
  onSettings: () => void
}

export function HomeSidebar({ view, places, libraryDir, onView, onNew, onCreateFromDocx, onOpenOther, onTemplates, onSettings }: Props) {
  const current = view.kind === 'folder' ? view.path : null
  // 当前文件夹只在“离它最近”的那个位置下展开、高亮（如桌面在 C 盘里，点桌面时不展开 C 盘）
  const scope =
    current === null
      ? null
      : (places
          .filter((p) => samePath(p.path, current) || isInside(current, p.path))
          .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null)

  return (
    <nav className="home-side" aria-label="首页导航">
      <div className="home-side-actions">
        <button type="button" className="primary home-new" onClick={onNew}>
          ＋ 新建教学案
        </button>
        <button type="button" onClick={onCreateFromDocx} title="识别 Word 文档中的题目，生成一份新的教学案">
          从 Word 文档新建…
        </button>
        <button type="button" onClick={() => window.api.openMoanImport()} title="登录墨案（老教学案系统），把其中的教案导入成教学案">
          从墨案导入…
        </button>
        <button type="button" onClick={onOpenOther}>
          打开…
        </button>
        <button type="button" onClick={onTemplates} title="内置模板与自制模板：复制、导入、导出">
          模板…
        </button>
        <button type="button" onClick={onSettings} title="本机的偏好设置（如导出时默认导出哪些文档）">
          设置…
        </button>
      </div>

      <ul className="home-nav">
        <li>
          <button type="button" className={view.kind === 'recent' ? 'home-nav-item is-active' : 'home-nav-item'} onClick={() => onView({ kind: 'recent' })}>
            <span className="nav-icon" aria-hidden="true">
              🕘
            </span>
            最近
          </button>
        </li>
        {libraryDir !== null && (
          <li>
            <button
              type="button"
              className={current !== null && samePath(current, libraryDir) ? 'home-nav-item is-active' : 'home-nav-item'}
              onClick={() => onView({ kind: 'folder', path: libraryDir, title: '教学案库' })}
              title={libraryDir}
            >
              <span className="nav-icon" aria-hidden="true">
                📚
              </span>
              教学案库
            </button>
          </li>
        )}
      </ul>

      <h2 className="home-side-heading">本地</h2>
      <ul className="folder-tree" role="tree" aria-label="本地文件夹">
        {places.map((p) => (
          <FolderNode key={p.path} name={p.label} path={p.path} icon={ICONS[p.kind]} depth={0} current={p.path === scope ? current : null} onOpen={(path, name) => onView({ kind: 'folder', path, ...(path === p.path ? { title: p.label } : { title: name }) })} />
        ))}
      </ul>

      <ThemePicker />
    </nav>
  )
}

const ICONS: Record<LocalPlace['kind'], string> = { desktop: '🖥', documents: '📄', downloads: '⬇', drive: '💽' }

function FolderNode(props: {
  name: string
  path: string
  icon?: string
  depth: number
  current: string | null
  onOpen: (path: string, name: string) => void
}) {
  const { name, path, icon, depth, current, onOpen } = props
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<Array<{ name: string; path: string }> | null>(null)
  // 当前打开的文件夹在这个文件夹里面时，自动展开（如在右侧双击进入了子文件夹）
  const contains = current !== null && isInside(current, path)
  useEffect(() => {
    if (contains && !open) setOpen(true)
  }, [contains, open])
  useEffect(() => {
    if (open && children === null) void window.api.listSubfolders(path).then(setChildren)
  }, [open, children, path])

  const active = current !== null && samePath(current, path)
  return (
    <li role="treeitem" aria-expanded={open} aria-selected={active}>
      <div className={active ? 'folder-row is-active' : 'folder-row'} style={{ paddingLeft: 6 + depth * 14 }}>
        <button
          type="button"
          className="folder-toggle"
          aria-label={open ? `收起“${name}”` : `展开“${name}”`}
          onClick={() => setOpen((o) => !o)}
          disabled={children !== null && children.length === 0}
        >
          {children !== null && children.length === 0 ? '' : open ? '▾' : '▸'}
        </button>
        <button type="button" className="folder-name" title={path} onClick={() => onOpen(path, name)}>
          <span className="nav-icon" aria-hidden="true">
            {icon ?? '📁'}
          </span>
          {name}
        </button>
      </div>
      {open && children !== null && children.length > 0 && (
        <ul role="group">
          {children.map((c) => (
            <FolderNode key={c.path} name={c.name} path={c.path} depth={depth + 1} current={current} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** 路径比较（Windows 不区分大小写，忽略末尾的分隔符） */
export function samePath(a: string, b: string): boolean {
  const n = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  return n(a) === n(b)
}

function isInside(p: string, dir: string): boolean {
  const n = (x: string): string => x.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const d = n(dir)
  return n(p).startsWith(d === '' ? '/' : `${d}/`)
}
