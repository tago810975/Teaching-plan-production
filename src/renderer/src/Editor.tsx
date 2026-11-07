/**
 * 编辑界面：工具栏 + 大纲 / 分页预览 / 属性面板。
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type Dispatch } from 'react'
import { buildDocument } from '@core/document/build'
import type { Variant } from '@core/model/types'
import { ErrorBanner } from './ErrorBanner'
import { Inspector } from './panels/Inspector'
import { Outline } from './panels/Outline'
import { useAssetUrls } from './preview/assets'
import { Preview } from './preview/Preview'
import { HEADER_SELECTION, type EditorAction, type EditorState } from './state/store'
import type { ProjectFileActions } from './state/useProjectFile'

interface Props {
  state: EditorState
  dispatch: Dispatch<EditorAction>
  files: ProjectFileActions
  error: string | null
  onDismissError: () => void
}

const VARIANTS: ReadonlyArray<readonly [Variant, string]> = [
  ['teacher', '教师版（教案）'],
  ['student', '学生版（学案）']
]

export function Editor({ state, dispatch, files, error, onDismissError }: Props) {
  const { project, assets } = state.bundle

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
  const headerSelected = state.selectedBlockId === HEADER_SELECTION
  const select = useCallback((blockId: string) => dispatch({ type: 'select', blockId }), [dispatch])
  const selectHeader = useCallback(() => dispatch({ type: 'select', blockId: HEADER_SELECTION }), [dispatch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dispatch({ type: 'select', blockId: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  const status = state.dirty ? '未保存' : state.filePath === null ? '示例，尚未保存为文件' : '已保存'

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-doc">
          <button type="button" className="toolbar-home" onClick={files.closeProject} title="返回首页（Ctrl+W）">
            ‹ 首页
          </button>
          <input
            className="doc-title"
            value={project.meta.title}
            aria-label="教学案名称"
            spellCheck={false}
            onChange={(e) => dispatch({ type: 'set-title', title: e.target.value })}
          />
          <span className={state.dirty ? 'doc-status is-dirty' : 'doc-status'}>{status}</span>
        </div>

        <div className="segmented segmented--variant" role="radiogroup" aria-label="预览版本">
          {VARIANTS.map(([v, label]) => (
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
          <button type="button" className="primary" onClick={() => void files.save()}>
            保存
          </button>
        </div>
      </header>

      {error !== null && <ErrorBanner message={error} onDismiss={onDismissError} />}

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
          onSelectHeader={selectHeader}
          headerSelected={headerSelected}
          onPageCount={setPageCount}
        />
        <Inspector
          block={selectedBlock}
          header={headerSelected ? project.header : null}
          assetUrls={assetUrls}
          dispatch={dispatch}
        />
      </main>
    </div>
  )
}
