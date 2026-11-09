/**
 * 创建模型对象的工厂函数，集中管理默认值。
 */
import type {
  BlockLayout,
  CompositeBlock,
  Inline,
  KnowledgeBlock,
  Project,
  ProjectBundle,
  OptionStops,
  ProjectLayout,
  Question,
  QuestionLayout,
  RichParagraph,
  RichText
} from './types'

/** 默认格式预设：物理教案 V1.0（与 core/presets 中的 id 一致） */
export const DEFAULT_PRESET_ID = 'physics-v1'

export const DEFAULT_TEMPLATE_ID = 'physics-default'

export function newId(): string {
  return crypto.randomUUID()
}

/**
 * 选项列位置的默认值（twip）：四列等宽并铺满整栏——每行 4 项时 B、C、D 列从第 14、26、38 个字处开始
 * （每列约 12 个字宽），每行 2 项时 B 列从第 26 个字处开始。
 * 模板样式自带的是 11、20、29 字（LEGACY_OPTION_STOPS），第 6、7 版的默认值是 13、24、35 字（PREVIOUS_OPTION_STOPS）。
 */
export const DEFAULT_OPTION_STOPS: Readonly<OptionStops> = Object.freeze({
  two: [26 * 210] as [number],
  four: [14 * 210, 26 * 210, 38 * 210] as [number, number, number]
})

/** 第 6、7 版的默认列位置；迁移时若工程仍是它（没有改过），换成新的默认值 */
export const PREVIOUS_OPTION_STOPS: Readonly<OptionStops> = Object.freeze({
  two: [24 * 210] as [number],
  four: [13 * 210, 24 * 210, 35 * 210] as [number, number, number]
})

/** 模板“题目 选项”样式自带的制表位；第 6 版之前的工程一律使用它，迁移后排版不变 */
export const LEGACY_OPTION_STOPS: Readonly<OptionStops> = Object.freeze({
  two: [4200] as [number],
  four: [2310, 4200, 6090] as [number, number, number]
})

/** 教案默认允许跨页以节省纸张；学案默认整题同页，保证题目与作答空间在一起 */
export const DEFAULT_PROJECT_LAYOUT: Readonly<ProjectLayout> = Object.freeze({
  keepQuestionTogether: Object.freeze({ teacher: false, student: true }),
  /** 知识点通常较长，默认允许跨页 */
  keepKnowledgeTogether: Object.freeze({ teacher: false, student: false }),
  optionStops: DEFAULT_OPTION_STOPS,
  difficultyDisplay: 'both' as const
})

export const DEFAULT_QUESTION_LAYOUT: Readonly<QuestionLayout> = Object.freeze({
  studentSpaceLines: 0,
  teacherSpaceLines: 0,
  optionColumns: 'auto',
  keepTogether: 'auto',
  pageBreakBefore: false
})

export function createEmptyProject(now: Date = new Date()): Project {
  const stamp = now.toISOString()
  return {
    meta: { title: '未命名教学案', createdAt: stamp, updatedAt: stamp },
    header: { left: '', phone: '', right: '' },
    layout: {
      keepQuestionTogether: { ...DEFAULT_PROJECT_LAYOUT.keepQuestionTogether },
      keepKnowledgeTogether: { ...DEFAULT_PROJECT_LAYOUT.keepKnowledgeTogether },
      optionStops: copyStops(DEFAULT_OPTION_STOPS),
      difficultyDisplay: 'both'
    },
    templateId: DEFAULT_TEMPLATE_ID,
    presetId: DEFAULT_PRESET_ID,
    blocks: []
  }
}

export function createEmptyBundle(now?: Date): ProjectBundle {
  return { project: createEmptyProject(now), assets: {} }
}

export function createQuestion(
  partial: Omit<Partial<Question>, 'layout'> & { layout?: Partial<QuestionLayout> } = {}
): Question {
  return {
    id: newId(),
    kind: 'single-choice',
    stem: [],
    figures: [],
    options: [],
    subQuestions: [],
    answer: [],
    knowledgePoints: [],
    analysis: [],
    ...partial,
    layout: { ...DEFAULT_QUESTION_LAYOUT, ...partial.layout }
  }
}

export const DEFAULT_BLOCK_LAYOUT: Readonly<BlockLayout> = Object.freeze({
  studentSpaceLines: 0,
  teacherSpaceLines: 0,
  keepTogether: 'auto',
  pageBreakBefore: false
})

export function createKnowledge(partial: Omit<Partial<KnowledgeBlock>, 'layout' | 'type'> & { layout?: Partial<BlockLayout> } = {}): KnowledgeBlock {
  return {
    id: newId(),
    title: '',
    content: [],
    figures: [],
    ...partial,
    type: 'knowledge',
    layout: { ...DEFAULT_BLOCK_LAYOUT, ...partial.layout }
  }
}

export function createComposite(
  partial: Omit<Partial<CompositeBlock>, 'layout' | 'type'> & { layout?: Partial<BlockLayout> } = {}
): CompositeBlock {
  return {
    id: newId(),
    title: '',
    background: [],
    figures: [],
    items: [],
    answer: [],
    analysis: [],
    ...partial,
    type: 'composite',
    layout: { ...DEFAULT_BLOCK_LAYOUT, ...partial.layout }
  }
}

// ---- 富文本便捷函数 ----

/** 由纯文本创建单段富文本 */
export function para(...inlines: Array<Inline | string>): RichParagraph {
  return {
    inlines: inlines.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x))
  }
}

/** 由多行纯文本创建富文本，每行一段 */
export function richFromPlain(text: string): RichText {
  if (text === '') return []
  return text.split('\n').map((line) => para(line))
}

/** 提取富文本中的纯文字（公式以 LaTeX 或占位符表示），用于大纲、搜索等 */
export function plainText(rich: RichText | RichParagraph): string {
  const paras = Array.isArray(rich) ? rich : [rich]
  return paras
    .map((p) =>
      p.inlines
        .map((i) => {
          switch (i.type) {
            case 'text':
              return i.text
            case 'math':
              return i.latex !== undefined ? `$${i.latex}$` : '[公式]'
            case 'image':
              return '[图]'
            case 'blank':
              return '____'
          }
        })
        .join('')
    )
    .join('\n')
}

export function copyStops(s: Readonly<OptionStops>): OptionStops {
  return { two: [s.two[0]], four: [s.four[0], s.four[1], s.four[2]] }
}
