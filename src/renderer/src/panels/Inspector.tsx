/**
 * 属性面板：编辑当前选中的内容块。每次输入都会更新工程数据，预览随之重排。
 *
 * 过渡期用“文字 + $公式$”的文本框编辑；接入 TipTap + MathLive 后替换各个 MarkupField。
 */
import { useId, useRef, useState, type Dispatch, type ReactNode, type RefObject } from 'react'
import { useOpenFormulaEditor } from '../formula/context'
import { useFieldFocus } from './fieldFocus'
import { fromEditable, paragraphFromEditable, paragraphToEditable, toEditable } from '@core/model/markup'
import { createKnowledge, createQuestion, newId, plainText } from '@core/model/factory'
import { FigureList } from './FigureList'
import { OptionImageControls } from './OptionImageControls'
import { FontSelect } from './FontSelect'
import { TableEditor } from './TableEditor'
import { createTable } from '@core/model/table'
import { FormatTargetProvider, FormatToolbar, useFormatTargets, useFormattable } from './FormatToolbar'
import { OptionStopsEditor } from './OptionStopsEditor'
import { DifficultyField } from './DifficultyField'
import { difficultyOf, getPreset, type FormatPreset } from '@core/presets'
import { STYLE_SPECS } from '@core/document/styles'
import { resolveOptionColumns } from '@core/document/build'
import { copyStops, DEFAULT_OPTION_STOPS } from '@core/model/factory'
import { optionImageSignature } from '@core/model/option-images'
import type {
  Block,
  FontFamily,
  Inline,
  TableInline,
  BlockLayout,
  CompositeBlock,
  KeepTogether,
  KnowledgeBlock,
  OptionColumns,
  OptionStops,
  DifficultyDisplay,
  Question,
  QuestionBlock,
  RichParagraph,
  RichText
} from '@core/model/types'
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
  /** 内容在面板之外被修改时递增，用于让输入框重新读取内容 */
  revision: number
  /** 预览中拖动选项图片时是否全部一起缩放 */
  linkOptionImages?: boolean
  /** 工程的版式设置（选项列位置等的默认值） */
  projectLayout?: ProjectLayout
  /** 工程的格式预设（难度等级、知识梳理的强调格式等） */
  preset?: FormatPreset
}

