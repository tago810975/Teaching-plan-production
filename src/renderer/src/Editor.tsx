/**
 * 编辑界面：工具栏 + 大纲 / 分页预览 / 属性面板。
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { buildDocument } from '@core/document/build'
import type { FigureListName, OptionImageRef } from '@core/document/ir'
import { getPreset } from '@core/presets'
import { resizeOptionImage, scaleOptionImages } from '@core/model/option-images'
import type { Variant, Asset } from '@core/model/types'
import { AddMenu } from './AddMenu'
import { Splitter } from './layout/Splitter'
import { usePanelWidths } from './layout/usePanelWidths'
import { ErrorBanner } from './ErrorBanner'
import { ImportNotice } from './ImportNotice'
import { ExportDialog, ExportDoneNotice } from './export/ExportDialog'
import { BlockQuickMenu } from './BlockQuickMenu'
import { ImageImportDialog } from './import/ImageImportDialog'
import { ContextMenu } from './home/ContextMenu'
import { FigureBatchDialog } from './figures/FigureBatchDialog'
import { FigureActionsContext, sharpenAsset, type FigureActions } from './figures/figure-actions'
import { FigureClickContext } from './preview/image-menu'
import { figureFieldId, listFigures, listKeyOf } from '@core/model/figure-refs'
import type { FigureRef } from '@core/document/ir'
import { FigureQuickMenu, OptionImageQuickMenu } from './ImageQuickMenu'
import type { ImageTarget } from './preview/image-menu'
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

/** 编辑器用到的文件操作（作用于本标签页） */
export interface EditorFiles {
  save(saveAs?: boolean): Promise<boolean>
  /** 回到首页（不关闭本标签页） */
  goHome(): void
}

interface Props {
  state: EditorState
  dispatch: Dispatch<EditorAction>
  files: EditorFiles
  /**
   * 后台标签页的编辑器：保留着（切回来时不必重新排版、测量分页、渲染），但隐藏、不可交互，
   * 不响应快捷键与菜单命令
   */
  inactive?: boolean
  /** 所属标签页（恢复滚动位置时用来找到本编辑器的预览） */
  tabId?: string
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
  onExportOpenChange,
  inactive: inactiveProp,
  tabId
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

