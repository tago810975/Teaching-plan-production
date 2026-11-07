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

  const createFromDocx = useCallback(async () => {
    const result = await window.api.createFromDocx(DEFAULT_TEMPLATE_ID)
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
            onCreateFromDocx={() => void createFromDocx()}
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
          onCreate={async (title, dir) => {
            await files.createProject(title, dir)
            setNewDialogOpen(false)
          }}
        />
      )}
    </>
  )
}
