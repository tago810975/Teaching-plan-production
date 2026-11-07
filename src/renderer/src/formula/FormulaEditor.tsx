/**
 * 公式编辑器：基于 MathLive 的可视化编辑，所见即所得。
 *
 * - 常用模板按钮：分数、根号、上下标、矢量、上划线，以及物理常用符号；
 * - 数学键盘：屏幕上的符号键盘，可随时打开；
 * - LaTeX 源码：熟悉 LaTeX 时可直接修改，与可视化编辑同步。
 */
import { useEffect, useRef, useState } from 'react'
import { MathfieldElement } from 'mathlive'
import 'mathlive/fonts.css'

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

/** 模板按钮：#? 为占位符，#@ 表示当前选中的内容 */
const TEMPLATES: ReadonlyArray<readonly [label: string, latex: string, title: string]> = [
  ['a⁄b', '\\frac{#@}{#?}', '分数'],
  ['√', '\\sqrt{#@}', '根号'],
  ['ⁿ√', '\\sqrt[#?]{#@}', 'n 次根号'],
  ['x²', '#@^{#?}', '上标'],
  ['x₂', '#@_{#?}', '下标'],
  ['矢量', '\\vec{#@}', '矢量'],
  ['线段', '\\overline{#@}', '上划线（线段）'],
  ['( )', '\\left(#@\\right)', '括号'],
  ['Σ', '\\sum_{#?}^{#?}#?', '求和'],
  ['∫', '\\int_{#?}^{#?}#?', '积分'],
  ['sin', '\\sin #?', '正弦'],
  ['cos', '\\cos #?', '余弦']
]

const SYMBOLS: ReadonlyArray<readonly [label: string, latex: string]> = [
  ['×', '\\times'],
  ['·', '\\cdot'],
  ['÷', '\\div'],
  ['±', '\\pm'],
  ['≤', '\\le'],
  ['≥', '\\ge'],
  ['≠', '\\ne'],
  ['≈', '\\approx'],
  ['∝', '\\propto'],
  ['°', '^{\\circ}'],
  ['→', '\\rightarrow'],
  ['∞', '\\infty'],
  ['Δ', '\\Delta'],
  ['θ', '\\theta'],
  ['α', '\\alpha'],
  ['β', '\\beta'],
  ['γ', '\\gamma'],
  ['λ', '\\lambda'],
  ['μ', '\\mu'],
  ['ρ', '\\rho'],
  ['ω', '\\omega'],
  ['φ', '\\varphi'],
  ['ε', '\\varepsilon'],
  ['π', '\\pi'],
  ['Ω', '\\Omega']
]

/** 点击模板按钮时不让公式框失去焦点，插入后可以直接继续输入 */
const keepFocus = (e: { preventDefault: () => void }): void => e.preventDefault()

export function FormulaEditor({ initialLatex, initialDisplay, mode, onSave, onDelete, onCancel }: FormulaEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const keyboardHostRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldElement | null>(null)
  const [latex, setLatex] = useState(initialLatex)
  const [display, setDisplay] = useState(initialDisplay)
  const [showSource, setShowSource] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

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

  const empty = latex.trim() === ''

  return (
    <dialog
      ref={dialogRef}
      className={keyboardOpen ? 'dialog formula-dialog formula-dialog--keyboard' : 'dialog formula-dialog'}
      aria-labelledby="formula-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h2 id="formula-title">{mode === 'insert' ? '插入公式' : '编辑公式'}</h2>

      <div className="formula-toolbar" role="toolbar" aria-label="公式模板">
        {TEMPLATES.map(([label, tex, title]) => (
          <button key={title} type="button" title={title} aria-label={title} onMouseDown={keepFocus} onClick={() => insert(tex)}>
            {label}
          </button>
        ))}
      </div>
      <div className="formula-toolbar formula-toolbar--symbols" role="toolbar" aria-label="常用符号">
        {SYMBOLS.map(([label, tex]) => (
          <button key={tex} type="button" title={tex} onMouseDown={keepFocus} onClick={() => insert(tex)}>
            {label}
          </button>
        ))}
      </div>

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
