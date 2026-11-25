/**
 * 快捷版式窗口：在预览或大纲中右键一项内容时弹出，可直接修改常用版式、上移下移、删除。
 *
 * - 题目（含综合题中的小题）：难度、选项排布、整题同页、从新页开始、教案 / 学案题后留白；
 * - 知识点、综合题：整块同页、从新页开始、留白；
 * - 大标题、栏目标题、题型分组：从新的一页开始、题号重新开始。
 * 所有修改都可撤销（删除也是），所以删除不再确认。上移下移后窗口保持打开，可连续调整。
 * 右键图片时弹出的是图片的快捷窗口（ImageQuickMenu.tsx），两者互不冲突。
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode } from 'react'
import { CollageText } from './theme/CollageText'
import { difficultyOf, type FormatPreset } from '@core/presets'
import { plainText } from '@core/model/factory'
import { collectBlocksByIds } from '@core/model/block-clipboard'
import type { Block, KeepTogether, KnowledgeBlock, OptionColumns, QuestionBlock, QuestionLayout } from '@core/model/types'
import type { EditorAction } from './state/store'
import { useBlockClipboard } from './state/blockClipboard'
import { AnswerPlacementControl } from './panels/AnswerPlacementControl'

interface Props {
  block: Block
  /** 题号（题目才有） */
  number?: string
  /** 各题在全卷中的题号（综合题答案集中到最后时使用） */
  questionNumbers?: ReadonlyMap<string, string>
  x: number
  y: number
  preset: FormatPreset
  dispatch: Dispatch<EditorAction>
  onClose: () => void
  /** 复制当前内容（支持跨学案粘贴） */
  onCopy?: () => void
  /** 剪切当前内容（支持跨学案粘贴） */
  onCut?: () => void
  /** 把剪贴板中的内容粘贴到当前内容下方 */
  onPaste?: () => void
  /** 从预览中打开（风格主题可用更张扬的样式） */
  stage?: boolean
}

type Layout = Omit<QuestionLayout, 'optionColumns' | 'optionStops'> & Partial<Pick<QuestionLayout, 'optionColumns'>>

