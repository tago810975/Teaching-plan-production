/**
 * 综合题的答案与解析放在哪里：集中在整道综合题最后（共用），或分到每道小题后面。
 *
 * 切换时真的把内容搬过去（而不只是换显示方式），这样数据与显示一致，各小题的答案也能单独修改：
 * - 分到各小题：共用答案按连续递增的题号拆开（“6．横波 7．1.8 向上 …”），共用解析按以题号开头的段落拆开，
 *   去掉题号前缀后交给对应的小题；第一道小题之前的解析段落（如【知识点】）仍留在综合题；
 * - 集中到最后：各小题的答案拼成“题号．答案”一段，解析按题号依次接起来，开头保留一个【解析】等标签。
 * 题号必须连续递增才算分界，所以“1.8”“[1]”“（1）”不会被误拆。
 */
import type { CompositeBlock, Inline, Question, QuestionBlock, RichParagraph, RichText } from './types'

export type AnswerPlacement = 'end' | 'items' | 'mixed' | 'none'

const hasContent = (t: RichText): boolean => t.some((p) => p.inlines.some((i) => i.type !== 'text' || i.text.trim() !== ''))
const LABEL = /^\s*【\s*(详解|解析|分析|点睛|点评)\s*】\s*/

/** 当前放在哪里：end 集中在最后；items 分在各小题；mixed 两处都有；none 都没有 */
export function answerPlacement(c: CompositeBlock): AnswerPlacement {
  const atEnd = hasContent(c.answer) || c.analysis.some((p) => numberAt(p) !== null)
  const atItems = c.items.some((it) => hasContent(it.question.answer) || hasContent(it.question.analysis))
  return atEnd && atItems ? 'mixed' : atEnd ? 'end' : atItems ? 'items' : 'none'
}

export interface DistributeResult {
  composite: CompositeBlock
  /** 答案中找到的分段数、解析中找到的分段数（与小题数对不上时提示） */
  answerParts: number
  analysisParts: number
}

// ---------------- 分到各小题 ----------------

/** 题号：全角“．”后面可以紧跟数字（“3．1.8”）；半角“.”后面紧跟数字的是小数（“1.8”） */
const TOKEN = /(^|[\s　】])(\d{1,3})\s*(?:．|\.(?!\d))/g

/** 段落开头的题号（可在【解析】等标签之后）；没有时为 null */
function numberAt(p: RichParagraph): number | null {
  const first = p.inlines[0]
  if (first?.type !== 'text') return null
  const m = /^(\d{1,3})\s*(?:．|\.(?!\d))/.exec(first.text.replace(LABEL, '').trimStart())
  return m === null ? null : Number(m[1])
}

/** 去掉段落开头的标签与题号 */
function stripNumber(p: RichParagraph): RichParagraph {
  const [first, ...rest] = p.inlines
  if (first?.type !== 'text') return p
  const text = first.text.replace(LABEL, '').trimStart().replace(/^\d{1,3}\s*[．.]\s*/, '')
  return { ...p, inlines: text === '' ? rest : [{ ...first, text }, ...rest] }
}

/**
 * 按连续递增的题号把答案拆成几段：返回各段（每段是若干行内元素），以及第一个题号。
 * 题号之间的空白去掉；同一段中的多个空（“1.8     向上”）用全角空格隔开。
 */
function splitAnswer(answer: RichText): { start: number | null; parts: Inline[][] } {
  const parts: Inline[][] = []
  let start: number | null = null
  let expect: number | null = null
  let cur: Inline[] | null = null
  const push = (i: Inline): void => {
    if (cur === null) return
    if (i.type === 'text') {
      const text = i.text.replace(/[\s　]{2,}/g, '　')
      if (text.trim() === '' && (cur.length === 0 || cur[cur.length - 1]?.type === 'text')) return
      const last = cur[cur.length - 1]
      if (last?.type === 'text' && JSON.stringify(last.marks ?? {}) === JSON.stringify(i.marks ?? {})) cur[cur.length - 1] = { ...last, text: last.text + text }
      else cur.push({ ...i, text })
    } else cur.push(i)
  }
  answer.forEach((p, pi) => {
    if (pi > 0) push({ type: 'text', text: '　' })
    for (const i of p.inlines) {
      if (i.type !== 'text') {
        push(i)
        continue
      }
      let last = 0
      for (const m of i.text.matchAll(TOKEN)) {
        const n = Number(m[2])
        if (expect !== null && n !== expect) continue
        push({ ...i, text: i.text.slice(last, m.index + m[1]!.length) })
        start ??= n
        expect = n + 1
        cur = []
        parts.push(cur)
        last = m.index + m[0].length
      }
      push({ ...i, text: i.text.slice(last) })
    }
  })
  // 去掉每段首尾的空白
  const trimmed = parts.map((ps) => {
    const out = ps.slice()
    const f = out[0]
    if (f?.type === 'text') out[0] = { ...f, text: f.text.replace(/^[\s　]+/, '') }
    const l = out[out.length - 1]
    if (l?.type === 'text') out[out.length - 1] = { ...l, text: l.text.replace(/[\s　]+$/, '') }
    return out.filter((x) => x.type !== 'text' || x.text !== '')
  })
  return { start, parts: trimmed }
}

