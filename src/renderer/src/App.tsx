import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react'
import { buildDocument } from '@core/document/build'
import { DEFAULT_TEMPLATE_ID } from '@core/model/factory'
import { createDemoBundle } from '@core/sample/demo-project'
import { Editor, type EditorFiles } from './Editor'
import { ErrorBanner } from './ErrorBanner'
import { HomeScreen } from './home/HomeScreen'
import { NewProjectDialog } from './home/NewProjectDialog'
import type { ImportReport } from '@shared/ipc'
import { findBlock, type EditorAction } from './state/store'
import { useWorkspaceFiles } from './state/useWorkspaceFiles'
import { activeTab, EMPTY_WORKSPACE, workspaceReducer, type Tab, type WorkspaceAction } from './state/workspace'
import {
  describeSessionPill,
  dismissImageImportNotice,
  minimizeImageImportSession,
  openImageImportSession,
  resolveImportTargetTab,
  restoreImageImportSession,
  updateImageImportSession,
  type ImageImportKind,
  type ImageImportSession
} from './state/imageImportSession'
import {
  describeFigureRedrawPill,
  dismissFigureRedrawNotice,
  minimizeFigureRedrawSession,
  openFigureRedrawSession,
  restoreFigureRedrawSession,
  updateFigureRedrawSession,
  type FigureBatchInitial,
  type FigureRedrawSession
} from './state/figureRedrawSession'
import { getPreset } from '@core/presets'
import { CreateFromDocxDialog } from './home/CreateFromDocxDialog'
import { FigureBatchDialog } from './figures/FigureBatchDialog'
import { ImageImportDialog } from './import/ImageImportDialog'
import { WorkBuddyReadyNotice } from './import/WorkBuddyReadyNotice'
import { TabTransition } from './TabTransition'
import { TabBar, type BackgroundTaskPill } from './TabBar'
import { useMathUpright } from './state/mathUpright'

