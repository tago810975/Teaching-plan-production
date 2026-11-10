/**
 * 题型整理（物理题型整理 V1.0）的预制模块。
 *
 * 样张：reference/samples/物理题型整理_放缩圆（原为 LaTeX 编译的 PDF，见其中的 tex/ 与 ANALYSIS.md）。
 * 一份题型整理讲一道母题，由这些部分组成：
 *   大标题（题型名）→ 例题（题干、题图、选项）→ 审题（灰底注释框 + 审题总结）
 *   → 解题（“思维过程 / 书写过程”对照表）→ 易错提醒 → 题后归纳
 *
 * 这里只用已有的块类型拼出这些部分（没有新的块类型）：
 * - 注释框：正文段落块 + 整块浅灰底纹（paragraph.shaded）；
 * - 对照表：正文段落块中的一张表格：深蓝表头、左栏浅蓝、右栏米色，
 *   右栏单元格设 studentLines，学生版换成虚线格（build.ts 的 applyStudentLines）。
 */
import { contentWidthTwip, A4_PAGE } from '../document/units'
import { createQuestion, newId, para } from './factory'
import type { Block, ParagraphBlock, RichParagraph, RichText, TableCell, TableInline } from './types'

/** 样张的配色（modi-handout.cls） */
export const TYPE_SUMMARY_COLORS = {
  /** 表头底色、表格线 */
  blue: '1F4E79',
  /** 左栏（思维过程）底色 */
  paleBlue: 'F2F7FC',
  /** 右栏（书写过程）底色 */
  cream: 'FDF8F2'
} as const

/** 对照表左右两栏的宽度比例（样张 0.53 : 0.47） */
const THINK_RATIO = 0.53

export interface ThinkWriteRow {
  /** 思维过程：一连串自问，通常以 ①②③ 开头 */
  think: RichText
  /** 书写过程：教师版显示的规范书写 */
  write: RichText
  /** 学生版书写栏的虚线行数 */
  lines: number
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩'

/** ①②……（超过 10 用 (11)） */
export function circled(n: number): string {
  return n >= 1 && n <= CIRCLED.length ? CIRCLED[n - 1]! : `(${n})`
}

/** “思维过程 / 书写过程”对照表的一个单元格 */
function cell(content: RichText, shading: string, extra: Partial<TableCell> = {}): TableCell {
  return { content: content.length > 0 ? content : [{ inlines: [] }], shading, ...extra }
}

/**
 * “思维过程 / 书写过程”对照表（一个正文段落块，内容是一张表格）。
 * header 为 false 时没有表头（样张中接在上一张表后面的续表）。
 */
export function createThinkWriteTable(rows: ThinkWriteRow[], header = true): ParagraphBlock {
  const width = contentWidthTwip(A4_PAGE)
  const left = Math.round(width * THINK_RATIO)
  const headCell = (text: string): TableCell => ({
    content: [{ inlines: [{ type: 'text', text, marks: { font: 'hei', color: 'FFFFFF' } }], format: { align: 'center' } }],
    shading: TYPE_SUMMARY_COLORS.blue
  })
  const table: TableInline = {
    type: 'table',
    rows: [
      ...(header ? [{ cells: [headCell('思维过程'), headCell('书写过程')] }] : []),
      ...rows.map((r) => ({
        cells: [cell(r.think, TYPE_SUMMARY_COLORS.paleBlue), cell(r.write, TYPE_SUMMARY_COLORS.cream, { studentLines: Math.max(1, Math.round(r.lines)) })]
      }))
    ],
    colWidthsTwip: [left, width - left],
    borderColor: TYPE_SUMMARY_COLORS.blue,
    valign: 'top'
  }
  return { id: newId(), type: 'paragraph', content: [{ inlines: [table] }] }
}

/** 审题注释框：浅灰底纹的正文段落块，每条以 ①②③ 开头 */
export function createNoteBox(lines: RichText): ParagraphBlock {
  return { id: newId(), type: 'paragraph', shaded: true, content: lines }
}

/** 一组编号条目：（1）（2）……，如“审题总结” */
export function numberedItems(items: string[]): RichText {
  return items.map((t, i) => para(`（${i + 1}）${t}`))
}

/** 一组圈号条目：①②……，如注释框、思维过程 */
export function circledItems(items: string[]): RichText {
  return items.map((t, i) => para(`${circled(i + 1)} ${t}`))
}

/** 加粗的小标题加正文，如“易错提醒：” */
function boldLead(lead: string, rest = ''): RichParagraph {
  return { inlines: [{ type: 'text', text: lead, marks: { bold: true } }, ...(rest !== '' ? [{ type: 'text' as const, text: rest }] : [])] }
}

/**
 * 一整份题型整理的骨架：按样张的顺序放好各部分，文字是填写提示。
 * 栏目标题取自预设的 sectionNames（例题、审题、解题、题后归纳）。
 */
export function createTypeSummarySkeleton(sectionNames: readonly string[]): Block[] {
  const name = (i: number, fallback: string): string => sectionNames[i] ?? fallback
  const options = ['A', 'B', 'C', 'D'].map((label) => ({ label, content: { inlines: [] } }))
  return [
    { id: newId(), type: 'title', text: '题型名称：适用条件（如“放缩圆法：速度方向一定，大小不同”）' },
    { id: newId(), type: 'section', text: name(0, '例题') },
    {
      id: newId(),
      type: 'question',
      question: createQuestion({
        kind: 'multi-choice',
        options,
        stem: [para('（多选）题干。在需要细读的条件后加圈号①②③，与下面审题注释框的条目对应。')]
      })
    },
    { id: newId(), type: 'section', text: name(1, '审题'), pageBreakBefore: true },
    createNoteBox(circledItems(['条件①的含义：它告诉我们什么物理条件。', '条件②的含义……', '条件③的含义……'])),
    {
      id: newId(),
      type: 'paragraph',
      content: [
        { inlines: [{ type: 'text', text: '审题总结：本题将包含' }], format: { firstLineChars: 2 } },
        ...numberedItems(['「认题型」：……', '「定不变量」：……', '「找临界」：……'])
      ]
    },
    { id: newId(), type: 'section', text: name(2, '解题') },
    createThinkWriteTable([
      {
        think: circledItems(['第一步要想清楚的问题？', '第二步要想清楚的问题？', '第三步要想清楚的问题？']),
        write: [boldLead('书写要点'), para('教师版显示这里的规范书写；学生版换成虚线格，行数在表格编辑器中设置。')],
        lines: 8
      }
    ]),
    {
      id: newId(),
      type: 'paragraph',
      content: [boldLead('易错提醒：'), para('① ……'), para('② ……')]
    },
    { id: newId(), type: 'section', text: name(3, '题后归纳'), pageBreakBefore: true },
    {
      id: newId(),
      type: 'paragraph',
      content: [boldLead('方法三步：'), para('第一步 认题型：……'), para('第二步 定不变量：……'), para('第三步 找临界：……'), boldLead('拓展思考：', '……')]
    }
  ]
}
