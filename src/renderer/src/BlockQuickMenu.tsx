/**
 * 快捷版式窗口：在预览或大纲中右键一项内容时弹出，可直接修改常用版式、上移下移、删除。
 *
 * - 题目（含综合题中的小题）：难度、选项排布、整题同页、从新页开始、教案 / 学案题后留白；
 * - 知识点、综合题：整块同页、从新页开始、留白；
 * - 大标题、栏目标题、题型分组：从新的一页开始、题号重新开始。
 * 所有修改都可撤销（删除也是），所以删除不再确认。上移下移后窗口保持打开，可连续调整。
 * 右键图片时弹出的是图片的快捷窗口（ImageQuickMenu.tsx），两者互不冲突。
 */
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode } from 'react'
import { difficultyOf, type FormatPreset } from '@core/presets'
import { plainText } from '@core/model/factory'
import type { Block, KeepTogether, OptionColumns, QuestionLayout } from '@core/model/types'
import type { EditorAction } from './state/store'
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
}

type Layout = Omit<QuestionLayout, 'optionColumns' | 'optionStops'> & Partial<Pick<QuestionLayout, 'optionColumns'>>

export function BlockQuickMenu({ block, number, questionNumbers = new Map(), x, y, preset, dispatch, onClose }: Props) {
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
    <QuickPopover x={x} y={y} title={title(block, number)} label="快捷版式" onClose={onClose}>

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

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="quick-menu-row">
      <span className="quick-menu-label">{label}</span>
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
export function QuickPopover({ x, y, title, label, onClose, children }: { x: number; y: number; title: string; label: string; onClose: () => void; children: ReactNode }) {
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
    <div ref={ref} className="quick-menu" role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top }}>
      <div className="quick-menu-head">
        <span className="quick-menu-title">{title}</span>
        <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </div>
  )
}
