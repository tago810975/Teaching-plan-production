/**
 * project.json 的运行时校验。
 *
 * 工程文件可能来自旧版本软件或被手工修改，读取时必须校验，
 * 不能直接信任 JSON 内容。文件底部的类型断言保证校验规则与
 * `types.ts` 中的类型定义保持同步：两者不一致时会编译失败。
 */
import { z } from 'zod'
import type { Inline, Project, RichParagraph, TableInline } from './types'

const fontFamily = z.enum(['song', 'hei', 'kai', 'fang'])

const twip = z.number().min(0).max(20000)
const optionStops = z.object({ two: z.tuple([twip]), four: z.tuple([twip, twip, twip]) })

const textMarks = z.object({
  font: fontFamily.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  script: z.enum(['sup', 'sub']).optional(),
  color: z
    .string()
    .regex(/^[0-9A-Fa-f]{6}$/)
    .optional()
})

const simpleInline = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string(), marks: textMarks.optional() }),
  z
    .object({
      type: z.literal('math'),
      omml: z.string().optional(),
      latex: z.string().optional(),
      display: z.boolean().optional(),
      bold: z.boolean().optional(),
      underline: z.boolean().optional(),
      color: z
        .string()
        .regex(/^[0-9A-Fa-f]{6}$/)
        .optional()
    })
    .refine((m) => m.omml !== undefined || m.latex !== undefined, '公式至少需要 omml 或 latex'),
  z.object({
    type: z.literal('image'),
    assetId: z.string(),
    widthEmu: z.number().positive(),
    heightEmu: z.number().positive()
  }),
  z.object({ type: z.literal('blank'), widthChars: z.number().positive() })
])

// 表格的单元格内容是富文本：行内元素、段落、表格互相引用，需显式标注类型
const inline: z.ZodType<Inline> = z.lazy(() => z.union([simpleInline, tableInline]))

const richParagraph: z.ZodType<RichParagraph> = z.object({
  inlines: z.array(inline),
  format: z
    .object({
      firstLineChars: z.number().optional(),
      align: z.enum(['center', 'right']).optional(),
      spaceAfterLines: z.number().min(0).optional(),
      font: fontFamily.optional(),
      pageBreakBefore: z.boolean().optional()
    })
    .optional()
})
const richText = z.array(richParagraph)

const tableInline: z.ZodType<TableInline> = z.object({
  type: z.literal('table'),
  rows: z.array(
    z.object({
      cells: z.array(
        z.object({
          content: richText,
          colSpan: z.number().int().min(1).optional(),
          rowSpan: z.number().int().min(1).optional(),
          shading: z
            .string()
            .regex(/^[0-9A-Fa-f]{6}$/)
            .optional()
        })
      )
    })
  ),
  colWidthsTwip: z.array(z.number().positive()).optional()
})


const variant = z.enum(['teacher', 'student'])

const figure = z.object({
  assetId: z.string(),
  widthEmu: z.number().positive(),
  heightEmu: z.number().positive(),
  placement: z.enum(['below', 'right', 'right-items', 'below-item', 'below-all', 'free']),
  anchorParagraph: z.number().int().min(0).optional(),
  anchorItem: z.number().int().min(0).optional(),
  offsetXEmu: z.number().optional(),
  offsetYEmu: z.number().optional()
})

const blockLayout = z.object({
  studentSpaceLines: z.number().min(0),
  teacherSpaceLines: z.number().min(0),
  keepTogether: z.enum(['auto', 'always', 'never']),
  pageBreakBefore: z.boolean()
})

const question = z.object({
  id: z.string(),
  kind: z.enum(['single-choice', 'multi-choice', 'fill-blank', 'solve']),
  difficulty: z.string().optional(),
  stars: z.number().int().min(1).max(5).optional(),
  stem: richText,
  figures: z.array(figure),
  options: z.array(z.object({ label: z.string(), content: richParagraph })),
  subQuestions: z.array(z.object({ id: z.string(), content: richText })),
  answer: richText,
  knowledgePoints: z.array(z.string()),
  keyPoint: z.string().optional(),
  difficultPoint: z.string().optional(),
  analysis: richText,
  source: z
    .object({ bankId: z.string().optional(), fileName: z.string().optional() })
    .optional(),
  layout: z.object({
    studentSpaceLines: z.number().min(0),
    teacherSpaceLines: z.number().min(0),
    optionColumns: z.union([z.literal('auto'), z.literal(1), z.literal(2), z.literal(4)]),
    optionStops: optionStops.optional(),
    keepTogether: z.enum(['auto', 'always', 'never']),
    pageBreakBefore: z.boolean()
  })
})

const questionBlock = z.object({ id: z.string(), type: z.literal('question'), question })

const block = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('title'),
    text: z.string(),
    restartNumbering: z.boolean().optional(),
    pageBreakBefore: z.boolean().optional()
  }),
  z.object({
    id: z.string(),
    type: z.literal('section'),
    text: z.string(),
    restartNumbering: z.boolean().optional(),
    pageBreakBefore: z.boolean().optional()
  }),
  z.object({ id: z.string(), type: z.literal('worksheet'), title: z.string(), fields: z.array(z.string()) }),
  z.object({
    id: z.string(),
    type: z.literal('topic'),
    text: z.string(),
    restartNumbering: z.boolean().optional(),
    pageBreakBefore: z.boolean().optional()
  }),
  z.object({
    id: z.string(),
    type: z.literal('paragraph'),
    content: richText,
    onlyIn: variant.optional()
  }),
  questionBlock,
  z.object({
    id: z.string(),
    type: z.literal('knowledge'),
    title: z.string(),
    content: richText,
    figures: z.array(figure),
    layout: blockLayout
  }),
  z.object({
    id: z.string(),
    type: z.literal('composite'),
    title: z.string(),
    background: richText,
    figures: z.array(figure),
    items: z.array(questionBlock),
    answer: richText,
    analysis: richText,
    layout: blockLayout
  })
])

const headerImage = z.object({
  assetId: z.string(),
  widthEmu: z.number().positive(),
  heightEmu: z.number().positive()
})

export const projectSchema = z.object({
  meta: z.object({
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  }),
  header: z.object({
    logo: headerImage.optional(),
    left: z.string(),
    phoneIcon: headerImage.optional(),
    phone: z.string(),
    right: z.string(),
    watermark: headerImage.optional()
  }),
  layout: z.object({
    keepQuestionTogether: z.object({ teacher: z.boolean(), student: z.boolean() }),
    keepKnowledgeTogether: z.object({ teacher: z.boolean(), student: z.boolean() }),
    optionStops,
    difficultyDisplay: z.enum(['both', 'grade', 'stars', 'none'])
  }),
  templateId: z.string(),
  presetId: z.string(),
  blocks: z.array(block)
})

// ---- 编译期同步检查 ----
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type _SchemaMatchesProject = Assert<Equals<z.infer<typeof projectSchema>, Project>>