export function App() {
  // 公式字母用正体（设置中修改）：整个界面中的公式预览都按它
  const mathUpright = useMathUpright()
  useEffect(() => {
    document.body.classList.toggle('math-upright', mathUpright)
  }, [mathUpright])
  const [ws, dispatch] = useReducer(workspaceReducer, EMPTY_WORKSPACE)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [demoError, setDemoError] = useState<string | null>(null)
  // 导入报告只在对应的标签页中显示
  const [importReport, setImportReport] = useState<{ tabId: string; report: ImportReport } | null>(null)
  const [exportTab, setExportTab] = useState<string | null>(null)
  // 从图片导入 / 批量插图重绘会话：提升到工作区，收起到后台时可继续在任意标签页或首页操作
  const [imageImport, setImageImport] = useState<ImageImportSession | null>(null)
  const [figureBatch, setFigureBatch] = useState<FigureRedrawSession | null>(null)

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
  // 保留着编辑器的标签页（最近使用的 KEEP_ALIVE 个，当前的排第一）；其余的切回来时重新创建
  const aliveRef = useRef<string[]>([])
  {
    const ids = new Set(ws.tabs.map((t) => t.id))
    const list = aliveRef.current.filter((id) => ids.has(id) && id !== ws.active)
    aliveRef.current = (ws.active !== null ? [ws.active, ...list] : list).slice(0, KEEP_ALIVE)
  }
  const alive = aliveRef.current
  const openPaths = ws.tabs.flatMap((t) => (t.state.filePath !== null ? [t.state.filePath] : []))

  const importTarget =
    imageImport === null
      ? { tab: null as Tab | null, fellBack: false }
      : (() => {
          const resolved = resolveImportTargetTab(
            imageImport.tabId,
            ws.tabs.map((t) => t.id),
            ws.active
          )
          return {
            tab: resolved.tabId !== null ? (ws.tabs.find((t) => t.id === resolved.tabId) ?? null) : null,
            fellBack: resolved.fellBack
          }
        })()
  const importTargetTitle = importTarget.tab !== null ? (importTarget.tab.state.bundle.project.meta.title || '未命名教学案') : null
  const batchTab = figureBatch !== null ? (ws.tabs.find((t) => t.id === figureBatch.tabId) ?? null) : null
  const batchTargetTitle = batchTab !== null ? (batchTab.state.bundle.project.meta.title || '未命名教学案') : null
  const batchQuestionNumbers = useMemo(() => {
    const map = new Map<string, string>()
    if (figureBatch === null || batchTab === null) return map
    const ir = buildDocument(batchTab.state.bundle.project, batchTab.state.variant)
    for (const p of ir.paragraphs) {
      if (p.style === 'question' && p.label !== undefined && !map.has(p.sourceBlockId)) {
        map.set(p.sourceBlockId, p.label)
      }
    }
    return map
  }, [figureBatch !== null, batchTab?.state.bundle.project, batchTab?.state.variant])
  const dispatchBatch = useCallback(
    (action: EditorAction) => {
      if (figureBatch === null) return
      dispatch({ type: 'doc', id: figureBatch.tabId, action })
      if (action.type === 'replace-figure-assets') dispatch({ type: 'activate', id: figureBatch.tabId })
    },
    [figureBatch?.tabId]
  )

  const backgroundTasks: BackgroundTaskPill[] = []
  if (imageImport !== null && imageImport.minimized) {
    const pill = describeSessionPill(imageImport)
    backgroundTasks.push({
      id: 'image-import',
      label: pill.label,
      tone: pill.tone,
      title: importTargetTitle !== null ? `点击还原图片导入窗口（目标：《${importTargetTitle}》）` : '点击还原图片导入窗口',
      cancelLabel: '取消图片导入',
      onRestore: () => setImageImport((s) => (s === null ? null : restoreImageImportSession(s))),
      onCancel: () => setImageImport(null)
    })
  }
  if (figureBatch !== null && figureBatch.minimized) {
    const pill = describeFigureRedrawPill(figureBatch)
    backgroundTasks.push({
      id: 'figure-redraw',
      label: pill.label,
      tone: pill.tone,
      title: batchTargetTitle !== null ? `点击还原插图重绘窗口（目标：《${batchTargetTitle}》）` : '点击还原插图重绘窗口',
      cancelLabel: '取消插图重绘',
      onRestore: () => setFigureBatch((s) => (s === null ? null : restoreFigureRedrawSession(s))),
      onCancel: () => setFigureBatch(null)
    })
  }

  return (
    <div className="app-shell">
      <TabBar
        tabs={ws.tabs}
        active={ws.active}
        onActivate={(id) => dispatch({ type: 'activate', id })}
        onClose={(id) => void files.closeTab(id)}
        onMove={(id, toIndex) => dispatch({ type: 'move-tab', id, toIndex })}
        onNew={files.newProject}
        backgroundTasks={backgroundTasks}
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
              onRename={files.renamePath}
              onCreateFromDocx={(filePath) => setFromDocx(filePath !== undefined ? { filePath } : {})}
            />
          </>
        ) : null}
        {/* 最近使用的几个标签页的编辑器保留着，只隐藏后台的：切回来时不必重新排版、测量分页、渲染 */}
        {ws.tabs
          .filter((t) => alive.includes(t.id))
          .map((t) => (
            <TabEditor
              key={t.id}
              tab={t}
              active={t.id === ws.active}
              workspaceDispatch={dispatch}
              files={files}
              error={t.id === ws.active ? error : null}
              onDismissError={dismissError}
              importReport={importReport?.tabId === t.id ? importReport.report : null}
              onImportReport={(report) => setImportReport(report === null ? null : { tabId: t.id, report })}
              onError={setDemoError}
              exportOpen={exportTab === t.id}
              onExportOpenChange={(open) => setExportTab(open ? t.id : null)}
              onOpenImageImport={(kind: ImageImportKind) => {
                setImageImport((cur) => {
                  const curTarget =
                    cur === null
                      ? null
                      : (() => {
                          const r = resolveImportTargetTab(
                            cur.tabId,
                            wsRef.current.tabs.map((x) => x.id),
                            wsRef.current.active
                          )
                          const target = r.tabId !== null ? wsRef.current.tabs.find((x) => x.id === r.tabId) : undefined
                          return target?.state.bundle.project.meta.title || null
                        })()
                  return openImageImportSession(cur, {
                    tabId: t.id,
                    kind,
                    presetId: t.state.bundle.project.presetId,
                    currentTargetTitle: curTarget
                  })
                })
              }}
              onOpenFigureBatch={(initial) => {
                setFigureBatch((cur) => {
                  const curTarget =
                    cur === null ? null : (wsRef.current.tabs.find((x) => x.id === cur.tabId)?.state.bundle.project.meta.title || null)
                  return openFigureRedrawSession(cur, {
                    tabId: t.id,
                    initial: initial ?? {},
                    currentTargetTitle: curTarget
                  })
                })
              }}
            />
          ))}
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
      {imageImport !== null && (
        <ImageImportDialog
          kind={imageImport.kind}
          presetId={importTarget.tab?.state.bundle.project.presetId ?? imageImport.presetId}
          minimized={imageImport.minimized}
          onMinimize={() => setImageImport((s) => (s === null ? null : minimizeImageImportSession(s)))}
          targetTitle={importTargetTitle}
          targetFellBack={importTarget.fellBack}
          reopenHint={imageImport.reopenHint}
          onSessionUpdate={(patch) => setImageImport((s) => (s === null ? null : updateImageImportSession(s, patch)))}
          onCancel={() => setImageImport(null)}
          onImport={(blocks, assets, report) => {
            const target = importTarget.tab
            if (target === null) return
            const afterBlockId = findBlock(target.state.bundle.project.blocks, target.state.selectedBlockId)?.id ?? null
            dispatch({ type: 'activate', id: target.id })
            dispatch({ type: 'doc', id: target.id, action: { type: 'insert-blocks', blocks, assets, afterBlockId } })
            setImportReport({ tabId: target.id, report })
            setImageImport(null)
          }}
        />
      )}
      {figureBatch !== null && (
        <FigureBatchDialog
          key={figureBatch.sessionKey}
          blocks={batchTab?.state.bundle.project.blocks ?? []}
          assets={batchTab?.state.bundle.assets ?? {}}
          questionNumbers={batchQuestionNumbers}
          dispatch={dispatchBatch}
          initial={figureBatch.initial}
          minimized={figureBatch.minimized}
          onMinimize={() => setFigureBatch((s) => (s === null ? null : minimizeFigureRedrawSession(s)))}
          targetTitle={batchTargetTitle}
          targetMissing={batchTab === null}
          reopenHint={figureBatch.reopenHint}
          onSessionUpdate={(patch) => setFigureBatch((s) => (s === null ? null : updateFigureRedrawSession(s, patch)))}
          onClose={() => setFigureBatch(null)}
        />
      )}
      <div className="wb-toast-stack">
        {imageImport !== null &&
          imageImport.minimized &&
          !imageImport.noticeDismissed &&
          imageImport.receivedNonce > 0 &&
          imageImport.lastArrivalKind !== null && (
            <WorkBuddyReadyNotice
              kind={imageImport.kind}
              arrivalKind={imageImport.lastArrivalKind}
              summary={imageImport.receivedSummary}
              redrawProgress={imageImport.redrawProgress}
              targetTitle={importTargetTitle}
              onOpen={() => setImageImport((s) => (s === null ? null : restoreImageImportSession(s)))}
              onDismiss={() => setImageImport((s) => (s === null ? null : dismissImageImportNotice(s)))}
            />
          )}
        {figureBatch !== null &&
          figureBatch.minimized &&
          !figureBatch.noticeDismissed &&
          figureBatch.receivedNonce > 0 && (
            <WorkBuddyReadyNotice
              kind="questions"
              arrivalKind="redraw"
              summary={null}
              redrawProgress={figureBatch.redrawProgress}
              targetTitle={batchTargetTitle}
              actionLabel="查看并应用"
              onOpen={() => setFigureBatch((s) => (s === null ? null : restoreFigureRedrawSession(s)))}
              onDismiss={() => setFigureBatch((s) => (s === null ? null : dismissFigureRedrawNotice(s)))}
            />
          )}
      </div>
    </div>
  )
}

