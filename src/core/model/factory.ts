/**
 * 创建模型对象的工厂函数，集中管理默认值。
 */
import type {
  Inline,
  Project,
  ProjectBundle,
  Question,
  QuestionLayout,
  RichParagraph,
  RichText
} from './types'

export const DEFAULT_TEMPLATE_ID = 'physics-default'

export function newId(): string {
  return crypto.randomUUID()
}

export const DEFAULT_QUESTION_LAYOUT: Readonly<QuestionLayout> = Object.freeze({
  studentSpaceLines: 0,
  teacherSpaceLines: 0,
  optionColumns: 'auto',
  keepTogether: true,
  pageBreakBefore: false
})

export function createEmptyProject(now: Date = new Date()): Project {
  const stamp = now.toISOString()
  return {
    meta: { title: '未命名教学案', createdAt: stamp, updatedAt: stamp },
    header: { left: '', phone: '', right: '' },
    templateId: DEFAULT_TEMPLATE_ID,
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
