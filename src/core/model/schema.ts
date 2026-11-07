/**
 * project.json 的运行时校验。
 *
 * 工程文件可能来自旧版本软件或被手工修改，读取时必须校验，
 * 不能直接信任 JSON 内容。文件底部的类型断言保证校验规则与
 * `types.ts` 中的类型定义保持同步：两者不一致时会编译失败。
 */
import { z } from 'zod'
import type { Project } from './types'

const textMarks = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  script: z.enum(['sup', 'sub']).optional(),
  color: z
    .string()
    .regex(/^[0-9A-Fa-f]{6}$/)
    .optional()
})

const inline = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string(), marks: textMarks.optional() }),
  z
    .object({
      type: z.literal('math'),
      omml: z.string().optional(),
      latex: z.string().optional(),
      display: z.boolean().optional()
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

const richParagraph = z.object({ inlines: z.array(inline) })
const richText = z.array(richParagraph)

const variant = z.enum(['teacher', 'student'])

const question = z.object({
  id: z.string(),
  kind: z.enum(['single-choice', 'multi-choice', 'fill-blank', 'solve']),
  difficulty: z.string().optional(),
  stem: richText,
  figures: z.array(
    z.object({
      assetId: z.string(),
      widthEmu: z.number().positive(),
      heightEmu: z.number().positive(),
      placement: z.enum(['below', 'right'])
    })
  ),
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
    keepTogether: z.boolean(),
    pageBreakBefore: z.boolean()
  })
})

const block = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('title'),
    text: z.string(),
    restartNumbering: z.boolean().optional()
  }),
  z.object({ id: z.string(), type: z.literal('section'), text: z.string() }),
  z.object({ id: z.string(), type: z.literal('topic'), text: z.string() }),
  z.object({
    id: z.string(),
    type: z.literal('paragraph'),
    content: richText,
    onlyIn: variant.optional()
  }),
  z.object({ id: z.string(), type: z.literal('question'), question })
])

export const projectSchema = z.object({
  meta: z.object({
    title: z.string(),
    headerLeft: z.string(),
    headerRight: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  }),
  templateId: z.string(),
  blocks: z.array(block)
})

// ---- 编译期同步检查 ----
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type _SchemaMatchesProject = Assert<Equals<z.infer<typeof projectSchema>, Project>>