/** 把共用答案与解析分到各小题（已有答案的小题，内容接在后面） */
export function distributeAnswers(c: CompositeBlock): DistributeResult {
  const n = c.items.length
  const { start, parts } = splitAnswer(c.answer)
  const answers: RichText[] = c.items.map(() => [])
  const analyses: RichText[] = c.items.map(() => [])
  let keepAnswer: RichText = []
  if (n === 1 && parts.length <= 1) answers[0] = hasContent(c.answer) ? c.answer : []
  else if (parts.length > 0) parts.slice(0, n).forEach((p, k) => (answers[k] = [{ inlines: p }]))
  else keepAnswer = c.answer

  // 解析：以连续递增题号开头的段落开始一道小题的解析
  const keepAnalysis: RichText = []
  let label = '【解析】'
  let expect = start
  let k = -1
  for (const p of c.analysis) {
    const first = p.inlines[0]
    const m = first?.type === 'text' ? LABEL.exec(first.text) : null
    const num = numberAt(p)
    if (num !== null && (expect === null || num === expect) && k + 1 < n) {
      if (m !== null) label = `【${m[1]}】`
      k += 1
      expect = num + 1
      analyses[k]!.push(stripNumber(p))
    } else if (k >= 0) analyses[k]!.push(p)
    else keepAnalysis.push(p)
  }
  if (n === 1 && k === -1 && hasContent(c.analysis)) {
    // 只有一道小题且解析不带题号：整段交给它
    analyses[0] = c.analysis
    keepAnalysis.length = 0
  }
  // 各小题解析开头补上标签
  const withLabel = (t: RichText): RichText => {
    if (t.length === 0) return t
    const f0 = t[0]!.inlines[0]
    if (f0?.type === 'text' && LABEL.test(f0.text)) return t
    const [p, ...rest] = t
    const f = p!.inlines[0]
    const inlines: Inline[] = f?.type === 'text' ? [{ ...f, text: label + f.text }, ...p!.inlines.slice(1)] : [{ type: 'text', text: label }, ...p!.inlines]
    return [{ ...p!, inlines }, ...rest]
  }
  const items = c.items.map((it, i): QuestionBlock => {
    const q: Question = it.question
    return {
      ...it,
      question: { ...q, answer: [...q.answer, ...answers[i]!], analysis: [...q.analysis, ...withLabel(analyses[i]!)] }
    }
  })
  return { composite: { ...c, items, answer: keepAnswer, analysis: keepAnalysis }, answerParts: parts.length, analysisParts: k + 1 }
}

// ---------------- 集中到最后 ----------------

/**
 * 把各小题的答案与解析集中到综合题最后：numbers 为各小题在全卷中的题号（如 6、7、8）。
 * 答案拼成一段“6．… 7．…”；解析按题号依次接起来，开头保留一个标签。综合题原有的解析段落（如【知识点】）放在最前面。
 */
export function collectAnswers(c: CompositeBlock, numbers: readonly number[]): CompositeBlock {
  const answer: Inline[] = []
  const analysis: RichText = []
  let label = '【解析】'
  c.items.forEach((it, i) => {
    const no = numbers[i] ?? i + 1
    const q = it.question
    if (hasContent(q.answer)) {
      answer.push({ type: 'text', text: `${answer.length > 0 ? '　　' : ''}${no}．` })
      q.answer.forEach((p, j) => {
        if (j > 0) answer.push({ type: 'text', text: '　' })
        answer.push(...p.inlines)
      })
    }
    if (hasContent(q.analysis)) {
      q.analysis.forEach((p, j) => {
        if (j > 0) {
          analysis.push(p)
          return
        }
        const f = p.inlines[0]
        const m = f?.type === 'text' ? LABEL.exec(f.text) : null
        if (m !== null) label = `【${m[1]}】`
        const text = f?.type === 'text' ? f.text.replace(LABEL, '') : ''
        const inlines: Inline[] = f?.type === 'text' ? [{ ...f, text: `${no}．${text}` }, ...p.inlines.slice(1)] : [{ type: 'text', text: `${no}．` }, ...p.inlines]
        analysis.push({ ...p, inlines })
      })
    }
  })
  // 第一段解析前加标签
  if (analysis.length > 0) {
    const f = analysis[0]!.inlines[0]
    analysis[0] = { ...analysis[0]!, inlines: f?.type === 'text' ? [{ ...f, text: label + f.text }, ...analysis[0]!.inlines.slice(1)] : [{ type: 'text', text: label }, ...analysis[0]!.inlines] }
  }
  const items = c.items.map((it): QuestionBlock => ({ ...it, question: { ...it.question, answer: [], analysis: [] } }))
  return {
    ...c,
    items,
    answer: [...c.answer, ...(answer.length > 0 ? [{ inlines: answer }] : [])],
    analysis: [...c.analysis, ...analysis]
  }
}