/** 最多保留几个标签页的编辑器（每个都占内存：几十页的教学案约几十 MB） */
const KEEP_ALIVE = 4

/** 预览滚动位置：切换标签页回来时恢复 */
const scrollPositions = new Map<string, number>()

/** 一个标签页的编辑器：动作交给工作区中对应的标签页处理 */
function TabEditor(props: {
  tab: Tab
  active: boolean
  workspaceDispatch: Dispatch<WorkspaceAction>
  files: ReturnType<typeof useWorkspaceFiles>
  error: string | null
  onDismissError: () => void
  importReport: ImportReport | null
  onImportReport: (report: ImportReport | null) => void
  onError: (message: string) => void
  exportOpen: boolean
  onExportOpenChange: (open: boolean) => void
  onOpenImageImport: (kind: ImageImportKind) => void
  onOpenFigureBatch: (initial?: FigureBatchInitial) => void
}) {
  const { tab, active, workspaceDispatch, files, ...rest } = props
  const id = tab.id
  const dispatch = useCallback((action: EditorAction) => workspaceDispatch({ type: 'doc', id, action }), [workspaceDispatch, id])
  const editorFiles: EditorFiles = useMemo(
    () => ({
      save: (saveAs?: boolean) => files.save(id, saveAs),
      rename: (newStem: string) => files.renameTab(id, newStem),
      goHome: () => workspaceDispatch({ type: 'activate', id: null })
    }),
    [files, id, workspaceDispatch]
  )

  // 记住并恢复预览的滚动位置（预览排版需要一点时间，内容够高了再恢复）
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`.app[data-tab="${CSS.escape(id)}"] .preview`)
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

  return <Editor state={tab.state} dispatch={dispatch} files={editorFiles} inactive={!active} tabId={id} {...rest} />
}