export function BlockQuickMenu({ block, number, questionNumbers = new Map(), x, y, preset, dispatch, onClose, onCopy, onCut, onPaste, stage = false }: Props) {
  const clipboard = useBlockClipboard()
  const update = (fn: (b: Block) => Block): void => dispatch({ type: 'update-block', blockId: block.id, update: fn })
  const setLayout = (patch: Partial<QuestionLayout>): void =>
    update((b) =>
      b.type === 'question'
        ? { ...b, question: { ...b.question, layout: { ...b.question.layout, ...patch } } }
        : b.type === 'knowledge' || b.type === 'composite'
          ? ({ ...b, layout: { ...b.layout, ...patch } } as Block)
          : b
    )
  const setFlag = (key: 'pageBreakBefore' | 'restartNumbering', on: boolean): void =>
    update((b) => {
      if (b.type !== 'title' && b.type !== 'section' && b.type !== 'topic') return b
      const { [key]: _old, ...rest } = b
      return (on ? { ...rest, [key]: true } : rest) as Block
    })

  const layout: Layout | null = block.type === 'question' ? block.question.layout : block.type === 'knowledge' || block.type === 'composite' ? block.layout : null
  const isQuestion = block.type === 'question'
  const unit = isQuestion ? '题' : '块'

  return (
    <QuickPopover x={x} y={y} title={title(block, number)} label="快捷版式" onClose={onClose} stage={stage}>

      {block.type === 'question' && (
        <Row label="难度">
          <Choice
            value={difficultyOf(block.question, preset).grade ?? ''}
            options={[['', '无'], ...preset.difficulty.levels.map((l): [string, string] => [l.grade, `${l.grade} ${'★'.repeat(l.stars)}`])]}
            onChange={(g) => update((b) => (b.type === 'question' ? { ...b, question: { ...b.question, difficulty: g === '' ? undefined : g, stars: undefined } } : b))}
          />
        </Row>
      )}
      {block.type === 'question' && block.question.options.length > 0 && (
        <Row label="选项">
          <Choice<OptionColumns>
            value={block.question.layout.optionColumns}
            options={[
              ['auto', '自动'],
              [1, '每行 1 项'],
              [2, '2 项'],
              [4, '4 项']
            ]}
            onChange={(optionColumns) => setLayout({ optionColumns })}
          />
        </Row>
      )}
      {layout !== null && (
        <>
          <Row label="同页">
            <Choice<KeepTogether>
              value={layout.keepTogether}
              options={[
                ['auto', '跟随版式设置'],
                ['always', `整${unit}同页`],
                ['never', '允许跨页']
              ]}
              onChange={(keepTogether) => setLayout({ keepTogether })}
            />
          </Row>
          <Row label="留白">
            <Stepper label="教案" value={layout.teacherSpaceLines} onChange={(teacherSpaceLines) => setLayout({ teacherSpaceLines })} />
            <Stepper label="学案" value={layout.studentSpaceLines} onChange={(studentSpaceLines) => setLayout({ studentSpaceLines })} />
          </Row>
          <label className="checkbox quick-menu-check">
            <input type="checkbox" checked={layout.pageBreakBefore} onChange={(e) => setLayout({ pageBreakBefore: e.target.checked })} />
            从新的一页开始
          </label>
        </>
      )}
      {block.type === 'composite' && block.items.length > 0 && (
        <Row label="答案">
          <AnswerPlacementControl block={block} questionNumbers={questionNumbers} dispatch={dispatch} />
        </Row>
      )}
      {(block.type === 'title' || block.type === 'section' || block.type === 'topic') && (
        <>
          <label className="checkbox quick-menu-check">
            <input type="checkbox" checked={block.pageBreakBefore === true} onChange={(e) => setFlag('pageBreakBefore', e.target.checked)} />
            从新的一页开始
          </label>
          <label className="checkbox quick-menu-check">
            <input type="checkbox" checked={block.restartNumbering === true} onChange={(e) => setFlag('restartNumbering', e.target.checked)} />
            之后的题号从 1 重新开始
          </label>
        </>
      )}

      <div className="quick-menu-actions">
        <button type="button" onClick={() => dispatch({ type: 'move-block', blockId: block.id, delta: -1 })} title="上移（可连续点击）">
          ↑ 上移
        </button>
        <button type="button" onClick={() => dispatch({ type: 'move-block', blockId: block.id, delta: 1 })} title="下移（可连续点击）">
          ↓ 下移
        </button>
        {block.type === 'composite' && block.items.length > 0 && (
          <button
            type="button"
            title="拆成独立的单题；拆开前会先把集中答案与解析分到各小题，可按 Ctrl+Z 撤销"
            onClick={() => {
              dispatch({ type: 'split-composite', blockId: block.id })
              onClose()
            }}
          >
            拆成单题
          </button>
        )}
        <button
          type="button"
          className="danger"
          title="删除后可用 Ctrl+Z 撤销"
          onClick={() => {
            dispatch({ type: 'delete-block', blockId: block.id })
            onClose()
          }}
        >
          删除
        </button>
      </div>
      {(onCopy !== undefined || onCut !== undefined || (clipboard !== null && onPaste !== undefined)) && (
        <div className="quick-menu-actions quick-menu-actions--clip">
          {onCopy !== undefined && (
            <button
              type="button"
              title="复制（Ctrl+C），可跨学案粘贴"
              onClick={() => {
                onCopy()
                onClose()
              }}
            >
              复制
            </button>
          )}
          {onCut !== undefined && (
            <button
              type="button"
              title="剪切（Ctrl+X），粘贴后从原处移除"
              onClick={() => {
                onCut()
                onClose()
              }}
            >
              剪切
            </button>
          )}
          {clipboard !== null && onPaste !== undefined && (
            <button
              type="button"
              title="粘贴到当前内容下方（Ctrl+V）"
              onClick={() => {
                onPaste()
                onClose()
              }}
            >
              粘贴
            </button>
          )}
        </div>
      )}
    </QuickPopover>
  )
}

/** 批量快捷菜单的 Props */
interface BatchProps {
  blockIds: readonly string[]
  blocks: readonly Block[]
  x: number
  y: number
  preset: FormatPreset
  dispatch: Dispatch<EditorAction>
  onClose: () => void
  onDeleted?: () => void
  onCopy?: () => void
  onCut?: () => void
  onPaste?: () => void
}

function commonValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null
  const first = values[0]!
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== first) return null
  }
  return first
}

