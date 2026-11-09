/**
 * 多个教学案（标签页）的文件操作：新建、打开、保存、另存为、关闭标签页，
 * 以及响应菜单、关闭窗口、双击 .tplan 文件打开。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'
import type { MenuCommand } from '@shared/ipc'
import type { ProjectBundle } from '@core/model/types'
import { getPreset } from '@core/presets'
import { activeTab, findTabByPath, type Workspace, type WorkspaceAction } from './workspace'

export interface WorkspaceFiles {
  /** 新建：弹出新建对话框 */
  newProject(): void
  /** 新建对话框中点击“创建” */
  createProject(title: string, dir: string | null, presetId: string): Promise<void>
  /** 打开文件：已在某个标签页中打开时切换过去 */
  openAt(filePath: string): Promise<void>
  /** 用“打开”对话框选择文件 */
  openProject(): Promise<void>
  /** 打开内存中的教学案（示例、从 Word 新建） */
  openBundle(bundle: ProjectBundle, filePath: string | null): void
  /** 关闭标签页；有未保存的修改时询问。返回是否已关闭 */
  closeTab(id: string): Promise<boolean>
  /** 保存某个标签页；返回是否保存成功（用户取消“另存为”时为 false） */
  save(id: string, saveAs?: boolean): Promise<boolean>
  error: string | null
  dismissError(): void
}

export interface WorkspaceFileOptions {
  onRequestNew?: () => void
  onRequestExport?: (tabId: string) => void
}

export function useWorkspaceFiles(ws: Workspace, dispatch: Dispatch<WorkspaceAction>, options: WorkspaceFileOptions): WorkspaceFiles {
  const [error, setError] = useState<string | null>(null)
  // 事件回调中需要读取最新状态，用 ref 避免反复注册监听
  const wsRef = useRef(ws)
  wsRef.current = ws
  const optionsRef = useRef(options)
  optionsRef.current = options

  const openBundle = useCallback((bundle: ProjectBundle, filePath: string | null) => dispatch({ type: 'open', bundle, filePath }), [dispatch])

  const newProject = useCallback(() => optionsRef.current.onRequestNew?.(), [])

  const createProject = useCallback(
    async (title: string, dir: string | null, presetId: string) => {
      // 预设决定所用的 Word 模板
      const result = await window.api.createProject({ title, dir, templateId: getPreset(presetId).templateId, presetId })
      if (result.ok) openBundle(result.value.bundle, result.value.filePath)
      else setError(result.error)
    },
    [openBundle]
  )

  const openAt = useCallback(
    async (filePath: string) => {
      const open = findTabByPath(wsRef.current, filePath)
      if (open !== undefined) {
        dispatch({ type: 'activate', id: open.id })
        return
      }
      const result = await window.api.openProjectAt(filePath)
      if (result.ok) openBundle(result.value.bundle, result.value.filePath)
      else setError(result.error)
    },
    [dispatch, openBundle]
  )

  const openProject = useCallback(async () => {
    const result = await window.api.openProject()
    if (!result.ok) setError(result.error)
    else if (result.value !== null) openBundle(result.value.bundle, result.value.filePath)
  }, [openBundle])

  const save = useCallback(
    async (id: string, saveAs = false): Promise<boolean> => {
      const tab = wsRef.current.tabs.find((t) => t.id === id)
      if (tab === undefined) return false
      const { bundle, filePath } = tab.state
      const result = await window.api.saveProject({ bundle, filePath, saveAs, suggestedName: bundle.project.meta.title })
      if (!result.ok) {
        setError(result.error)
        return false
      }
      if (result.value === null) return false
      // 另存为的位置已在别的标签页中打开：保存后关掉那个旧标签页，避免两个标签页对应同一文件
      const other = wsRef.current.tabs.find((t) => t.id !== id && t.state.filePath !== null && samePathLoose(t.state.filePath, result.value!))
      if (other !== undefined) dispatch({ type: 'close-tab', id: other.id })
      // 保存期间若有新的修改，仍保持“未保存”状态
      const now = wsRef.current.tabs.find((t) => t.id === id)
      if (now !== undefined && now.state.bundle === bundle) dispatch({ type: 'doc', id, action: { type: 'saved', filePath: result.value } })
      else dispatch({ type: 'doc', id, action: { type: 'set-file-path', filePath: result.value } })
      return true
    },
    [dispatch]
  )

  const closeTab = useCallback(
    async (id: string): Promise<boolean> => {
      const tab = wsRef.current.tabs.find((t) => t.id === id)
      if (tab === undefined) return true
      if (tab.state.dirty) {
        dispatch({ type: 'activate', id })
        const answer = await window.api.askSaveChanges(tab.state.bundle.project.meta.title || '未命名教学案')
        if (answer === 'cancel') return false
        if (answer === 'save' && !(await save(id))) return false
      }
      dispatch({ type: 'close-tab', id })
      return true
    },
    [dispatch, save]
  )

  // 菜单命令：作用于当前标签页
  useEffect(() => {
    return window.api.onMenuCommand((command: MenuCommand) => {
      const tab = activeTab(wsRef.current)
      switch (command) {
        case 'new':
          newProject()
          break
        case 'open':
          void openProject()
          break
        case 'save':
          if (tab !== null) void save(tab.id, false)
          break
        case 'save-as':
          if (tab !== null) void save(tab.id, true)
          break
        case 'export-word':
          if (tab !== null) optionsRef.current.onRequestExport?.(tab.id)
          break
        case 'close':
          if (tab !== null) void closeTab(tab.id)
          break
      }
    })
  }, [newProject, openProject, save, closeTab])

  // 关闭窗口时选择了“保存”：依次保存所有未保存的教学案（另存为时可取消，取消则不关闭窗口）
  useEffect(() => {
    return window.api.onSaveBeforeClose(() => {
      void (async () => {
        for (const tab of wsRef.current.tabs.filter((t) => t.state.dirty)) {
          dispatch({ type: 'activate', id: tab.id })
          if (!(await save(tab.id))) return
        }
        window.api.confirmClose()
      })()
    })
  }, [dispatch, save])

  // 双击 .tplan 文件打开（应用已在运行时）
  useEffect(() => window.api.onOpenFileRequest((path) => void openAt(path)), [openAt])

  // 启动时通过文件关联传入的文件。开发模式下 StrictMode 会执行两次 effect，用 ref 保证只处理一次
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void window.api.getStartupFile().then((path) => {
      if (path !== null) void openAt(path)
    })
  }, [openAt])

  // 同步窗口标题与“未保存”标记
  const tab = activeTab(ws)
  const title = tab === null ? '首页' : tab.state.bundle.project.meta.title
  const dirty = tab?.state.dirty ?? false
  const dirtyTitles = ws.tabs.filter((t) => t.state.dirty).map((t) => t.state.bundle.project.meta.title || '未命名教学案')
  const dirtyKey = dirtyTitles.join('\u0000')
  useEffect(() => {
    window.api.setWindowState({ title, dirty, dirtyTitles: dirtyKey === '' ? [] : dirtyKey.split('\u0000') })
  }, [title, dirty, dirtyKey])

  return { newProject, createProject, openAt, openProject, openBundle, closeTab, save, error, dismissError: () => setError(null) }
}

function samePathLoose(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}
