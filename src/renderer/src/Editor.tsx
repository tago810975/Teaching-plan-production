/**
 * 编辑界面：工具栏 + 大纲 / 分页预览 / 属性面板。
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { buildDocument } from '@core/document/build'
import type { OptionImageRef } from '@core/document/ir'
import { getPreset } from '@core/presets'
import { resizeOptionImage, scaleOptionImages } from '@core/model/option-images'
import type { Variant } from '@core/model/types'
import { AddMenu } from './AddMenu'
import { Splitter } from './layout/Splitter'
import { usePanelWidths } from './layout/usePanelWidths'
import { ErrorBanner } from './ErrorBanner'
import { ImportNotice } from './ImportNotice'
import { ExportDialog, ExportDoneNotice } from './export/ExportDialog'
import { FormulaEditorProvider, useOpenFormulaEditor } from './formula/context'
import { ommlToLatex } from '@core/math/omml-to-latex'
import type { MathRun, ParagraphFocus } from './preview/DocParagraphView'
import { FieldFocusContext } from './panels/fieldFocus'
import type { ImportReport } from '@shared/ipc'
import type { Block } from '@core/model/types'
import { Inspector } from './panels/Inspector'
import { Outline } from './panels/Outline'
import { useAssetUrls } from './preview/assets'
import { Preview } from './preview/Preview'
import { findBlock, HEADER_SELECTION, LAYOUT_SELECTION, type EditorAction, type EditorState } from './state/store'
import type { ProjectFileActions } from './state/useProjectFile'

interface Props {
  state: EditorState
  dispatch: Dispatch<EditorAction>
  files: ProjectFileActions
  error: string | null
  onDismissError: () => void
  importReport: ImportReport | null
  onImportReport: (report: ImportReport | null) => void
  onError: (message: string) => void
  exportOpen: boolean
  onExportOpenChange: (open: boolean) => void
}

const VARIANTS: ReadonlyArray<readonly [Variant, string]> = [
  ['teacher', '教师版（教案）'],
  ['student', '学生版（学案）']
]

export function Editor(props: Props) {
  return (
    <FormulaEditorProvider>
      <EditorBody {...props} />
    </FormulaEditorProvider>
  )
}

function EditorBody({
  state,
  dispatch,
  files,
  error,
  onDismissError,
  importReport,
  onImportReport,
  onError,
  exportOpen,
  onExportOpenChange
}: Props) {
  const [exportedFiles, setExportedFiles] = useState<string[] | null>(null)
  const { widths: panelWidths, setWidth: setPanelWidth, reset: resetPanel } = usePanelWidths()
  const panelWidthsRef = useRef(panelWidths)
  panelWidthsRef.current = panelWidths
  const workspaceRef = useRef<HTMLElement>(null)
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  useEffect(() => {
    const el = workspaceRef.current
    if (el === null) return
    const observer = new ResizeObserver(([entry]) => {
      const total = entry?.contentRect.width ?? 0
      setWorkspaceWidth(total)
      // 窗口变窄时，两侧栏让出空间，保证预览区不被挤没
      setPanelWidth('left', panelWidthsRef.current.left, total)
      setPanelWidth('right', panelWidthsRef.current.right, total)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setPanelWidth])
  const openFormula = useOpenFormulaEditor()

  /** 在预览中点击公式：打开编辑器。导入的公式先转为 LaTeX；未修改则保留原始 Word 公式 */
  const editMath = useCallback(
    (run: MathRun) => {
      const ref = run.ref
      if (ref === undefined || openFormula === null) return
      const initialLatex = run.latex ?? (run.omml !== undefined ? ommlToLatex(run.omml).latex : '')
      const initialDisplay = run.display === true
      openFormula({
        mode: 'edit',
        initialLatex,
        initialDisplay,
        onSave: (latex, display) => {
          if (latex === initialLatex && display === initialDisplay) return
          dispatch({ type: 'replace-inline', ref, inline: { type: 'math', latex, ...(display ? { display: true } : {}) } })
        },
        onDelete: () => dispatch({ type: 'replace-inline', ref, inline: null })
      })
    },
    [openFormula, dispatch]
  )
  const { project, assets } = state.bundle
  const preset = getPreset(project.presetId)

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

  const selectedBlock = findBlock(project.blocks, state.selectedBlockId)

  // 预览中缩放选项图片：单张等比例缩放，或全部按同一比例缩放
  const resizeOptionImageFromPreview = useCallback(
    (ref: OptionImageRef, widthEmu: number, group: boolean) => {
      dispatch({
        type: 'update-block',
        blockId: ref.blockId,
        update: (b) => {
          if (b.type !== 'question') return b
          const image = b.question.options[ref.option]?.content.inlines[ref.inline]
          if (image?.type !== 'image') return b
          const question = group
            ? scaleOptionImages(b.question, widthEmu / image.widthEmu)
            : resizeOptionImage(b.question, { option: ref.option, inline: ref.inline }, widthEmu)
          return question === b.question ? b : { ...b, question }
        }
      })
    },
    [dispatch]
  )
  const headerSelected = state.selectedBlockId === HEADER_SELECTION
  const select = useCallback(
    (blockId: string, focus?: ParagraphFocus) => dispatch({ type: 'select', blockId, ...(focus !== undefined ? { focus } : {}) }),
    [dispatch]
  )
  const selectHeader = useCallback(() => dispatch({ type: 'select', blockId: HEADER_SELECTION }), [dispatch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dispatch({ type: 'select', blockId: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  /** 插入位置：选中内容之后；未选中或选中页眉时放在末尾 */
  const insertAfter = selectedBlock?.id ?? null
  const addBlock = (block: Block): void => dispatch({ type: 'insert-blocks', blocks: [block], afterBlockId: insertAfter })
  const importWord = async (): Promise<void> => {
    // 按本工程的格式预设整理导入的内容
    const result = await window.api.importDocx(project.presetId)
    if (!result.ok) onError(result.error)
    else if (result.value !== null) {
      const { blocks, assets, report } = result.value
      dispatch({ type: 'insert-blocks', blocks, assets, afterBlockId: insertAfter })
      onImportReport(report)
    }
  }

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
          <AddMenu onAdd={addBlock} preset={preset} projectTitle={project.meta.title} />
          <button type="button" onClick={() => void importWord()} title="识别 Word 文档中的题目，插入到当前选中内容之后">
            导入 Word 题目…
          </button>
          <span className="page-count">共 {pageCount} 页</span>
          <button type="button" onClick={() => onExportOpenChange(true)} title="导出教案与学案 Word 文档（Ctrl+E）">
            导出 Word…
          </button>
          <button type="button" className="primary" onClick={() => void files.save()}>
            保存
          </button>
        </div>
      </header>

      {error !== null && <ErrorBanner message={error} onDismiss={onDismissError} />}
      {importReport !== null && <ImportNotice report={importReport} onDismiss={() => onImportReport(null)} />}
      {exportedFiles !== null && <ExportDoneNotice files={exportedFiles} onDismiss={() => setExportedFiles(null)} />}
      {exportOpen && (
        <ExportDialog
          bundle={state.bundle}
          projectPath={state.filePath}
          onCancel={() => onExportOpenChange(false)}
          onDone={(f) => {
            onExportOpenChange(false)
            setExportedFiles(f)
          }}
        />
      )}

      <main
        ref={workspaceRef}
        className="workspace"
        style={{ gridTemplateColumns: `${panelWidths.left}px minmax(0, 1fr) ${panelWidths.right}px` }}
      >
        <Outline
          blocks={project.blocks}
          questionNumbers={questionNumbers}
          selectedBlockId={state.selectedBlockId}
          dispatch={dispatch}
          preset={preset}
        />
        <Preview
          ir={ir}
          assetUrls={assetUrls}
          selectedBlockId={state.selectedBlockId}
          onSelect={select}
          onSelectHeader={selectHeader}
          headerSelected={headerSelected}
          onPageCount={setPageCount}
          onEditMath={editMath}
          onFigureChange={(ref, patch) => dispatch({ type: 'update-figure', ref, patch })}
          onOptionImageResize={resizeOptionImageFromPreview}
          linkOptionImages={state.linkOptionImages}
        />
        <FieldFocusContext.Provider value={state.focusRequest}>
        <Inspector
          block={selectedBlock}
          linkOptionImages={state.linkOptionImages}
          projectLayout={project.layout}
          preset={preset}
          header={headerSelected ? project.header : null}
          layout={state.selectedBlockId === LAYOUT_SELECTION ? project.layout : null}
          assetUrls={assetUrls}
          dispatch={dispatch}
          revision={state.revision}
        />
        </FieldFocusContext.Provider>
        <Splitter
          side="left"
          width={panelWidths.left}
          position={panelWidths.left}
          onResize={(w, total) => setPanelWidth('left', w, total)}
          onReset={() => resetPanel('left')}
        />
        <Splitter
          side="right"
          width={panelWidths.right}
          position={workspaceWidth - panelWidths.right}
          onResize={(w, total) => setPanelWidth('right', w, total)}
          onReset={() => resetPanel('right')}
        />
      </main>
    </div>
  )
}
