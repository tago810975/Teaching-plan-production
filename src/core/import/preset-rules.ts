/**
 * 按格式预设整理导入的内容（在识别、整理字体之后进行）：
 * - 作业单：“作业单-……”大标题加上其后的“姓名：…… 教室：……”一行，合成作业单模块；
 * - 难度：题干开头的 ★（或【★★】）记为星级难度；
 * - 解析：标签改写（如【详解】→【解析】），文字统一为黑色（预设规定时）。
 */
import { newId, plainText } from '../model/factory'
import { gradeForStars, type FormatPreset } from '../presets'
import type { Block, Inline, Question, QuestionBlock, RichText } from '../model/types'

export function applyPresetRules(blocks: Block[], preset: FormatPreset): Block[] {
  return mergeWorksheets(blocks).map((b) => {
    if (b.type === 'question') return question(b, preset)
    if (b.type === 'composite') return { ...b, analysis: analysis(b.analysis, preset), items: b.items.map((it) => question(it, preset)) }
    return b
  })
}

// ---------------- 作业单 ----------------

const WORKSHEET_TITLE = /作业单/
const FIELD = /([^\s：:_＿]+)\s*[：:]/g

function mergeWorksheets(blocks: Block[]): Block[] {
  const out: Block[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    const next = blocks[i + 1]
    if (b.type === 'title' && WORKSHEET_TITLE.test(b.text) && next?.type === 'paragraph') {
      const text = plainText(next.content)
      const fields = [...text.matchAll(FIELD)].map((m) => m[1]!)
      if (fields.includes('姓名')) {
        out.push({ id: b.id ?? newId(), type: 'worksheet', title: b.text.trim(), fields })
        i += 1
        continue
      }
    }
    out.push(b)
  }
  return out
}

// ---------------- 难度与解析 ----------------

function question(b: QuestionBlock, preset: FormatPreset): QuestionBlock {
  let q: Question = b.question
  let stars: number | undefined
  // 【★★★】被识别成等级时，改记为星级
  if (q.difficulty !== undefined && /^[★☆]+$/.test(q.difficulty)) {
    stars = count(q.difficulty)
    const { difficulty: _d, ...rest } = q
    q = rest
  }
  // 题干开头的 ★★★
  const first = q.stem[0]?.inlines[0]
  if (first?.type === 'text') {
    const m = /^\s*([★☆]+)\s*/.exec(first.text)
    if (m !== null) {
      stars ??= count(m[1]!)
      const text = first.text.slice(m[0].length)
      const inlines: Inline[] = [...(text !== '' ? [{ ...first, text }] : []), ...q.stem[0]!.inlines.slice(1)]
      q = { ...q, stem: [{ ...q.stem[0]!, inlines }, ...q.stem.slice(1)] }
    }
  }
  // 星级换算成等级（如 3 星 → C）；已有等级时以等级为准。没有对应等级的星数才单独记为星级
  if (stars !== undefined && stars > 0 && (q.difficulty === undefined || q.difficulty === '')) {
    const grade = gradeForStars(stars, preset)
    q = grade !== undefined ? { ...q, difficulty: grade } : { ...q, stars: Math.min(stars, 5) }
  }
  return { ...b, question: { ...q, analysis: analysis(q.analysis, preset) } }
}

/** 实心星的个数（☆ 是空星，不计） */
function count(s: string): number {
  return [...s].filter((c) => c === '★').length
}

function analysis(text: RichText, preset: FormatPreset): RichText {
  const rename = Object.entries(preset.import.renameLabels)
  const black = preset.import.analysisColor === 'black'
  return text.map((p) => ({
    ...p,
    inlines: p.inlines.map((i): Inline => {
      if (i.type !== 'text') return i
      let t = i.text
      for (const [from, to] of rename) t = t.split(from).join(to)
      let marks = i.marks
      if (black && marks?.color !== undefined) {
        const { color: _c, ...rest } = marks
        marks = Object.keys(rest).length > 0 ? rest : undefined
      }
      return marks !== undefined ? { type: 'text', text: t, marks } : { type: 'text', text: t }
    })
  }))
}
