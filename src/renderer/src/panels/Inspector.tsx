/**
 * 属性面板：编辑当前选中的内容块。每次输入都会更新工程数据，预览随之重排。
 *
 * 过渡期用“文字 + $公式$”的文本框编辑；接入 TipTap + MathLive 后替换各个 MarkupField。
 */
import { useId, useState, type Dispatch, type ReactNode } from 'react'
import { fromEditable, paragraphFromEditable, paragraphToEditable, toEditable } from '@core/model/markup'
import { newId } from '@core/model/factory'
import { FigureList } from './FigureList'
import type { Block, KeepTogether, OptionColumns, Question, QuestionBlock, RichParagraph, RichText } from '@core/model/types'
import type { EditorAction } from '../state/store'
import { HeaderForm } from './HeaderForm'
import type { PageHeader, ProjectLayout, Variant } from '@core/model/types'

interface Props {
  block: Block | null
  /** 不为 null 时表示正在编辑页眉 */
  header: PageHeader | null
  /** 不为 null 时表示正在编辑版式设置 */
  layout: ProjectLayout | null
  assetUrls: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
}

export function Inspector({ block, header, layout, assetUrls, dispatch }: Props) {
  if (layout !== null) {
    return (
      <aside className="panel inspector" aria-label="属性">
        <h2 className="panel-title">版式设置</h2>
        <div className="inspector-body">
          <LayoutForm layout={layout} dispatch={dispatch} />
        </div>
      </aside>
    )
  }
  if (header !== null) {
    return (
      <aside className="panel inspector" aria-label="属性">
        <h2 className="panel-title">页眉</h2>
        <div className="inspector-body">
          <HeaderForm header={header} assetUrls={assetUrls} dispatch={dispatch} />
        </div>
      </aside>
    )
  }
  if (block === null) {
    return (
      <aside className="panel inspector" aria-label="属性">
        <h2 className="panel-title">属性</h2>
        <p className="panel-empty">在大纲或预览中点选一项内容，即可在这里修改。</p>
      </aside>
    )
  }

  const update = (fn: (b: Block) => Block): void => dispatch({ type: 'update-block', blockId: block.id, update: fn })

  return (
    <aside className="panel inspector" aria-label="属性">
      <h2 className="panel-title">{BLOCK_NAMES[block.type]}</h2>
      {/* key 保证切换选中项时各输入框重新初始化 */}
      <div key={block.id} className="inspector-body">
        {block.type === 'question' ? (
          <QuestionForm
            block={block}
            update={update as (fn: (b: QuestionBlock) => QuestionBlock) => void}
            assetUrls={assetUrls}
            dispatch={dispatch}
          />
        ) : block.type === 'paragraph' ? (
          <Field label="内容">
            <RichTextField
              value={block.content}
              rows={6}
              onChange={(content) => update((b) => ({ ...b, content }) as Block)}
            />
          </Field>
        ) : (
          <Field label="文字">
            <TextInput value={block.text} onChange={(text) => update((b) => ({ ...b, text }) as Block)} />
          </Field>
        )}
      </div>
    </aside>
  )
}

const BLOCK_NAMES: Record<Block['type'], string> = {
  title: '大标题',
  section: '栏目标题',
  topic: '题型分组',
  paragraph: '正文段落',
  question: '题目'
}

// ---------------- 版式设置 ----------------

function LayoutForm({ layout, dispatch }: { layout: ProjectLayout; dispatch: Dispatch<EditorAction> }) {
  const set = (variant: Variant, value: boolean): void =>
    dispatch({
      type: 'update-layout',
      layout: { ...layout, keepQuestionTogether: { ...layout.keepQuestionTogether, [variant]: value } }
    })
  const row = (variant: Variant, name: string) => (
    <Field label={name}>
      <Segmented<'keep' | 'split'>
        value={layout.keepQuestionTogether[variant] ? 'keep' : 'split'}
        options={[
          ['split', '允许跨页（节省纸张）'],
          ['keep', '整题同页']
        ]}
        onChange={(v) => set(variant, v === 'keep')}
      />
    </Field>
  )
  return (
    <>
      <p className="field-hint">
        设置每道题默认是否整题排在同一页。整题同页时，排不下的题目会整道移到下一页，前一页可能留下空白；
        允许跨页时，题干、题图与选项仍保持在同一页，只有答案和详解可以接到下一页。
      </p>
      {row('teacher', '教案')}
      {row('student', '学案')}
      <p className="field-hint">单道题可以在题目的“版式”中另行设置。</p>
    </>
  )
}