export function Inspector({ block, header, layout, assetUrls, dispatch, revision, linkOptionImages = false, projectLayout, preset = getPreset(undefined) }: Props) {
  const format = useFormatTargets()
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
  /** 改字体会改动文字自身的格式，输入框需要重新读取内容 */
  const refreshAfter = (fn: () => void): void => {
    fn()
    dispatch({ type: 'refresh-inspector' })
  }

  return (
    <aside className="panel inspector" aria-label="属性">
      <h2 className="panel-title">{BLOCK_NAMES[block.type]}</h2>
      <FormatToolbar active={format.active} onApply={format.apply} colors={preset.textColors} keyPoint={block.type === 'knowledge' ? preset.keyPoint : undefined} />
      {/* key 保证切换选中项时各输入框重新初始化 */}
      <FormatTargetProvider value={format.provider}>
      <div key={`${block.id}:${revision}`} className="inspector-body">
        {block.type === 'question' ? (
          <QuestionForm
            block={block}
            update={update as (fn: (b: QuestionBlock) => QuestionBlock) => void}
            assetUrls={assetUrls}
            dispatch={dispatch}
            linkOptionImages={linkOptionImages}
            projectStops={projectLayout?.optionStops ?? DEFAULT_OPTION_STOPS}
            preset={preset}
          />
        ) : block.type === 'knowledge' ? (
          <KnowledgeForm
            block={block}
            update={update as (fn: (b: KnowledgeBlock) => KnowledgeBlock) => void}
            assetUrls={assetUrls}
            dispatch={dispatch}
          />
        ) : block.type === 'composite' ? (
          <CompositeForm
            block={block}
            update={update as (fn: (b: CompositeBlock) => CompositeBlock) => void}
            assetUrls={assetUrls}
            dispatch={dispatch}
          />
        ) : block.type === 'paragraph' ? (
          <Field
            label="内容"
            aside={
              <FontSelect
                label="内容"
                paragraphs={block.content}
                styleFont={STYLE_SPECS.body.fontRole}
                onChange={(content) => refreshAfter(() => update((b) => ({ ...b, content }) as Block))}
              />
            }
          >
            <RichTextField
              fieldId="content"
              value={block.content}
              rows={6}
              onChange={(content) => update((b) => ({ ...b, content }) as Block)}
            />
          </Field>
        ) : block.type === 'worksheet' ? (
          <>
            <Field label="标题" hint="如“作业单-动态圆”；作业单从新的一页开始，其后的题目从 1 重新编号">
              <TextInput fieldId="text" value={block.title} onChange={(title) => update((b) => ({ ...b, title }) as Block)} />
            </Field>
            <Field label="姓名栏" hint="各项用顿号分隔，每项后面留一段下划线供学生填写">
              <TextInput
                value={block.fields.join('、')}
                onChange={(v) =>
                  update((b) => ({ ...b, fields: v.split(/[、,，;；\s]+/).map((s) => s.trim()).filter(Boolean) }) as Block)
                }
              />
            </Field>
            <button
              type="button"
              className="link"
              onClick={() => update((b) => ({ ...b, fields: [...preset.worksheet.fields] }) as Block)}
            >
              恢复为“{preset.worksheet.fields.join('、')}”
            </button>
          </>
        ) : (
          <Field label="文字">
            <TextInput fieldId="text" value={block.text} onChange={(text) => update((b) => ({ ...b, text }) as Block)} />
          </Field>
        )}
      </div>
      </FormatTargetProvider>
    </aside>
  )
}

const BLOCK_NAMES: Record<Block['type'], string> = {
  title: '大标题',
  section: '栏目标题',
  topic: '题型分组',
  paragraph: '正文段落',
  question: '题目',
  knowledge: '知识点',
  composite: '综合题',
  worksheet: '作业单'
}

// ---------------- 版式设置 ----------------

function LayoutForm({ layout, dispatch }: { layout: ProjectLayout; dispatch: Dispatch<EditorAction> }) {
  type Key = 'keepQuestionTogether' | 'keepKnowledgeTogether'
  const set = (key: Key, variant: Variant, value: boolean): void =>
    dispatch({ type: 'update-layout', layout: { ...layout, [key]: { ...layout[key], [variant]: value } } })
  const row = (key: Key, variant: Variant, name: string, keepLabel: string) => (
    <Field label={name}>
      <Segmented<'keep' | 'split'>
        value={layout[key][variant] ? 'keep' : 'split'}
        options={[
          ['split', '允许跨页（节省纸张）'],
          ['keep', keepLabel]
        ]}
        onChange={(v) => set(key, variant, v === 'keep')}
      />
    </Field>
  )
  return (
    <>
      <fieldset className="group">
        <legend>题目</legend>
        <p className="field-hint">
          整题同页时，排不下的题目会整道移到下一页，前一页可能留下空白；允许跨页时，题干、题图与选项仍保持在同一页，
          只有答案和详解可以接到下一页。
        </p>
        {row('keepQuestionTogether', 'teacher', '教案', '整题同页')}
        {row('keepQuestionTogether', 'student', '学案', '整题同页')}
      </fieldset>
      <fieldset className="group">
        <legend>知识点</legend>
        <p className="field-hint">整块同页时，排不下的知识点会整块移到下一页；允许跨页时，知识点的文字可以接到下一页。</p>
        {row('keepKnowledgeTogether', 'teacher', '教案', '整块同页')}
        {row('keepKnowledgeTogether', 'student', '学案', '整块同页')}
      </fieldset>
      <fieldset className="group">
        <legend>难度显示</legend>
        <p className="field-hint">题干开头的难度标记。左侧大纲中始终显示等级和星级，方便浏览。</p>
        <Segmented<DifficultyDisplay>
          value={layout.difficultyDisplay}
          options={[
            ['both', '【B】★★'],
            ['grade', '只显示【B】'],
            ['stars', '只显示 ★★'],
            ['none', '不显示']
          ]}
          onChange={(difficultyDisplay) => dispatch({ type: 'update-layout', layout: { ...layout, difficultyDisplay } })}
        />
      </fieldset>
      <fieldset className="group">
        <legend>选项位置</legend>
        <p className="field-hint">选择题选项排成每行 2 项、4 项时，各列从哪里开始。可以把调好的间距另存为方案，所有教学案都能选用。</p>
        <OptionStopsEditor stops={layout.optionStops} onChange={(optionStops) => dispatch({ type: 'update-layout', layout: { ...layout, optionStops } })} />
      </fieldset>
      <p className="field-hint">单道题、单个知识点可以在各自的“版式”中另行设置。</p>
    </>
  )
}