  const inactive = inactiveProp === true
  useEffect(() => {
    if (inactive) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dispatch({ type: 'select', blockId: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, inactive])

  // 撤销 / 重做：工具栏按钮、Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z、“编辑”菜单
  const travel = useCallback(
    (kind: 'undo' | 'redo') => {
      const el = document.activeElement
      // 对话框（如公式编辑）中仍用输入框自己的撤销
      if (el instanceof HTMLElement && el.closest('dialog[open]') !== null) {
        document.execCommand(kind)
        return
      }
      // 记下光标所在的输入框，撤销后放回原处
      const field = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.dataset.fieldId : undefined
      const caret = field !== undefined ? ((el as HTMLInputElement).selectionStart ?? 0) : 0
      dispatch({ type: kind, ...(field !== undefined ? { focus: { field, caret } } : {}) })
    },
    [dispatch]
  )
  useEffect(() => {
    // 后台标签页不响应撤销快捷键与菜单命令
    if (inactive) return
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      // 有对话框开着时（表格编辑器、公式编辑……）由对话框自己处理撤销；
      // 焦点可能不在对话框里（如点过的按钮变为不可用后），所以按“是否有对话框”判断
      if (document.querySelector('dialog[open]') !== null) return
      const k = e.key.toLowerCase()
      const kind = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : k === 'y' && !e.shiftKey ? 'redo' : null
      if (kind === null) return
      e.preventDefault()
      travel(kind)
    }
    // 捕获阶段：先于输入框自己的撤销
    window.addEventListener('keydown', onKey, true)
    const off = window.api.onMenuCommand((command) => {
      if (command === 'undo' || command === 'redo') travel(command)
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      off()
    }
  }, [travel, inactive])
  // 快捷窗口：右键内容（预览或大纲）弹出版式窗口，右键图片弹出图片窗口
  const [quickMenu, setQuickMenu] = useState<
    | { kind: 'block'; blockId: string; x: number; y: number }
    | { kind: 'figure'; blockId: string; figureIndex: number; list?: FigureListName; x: number; y: number }
    | { kind: 'option'; blockId: string; ref: OptionImageRef; x: number; y: number }
    | null
  >(null)
  const openQuickMenu = useCallback(
    (blockId: string, x: number, y: number) => {
      dispatch({ type: 'select', blockId })
      setQuickMenu({ kind: 'block', blockId, x, y })
    },
    [dispatch]
  )
  const openImageMenu = useCallback(
    (target: ImageTarget, x: number, y: number) => {
      dispatch({ type: 'select', blockId: target.ref.blockId })
      setQuickMenu(
        target.kind === 'figure'
          ? { kind: 'figure', blockId: target.ref.blockId, figureIndex: target.ref.figureIndex, ...(target.ref.list !== undefined ? { list: target.ref.list } : {}), x, y }
          : { kind: 'option', blockId: target.ref.blockId, ref: target.ref, x, y }
      )
    },
    [dispatch]
  )
  const closeQuickMenu = useCallback(() => setQuickMenu(null), [])
  const quickBlock = quickMenu !== null ? findBlock(project.blocks, quickMenu.blockId) : null
  const canUndo = state.history.past.length > 0
  const canRedo = state.history.future.length > 0

  /** 插入位置：选中内容之后；未选中或选中页眉时放在末尾 */
  const insertAfter = selectedBlock?.id ?? null
  const addBlock = (block: Block | Block[]): void => dispatch({ type: 'insert-blocks', blocks: Array.isArray(block) ? block : [block], afterBlockId: insertAfter })
  const importWord = async (asKnowledge = false): Promise<void> => {
    // 按本工程的格式预设整理导入的内容；asKnowledge：按知识点导入
    const result = await window.api.importDocx(project.presetId, asKnowledge)
    if (!result.ok) onError(result.error)
    else if (result.value !== null) {
      const { blocks, assets, report } = result.value
      dispatch({ type: 'insert-blocks', blocks, assets, afterBlockId: insertAfter })
      onImportReport(report)
    }
  }

  // 从图片导入题目（识别结果由 AI 给出，见 import/ImageImportDialog.tsx）
  // 从图片导入：题目或知识点
  const [imageImportOpen, setImageImportOpen] = useState<'questions' | 'knowledge' | null>(null)
  const [importMenu, setImportMenu] = useState<{ x: number; y: number; kind: 'questions' | 'knowledge' } | null>(null)

  // 插图：批量处理窗口、变清晰（属性栏、右键快捷栏共用）、点击预览中的插图定位到属性栏
  const [figureBatch, setFigureBatch] = useState<{ refs?: FigureRef[]; redraw?: boolean } | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const figureActions = useMemo<FigureActions>(
    () => ({
      sharpen: async (refs, mode = 'normal') => {
        const { bundle } = stateRef.current
        const keys = new Set(refs.map((r) => `${r.blockId}|${r.list ?? ''}|${r.figureIndex}`))
        const entries = listFigures(bundle.project.blocks).filter((e) => keys.has(`${e.ref.blockId}|${e.ref.list ?? ''}|${e.ref.figureIndex}`))
        const newAssets: Asset[] = []
        const changes: Array<{ ref: FigureRef; assetId: string }> = []
        let skipped = 0
        for (const e of entries) {
          const asset = bundle.assets[e.figure.assetId]
          const next = asset !== undefined ? await sharpenAsset(asset, mode) : null
          if (next === null) {
            skipped++
            continue
          }
          newAssets.push(next)
          changes.push({ ref: e.ref, assetId: next.id })
        }
        dispatch({ type: 'replace-figure-assets', assets: newAssets, changes })
        return { done: changes.length, skipped }
      },
      openBatch: (options) => setFigureBatch(options ?? {})
    }),
    [dispatch]
  )
  const onFigureClick = useCallback(
    (ref: FigureRef) =>
      dispatch({ type: 'select', blockId: ref.blockId, focus: { field: figureFieldId(listKeyOf(ref), ref.figureIndex), paragraph: 0, before: '', after: '' } }),
    [dispatch]
  )

  const status = state.dirty ? '未保存' : state.filePath === null ? '示例，尚未保存为文件' : '已保存'

  return (
    <div className={inactive ? 'app is-inactive' : 'app'} inert={inactive} aria-hidden={inactive} {...(tabId !== undefined ? { 'data-tab': tabId } : {})}>
      <FigureActionsContext.Provider value={figureActions}>
      <FigureClickContext.Provider value={onFigureClick}>
      <header className="toolbar">
        <div className="toolbar-doc">
          <button type="button" className="toolbar-home" onClick={files.goHome} title="回到首页（教学案保持打开，可在上方标签页中切换回来）">
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
          <div className="undo-redo" role="group" aria-label="撤销与重做">
            <button type="button" className="icon-button" onClick={() => travel('undo')} disabled={!canUndo} title="撤销（Ctrl+Z）" aria-label="撤销">
              ↶
            </button>
            <button type="button" className="icon-button" onClick={() => travel('redo')} disabled={!canRedo} title="重做（Ctrl+Y 或 Ctrl+Shift+Z）" aria-label="重做">
              ↷
            </button>
          </div>
          <AddMenu onAdd={addBlock} preset={preset} projectTitle={project.meta.title} />
          <button
            type="button"
            title="导入题目，插入到当前选中内容之后"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setImportMenu({ x: r.left, y: r.bottom + 4, kind: 'questions' })
            }}
          >
            导入题目 ▾
          </button>
          <button
            type="button"
            title="导入知识点（讲解、笔记、知识梳理），插入到当前选中内容之后"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setImportMenu({ x: r.left, y: r.bottom + 4, kind: 'knowledge' })
            }}
          >
            导入知识点 ▾
          </button>
          {importMenu !== null && (
            <ContextMenu
              x={importMenu.x}
              y={importMenu.y}
              label={importMenu.kind === 'knowledge' ? '导入知识点' : '导入题目'}
              onClose={() => setImportMenu(null)}
              items={[
                { label: 'Word 文档…', onSelect: () => void importWord(importMenu.kind === 'knowledge') },
                { label: '图片（交给 AI 识别）…', onSelect: () => setImageImportOpen(importMenu.kind) }
              ]}
            />
          )}
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
      {imageImportOpen !== null && (
        <ImageImportDialog
          kind={imageImportOpen}
          presetId={project.presetId}
          onCancel={() => setImageImportOpen(null)}
          onImport={(blocks, assets, report) => {
            dispatch({ type: 'insert-blocks', blocks, assets, afterBlockId: insertAfter })
            onImportReport(report)
            setImageImportOpen(null)
          }}
        />
      )}
      {quickMenu?.kind === 'figure' && quickBlock !== null && (
        <FigureQuickMenu
          block={quickBlock}
          figureIndex={quickMenu.figureIndex}
          {...(quickMenu.list !== undefined ? { list: quickMenu.list } : {})}
          x={quickMenu.x}
          y={quickMenu.y}
          dispatch={dispatch}
          onClose={closeQuickMenu}
          onIndexChange={(figureIndex) => setQuickMenu({ ...quickMenu, figureIndex })}
        />
      )}
      {quickMenu?.kind === 'option' && quickBlock !== null && (
        <OptionImageQuickMenu block={quickBlock} optionRef={quickMenu.ref} x={quickMenu.x} y={quickMenu.y} dispatch={dispatch} onClose={closeQuickMenu} />
      )}
      {quickMenu?.kind === 'block' && quickBlock !== null && (
        <BlockQuickMenu
          key={quickMenu.blockId}
          block={quickBlock}
          {...(questionNumbers.get(quickBlock.id) !== undefined ? { number: questionNumbers.get(quickBlock.id)! } : {})}
          questionNumbers={questionNumbers}
          blocks={project.blocks}
          x={quickMenu.x}
          y={quickMenu.y}
          preset={preset}
          dispatch={dispatch}
          onClose={closeQuickMenu}
        />
      )}
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
          onBlockMenu={openQuickMenu}
          onOpenFigureBatch={() => setFigureBatch({})}
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
          onFormatRange={(ranges, op) => dispatch({ type: 'format-range', ranges, op })}
          onAlignRanges={(ranges, align) => dispatch({ type: 'set-align', align, paragraphs: ranges.map((r) => ({ blockId: r.blockId, path: r.path })) })}
          onTableWidths={(ref, widths) => dispatch({ type: 'set-table-widths', ref, widths })}
          onBlockMenu={openQuickMenu}
          onImageMenu={openImageMenu}
          formatColors={preset.textColors}
          keyPoint={preset.keyPoint}
          linkOptionImages={state.linkOptionImages}
        />
        <FieldFocusContext.Provider value={state.focusRequest}>
        <Inspector
          block={selectedBlock}
          linkOptionImages={state.linkOptionImages}
          projectLayout={project.layout}
          preset={preset}
          questionNumbers={questionNumbers}
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
      {figureBatch !== null && (
        <FigureBatchDialog
          blocks={project.blocks}
          assets={state.bundle.assets}
          questionNumbers={questionNumbers}
          dispatch={dispatch}
          initial={figureBatch}
          onClose={() => setFigureBatch(null)}
        />
      )}
      </FigureClickContext.Provider>
      </FigureActionsContext.Provider>
    </div>
  )
}