// ---------------- 题目表单 ----------------

function QuestionForm({
  block,
  update,
  assetUrls,
  dispatch
}: {
  block: QuestionBlock
  update: (fn: (b: QuestionBlock) => QuestionBlock) => void
  assetUrls: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
}) {
  const q = block.question
  const set = (patch: Partial<Question>): void => update((b) => ({ ...b, question: { ...b.question, ...patch } }))
  const setLayout = (patch: Partial<Question['layout']>): void =>
    update((b) => ({ ...b, question: { ...b.question, layout: { ...b.question.layout, ...patch } } }))

  return (
    <>
      <Field label="难度" hint="显示为题干开头的【B】，留空则不显示">
        <TextInput value={q.difficulty ?? ''} width="4em" onChange={(v) => set({ difficulty: v || undefined })} />
      </Field>
      <Field label="题干" hint="公式写作 $LaTeX$；⟦⟧ 中的标记是导入的公式、图片或带格式文字，可移动或删除">
        <RichTextField value={q.stem} rows={5} onChange={(stem) => set({ stem })} />
      </Field>

      <FigureList
        figures={q.figures}
        assetUrls={assetUrls}
        onChange={(figures) => set({ figures })}
        onAddAsset={(asset) => dispatch({ type: 'add-asset', asset })}
      />

      <fieldset className="group">
        <legend>选项</legend>
        {q.options.length === 0 && <p className="field-hint">没有选项。选择题请添加选项。</p>}
        {q.options.map((opt, i) => (
          <div key={`${block.id}-${opt.label}-${q.options.length}`} className="option-row">
            <span className="option-label">{opt.label}</span>
            <ParagraphField
              value={opt.content}
              onChange={(content) => set({ options: q.options.map((o, j) => (j === i ? { ...o, content } : o)) })}
            />
            <button
              type="button"
              className="icon-button"
              title={`删除选项 ${opt.label}`}
              aria-label={`删除选项 ${opt.label}`}
              onClick={() => set({ options: relabel(q.options.filter((_, j) => j !== i)) })}
            >
              ×
            </button>
          </div>
        ))}
        <div className="group-actions">
          <button
            type="button"
            disabled={q.options.length >= 8}
            onClick={() =>
              set({
                options: [...q.options, { label: String.fromCharCode(65 + q.options.length), content: { inlines: [] } }],
                kind: q.kind === 'solve' || q.kind === 'fill-blank' ? 'single-choice' : q.kind
              })
            }
          >
            添加选项
          </button>
          {q.options.length > 0 && (
            <label className="checkbox checkbox--inline">
              <input
                type="checkbox"
                checked={q.kind === 'multi-choice'}
                onChange={(e) => set({ kind: e.target.checked ? 'multi-choice' : 'single-choice' })}
              />
              多选题
            </label>
          )}
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>小问</legend>
        {q.subQuestions.map((sq, i) => (
          <div key={sq.id} className="field">
            <div className="field-label-row">
              <span className="field-label">({i + 1})</span>
              <button
                type="button"
                className="link danger"
                onClick={() => set({ subQuestions: q.subQuestions.filter((s) => s.id !== sq.id) })}
              >
                删除
              </button>
            </div>
            <RichTextField
              value={sq.content}
              rows={2}
              onChange={(content) =>
                set({ subQuestions: q.subQuestions.map((s, j) => (j === i ? { ...s, content } : s)) })
              }
            />
          </div>
        ))}
        <div className="group-actions">
          <button
            type="button"
            onClick={() => set({ subQuestions: [...q.subQuestions, { id: newId(), content: [] }] })}
          >
            添加小问
          </button>
        </div>
      </fieldset>

      <fieldset className="group group--teacher">
        <legend>仅教师版</legend>
        <Field label="答案">
          <RichTextField value={q.answer} rows={2} onChange={(answer) => set({ answer })} />
        </Field>
        <Field label="知识点" hint="多个知识点用顿号或逗号分隔">
          <TextInput
            value={q.knowledgePoints.join('、')}
            onChange={(v) =>
              set({
                knowledgePoints: v
                  .split(/[、,，;；]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              })
            }
          />
        </Field>
        <Field label="重点">
          <TextInput value={q.keyPoint ?? ''} onChange={(v) => set({ keyPoint: v || undefined })} />
        </Field>
        <Field label="难点">
          <TextInput value={q.difficultPoint ?? ''} onChange={(v) => set({ difficultPoint: v || undefined })} />
        </Field>
        <Field label="详解">
          <RichTextField value={q.analysis} rows={6} onChange={(analysis) => set({ analysis })} />
        </Field>
      </fieldset>

      <fieldset className="group">
        <legend>版式</legend>
        {q.options.length > 0 && (
          <Field label="选项排列">
            <Segmented<OptionColumns>
              value={q.layout.optionColumns}
              options={[
                ['auto', '自动'],
                [1, '每行 1 项'],
                [2, '每行 2 项'],
                [4, '每行 4 项']
              ]}
              onChange={(optionColumns) => setLayout({ optionColumns })}
            />
          </Field>
        )}
        <Field label="学生版题后留白" hint="作答空间，单位：行">
          <NumberInput value={q.layout.studentSpaceLines} onChange={(studentSpaceLines) => setLayout({ studentSpaceLines })} />
        </Field>
        <Field label="教师版题后留白" hint="单位：行">
          <NumberInput value={q.layout.teacherSpaceLines} onChange={(teacherSpaceLines) => setLayout({ teacherSpaceLines })} />
        </Field>
        <Field label="跨页" hint="允许跨页时，题干、题图与选项仍保持在同一页，只有答案和详解可以接到下一页">
          <Segmented<KeepTogether>
            value={q.layout.keepTogether}
            options={[
              ['auto', '跟随版式设置'],
              ['always', '整题同页'],
              ['never', '允许跨页']
            ]}
            onChange={(keepTogether) => setLayout({ keepTogether })}
          />
        </Field>
        <Checkbox
          label="从新的一页开始"
          checked={q.layout.pageBreakBefore}
          onChange={(pageBreakBefore) => setLayout({ pageBreakBefore })}
        />
      </fieldset>
    </>
  )
}

// ---------------- 通用输入控件 ----------------

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="field-control">{children}</div>
      {hint !== undefined && <p className="field-hint">{hint}</p>}
    </div>
  )
}

