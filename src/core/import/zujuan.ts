/**
 * 组卷网（zujuan.xkw.com）下载的题目：没有段落样式，题目以“题组”组织——
 *
 *   [短标题，如“摆动”] [背景材料与配图]
 *   N．小题……（全卷连续编号；选项、小问另起段落）
 *   【答案】N．…    N+1．…        ← 一组共用一段答案，按题号分开
 *   【难度】0.61                   ← 难度系数，0～1，越大越容易
 *   【知识点】…
 *   【详解】N．…（或【解析】）      ← 按题号分开的解析
 *
 * 上一组的解析与下一组的短标题、背景之间没有空行。这里在识别之前做预处理：
 * 找出每组的开头，插入“题组开始”标记（识别器据此新建综合题，短标题作为综合题标题，
 * 标题与第一道小题之间的内容作为背景）；去掉“学校:___姓名:___”与“系统分组”这类组卷网自动生成的行；
 * 取出各组的难度系数，识别后换算为难度等级（A 简单、B 中等、C 难）。
 */
import type { Inline } from '../model/types'
import type { ReadParagraph } from './docx-reader'

/** 段落的文字（公式、图片不计）；不引用 recognize.ts，以免循环依赖 */
function textOf(p: Pick<ReadParagraph, 'inlines'>): string {
  return p.inlines.map((i) => (i.type === 'text' ? i.text : '')).join('')
}

/**
 * 答案与解析区中的段落（【答案】到下一组开始之前）：其中“N．”开头的是分题解析，不是新题。
 * 识别器见到这个标记就不按题号开新题。
 */
export const IN_ANSWER_STYLE = '\u0000组卷网解析'

/** 识别器中的“题组开始”标记（段落样式名，文字为题组的短标题，可为空） */
export const GROUP_START_STYLE = '\u0000组卷网题组'