/** 支持混合态（indeterminate）的复选框 */
function TriCheckbox({ checked, label, onChange }: { checked: boolean | null; label: string; onChange: (next: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = checked === null
  }, [checked])
  return (
    <label className="checkbox quick-menu-check">
      <input ref={ref} type="checkbox" checked={checked === true} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/**
 * 大纲多选后右键弹出的批量快捷操作窗口：全部修改与删除均可按 Ctrl+Z 一步撤销。
 * - 全为题目时提供题目完整批量版式、合并综合题、删除与复制/剪切/粘贴；
 * - 全为知识点时提供知识点批量版式、删除与复制/剪切/粘贴；
 * - 其他或混合类型（如知识梳理标题 + 知识点 + 题目）提供批量删除与复制/剪切/粘贴。
 */
export function BatchQuestionQuickMenu({ blockIds, blocks, x, y, preset, dispatch, onClose, onDeleted, onCopy, onCut, onPaste }: BatchProps) {
  const clipboard = useBlockClipboard()
  const picked = collectBlocksByIds(blocks, blockIds)
  if (picked.length === 0) return null

  const targetIds = picked.map((b) => b.id)
  const allQuestions = picked.every((b): b is QuestionBlock => b.type === 'question')
  const allKnowledge = picked.every((b): b is KnowledgeBlock => b.type === 'knowledge')

  if (allQuestions) {
    const questions = picked
    const updateQuestions = (fn: (q: QuestionBlock) => QuestionBlock): void =>
      dispatch({
        type: 'update-blocks',
        blockIds: targetIds,
        update: (b) => (b.type === 'question' ? fn(b) : b)
      })
    const setLayout = (patch: Partial<QuestionLayout>): void =>
      updateQuestions((q) => ({ ...q, question: { ...q.question, layout: { ...q.question.layout, ...patch } } }))

    const commonGrade = commonValue(questions.map((q) => difficultyOf(q.question, preset).grade ?? ''))
    const withOptions = questions.filter((q) => q.question.options.length > 0)
    const commonCols = commonValue(withOptions.map((q) => q.question.layout.optionColumns))
    const commonKeep = commonValue(questions.map((q) => q.question.layout.keepTogether))
    const commonTeacher = commonValue(questions.map((q) => q.question.layout.teacherSpaceLines))
    const commonStudent = commonValue(questions.map((q) => q.question.layout.studentSpaceLines))
    const commonPageBreak = commonValue(questions.map((q) => q.question.layout.pageBreakBefore))

    return (
      <QuickPopover x={x} y={y} title={`已选 ${questions.length} 道题`} label="批量快捷操作" onClose={onClose}>
        <Row label="难度">
          <Choice
            value={commonGrade}
            options={[['', '无'], ...preset.difficulty.levels.map((l): [string, string] => [l.grade, `${l.grade} ${'★'.repeat(l.stars)}`])]}
            onChange={(g) => updateQuestions((q) => ({ ...q, question: { ...q.question, difficulty: g === '' ? undefined : g, stars: undefined } }))}
          />
        </Row>
        {withOptions.length > 0 && (
          <Row label="选项">
            <Choice<OptionColumns>
              value={commonCols}
              options={[
                ['auto', '自动'],
                [1, '每行 1 项'],
                [2, '2 项'],
                [4, '4 项']
              ]}
              onChange={(optionColumns) =>
                dispatch({
                  type: 'update-blocks',
                  blockIds: withOptions.map((q) => q.id),
                  update: (b) => (b.type === 'question' ? { ...b, question: { ...b.question, layout: { ...b.question.layout, optionColumns } } } : b)
                })
              }
            />
          </Row>
        )}
        <Row label="同页">
          <Choice<KeepTogether>
            value={commonKeep}
            options={[
              ['auto', '跟随版式设置'],
              ['always', '整题同页'],
              ['never', '允许跨页']
            ]}
            onChange={(keepTogether) => setLayout({ keepTogether })}
          />
        </Row>
        <Row label="留白">
          <Stepper label="教案" value={commonTeacher ?? questions[0]!.question.layout.teacherSpaceLines} onChange={(teacherSpaceLines) => setLayout({ teacherSpaceLines })} />
          <Stepper label="学案" value={commonStudent ?? questions[0]!.question.layout.studentSpaceLines} onChange={(studentSpaceLines) => setLayout({ studentSpaceLines })} />
        </Row>
        {(commonTeacher === null || commonStudent === null) && <p className="field-hint quick-menu-note">各题留白行数不同，调整将统一所选题目的留白</p>}
        <TriCheckbox checked={commonPageBreak} label="从新的一页开始" onChange={(pageBreakBefore) => setLayout({ pageBreakBefore })} />
        <div className="quick-menu-actions">
          {questions.length >= 2 && (
            <button
              type="button"
              title="按大纲顺序合并成一道综合题；合并后可用 Ctrl+Z 撤销"
              onClick={() => {
                dispatch({ type: 'merge-to-composite', blockIds: targetIds })
                onDeleted?.()
                onClose()
              }}
            >
              合并成综合题
            </button>
          )}
          <button
            type="button"
            className="danger"
            title="删除后可用 Ctrl+Z 撤销"
            onClick={() => {
              dispatch({ type: 'delete-blocks', blockIds: targetIds })
              onDeleted?.()
              onClose()
            }}
          >
            删除这 {questions.length} 道题
          </button>
        </div>
        <BatchClipActions clipboardHas={clipboard !== null} onClose={onClose} onCopy={onCopy} onCut={onCut} onPaste={onPaste} />
      </QuickPopover>
    )
  }

  if (allKnowledge) {
    const knowledges = picked
    const setLayout = (patch: Partial<QuestionLayout>): void =>
      dispatch({
        type: 'update-blocks',
        blockIds: targetIds,
        update: (b) => (b.type === 'knowledge' ? { ...b, layout: { ...b.layout, ...patch } } : b)
      })
    const commonKeep = commonValue(knowledges.map((k) => k.layout.keepTogether))
    const commonTeacher = commonValue(knowledges.map((k) => k.layout.teacherSpaceLines))
    const commonStudent = commonValue(knowledges.map((k) => k.layout.studentSpaceLines))
    const commonPageBreak = commonValue(knowledges.map((k) => k.layout.pageBreakBefore))

    return (
      <QuickPopover x={x} y={y} title={`已选 ${knowledges.length} 个知识点`} label="批量快捷操作" onClose={onClose}>
        <Row label="同页">
          <Choice<KeepTogether>
            value={commonKeep}
            options={[
              ['auto', '跟随版式设置'],
              ['always', '整块同页'],
              ['never', '允许跨页']
            ]}
            onChange={(keepTogether) => setLayout({ keepTogether })}
          />
        </Row>
        <Row label="留白">
          <Stepper label="教案" value={commonTeacher ?? knowledges[0]!.layout.teacherSpaceLines} onChange={(teacherSpaceLines) => setLayout({ teacherSpaceLines })} />
          <Stepper label="学案" value={commonStudent ?? knowledges[0]!.layout.studentSpaceLines} onChange={(studentSpaceLines) => setLayout({ studentSpaceLines })} />
        </Row>
        {(commonTeacher === null || commonStudent === null) && <p className="field-hint quick-menu-note">各块留白行数不同，调整将统一所选知识点的留白</p>}
        <TriCheckbox checked={commonPageBreak} label="从新的一页开始" onChange={(pageBreakBefore) => setLayout({ pageBreakBefore })} />
        <div className="quick-menu-actions">
          <button
            type="button"
            className="danger"
            title="删除后可用 Ctrl+Z 撤销"
            onClick={() => {
              dispatch({ type: 'delete-blocks', blockIds: targetIds })
              onDeleted?.()
              onClose()
            }}
          >
            删除这 {knowledges.length} 个知识点
          </button>
        </div>
        <BatchClipActions clipboardHas={clipboard !== null} onClose={onClose} onCopy={onCopy} onCut={onCut} onPaste={onPaste} />
      </QuickPopover>
    )
  }

  return (
    <QuickPopover x={x} y={y} title={`已选 ${picked.length} 项内容`} label="批量快捷操作" onClose={onClose}>
      <div className="quick-menu-actions">
        <button
          type="button"
          className="danger"
          title="删除后可用 Ctrl+Z 撤销"
          onClick={() => {
            dispatch({ type: 'delete-blocks', blockIds: targetIds })
            onDeleted?.()
            onClose()
          }}
        >
          删除这 {picked.length} 项
        </button>
      </div>
      <BatchClipActions clipboardHas={clipboard !== null} onClose={onClose} onCopy={onCopy} onCut={onCut} onPaste={onPaste} />
    </QuickPopover>
  )
}

function BatchClipActions({
  clipboardHas,
  onClose,
  onCopy,
  onCut,
  onPaste
}: {
  clipboardHas: boolean
  onClose: () => void
  onCopy?: () => void
  onCut?: () => void
  onPaste?: () => void
}) {
  if (onCopy === undefined && onCut === undefined && (!clipboardHas || onPaste === undefined)) return null
  return (
    <div className="quick-menu-actions quick-menu-actions--clip">
      {onCopy !== undefined && (
        <button
          type="button"
          title="复制选中内容（Ctrl+C），可跨学案粘贴"
          onClick={() => {
            onCopy()
            onClose()
          }}
        >
          复制
        </button>
      )}
      {onCut !== undefined && (
        <button
          type="button"
          title="剪切选中内容（Ctrl+X），粘贴后从原处移除"
          onClick={() => {
            onCut()
            onClose()
          }}
        >
          剪切
        </button>
      )}
      {clipboardHas && onPaste !== undefined && (
        <button
          type="button"
          title="粘贴到所选内容最后一项下方（Ctrl+V）"
          onClick={() => {
            onPaste()
            onClose()
          }}
        >
          粘贴
        </button>
      )}
    </div>
  )
}

function title(b: Block, number: string | undefined): string {
  const cut = (s: string): string => (s.length > 18 ? `${s.slice(0, 18)}…` : s)
  switch (b.type) {
    case 'question':
      return `${number !== undefined ? `第 ${number.replace(/\.$/, '')} 题` : '题目'}　${cut(plainText(b.question.stem))}`
    case 'knowledge':
      return `知识点　${cut(b.title || plainText(b.content))}`
    case 'composite':
      return `综合题　${cut(b.title || plainText(b.background))}`
    case 'title':
      return `大标题　${cut(b.text)}`
    case 'section':
      return `栏目标题　${cut(b.text)}`
    case 'topic':
      return `题型分组　${cut(b.text)}`
    case 'worksheet':
      return `作业单　${cut(b.title)}`
    case 'paragraph':
      return `正文　${cut(plainText(b.content))}`
  }
}

/** 是否在预览中打开的快捷窗口里（字段名用拼贴字，赤黑主题下画成战斗指令的样子） */
const StageContext = createContext(false)

export function Row({ label, children }: { label: string; children: ReactNode }) {
  const stage = useContext(StageContext)
  return (
    <div className="quick-menu-row">
      <span className="quick-menu-label">{stage ? <CollageText text={label} /> : label}</span>
      <div className="quick-menu-controls">{children}</div>
    </div>
  )
}

export function Choice<T extends string | number>({ value, options, onChange }: { value: T | null; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="segmented quick-menu-seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-active' : undefined} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** 行数：− / + 按钮与输入框（0～40 行） */
export function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const set = (v: number): void => onChange(Math.max(0, Math.min(40, Math.round(v))))
  return (
    <span className="quick-menu-stepper">
      {label}
      <button type="button" aria-label={`${label}留白减少一行`} onClick={() => set(value - 1)} disabled={value <= 0}>
        −
      </button>
      <input
        type="number"
        min={0}
        max={40}
        aria-label={`${label}留白（行）`}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(v)) set(v)
        }}
      />
      <button type="button" aria-label={`${label}留白增加一行`} onClick={() => set(value + 1)}>
        +
      </button>
      行
    </span>
  )
}