const EDIT_HINT = '公式写作 $LaTeX$，如 $\\frac{1}{2}mv^2$。⟦⟧ 中是从 Word 导入的公式、图片或带格式的文字，可以移动或删除。'

/**
 * 多段富文本的文本框。输入框保留自己的草稿，只在挂载时从模型读取一次，
 * 避免“解析 → 再生成”把用户正在输入的内容改掉（例如还没配对的 $）。
 */
function RichTextField({ value, rows, onChange }: { value: RichText; rows: number; onChange: (v: RichText) => void }) {
  const [initial] = useState(() => toEditable(value))
  const [draft, setDraft] = useState(initial.text)
  return (
    <textarea
      rows={rows}
      value={draft}
      spellCheck={false}
      title={EDIT_HINT}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(fromEditable(e.target.value, initial.objects))
      }}
    />
  )
}

function ParagraphField({ value, onChange }: { value: RichParagraph; onChange: (v: RichParagraph) => void }) {
  const [initial] = useState(() => paragraphToEditable(value))
  const [draft, setDraft] = useState(initial.text)
  return (
    <input
      type="text"
      value={draft}
      spellCheck={false}
      title={EDIT_HINT}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(paragraphFromEditable(e.target.value, initial.objects))
      }}
    />
  )
}

/** 删除选项后重新按 A、B、C…… 排序 */
function relabel(options: Question['options']): Question['options'] {
  return options.map((o, i) => ({ ...o, label: String.fromCharCode(65 + i) }))
}

function TextInput({ value, width, onChange }: { value: string; width?: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      spellCheck={false}
      style={width === undefined ? undefined : { width }}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={0}
      max={60}
      step={1}
      value={value}
      style={{ width: '5em' }}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n) && n >= 0) onChange(n)
      }}
    />
  )
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange
}: {
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={v === value ? 'is-active' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
