import { useCallback, useReducer, useState } from 'react'
import { createEmptyBundle, DEFAULT_TEMPLATE_ID } from '@core/model/factory'
import { createDemoBundle } from '@core/sample/demo-project'
import { Editor } from './Editor'
import { ErrorBanner } from './ErrorBanner'
import { HomeScreen } from './home/HomeScreen'
import { NewProjectDialog } from './home/NewProjectDialog'
import type { ImportReport } from '@shared/ipc'
import { editorReducer, initEditorState } from './state/store'
import { useProjectFile } from './state/useProjectFile'
import { getPreset } from '@core/presets'
import { CreateFromDocxDialog } from './home/CreateFromDocxDialog'

export function App() {
  const [state, dispatch] = useReducer(editorReducer, createEmptyBundle(), initEditorState)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [demoError, setDemoError] = useState<string | null>(null)
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const files = useProjectFile(state, dispatch, {
    onRequestNew: () => setNewDialogOpen(true),
    onRequestExport: () => setExportOpen(true),
    templateId: DEFAULT_TEMPLATE_ID
  })

  const openDemo = useCallback(async () => {
    const defaults = await window.api.getTemplateDefaults(DEFAULT_TEMPLATE_ID)
    if (!defaults.ok) setDemoError(defaults.error)
    const bundle = await createDemoBundle(defaults.ok ? defaults.value : undefined)
    dispatch({ type: 'load', bundle, filePath: null })
  }, [])

  // 从 Word 新建：null 为关闭；filePath 为首页中选中的文档（否则弹出选择文件的对话框）
  const [fromDocx, setFromDocx] = useState<{ filePath?: string } | null>(null)
  const createFromDocx = useCallback(async (presetId: string, filePath?: string) => {
    const templateId = getPreset(presetId).templateId
    const result = filePath !== undefined ? await window.api.createFromDocxAt(filePath, templateId, presetId) : await window.api.createFromDocx(templateId, presetId)
    if (!result.ok) setDemoError(result.error)
    else if (result.value !== null) {
      const { opened, report } = result.value
      dispatch({ type: 'load', bundle: opened.bundle, filePath: opened.filePath })
      setImportReport(report)
    }
  }, [])

  const error = files.error ?? demoError
  const dismissError = (): void => {
    files.dismissError()
    setDemoError(null)
  }

  return (
    <>
      {state.screen === 'home' ? (
        <>
          {error !== null && <ErrorBanner message={error} onDismiss={dismissError} />}
          <HomeScreen
            onOpen={(path) => void files.openAt(path)}
            onOpenOther={() => void files.openProject()}
            onNew={files.newProject}
            onOpenDemo={() => void openDemo()}
            onCreateFromDocx={(filePath) => setFromDocx(filePath !== undefined ? { filePath } : {})}
          />
        </>
      ) : (
        <Editor
          state={state}
          dispatch={dispatch}
          files={files}
          error={error}
          onDismissError={dismissError}
          importReport={importReport}
          onImportReport={setImportReport}
          onError={setDemoError}
          exportOpen={exportOpen}
          onExportOpenChange={setExportOpen}
        />
      )}
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
    </>
  )
}
