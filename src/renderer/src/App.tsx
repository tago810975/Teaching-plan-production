import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useState } from 'react'
import { buildDocument } from '@core/document/build'
import { createEmptyBundle } from '@core/model/factory'
import type { Variant } from '@core/model/types'
import { createDemoBundle } from '@core/sample/demo-project'
import { Inspector } from './panels/Inspector'
import { Outline } from './panels/Outline'
import { useAssetUrls } from './preview/assets'
import { Preview } from './preview/Preview'
import { editorReducer, initEditorState } from './state/store'
import { useProjectFile } from './state/useProjectFile'

export function App() {
  const [state, dispatch] = useReducer(editorReducer, createEmptyBundle(), initEditorState)
  const { project, assets } = state.bundle

  const loadDemo = useCallback(() => {
    void createDemoBundle().then((bundle) => dispatch({ type: 'load', bundle, filePath: null }))
  }, [])
  const files = useProjectFile(state, dispatch, { onNoStartupFile: loadDemo })

  // 预览使用延迟值：快速输入时优先保证输入框流畅，预览稍后跟上
  const deferredProject = useDeferredValue(project)
  const ir = useMemo(() => buildDocument(deferredProject, state.variant), [deferredProject, state.variant])
  const assetUrls = useAssetUrls(assets)
  const [pageCount, setPageCount] = useState(1)

  const questionNumbers = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of ir.paragraphs) {
      if (p.style === 'question' && p.label !== undefined && !map.has(p.sourceBlockId)) {
        map.set(p.sourceBlockId, p.label)
      }
    }
    return map
  }, [ir])

  const selectedBlock = project.blocks.find((b) => b.id === state.selectedBlockId) ?? null
  const select = useCallback((blockId: string) => dispatch({ type: 'select', blockId }), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dispatch({ type: 'select', blockId: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-doc">
          <input
            className="doc-title"
            value={project.meta.title}
            aria-label="教学案名称"
            spellCheck={false}
            onChange={(e) => dispatch({ type: 'set-title', title: e.target.value })}
          />
          <span className="doc-status">{state.dirty ? '未保存' : state.filePath === null ? '尚未保存为文件' : '已保存'}</span>
        </div>

        <div className="segmented segmented--variant" role="radiogroup" aria-label="预览版本">
          {(
            [
              ['teacher', '教师版（教案）'],
              ['student', '学生版（学案）']
            ] as const satisfies ReadonlyArray<readonly [Variant, string]>
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={state.variant === v}
              className={state.variant === v ? 'is-active' : ''}
              onClick={() => dispatch({ type: 'set-variant', variant: v })}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="toolbar-actions">
          <span className="page-count">共 {pageCount} 页</span>
          <button type="button" onClick={() => void files.openProject()}>
            打开
          </button>
          <button type="button" className="primary" onClick={() => void files.save()}>
            保存
          </button>
        </div>
      </header>

      {files.error !== null && (
        <div className="banner" role="alert">
          <span>{files.error}</span>
          <button type="button" onClick={files.dismissError}>
            知道了
          </button>
        </div>
      )}

      <main className="workspace">
        <Outline
          blocks={project.blocks}
          questionNumbers={questionNumbers}
          selectedBlockId={state.selectedBlockId}
          dispatch={dispatch}
        />
        <Preview
          ir={ir}
          assetUrls={assetUrls}
          selectedBlockId={state.selectedBlockId}
          onSelect={select}
          onPageCount={setPageCount}
        />
        <Inspector block={selectedBlock} dispatch={dispatch} />
      </main>
    </div>
  )
}