const ANSWER = /^\s*【\s*答案\s*】/
const DIFFICULTY = /^\s*【\s*难度\s*】\s*([0-9.]+)/
const LABEL = /^\s*【/
const QUESTION = /^\s*(\d{1,3})\s*[．.]/
const STUDENT_INFO = /^\s*学校[:：]\s*_{2,}/
/** 组卷网自动生成的分组：“一、系统分组_加入顺序” */
const AUTO_GROUP = /^\s*[一二三四五六七八九十]+\s*[、.．]\s*系统分组/
/** 题型分组：“一、单选题” */
const TYPE_GROUP = /^\s*[一二三四五六七八九十]+\s*[、.．]\s*((?:单项|多项|不定项)?选择题|单选题|多选题|填空题|解答题|计算题|实验题|综合题|判断题|作图题|简答题)\s*$/
/** 解析中常见的开头：不会是下一组的标题或背景 */
const ANALYSIS_START =
  /^\s*(?:\d+\s*[．.]|[［[]\d|[（(]\s*\d|[①-⑳]|[A-H]{1,4}\s*[．.、]|故|解得|可得|可知|所以|因此|则|即|联立|由|根据|设|代入|又|而|同理|综上|整理|此时|其中|对|当|若|如图|如答图|得|有|说明|可见|计算|代入数据|带入)/

/** 文档是否像组卷网下载的题目：有【答案】与【难度】，且没有使用“物理排版”样式 */
export function isZujuan(paragraphs: ReadParagraph[]): boolean {
  const texts = paragraphs.map((p) => textOf(p))
  return (
    texts.some((t) => DIFFICULTY.test(t)) &&
    texts.some((t) => ANSWER.test(t)) &&
    !paragraphs.some((p) => p.styleName !== undefined && /物理排版/.test(p.styleName))
  )
}

export interface ZujuanPrepared {
  paragraphs: ReadParagraph[]
  /** 题号 → 难度系数 */
  difficulty: Map<number, number>
  groups: number
}

const isBlankPara = (p: ReadParagraph): boolean => p.floating.length === 0 && p.inlines.every((i) => i.type === 'text' && i.text.trim() === '')
const hasMath = (p: ReadParagraph): boolean => p.inlines.some((i) => i.type === 'math')
const imageOnly = (p: ReadParagraph): boolean => p.inlines.length > 0 && p.inlines.every((i) => i.type === 'image' || (i.type === 'text' && i.text.trim() === ''))

export function prepareZujuan(input: ReadParagraph[]): ZujuanPrepared {
  // 1. 去掉组卷网自动生成的行；题型分组改为“题目类型”样式；第一段（居中的试卷名）作为大标题
  const paras: ReadParagraph[] = []
  let titled = false
  for (const p of input) {
    const t = textOf(p).trim()
    if (STUDENT_INFO.test(t) || AUTO_GROUP.test(t)) continue
    if (TYPE_GROUP.test(t)) {
      paras.push({ ...p, styleName: '物理排版 题目类型', inlines: [{ type: 'text', text: t.replace(/^[一二三四五六七八九十]+\s*[、.．]\s*/, '') }] })
      continue
    }
    if (!titled && t !== '' && p.format?.align === 'center' && !QUESTION.test(t)) {
      titled = true
      paras.push({ ...p, styleName: '物理排版 大标题', inlines: p.inlines.filter((i) => i.type !== 'image') })
      continue
    }
    if (t !== '') titled = true
    paras.push(p)
  }

  // 2. 找出各道小题（题号依次递增；解析中的“N．”是已出现过的题号）与各组的答案
  const questionAt = new Map<number, number>() // 段落位置 → 题号
  let maxNo = 0
  let inTeacher = false // 处在【答案】之后的答案、解析中
  const answerAt: number[] = []
  paras.forEach((p, i) => {
    const t = textOf(p)
    if (ANSWER.test(t)) {
      inTeacher = true
      answerAt.push(i)
      return
    }
    const m = QUESTION.exec(t)
    if (m !== null && Number(m[1]) === maxNo + 1) {
      maxNo += 1
      questionAt.set(i, maxNo)
      inTeacher = false
    } else if (m !== null && !inTeacher && Number(m[1]) > maxNo + 1) {
      // 题号跳过了（组卷网有时从别处开始编号）：也算新题
      maxNo = Number(m[1])
      questionAt.set(i, maxNo)
    }
  })

  // 3. 分组：每段【答案】之前、上一段【答案】之后的小题为一组
  interface Group {
    first: number
    numbers: number[]
    answer: number
  }
  const groups: Group[] = []
  let prevAnswer = -1
  for (const a of answerAt) {
    const qs = [...questionAt.entries()].filter(([i]) => i > prevAnswer && i < a)
    if (qs.length > 0) groups.push({ first: qs[0]![0], numbers: qs.map(([, n]) => n), answer: a })
    prevAnswer = a
  }

  // 4. 各组的开头：从第一道小题往回，把短标题、背景材料、配图划给本组（遇到解析的样子就停）
  const starts = new Map<number, { title: string; index: number }>()
  groups.forEach((g, k) => {
    const floor = k === 0 ? -1 : groups[k - 1]!.answer
    let s = g.first
    let title = ''
    for (let j = g.first - 1; j > floor && g.first - j <= 6; j--) {
      const p = paras[j]!
      const t = textOf(p).trim()
      if (isBlankPara(p) || p.styleName !== undefined) break
      if (imageOnly(p)) {
        s = j
        continue
      }
      if (LABEL.test(t) || ANALYSIS_START.test(t) || (k > 0 && hasMath(p))) break
      // 短标题：不超过 12 个字、没有句读
      if ([...t].length <= 12 && !/[。，；：！？,.;:]/.test(t)) {
        title = t
        s = j
        break
      }
      s = j
    }
    // 有背景、标题，或有两道以上小题时做成综合题（共用答案与解析）
    if (title !== '' || s < g.first || g.numbers.length > 1) starts.set(s, { title, index: s })
  })

  // 5. 难度系数
  const difficulty = new Map<number, number>()
  groups.forEach((g, k) => {
    const end = k + 1 < groups.length ? groups[k + 1]!.first : paras.length
    for (let j = g.answer; j < end; j++) {
      const m = DIFFICULTY.exec(textOf(paras[j]!))
      if (m !== null) {
        for (const n of g.numbers) difficulty.set(n, Number(m[1]))
        break
      }
    }
  })

  // 6. 各组答案区的范围：从【答案】到下一组的开头（题组标记或第一道小题）之前
  const inAnswer = new Set<number>()
  groups.forEach((g, k) => {
    const next = groups[k + 1]
    const nextStart = next === undefined ? paras.length : Math.min(next.first, ...[...starts.keys()].filter((s) => s > g.answer))
    for (let j = g.answer + 1; j < nextStart; j++) inAnswer.add(j)
  })

  // 7. 输出：插入题组标记（短标题段落改为标记本身），去掉【难度】行，标出答案区中的段落
  const out: ReadParagraph[] = []
  paras.forEach((p, i) => {
    const start = starts.get(i)
    if (start !== undefined) {
      const inlines: Inline[] = start.title !== '' ? [{ type: 'text', text: start.title }] : []
      out.push({ styleName: GROUP_START_STYLE, numbered: false, inlines, floating: [] })
      if (start.title !== '') return
    }
    if (DIFFICULTY.test(textOf(p))) return
    out.push(inAnswer.has(i) && p.styleName === undefined ? { ...p, styleName: IN_ANSWER_STYLE } : p)
  })
  return { paragraphs: out, difficulty, groups: groups.length }
}

/** 组卷网难度系数（0～1，越大越容易）→ 难度等级：0.7 以上 A（简单），0.5～0.7 B，低于 0.5 C（难） */
export function gradeOfCoefficient(c: number): 'A' | 'B' | 'C' {
  return c >= 0.7 ? 'A' : c >= 0.5 ? 'B' : 'C'
}