/**
 * 快捷窗口的外壳：在鼠标位置弹出，靠近窗口边缘时向内收；Esc、点窗口外、窗口失去焦点时关闭。
 */
export function QuickPopover({
  x,
  y,
  title,
  label,
  onClose,
  children,
  stage = false
}: {
  x: number
  y: number
  title: string
  label: string
  onClose: () => void
  children: ReactNode
  /** 从预览中打开：加 quick-menu--stage，“赤黑”主题下画成战斗指令式的菜单 */
  stage?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    let left = x
    let top = y
    // 战斗指令式菜单（主题把内容区排成左右两列、中间留空）：让中间那块空处正对鼠标点下的位置，各项围着它向四周散开
    const body = bodyRef.current
    if (stage && body !== null && getComputedStyle(body).display === 'grid') {
      const b = body.getBoundingClientRect()
      left = x - (b.left + b.width / 2 - r.left)
      top = y - (b.top + b.height / 2 - r.top)
    }
    setPos({ left: Math.max(6, Math.min(left, window.innerWidth - r.width - 6)), top: Math.max(6, Math.min(top, window.innerHeight - r.height - 6)) })
  }, [x, y, title, stage])
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return (
    <div ref={ref} className={stage ? 'quick-menu quick-menu--stage' : 'quick-menu'} role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top }}>
      <div className="quick-menu-head">
        <span className="quick-menu-title">{title}</span>
        <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      {/* 常规样式下这一层不参与排版（display: contents）；战斗指令式菜单把它排成围绕鼠标位置的两列 */}
      <div ref={bodyRef} className="quick-menu-body">
        <StageContext.Provider value={stage}>{children}</StageContext.Provider>
      </div>
    </div>
  )
}