/** 输入框标题旁的字体选择；改完后让输入框重新读取内容（字体会去掉文字自身的字体格式） */
function fontSelect(
  label: string,
  paragraphs: RichParagraph[],
  styleFont: FontFamily,
  onChange: (paragraphs: RichParagraph[]) => void,
  dispatch: Dispatch<EditorAction>
): ReactNode {
  return (
    <FontSelect
      label={label}
      paragraphs={paragraphs}
      styleFont={styleFont}
      onChange={(next) => {
        onChange(next)
        dispatch({ type: 'refresh-inspector' })
      }}
    />
  )
}

// ---------------- 综合题表单 ----------------

function CompositeForm({
  block,
  update,
  assetUrls,
  dispatch
}: {
  block: CompositeBlock
  update: (fn: (b: CompositeBlock) => CompositeBlock) => void
  assetUrls: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
}) {
  const set = (patch: Partial<CompositeBlock>): void => update((b) => ({ ...b, ...patch }))
  const setLayout = (patch: Partial<BlockLayout>): void => update((b) => ({ ...b, layout: { ...b.layout, ...patch } }))
  const addItem = (kind: 'single-choice' | 'solve'): void => {
    const options = kind === 'single-choice' ? ['A', 'B', 'C', 'D'].map((label) => ({ label, content: { inlines: [] } })) : []
    const item = { id: newId(), type: 'question' as const, question: createQuestion({ kind, options }) }
    set({ items: [...block.items, item] })
    dispatch({ type: 'select', blockId: item.id })
  }
  return (
    <>
      <Field label="标题" hint="如“材料一”；居中显示">
        <TextInput fieldId="title" value={block.title} onChange={(title) => set({ title })} />
      </Field>
      <Field
        label="背景材料（可选）"
        hint="小题共用的情境、材料；留空则不显示"
        aside={fontSelect('背景材料', block.background, STYLE_SPECS.compositeBackground.fontRole, (background) => set({ background }), dispatch)}
      >
        <RichTextField fieldId="background" value={block.background} rows={6} onChange={(background) => set({ background })} />
      </Field>
      <FigureList
        title="背景配图"
        kind="knowledge"
        paragraphs={block.background}
        figures={block.figures}
        assetUrls={assetUrls}
        onChange={(figures) => set({ figures })}
        onAddAsset={(asset) => dispatch({ type: 'add-asset', asset })}
      />
      <fieldset className="group">
        <legend>小题</legend>
        {block.items.length === 0 && <p className="field-hint">还没有小题。</p>}
        <ol className="composite-items">
          {block.items.map((item, i) => (
            <li key={item.id}>
              <button type="button" className="link" onClick={() => dispatch({ type: 'select', blockId: item.id })}>
                {i + 1}. {plainText(item.question.stem).replace(/\$[^$]*\$/g, '…').slice(0, 24) || '（空题目）'}
              </button>
            </li>
          ))}
        </ol>
        <p className="field-hint">点击小题进入编辑；题号与全卷连续编排。</p>
        <div className="group-actions">
          <button type="button" onClick={() => addItem('single-choice')}>
            添加选择题
          </button>
          <button type="button" onClick={() => addItem('solve')}>
            添加解答题
          </button>
        </div>
      </fieldset>
      <fieldset className="group group--teacher">
        <legend>仅教师版：共用的答案与详解</legend>
        <Field
          label="答案"
          hint="如“1.横波 2. 1.8 3.A”；也可以在各小题中分别填写"
          aside={fontSelect('答案', block.answer, STYLE_SPECS.answer.fontRole, (answer) => set({ answer }), dispatch)}
        >
          <RichTextField fieldId="answer" value={block.answer} rows={3} onChange={(answer) => set({ answer })} />
        </Field>
        <Field label="解析" aside={fontSelect('解析', block.analysis, STYLE_SPECS.analysis.fontRole, (analysis) => set({ analysis }), dispatch)}>
          <RichTextField fieldId="analysis" value={block.analysis} rows={6} onChange={(analysis) => set({ analysis })} />
        </Field>
      </fieldset>
      <LayoutFields layout={block.layout} onChange={setLayout} keepLabel="整题同页" />
    </>
  )
}

