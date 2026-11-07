/**
 * 文件相关操作：新建、打开、保存、另存为，以及响应菜单、关闭窗口、双击文件打开。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'
import type { MenuCommand } from '@shared/ipc'
import type { EditorAction, EditorState } from './store'

const DISCARD_PROMPT = '当前教学案有未保存的修改，确定要放弃这些修改吗？'

export interface ProjectFileActions {
  /** 新建：弹出新建对话框 */
  newProject(): void
  /** 新建对话框中点击“创建” */
  createProject(title: string, dir: string | null): Promise<void>
  openAt(filePath: string): Promise<void>
  /** 关闭当前教学案，回到首页 */
  closeProject(): void
  openProject(): Promise<void>
  /** 返回是否保存成功（用户取消“另存为”时为 false） */
  save(saveAs?: boolean): Promise<boolean>
  /** 最近一次操作的错误信息 */
  error: string | null
  dismissError(): void
}

export interface ProjectFileOptions {
  /** 启动时没有通过文件关联传入工程文件时调用 */
  onNoStartupFile?: () => void
  /** 请求新建教学案（显示新建对话框） */
  onRequestNew?: () => void
  /** 请求导出 Word（显示导出对话框） */
  onRequestExport?: () => void
  templateId: string
}

export function useProjectFile(
  state: EditorState,
  dispatch: Dispatch<EditorAction>,
  options: ProjectFileOptions
): ProjectFileActions {
  const [error, setError] = useState<string | null>(null)
  // 事件回调中需要读取最新状态，用 ref 避免反复注册监听
  const stateRef = useRef(state)
  stateRef.current = state

  const confirmDiscard = (): boolean => !stateRef.current.dirty || window.confirm(DISCARD_PROMPT)

  const requestNewRef = useRef(options.onRequestNew)
  requestNewRef.current = options.onRequestNew
  const requestExportRef = useRef(options.onRequestExport)
  requestExportRef.current = options.onRequestExport
  const newProject = useCallback(() => {
    if (!confirmDiscard()) return
    requestNewRef.current?.()
  }, [])

  const createProject = useCallback(
    async (title: string, dir: string | null) => {
      const result = await window.api.createProject({ title, dir, templateId: options.templateId })
      if (result.ok) dispatch({ type: 'load', bundle: result.value.bundle, filePath: result.value.filePath })
      else setError(result.error)
    },
    [dispatch, options.templateId]
  )

  const closeProject = useCallback(() => {
    if (stateRef.current.screen === 'home' || !confirmDiscard()) return
    dispatch({ type: 'close' })
  }, [dispatch])

  const openAt = useCallback(
    async (filePath: string) => {
      if (!confirmDiscard()) return
      const result = await window.api.openProjectAt(filePath)
      if (result.ok) dispatch({ type: 'load', bundle: result.value.bundle, filePath: result.value.filePath })
      else setError(result.error)
    },
    [dispatch]
  )

  const openProject = useCallback(async () => {
    if (!confirmDiscard()) return
    const result = await window.api.openProject()
    if (!result.ok) setError(result.error)
    else if (result.value !== null) {
      dispatch({ type: 'load', bundle: result.value.bundle, filePath: result.value.filePath })
    }
  }, [dispatch])

  const save = useCallback(
    async (saveAs = false): Promise<boolean> => {
      const { bundle, filePath } = stateRef.current
      const result = await window.api.saveProject({
        bundle,
        filePath,
        saveAs,
        suggestedName: bundle.project.meta.title
      })
      if (!result.ok) {
        setError(result.error)
        return false
      }
      if (result.value === null) return false
      // 保存期间若有新的修改，仍保持“未保存”状态
      if (stateRef.current.bundle === bundle) dispatch({ type: 'saved', filePath: result.value })
      return true
    },
    [dispatch]
  )

  // 菜单命令
  useEffect(() => {
    return window.api.onMenuCommand((command: MenuCommand) => {
      switch (command) {
        case 'new':
          newProject()
          break
        case 'open':
          void openProject()
          break
        case 'save':
          if (stateRef.current.screen === 'editor') void save(false)
          break
        case 'save-as':
          if (stateRef.current.screen === 'editor') void save(true)
          break
        case 'export-word':
          if (stateRef.current.screen === 'editor') requestExportRef.current?.()
          break
        case 'close':
          closeProject()
          break
      }
    })
  }, [newProject, openProject, save, closeProject])

  // 关闭窗口时选择了“保存”
  useEffect(() => {
    return window.api.onSaveBeforeClose(() => {
      void save(false).then((ok) => {
        if (ok) window.api.confirmClose()
      })
    })
  }, [save])

  // 双击 .tplan 文件打开（应用已在运行时）
  useEffect(() => window.api.onOpenFileRequest((path) => void openAt(path)), [openAt])

  // 启动时通过文件关联传入的文件。开发模式下 StrictMode 会执行两次 effect，用 ref 保证只处理一次
  const startedRef = useRef(false)
  const onNoStartupFile = useRef(options.onNoStartupFile)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void window.api.getStartupFile().then((path) => {
      if (path !== null) void openAt(path)
      else onNoStartupFile.current?.()
    })
  }, [openAt])

  // 同步窗口标题与“未保存”标记
  const title = state.screen === 'home' ? '首页' : state.bundle.project.meta.title
  useEffect(() => {
    window.api.setWindowState({ title, dirty: state.dirty })
  }, [title, state.dirty])

  return {
    newProject,
    createProject,
    openAt,
    closeProject,
    openProject,
    save,
    error,
    dismissError: () => setError(null)
  }
}
