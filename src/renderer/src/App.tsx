import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react'
import { DEFAULT_TEMPLATE_ID } from '@core/model/factory'
import { createDemoBundle } from '@core/sample/demo-project'
import { Editor, type EditorFiles } from './Editor'
import { ErrorBanner } from './ErrorBanner'
import { HomeScreen } from './home/HomeScreen'
import { NewProjectDialog } from './home/NewProjectDialog'
import type { ImportReport } from '@shared/ipc'
import type { EditorAction } from './state/store'
import { useWorkspaceFiles } from './state/useWorkspaceFiles'
import { activeTab, EMPTY_WORKSPACE, workspaceReducer, type Tab, type WorkspaceAction } from './state/workspace'
import { getPreset } from '@core/presets'
import { CreateFromDocxDialog } from './home/CreateFromDocxDialog'
import { TabTransition } from './TabTransition'
import { TabBar } from './TabBar'

export function App() {
  const [ws, dispatch] = useReducer(workspaceReducer, EMPTY_WORKSPACE)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [demoError, setDemoError] = useState<string | null>(null)
  // 导入报告只在对应的标签页中显示
  const [importReport, setImportReport] = useState<{ tabId: string; report: ImportReport } | null>(null)
  const [exportTab, setExportTab] = useState<string | null>(null)

  const files = useWorkspaceFiles(ws, dispatch, {
    onRequestNew: () => setNewDialogOpen(true),
    onRequestExport: (id) => setExportTab(id)
  })

  const openDemo = useCallback(async () => {
    const defaults = await window.api.getTemplateDefaults(DEFAULT_TEMPLATE_ID)
    if (!defaults.ok) setDemoError(defaults.error)
    const bundle = await createDemoBundle(defaults.ok ? defaults.value : undefined)
    files.openBundle(bundle, null)
  }, [files])

  // 从 Word 新建：null 为关闭；filePath 为首页中选中的文档（否则弹出选择文件的对话框）
  const [fromDocx, setFromDocx] = useState<{ filePath?: string } | null>(null)
  const wsRef = useRef(ws)
  wsRef.current = ws
  const createFromDocx = useCallback(
    async (presetId: string, filePath?: string) => {
      const templateId = getPreset(presetId).templateId
      const result = filePath !== undefined ? await window.api.createFromDocxAt(filePath, templateId, presetId) : await window.api.createFromDocx(templateId, presetId)
      if (!result.ok) setDemoError(result.error)
      else if (result.value !== null) {
        const { opened, report } = result.value
        files.openBundle(opened.bundle, opened.filePath)
        // 新开的标签页即为当前标签页（在下一次渲染时生效）
        queueMicrotask(() => {
          const id = wsRef.current.active
          if (id !== null) setImportReport({ tabId: id, report })
        })
      }
    },
    [files]
  )

  // Ctrl+Tab / Ctrl+Shift+Tab 切换标签页
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        dispatch({ type: 'cycle', delta: e.shiftKey ? -1 : 1 })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const error = files.error ?? demoError
  const dismissError = (): void => {
    files.dismissError()
    setDemoError(null)
  }
  const tab = activeTab(ws)
  const openPaths = ws.tabs.flatMap((t) => (t.state.filePath !== null ? [t.state.filePath] : []))

  return (
    <div className="app-shell">
      <TabBar
        tabs={ws.tabs}
        active={ws.active}
        onActivate={(id) => dispatch({ type: 'activate', id })}
        onClose={(id) => void files.closeTab(id)}
        onMove={(id, toIndex) => dispatch({ type: 'move-tab', id, toIndex })}
        onNew={files.newProject}
      />
      {/* 必须排在内容区之前：它要在旧页面被移除之前拍下快照 */}
      <TabTransition activeKey={ws.active ?? 'home'} />
      <div className="app-shell-body">
        {tab === null ? (
          <>
            {error !== null && <ErrorBanner message={error} onDismiss={dismissError} />}
            <HomeScreen
              openPaths={openPaths}
              onOpen={(path) => void files.openAt(path)}
              onOpenOther={() => void files.openProject()}
              onNew={files.newProject}
              onOpenDemo={() => void openDemo()}
              onCreateFromDocx={(filePath) => setFromDocx(filePath !== undefined ? { filePath } : {})}
            />
          </>
        ) : (
          <TabEditor
            key={tab.id}
            tab={tab}
            workspaceDispatch={dispatch}
            files={files}
            error={error}
            onDismissError={dismissError}
            importReport={importReport?.tabId === tab.id ? importReport.report : null}
            onImportReport={(report) => setImportReport(report === null ? null : { tabId: tab.id, report })}
            onError={setDemoError}
            exportOpen={exportTab === tab.id}
            onExportOpenChange={(open) => setExportTab(open ? tab.id : null)}
          />
        )}
      </div>
      {newDialogOpen && (
        <NewProjectDialog
          onCancel={() => setNewDialogOpen(false)}
          onCreate={async (title, dir, presetId) => {
            await files.createProject(title, dir, presetId)
            setNewDialogOpen(false)
          }}
        />
      )}
      {fromDocx !== null && (
        <CreateFromDocxDialog
          {...(fromDocx.filePath !== undefined ? { filePath: fromDocx.filePath } : {})}
          onCancel={() => setFromDocx(null)}
          onChoose={async (presetId) => {
            await createFromDocx(presetId, fromDocx.filePath)
            setFromDocx(null)
          }}
        />
      )}
    </div>
  )
}

/** 预览滚动位置：切换标签页回来时恢复 */
const scrollPositions = new Map<string, number>()

/** 一个标签页的编辑器：动作交给工作区中对应的标签页处理 */
function TabEditor(props: {
  tab: Tab
  workspaceDispatch: Dispatch<WorkspaceAction>
  files: ReturnType<typeof useWorkspaceFiles>
  error: string | null
  onDismissError: () => void
  importReport: ImportReport | null
  onImportReport: (report: ImportReport | null) => void
  onError: (message: string) => void
  exportOpen: boolean
  onExportOpenChange: (open: boolean) => void
}) {
  const { tab, workspaceDispatch, files, ...rest } = props
  const id = tab.id
  const dispatch = useCallback((action: EditorAction) => workspaceDispatch({ type: 'doc', id, action }), [workspaceDispatch, id])
  const editorFiles: EditorFiles = useMemo(
    () => ({ save: (saveAs?: boolean) => files.save(id, saveAs), goHome: () => workspaceDispatch({ type: 'activate', id: null }) }),
    [files, id, workspaceDispatch]
  )

  // 记住并恢复预览的滚动位置（预览排版需要一点时间，内容够高了再恢复）
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.preview')
    if (el === null) return
    const saved = scrollPositions.get(id) ?? 0
    let frames = 0
    let raf = 0
    const restore = (): void => {
      if (el.scrollHeight - el.clientHeight >= saved || frames++ > 120) el.scrollTop = saved
      else raf = requestAnimationFrame(restore)
    }
    if (saved > 0) raf = requestAnimationFrame(restore)
    const onScroll = (): void => {
      scrollPositions.set(id, el.scrollTop)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
  }, [id])

  return <Editor state={tab.state} dispatch={dispatch} files={editorFiles} {...rest} />
}