// ---------------- 知识点表单 ----------------

function KnowledgeForm({
  block,
  update,
  assetUrls,
  dispatch
}: {
  block: KnowledgeBlock
  update: (fn: (b: KnowledgeBlock) => KnowledgeBlock) => void
  assetUrls: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
}) {
  const set = (patch: Partial<KnowledgeBlock>): void => update((b) => ({ ...b, ...patch }))
  const setLayout = (patch: Partial<BlockLayout>): void => update((b) => ({ ...b, layout: { ...b.layout, ...patch } }))
  return (
    <>
      <Field label="标题" hint="如“一、放缩圆”；留空则只显示内容">
        <TextInput fieldId="title" value={block.title} onChange={(title) => set({ title })} />
      </Field>
      <Field
        label="内容"
        hint="公式写作 $LaTeX$；⟦⟧ 中的标记是导入的公式、图片或带格式文字，可移动或删除"
        aside={fontSelect('内容', block.content, STYLE_SPECS.body.fontRole, (content) => set({ content }), dispatch)}
      >
        <RichTextField fieldId="content" value={block.content} rows={10} onChange={(content) => set({ content })} />
      </Field>
      <ParagraphSettings block={block} update={update} dispatch={dispatch} />
      <FigureList
        title="插图"
        kind="knowledge"
        paragraphs={block.content}
        figures={block.figures}
        assetUrls={assetUrls}
        onChange={(figures) => set({ figures })}
        onAddAsset={(asset) => dispatch({ type: 'add-asset', asset })}
      />
      <LayoutFields layout={block.layout} onChange={setLayout} keepLabel="整块同页" />
    </>
  )
}

/**
 * 知识点的段落设置：每段的段后空行、从此段换页；也可以从某一段拆分出新的知识点，
 * 拆出的部分拥有独立的版式设置。
 */
