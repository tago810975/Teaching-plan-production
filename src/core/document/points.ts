/**
 * 知识点重点难点汇总（“题目要点”文档）：按栏目列出每道题的【知识点】【重点】【难点】【审题】，
 * 仿照用户提供的样张（reference/samples/知识点重点难点汇总/）：
 *
 *   大标题：<名称> 知识点重点难点汇总
 *   栏目标题（例题精讲 / 课堂练习 / 课后练习……）
 *     第 N 题
 *     【知识点】…  【重点】…  【难点】…  【审题】…
 *
 * 栏目中有“重点题”（题目标记为重点题，或写了【重点】）或“难点题”（写了【难点】）时，这一栏目只列出这两类题，
 * 分成【重点题】【难点题】两组（样张中的课堂练习）；否则列出栏目中所有写了要点的题。
 * 题号与教案中一致（取自教案的排版结果，变式题 a. b. c. 也一样）。
 */
import type { Block, Question, RichText } from '../model/types'
import { getPreset, resolveQuestionFields } from '../presets'
import { buildDocument } from './build'
import type { DocIR, DocParagraph, DocRun } from './ir'

export const POINTS_TITLE_SUFFIX = '知识点重点难点汇总'

interface Entry {
  id: string
  number: string
  q: Question
}

interface Section {
  title: string | null
  entries: Entry[]
}

export function buildPointsDocument(project: Parameters<typeof buildDocument>[0]): DocIR {
  // 页眉、页面、样式与题号都取自教案，保证与导出的教案一致
  const teacher = buildDocument(project, 'teacher')
  const numbers = new Map<string, string>()
  for (const p of teacher.paragraphs) {
    if (p.style === 'question' && p.label !== undefined && !numbers.has(p.sourceBlockId)) numbers.set(p.sourceBlockId, p.label.replace(/[.．]\s*$/, ''))
  }
  const fields = resolveQuestionFields(project.layout, getPreset(project.presetId))

  // 按栏目（栏目标题、作业单）分组
  const sections: Section[] = [{ title: null, entries: [] }]
  const add = (id: string, q: Question): void => {
    const number = numbers.get(id)
    if (number !== undefined) sections[sections.length - 1]!.entries.push({ id, number, q })
  }
  for (const b of project.blocks as Block[]) {
    if (b.type === 'section') sections.push({ title: b.text, entries: [] })
    else if (b.type === 'worksheet') sections.push({ title: b.title, entries: [] })
    else if (b.type === 'question') add(b.id, b.question)
    else if (b.type === 'composite') for (const it of b.items) add(it.id, it.question)
  }

  const isImportant = (q: Question): boolean => (fields.important && q.important === true) || nonEmpty(q.keyPoint)
  const isDifficult = (q: Question): boolean => nonEmpty(q.difficultPoint)
  const hasPoints = (q: Question): boolean =>
    q.knowledgePoints.some((k) => k.trim() !== '') || isImportant(q) || isDifficult(q) || (fields.review && hasText(q.review))

  const out: DocParagraph[] = []
  let n = 0
  const para = (style: DocParagraph['style'], runs: DocRun[], extra: Partial<DocParagraph> = {}): void => {
    out.push({ key: `points-${n++}`, sourceBlockId: 'points', style, runs, ...extra })
  }
  const text = (t: string, bold = false): DocRun => ({ kind: 'text', text: t, ...(bold ? { marks: { bold: true } } : {}) })
  const entryParas = (e: Entry): void => {
    para('body', [text(`第${e.number}题`, true)], { keepNext: true })
    const k = e.q.knowledgePoints.map((s) => s.trim()).filter((s) => s !== '')
    if (k.length > 0) para('body', [text(`【知识点】${k.join('、')}`)])
    if (nonEmpty(e.q.keyPoint)) para('body', [text(`【重点】${e.q.keyPoint!.trim()}`)])
    if (nonEmpty(e.q.difficultPoint)) para('body', [text(`【难点】${e.q.difficultPoint!.trim()}`)])
    if (fields.review && hasText(e.q.review)) {
      e.q.review!.forEach((p, i) => {
        const runs: DocRun[] = p.inlines.flatMap((x): DocRun[] =>
          x.type === 'text' ? [{ kind: 'text', text: x.text, ...(x.marks !== undefined ? { marks: x.marks } : {}) }] : x.type === 'math' ? [{ kind: 'math', ...withoutType(x) }] : []
        )
        para('body', i === 0 ? [text('【审题】'), ...runs] : runs)
      })
    }
  }

  para('title', [text(`${project.meta.title} ${POINTS_TITLE_SUFFIX}`)])
  for (const s of sections) {
    const listed = s.entries.filter((e) => hasPoints(e.q))
    if (listed.length === 0) continue
    if (s.title !== null) para('section', [text(s.title)], { keepNext: true })
    const important = listed.filter((e) => isImportant(e.q))
    const difficult = listed.filter((e) => !isImportant(e.q) && isDifficult(e.q))
    if (important.length + difficult.length > 0) {
      // 有重点题、难点题的栏目：只列这两类，分组（样张中的课堂练习）
      if (important.length > 0) {
        para('topic', [text('【重点题】')], { keepNext: true })
        important.forEach(entryParas)
      }
      if (difficult.length > 0) {
        para('topic', [text('【难点题】')], { keepNext: true })
        difficult.forEach(entryParas)
      }
    } else listed.forEach(entryParas)
  }
  if (out.length === 1) para('body', [text('还没有题目写了知识点、重点或难点。')])

  return { ...teacher, paragraphs: out }
}

function nonEmpty(s: string | undefined): boolean {
  return s !== undefined && s.trim() !== ''
}

function hasText(t: RichText | undefined): boolean {
  return t !== undefined && t.some((p) => p.inlines.some((i) => i.type !== 'text' || i.text.trim() !== ''))
}

function withoutType<T extends { type: string }>(x: T): Omit<T, 'type'> {
  const { type: _t, ...rest } = x
  return rest
}
