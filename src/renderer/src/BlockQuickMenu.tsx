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
import type { Block, CompositeBlock, KeepTogether, OptionColumns, QuestionLayout } from '@core/model/types'
import { answerPlacement } from '@core/model/composite-answers'
import type { EditorAction } from './state/store'
import { AnswerPlacementControl } from './panels/AnswerPlacementControl'

interface Props {
  block: Block
  /** 题号（题目才有） */
  number?: string
  /** 各题在全卷中的题号（综合题答案集中到最后时使用） */
  questionNumbers?: ReadonlyMap<string, string>
  /** 全部内容（题目可移到哪道综合题） */
  blocks?: readonly Block[]
  x: number
  y: number
  preset: FormatPreset
  dispatch: Dispatch<EditorAction>
  onClose: () => void
  /** 从预览中打开（风格主题可用更张扬的样式） */
  stage?: boolean
}

type Layout = Omit<QuestionLayout, 'optionColumns' | 'optionStops'> & Partial<Pick<QuestionLayout, 'optionColumns'>>

export function BlockQuickMenu({ block, number, questionNumbers = new Map(), blocks = [], x, y, preset, dispatch, onClose, stage = false }: Props) {
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
      {block.type === 'question' && <MoveTo block={block} blocks={blocks} questionNumbers={questionNumbers} dispatch={dispatch} />}
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
    </QuickPopover>
  )
}

/**
 * “移到”：把题目一步移到某道综合题的最后，或移出综合题。所在综合题的答案还集中在最后时提示先分到各小题
 * （否则共用答案里仍写着这道题的答案）。
 */
function MoveTo({ block, blocks, questionNumbers, dispatch }: { block: Block; blocks: readonly Block[]; questionNumbers: ReadonlyMap<string, string>; dispatch: Dispatch<EditorAction> }) {
  const composites = blocks.filter((b): b is CompositeBlock => b.type === 'composite')
  const parent = composites.find((c) => c.items.some((it) => it.id === block.id))
  if (composites.length === 0) return null
  const range = (c: CompositeBlock): string => {
    const ns = c.items.map((it) => questionNumbers.get(it.id)?.replace(/\.$/, '')).filter((n): n is string => n !== undefined)
    return ns.length === 0 ? '无小题' : ns.length === 1 ? `第 ${ns[0]} 题` : `第 ${ns[0]}～${ns[ns.length - 1]} 题`
  }
  const name = (c: CompositeBlock): string => {
    const t = c.title.trim() || plainText(c.background).trim()
    return `${t.length > 10 ? `${t.slice(0, 10)}…` : t || '综合题'}（${range(c)}）`
  }
  const shared = parent !== undefined && answerPlacement(parent) === 'end'
  return (
    <>
      <Row label="移到">
        <select
          aria-label="把这道题移到"
          value=""
          onChange={(e) => {
            const v = e.target.value
            if (v === '') return
            dispatch({ type: 'move-question-to', blockId: block.id, compositeId: v === '\u0000' ? null : v })
          }}
        >
          <option value="">{parent !== undefined ? `现在在：${name(parent)}` : '现在是独立的题目'}</option>
          {parent !== undefined && <option value={'\u0000'}>移出综合题（成为独立的题目）</option>}
          {composites
            .filter((c) => c !== parent)
            .map((c) => (
              <option key={c.id} value={c.id}>
                综合题：{name(c)} 的最后
              </option>
            ))}
        </select>
      </Row>
      {shared && <p className="field-hint quick-menu-note">所在综合题的答案与解析集中在最后，移走前建议先在综合题中选“分到各小题”，答案才会跟着这道题走。</p>}
    </>
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

export function Choice<T extends string | number>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
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
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(6, Math.min(x, window.innerWidth - r.width - 6)), top: Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) })
  }, [x, y, title])
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
      <StageContext.Provider value={stage}>{children}</StageContext.Provider>
    </div>
  )
}
