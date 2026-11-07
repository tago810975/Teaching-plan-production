/**
 * 公式编辑器：基于 MathLive 的可视化编辑，所见即所得。
 *
 * - 工具栏仿照 WPS 公式编辑器：按类别展开模板面板，模板直接显示为公式；
 * - 数学键盘：屏幕上的符号键盘，可随时打开；
 * - LaTeX 源码：熟悉 LaTeX 时可直接修改，与可视化编辑同步。
 */
import { useEffect, useRef, useState } from 'react'
import { MathfieldElement } from 'mathlive'
import 'mathlive/fonts.css'
import { FormulaToolbar } from './FormulaToolbar'

// 字体由上面的 CSS 随程序一起打包，不再动态加载；不使用按键音效
MathfieldElement.fontsDirectory = null
MathfieldElement.soundsDirectory = null

export interface FormulaEditorProps {
  /** 编辑已有公式时的初始 LaTeX；插入新公式时为空 */
  initialLatex: string
  initialDisplay: boolean
  /** 插入模式下不提供“独立成行”与“删除” */
  mode: 'edit' | 'insert'
  onSave: (latex: string, display: boolean) => void
  onDelete?: () => void
  onCancel: () => void
}

export function FormulaEditor({ initialLatex, initialDisplay, mode, onSave, onDelete, onCancel }: FormulaEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const keyboardHostRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldElement | null>(null)
  const [latex, setLatex] = useState(initialLatex)
  const [display, setDisplay] = useState(initialDisplay)
  const [showSource, setShowSource] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  /** 模板面板打开时，Esc 只关闭面板，不关闭整个弹窗 */
  const [panelOpen, setPanelOpen] = useState(false)
  const [closePanels, setClosePanels] = useState(0)

  useEffect(() => {
    dialogRef.current?.showModal()
    const mf = new MathfieldElement()
    mf.value = initialLatex
    mf.mathVirtualKeyboardPolicy = 'manual'
    mf.smartMode = false
    mf.className = 'formula-field'
    mf.setAttribute('aria-label', '公式')
    // 未填写的占位符不写入题目
    mf.addEventListener('input', () => setLatex(mf.getValue('latex-without-placeholders')))
    // 弹窗打开时外面的内容不可点击，数学键盘必须放在弹窗内部才能使用
    const kb = window.mathVirtualKeyboard
    if (kb !== undefined && keyboardHostRef.current !== null) kb.container = keyboardHostRef.current
    const onKeyboardChange = (): void => setKeyboardOpen(kb?.visible === true)
    kb?.addEventListener('geometrychange', onKeyboardChange)
    hostRef.current?.appendChild(mf)
    fieldRef.current = mf
    // 等元素挂载后再聚焦
    requestAnimationFrame(() => mf.focus())
    return () => {
      kb?.removeEventListener('geometrychange', onKeyboardChange)
      kb?.hide()
      if (kb !== undefined) kb.container = document.body
      mf.remove()
      fieldRef.current = null
    }
  }, [initialLatex])

  const insert = (tex: string): void => {
    const mf = fieldRef.current
    if (mf === null) return
    mf.focus()
    mf.executeCommand(['insert', tex, { selectionMode: 'placeholder' }])
    setLatex(mf.getValue('latex-without-placeholders'))
  }

  const toggleKeyboard = (): void => {
    const kb = window.mathVirtualKeyboard
    if (kb === undefined) return
    if (kb.visible) {
      kb.hide()
      setKeyboardOpen(false)
    } else {
      fieldRef.current?.focus()
      kb.show()
      setKeyboardOpen(true)
    }
  }

  /** Esc 逐层退出：先关模板面板，再收起数学键盘，最后关闭编辑器 */
  const escape = (): void => {
    if (panelOpen) setClosePanels((n) => n + 1)
    else if (keyboardOpen) toggleKeyboard()
    else onCancel()
  }

  const empty = latex.trim() === ''

  return (
    <dialog
      ref={dialogRef}
      className={keyboardOpen ? 'dialog formula-dialog formula-dialog--keyboard' : 'dialog formula-dialog'}
      aria-labelledby="formula-title"
      onCancel={(e) => {
        e.preventDefault()
        escape()
      }}
      onKeyDownCapture={(e) => {
        // 公式框获得焦点时 MathLive 会自行处理 Esc，所以在捕获阶段先拦下
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        escape()
      }}
    >
      <h2 id="formula-title">{mode === 'insert' ? '插入公式' : '编辑公式'}</h2>

      <FormulaToolbar onInsert={insert} onOpenChange={setPanelOpen} closeRequest={closePanels} />

      <div ref={hostRef} className="formula-host" />

      <div className="formula-options">
        <button type="button" className="link" onClick={toggleKeyboard}>
          数学键盘
        </button>
        <button type="button" className="link" onClick={() => setShowSource((v) => !v)} aria-expanded={showSource}>
          {showSource ? '隐藏 LaTeX 源码' : 'LaTeX 源码'}
        </button>
        {mode === 'edit' && (
          <label className="checkbox checkbox--inline">
            <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} />
            独立成行（居中显示）
          </label>
        )}
      </div>

      {showSource && (
        <textarea
          className="formula-source"
          rows={3}
          spellCheck={false}
          aria-label="LaTeX 源码"
          value={latex}
          onChange={(e) => {
            setLatex(e.target.value)
            if (fieldRef.current !== null) fieldRef.current.value = e.target.value
          }}
        />
      )}

      <div ref={keyboardHostRef} className={keyboardOpen ? 'formula-keyboard is-open' : 'formula-keyboard'} />

      <div className="dialog-actions">
        {mode === 'edit' && onDelete !== undefined && (
          <button type="button" className="danger dialog-actions-left" onClick={onDelete}>
            删除公式
          </button>
        )}
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="primary" disabled={empty} onClick={() => onSave(latex.trim(), display)}>
          确定
        </button>
      </div>
    </dialog>
  )
}