function ParagraphSettings({
  block,
  update,
  dispatch
}: {
  block: KnowledgeBlock
  update: (fn: (b: KnowledgeBlock) => KnowledgeBlock) => void
  dispatch: Dispatch<EditorAction>
}) {
  if (block.content.length === 0) return null
  const setFormat = (i: number, patch: NonNullable<RichParagraph['format']>): void =>
    update((b) => ({
      ...b,
      content: b.content.map((p, j) => {
        if (j !== i) return p
        const format = { ...p.format, ...patch }
        if (format.spaceAfterLines === 0) delete format.spaceAfterLines
        if (format.pageBreakBefore === false) delete format.pageBreakBefore
        return Object.keys(format).length > 0 ? { ...p, format } : { inlines: p.inlines }
      })
    }))

  const split = (i: number): void => {
    const last = block.content.length - 1
    const stay = block.figures.filter((f) => (f.anchorParagraph ?? last) < i)
    const move = block.figures
      .filter((f) => (f.anchorParagraph ?? last) >= i)
      .map((f) => ({ ...f, anchorParagraph: (f.anchorParagraph ?? last) - i }))
    const rest = createKnowledge({ title: '', content: block.content.slice(i), figures: move })
    update((b) => ({ ...b, content: b.content.slice(0, i), figures: stay }))
    dispatch({ type: 'insert-blocks', blocks: [rest], afterBlockId: block.id })
  }

  return (
    <fieldset className="group">
      <legend>段落设置</legend>
      <p className="field-hint">在长知识点中插入空行或换页；也可以从某段拆分出新的知识点，单独设置版式。</p>
      <ol className="para-settings">
        {block.content.map((p, i) => (
          <li key={i} className="para-settings-row">
            <span className="para-settings-text" title={plainText(p)}>
              {i + 1}. {plainText(p).replace(/\$[^$]*\$/g, '…').slice(0, 18) || '（空）'}
            </span>
            <span className="para-settings-controls">
              <label title="这一段之后空出的行数">
                空行
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={p.format?.spaceAfterLines ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n >= 0) setFormat(i, { spaceAfterLines: n })
                  }}
                />
              </label>
              <label title="从这一段开始换到新的一页">
                <input
                  type="checkbox"
                  checked={p.format?.pageBreakBefore === true}
                  onChange={(e) => setFormat(i, { pageBreakBefore: e.target.checked })}
                />
                换页
              </label>
              {i > 0 && (
                <button type="button" className="link" title="从这一段起拆分为新的知识点" onClick={() => split(i)}>
                  拆分
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
    </fieldset>
  )
}

/** 题目与知识点共用的版式字段：留白、跨页、从新页开始 */
function LayoutFields({
  layout,
  onChange,
  keepLabel,
  children
}: {
  layout: BlockLayout
  onChange: (patch: Partial<BlockLayout>) => void
  keepLabel: string
  children?: ReactNode
}) {
  return (
    <fieldset className="group">
      <legend>版式</legend>
      {children}
      <Field label="学生版后留白" hint="单位：行">
        <NumberInput value={layout.studentSpaceLines} onChange={(studentSpaceLines) => onChange({ studentSpaceLines })} />
      </Field>
      <Field label="教师版后留白" hint="单位：行">
        <NumberInput value={layout.teacherSpaceLines} onChange={(teacherSpaceLines) => onChange({ teacherSpaceLines })} />
      </Field>
      <Field label="跨页">
        <Segmented<KeepTogether>
          value={layout.keepTogether}
          options={[
            ['auto', '跟随版式设置'],
            ['always', keepLabel],
            ['never', '允许跨页']
          ]}
          onChange={(keepTogether) => onChange({ keepTogether })}
        />
      </Field>
      <Checkbox label="从新的一页开始" checked={layout.pageBreakBefore} onChange={(pageBreakBefore) => onChange({ pageBreakBefore })} />
    </fieldset>
  )
}

// ---------------- 题目表单 ----------------

function QuestionForm({
  block,
  update,
  assetUrls,
  dispatch,
  linkOptionImages,
  projectStops,
  preset
}: {
  block: QuestionBlock
  update: (fn: (b: QuestionBlock) => QuestionBlock) => void
  assetUrls: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
  linkOptionImages: boolean
  projectStops: OptionStops
  preset: FormatPreset
}) {
  const q = block.question
  // 选项图片的尺寸变化时，选项输入框需要重新读取内容（它只在挂载时读取一次行内图片）
  const imageSig = optionImageSignature(q)
  const set = (patch: Partial<Question>): void => update((b) => ({ ...b, question: { ...b.question, ...patch } }))
  const setLayout = (patch: Partial<Question['layout']>): void =>
    update((b) => ({ ...b, question: { ...b.question, layout: { ...b.question.layout, ...patch } } }))

  return (
    <>
      <DifficultyField
        grade={difficultyOf(q, preset).grade}
        levels={preset.difficulty.levels}
        onChange={(difficulty) => set({ difficulty, stars: undefined })}
      />
      <Field
        label="题干"
        hint="公式写作 $LaTeX$；⟦⟧ 中的标记是导入的公式、图片或带格式文字，可移动或删除"
        aside={fontSelect('题干', q.stem, STYLE_SPECS.question.fontRole, (stem) => set({ stem }), dispatch)}
      >
        <RichTextField fieldId="stem" value={q.stem} rows={5} onChange={(stem) => set({ stem })} />
      </Field>

      <FigureList
        kind="question"
        paragraphs={q.stem}
        subQuestionCount={q.subQuestions.length}
        figures={q.figures}
        assetUrls={assetUrls}
        onChange={(figures) => set({ figures })}
        onAddAsset={(asset) => dispatch({ type: 'add-asset', asset })}
      />

      <fieldset className="group">
        <legend>选项</legend>
        {q.options.length === 0 && <p className="field-hint">没有选项。选择题请添加选项。</p>}
        {q.options.length > 0 && (
          <div className="group-font-row">
            <span>字体</span>
            {fontSelect(
              '选项',
              q.options.map((o) => o.content),
              STYLE_SPECS.option.fontRole,
              (contents) => set({ options: q.options.map((o, i) => ({ ...o, content: contents[i]! })) }),
              dispatch
            )}
          </div>
        )}
        {q.options.map((opt, i) => (
          <div key={`${block.id}-${opt.label}-${q.options.length}-${imageSig}`} className="option-row">
            <span className="option-label">{opt.label}</span>
            <ParagraphField
              fieldId={`option:${i}`}
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

      <OptionImageControls
        question={q}
        assetUrls={assetUrls}
        onUpdate={(fn) =>
          update((b) => {
            const question = fn(b.question)
            return question === b.question ? b : { ...b, question }
          })
        }
        linked={linkOptionImages}
        onLinkedChange={(value) => dispatch({ type: 'set-link-option-images', value })}
      />

      <fieldset className="group">
        <legend>小问</legend>
        {q.subQuestions.length > 0 && (
          <div className="group-font-row">
            <span>字体</span>
            {fontSelect(
              '小问',
              q.subQuestions.flatMap((sq) => sq.content),
              STYLE_SPECS.subQuestion.fontRole,
              (all) => {
                // 按各小问的段数切回去
                let k = 0
                set({ subQuestions: q.subQuestions.map((sq) => ({ ...sq, content: sq.content.map(() => all[k++]!) })) })
              },
              dispatch
            )}
          </div>
        )}
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
              fieldId={`sub:${i}`}
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
        <Field label="答案" aside={fontSelect('答案', q.answer, STYLE_SPECS.answer.fontRole, (answer) => set({ answer }), dispatch)}>
          <RichTextField fieldId="answer" value={q.answer} rows={2} onChange={(answer) => set({ answer })} />
        </Field>
        <Field label="知识点" hint="多个知识点用顿号或逗号分隔">
          <TextInput
            fieldId="knowledgePoints"
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
          <TextInput fieldId="keyPoint" value={q.keyPoint ?? ''} onChange={(v) => set({ keyPoint: v || undefined })} />
        </Field>
        <Field label="难点">
          <TextInput fieldId="difficultPoint" value={q.difficultPoint ?? ''} onChange={(v) => set({ difficultPoint: v || undefined })} />
        </Field>
        <Field label="解析" aside={fontSelect('解析', q.analysis, STYLE_SPECS.analysis.fontRole, (analysis) => set({ analysis }), dispatch)}>
          <RichTextField fieldId="analysis" value={q.analysis} rows={6} onChange={(analysis) => set({ analysis })} />
        </Field>
      </fieldset>

      <LayoutFields layout={q.layout} onChange={setLayout} keepLabel="整题同页">
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
        {q.options.length > 0 && (
          <Field
            label="选项位置"
            hint={(() => {
              const n = resolveOptionColumns(q.options, q.layout.optionColumns, q.layout.optionStops ?? projectStops)
              return n === 1 ? '现在每行 1 项，不用设置位置。' : `现在每行 ${n} 项。`
            })()}
          >
            <label className="checkbox checkbox--inline">
              <input
                type="checkbox"
                checked={q.layout.optionStops !== undefined}
                onChange={(e) => {
                  if (e.target.checked) setLayout({ optionStops: copyStops(projectStops) })
                  else update((b) => {
                    const { optionStops: _s, ...layout } = b.question.layout
                    return { ...b, question: { ...b.question, layout } }
                  })
                }}
              />
              本题单独设置（否则用“版式设置”中的位置）
            </label>
            {q.layout.optionStops !== undefined && (
              <OptionStopsEditor stops={q.layout.optionStops} onChange={(optionStops) => setLayout({ optionStops })} />
            )}
          </Field>
        )}
      </LayoutFields>
    </>
  )
}

// ---------------- 通用输入控件 ----------------

function Field({ label, hint, children, aside }: { label: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId()
  const labelEl = (
    <span className="field-label" id={id}>
      {label}
    </span>
  )
  return (
    <div className="field" role="group" aria-labelledby={id}>
      {aside === undefined ? (
        labelEl
      ) : (
        <div className="field-label-row">
          {labelEl}
          {aside}
        </div>
      )}
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
function RichTextField({
  value,
  rows,
  onChange,
  fieldId
}: {
  value: RichText
  rows: number
  onChange: (v: RichText) => void
  /** 对应预览段落的字段名，用于“点击预览定位到编辑框” */
  fieldId?: string
}) {
  const [initial] = useState(() => toEditable(value))
  const [draft, setDraft] = useState(initial.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useFieldFocus(fieldId, ref)
  const latest = useRef(value)
  latest.current = value
  const update = (text: string): void => {
    setDraft(text)
    // 文本框只编辑文字：按段落顺序保留原有的段落格式（缩进、空行、换页）
    const next = fromEditable(text, initial.objects).map((p, i) => {
      const format = latest.current[i]?.format
      return format !== undefined ? { ...p, format } : p
    })
    onChange(next)
  }
  // 加粗、倾斜、下划线：属性面板顶部的格式工具与 Ctrl+B / I / U
  const formattable = useFormattable(ref, () => ({ text: draft, objects: initial.objects as Map<number, Inline> }), update)
  // 表格：⟦表格N⟧ 标记对应的表格在编辑器中修改；n 为 null 表示插入新表格
  const [tableEdit, setTableEdit] = useState<{ n: number | null; table: TableInline } | null>(null)
  const tableTokens = [...draft.matchAll(/⟦表格(\d+)⟧/g)].map((m) => Number(m[1]))
  const objects = initial.objects as Map<number, Inline>
  const saveTable = (table: TableInline): void => {
    if (tableEdit?.n != null) {
      objects.set(tableEdit.n, table)
      update(draft)
    } else {
      // 新表格独占一行，插在光标处
      const n = Math.max(0, ...objects.keys()) + 1
      objects.set(n, table)
      const pos = ref.current?.selectionStart ?? draft.length
      const before = draft.slice(0, pos)
      const after = draft.slice(pos)
      const lead = before === '' || before.endsWith('\n') ? '' : '\n'
      const trail = after === '' || after.startsWith('\n') ? '' : '\n'
      update(`${before}${lead}⟦表格${n}⟧${trail}${after}`)
    }
    setTableEdit(null)
  }
  return (
    <div className="text-field">
      <textarea
        ref={ref}
        rows={rows}
        value={draft}
        spellCheck={false}
        title={EDIT_HINT}
        onChange={(e) => update(e.target.value)}
        {...formattable}
      />
      {tableEdit !== null && (
        <TableEditor
          table={tableEdit.table}
          title={tableEdit.n === null ? '插入表格' : '编辑表格'}
          onSave={saveTable}
          onCancel={() => setTableEdit(null)}
        />
      )}
      <div className="text-field-tools">
        {tableTokens.map((n, k) => {
          const t = objects.get(n)
          return t?.type === 'table' ? (
            <button key={`${n}-${k}`} type="button" className="table-edit-button" onClick={() => setTableEdit({ n, table: t })} title="删除表格：在输入框中删掉 ⟦表格⟧ 标记">
              编辑表格{tableTokens.length > 1 ? k + 1 : ''}
            </button>
          ) : null
        })}
        <button type="button" className="table-edit-button" onClick={() => setTableEdit({ n: null, table: createTable(3, 3) })}>
          插入表格
        </button>
        <InsertFormulaButton target={ref} text={draft} onInsert={update} />
      </div>
    </div>
  )
}

function ParagraphField({ value, onChange, fieldId }: { value: RichParagraph; onChange: (v: RichParagraph) => void; fieldId?: string }) {
  const [initial] = useState(() => paragraphToEditable(value))
  const [draft, setDraft] = useState(initial.text)
  const ref = useRef<HTMLInputElement>(null)
  useFieldFocus(fieldId, ref)
  const latest = useRef(value)
  latest.current = value
  const update = (text: string): void => {
    setDraft(text)
    // 文本框只编辑文字：保留段落格式（如字体）
    const next = paragraphFromEditable(text, initial.objects)
    const format = latest.current.format
    onChange(format !== undefined ? { ...next, format } : next)
  }
  const formattable = useFormattable(ref, () => ({ text: draft, objects: initial.objects as Map<number, Inline> }), update)
  return (
    <div className="text-field text-field--inline">
      <input
        ref={ref}
        type="text"
        value={draft}
        spellCheck={false}
        title={EDIT_HINT}
        onChange={(e) => update(e.target.value)}
        {...formattable}
      />
      <InsertFormulaButton target={ref} text={draft} onInsert={update} compact />
    </div>
  )
}

/** 打开公式编辑器，把新公式以 $LaTeX$ 插入到光标位置 */
function InsertFormulaButton(props: {
  target: RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  text: string
  onInsert: (text: string) => void
  compact?: boolean
}) {
  const open = useOpenFormulaEditor()
  if (open === null) return null
  return (
    <button
      type="button"
      className={props.compact === true ? 'icon-button insert-formula' : 'link insert-formula'}
      title="插入公式"
      aria-label="插入公式"
      onClick={() => {
        const el = props.target.current
        const pos = el?.selectionStart ?? props.text.length
        open({
          mode: 'insert',
          initialLatex: '',
          initialDisplay: false,
          onSave: (latex) => {
            props.onInsert(`${props.text.slice(0, pos)}$${latex}$${props.text.slice(pos)}`)
          }
        })
      }}
    >
      {props.compact === true ? 'ƒx' : '插入公式…'}
    </button>
  )
}

/** 删除选项后重新按 A、B、C…… 排序 */
function relabel(options: Question['options']): Question['options'] {
  return options.map((o, i) => ({ ...o, label: String.fromCharCode(65 + i) }))
}

function TextInput({ value, width, onChange, fieldId }: { value: string; width?: string; onChange: (v: string) => void; fieldId?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useFieldFocus(fieldId, ref)
  return (
    <input
      ref={ref}
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
