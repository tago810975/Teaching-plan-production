/**
 * 首页（参照 WPS）：左侧栏是新建 / 打开、最近、教学案库和本地文件夹；右侧列出文件。
 * 右键文件可以打开、导出 Word、重命名、删除（移到回收站）等。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FolderListing, LibraryListing, LocalPlace, ProjectListItem } from '@shared/ipc'
import type { ProjectBundle } from '@core/model/types'
import { PRESETS } from '@core/presets'
import { ExportDialog, ExportDoneNotice } from '../export/ExportDialog'
import { FileTable, stem, type FileActions, type FileItem } from './FileTable'
import { HomeSidebar, samePath, type HomeView } from './HomeSidebar'
import { useDefaultPreset } from './PresetSelect'

interface Props {
  /** 已在标签页中打开的文件：不能在首页重命名或删除（先关闭标签页） */
  openPaths: string[]
  onOpen: (filePath: string) => void
  onOpenOther: () => void
  onNew: () => void
  onOpenDemo: () => void
  /** 从 Word 文档新建；给出 filePath 时直接用这个文档 */
  onCreateFromDocx: (filePath?: string) => void
}

export function HomeScreen({ openPaths, onOpen, onOpenOther, onNew, onOpenDemo, onCreateFromDocx }: Props) {
  const [view, setView] = useState<HomeView>({ kind: 'recent' })
  const [listing, setListing] = useState<LibraryListing | null>(null)
  const [folder, setFolder] = useState<FolderListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState<{ bundle: ProjectBundle; path: string } | null>(null)
  const [exported, setExported] = useState<string[] | null>(null)
  const [places, setPlaces] = useState<LocalPlace[]>([])
  useEffect(() => {
    void window.api.getLocalPlaces().then(setPlaces)
  }, [])

  const refresh = useCallback(async () => {
    const result = await window.api.listProjects()
    if (result.ok) setListing(result.value)
    else setError(result.error)
    if (view.kind === 'folder') {
      const r = await window.api.listFolder(view.path)
      if (r.ok) setFolder(r.value)
      else {
        setFolder(null)
        setError(r.error)
      }
    }
  }, [view])

  useEffect(() => {
    void refresh()
    // 切回窗口时刷新，以反映在资源管理器中做的增删改
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const go = (v: HomeView): void => {
    setQuery('')
    if (v.kind === 'folder') setFolder(null)
    setView(v)
  }

  const items: FileItem[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all =
      view.kind === 'recent'
        ? (listing?.items ?? []).slice().sort((a, b) => sortKey(b).localeCompare(sortKey(a))).map((i) => fromListItem(i, listing!.libraryDir))
        : (folder?.entries ?? []).map(
            (e): FileItem => ({
              path: e.path,
              kind: e.kind,
              name: e.kind === 'project' ? (e.summary?.title ?? stem(e.name)) : e.name,
              fileName: e.name,
              status: e.error !== undefined ? 'error' : 'ok',
              ...(e.error !== undefined ? { error: e.error } : {}),
              ...(e.summary !== undefined ? { questionCount: e.summary.questionCount } : {}),
              ...(e.modifiedAt !== undefined ? { modifiedAt: e.modifiedAt } : {})
            })
          )
    return all.filter((i) => q === '' || i.name.toLowerCase().includes(q) || i.fileName.toLowerCase().includes(q))
  }, [view, listing, folder, query])

  // 在本软件之外删除或移动了的文件
  const missing = (listing?.items ?? []).filter((i) => i.status === 'missing')
  const forgetAll = async (): Promise<void> => {
    for (const i of missing) await window.api.removeRecent(i.filePath)
    await refresh()
  }
  const isOpen = (item: FileItem): boolean => openPaths.some((p) => samePath(p, item.path))
  const actions: FileActions = {
    open: (item) => {
      if (item.kind === 'folder') go({ kind: 'folder', path: item.path })
      else if (item.kind === 'docx') onCreateFromDocx(item.path)
      else onOpen(item.path)
    },
    exportWord: async (item) => {
      const r = await window.api.readProject(item.path)
      if (r.ok) setExporting({ bundle: r.value, path: item.path })
      else setError(r.error)
    },
    createFromDocx: (item) => onCreateFromDocx(item.path),
    rename: async (item, newStem) => {
      if (isOpen(item)) {
        const msg = `“${item.name}”正在上方的标签页中编辑，请先关闭它再重命名。`
        setError(msg)
        return msg
      }
      const r = await window.api.renameFile(item.path, newStem)
      if (!r.ok) {
        setError(r.error)
        return r.error
      }
      await refresh()
      return null
    },
    remove: async (item) => {
      if (isOpen(item)) {
        setError(`“${item.name}”正在上方的标签页中编辑，请先关闭它再删除。`)
        return
      }
      const what = item.kind === 'project' ? '教学案' : 'Word 文档'
      if (!window.confirm(`把${what}“${item.name}”移到回收站？\n\n${item.path}\n\n需要时可以从回收站还原。`)) return
      const r = await window.api.trashFile(item.path)
      if (!r.ok) setError(r.error)
      await refresh()
    },
    forget: async (item) => {
      await window.api.removeRecent(item.path)
      await refresh()
    }
  }

  const libraryDir = listing?.libraryDir ?? null
  // 标题：左侧栏中有的位置用左侧栏上的叫法（如“桌面”），其余用文件夹名
  const title =
    view.kind === 'recent'
      ? '最近'
      : libraryDir !== null && samePath(view.path, libraryDir)
        ? '教学案库'
        : (places.find((p) => samePath(p.path, view.path))?.label ?? view.title ?? lastSegment(view.path))
  const inLibrary = view.kind === 'folder' && libraryDir !== null && samePath(view.path, libraryDir)

  return (
    <div className="home">
      <HomeSidebar
        view={view}
        places={places}
        libraryDir={libraryDir}
        onView={go}
        onNew={onNew}
        onCreateFromDocx={() => onCreateFromDocx()}
        onOpenOther={onOpenOther}
      />

      <main className="home-main">
        {error !== null && (
          <div className="banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              知道了
            </button>
          </div>
        )}

        <div className="home-list-bar">
          <h1 className="home-view-title">{title}</h1>
          <button type="button" className="icon-button" title="刷新" aria-label="刷新" onClick={() => void refresh()}>
            ⟳
          </button>
          {view.kind === 'recent' && missing.length > 0 && (
            <button type="button" className="link" onClick={() => void forgetAll()} title="在本软件之外删除或移动过的文件">
              清除失效项（{missing.length}）
            </button>
          )}
          <input
            type="search"
            className="home-search"
            placeholder="按名称查找"
            aria-label="按名称查找"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {view.kind === 'folder' && folder !== null && <Breadcrumb dir={folder.dir} parent={folder.parent} onGo={(path) => go({ kind: 'folder', path })} />}

        {view.kind === 'recent' ? (
          listing === null ? (
            <p className="home-empty">正在读取教学案…</p>
          ) : (
            <FileTable
              items={items}
              actions={actions}
              showLocation
              emptyText={query !== '' ? `没有名称包含“${query}”的教学案。` : '还没有教学案。点左上角“新建教学案”开始制作第一份。'}
            />
          )
        ) : folder === null ? (
          <p className="home-empty">正在读取文件夹…</p>
        ) : (
          <FileTable
            items={items}
            actions={actions}
            showLocation={false}
            emptyText={query !== '' ? `没有名称包含“${query}”的文件。` : '这个文件夹中没有教学案或 Word 文档。'}
          />
        )}

        <footer className="home-foot">
          {libraryDir !== null && (
            <p className="home-library">
              教学案库：<span className="home-library-path">{libraryDir}</span>
              {!inLibrary && (
                <button type="button" className="link" onClick={() => go({ kind: 'folder', path: libraryDir, title: '教学案库' })}>
                  查看
                </button>
              )}
              <button type="button" className="link" onClick={() => void changeLibrary(setError, refresh)}>
                更改…
              </button>
            </p>
          )}
          <DefaultPresetSetting />
          <button type="button" className="link" onClick={onOpenDemo}>
            打开示例
          </button>
        </footer>
      </main>

      {exported !== null && <ExportDoneNotice files={exported} onDismiss={() => setExported(null)} />}
      {exporting !== null && (
        <ExportDialog
          bundle={exporting.bundle}
          projectPath={exporting.path}
          onCancel={() => setExporting(null)}
          onDone={(files) => {
            setExporting(null)
            setExported(files)
          }}
        />
      )}
    </div>
  )
}

function Breadcrumb({ dir, parent, onGo }: { dir: string; parent: string | null; onGo: (path: string) => void }) {
  // 逐级拆开路径：C:\Users\张老师\文档 → C:\ › Users › 张老师 › 文档
  const sep = dir.includes('\\') ? '\\' : '/'
  const parts = dir.split(/[\\/]+/).filter(Boolean)
  const crumbs: Array<{ label: string; path: string }> = []
  let acc = dir.startsWith('/') ? '/' : ''
  parts.forEach((p, i) => {
    acc = i === 0 ? (dir.startsWith('/') ? `/${p}` : `${p}${sep}`) : `${acc.replace(/[\\/]$/, '')}${sep}${p}`
    crumbs.push({ label: p, path: acc })
  })
  if (dir.startsWith('/')) crumbs.unshift({ label: '/', path: '/' })
  return (
    <nav className="breadcrumb" aria-label="文件夹位置">
      <button type="button" className="icon-button" disabled={parent === null} onClick={() => parent !== null && onGo(parent)} title="上一级" aria-label="上一级">
        ↑
      </button>
      {crumbs.map((c, i) => (
        <span key={c.path} className="breadcrumb-item">
          {i > 0 && <span className="breadcrumb-sep">›</span>}
          {i === crumbs.length - 1 ? (
            <span aria-current="page">{c.label}</span>
          ) : (
            <button type="button" className="link" onClick={() => onGo(c.path)}>
              {c.label}
            </button>
          )}
        </span>
      ))}
      <button type="button" className="link breadcrumb-reveal" onClick={() => window.api.revealInFolder(dir)}>
        在资源管理器中打开
      </button>
    </nav>
  )
}

async function changeLibrary(setError: (e: string) => void, refresh: () => Promise<void>): Promise<void> {
  const result = await window.api.chooseLibraryDir()
  if (!result.ok) setError(result.error)
  else if (result.value !== null) await refresh()
}

function fromListItem(item: ProjectListItem, libraryDir: string): FileItem {
  const fileName = item.filePath.split(/[\\/]/).pop() ?? item.filePath
  return {
    path: item.filePath,
    kind: 'project',
    name: item.summary?.title ?? stem(fileName),
    fileName,
    status: item.status,
    ...(item.error !== undefined ? { error: item.error } : {}),
    ...(item.summary !== undefined ? { questionCount: item.summary.questionCount } : {}),
    ...(item.modifiedAt !== undefined ? { modifiedAt: item.modifiedAt } : {}),
    location: item.inLibrary ? relativeToLibrary(item.filePath, libraryDir) : parentDir(item.filePath),
    recentOnly: !item.inLibrary
  }
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

function parentDir(p: string): string {
  return p.replace(/[\\/][^\\/]*$/, '')
}

function lastSegment(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

/** 设置：导入（从 Word 新建）时默认使用的格式预设；新建教学案时也以它为初始选择 */
function DefaultPresetSetting() {
  const [presetId, setPresetId] = useDefaultPreset()
  return (
    <p className="home-library">
      <label htmlFor="default-preset">导入时默认格式预设：</label>
      <select
        id="default-preset"
        value={presetId}
        onChange={(e) => {
          setPresetId(e.target.value)
          void window.api.setDefaultPreset(e.target.value)
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </p>
  )
}
