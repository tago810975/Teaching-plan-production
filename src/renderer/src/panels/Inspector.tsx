/**
 * 属性面板：编辑当前选中的内容块。每次输入都会更新工程数据，预览随之重排。
 *
 * 过渡期用“文字 + $公式$”的文本框编辑；接入 TipTap + MathLive 后替换各个 MarkupField。
 */
import { useId, useState, type Dispatch, type ReactNode } from 'react'
import { markupToParagraph, markupToRichText, paragraphToMarkup, richTextToMarkup } from '@core/model/markup'
import type { Block, OptionColumns, Question, QuestionBlock, RichParagraph, RichText } from '@core/model/types'
import type { EditorAction } from '../state/store'

interface Props {
  block: Block | null
  dispatch: Dispatch<EditorAction>
}

export function Inspector({ block, dispatch }: Props) {
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
          <QuestionForm block={block} update={update as (fn: (b: QuestionBlock) => QuestionBlock) => void} />
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

// ---------------- 题目表单 ----------------

function QuestionForm({
  block,
  update
}: {
  block: QuestionBlock
  update: (fn: (b: QuestionBlock) => QuestionBlock) => void
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
      <Field label="题干">
        <RichTextField value={q.stem} rows={5} onChange={(stem) => set({ stem })} />
      </Field>

      {q.options.length > 0 && (
        <fieldset className="group">
          <legend>选项</legend>
          {q.options.map((opt, i) => (
            <div key={i} className="option-row">
              <span className="option-label">{opt.label}</span>
              <ParagraphField
                value={opt.content}
                onChange={(content) =>
                  set({ options: q.options.map((o, j) => (j === i ? { ...o, content } : o)) })
                }
              />
            </div>
          ))}
        </fieldset>
      )}

      {q.subQuestions.length > 0 && (
        <fieldset className="group">
          <legend>小问</legend>
          {q.subQuestions.map((sq, i) => (
            <Field key={sq.id} label={`(${i + 1})`}>
              <RichTextField
                value={sq.content}
                rows={2}
                onChange={(content) =>
                  set({ subQuestions: q.subQuestions.map((s, j) => (j === i ? { ...s, content } : s)) })
                }
              />
            </Field>
          ))}
        </fieldset>
      )}

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
        <Checkbox
          label="整道题尽量排在同一页"
          checked={q.layout.keepTogether}
          onChange={(keepTogether) => setLayout({ keepTogether })}
        />
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

const READONLY_NOTICE = '这部分包含图片、带格式的文字或从 Word 导入的公式，富文本编辑器完成后才能在这里修改。'

/**
 * 多段富文本的文本框。输入框保留自己的草稿，只在挂载时从模型读取一次，
 * 避免“解析 → 再生成”把用户正在输入的内容改掉（例如还没配对的 $）。
 */
function RichTextField({ value, rows, onChange }: { value: RichText; rows: number; onChange: (v: RichText) => void }) {
  const [draft, setDraft] = useState(() => richTextToMarkup(value))
  if (draft === null) return <p className="field-readonly">{READONLY_NOTICE}</p>
  return (
    <textarea
      rows={rows}
      value={draft}
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(markupToRichText(e.target.value))
      }}
    />
  )
}

function ParagraphField({ value, onChange }: { value: RichParagraph; onChange: (v: RichParagraph) => void }) {
  const [draft, setDraft] = useState(() => paragraphToMarkup(value))
  if (draft === null) return <p className="field-readonly">{READONLY_NOTICE}</p>
  return (
    <input
      type="text"
      value={draft}
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(markupToParagraph(e.target.value))
      }}
    />
  )
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
