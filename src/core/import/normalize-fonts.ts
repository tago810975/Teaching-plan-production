/**
 * 导入后整理字体：题库文档通常给每一段文字都显式标上字体（多数是“宋体”），
 * 原样保留会让编辑框里到处是格式标记，也看不出哪些字体是真正特意设置的。
 *
 * 规则（逐段）：
 * 1. 段中所有含汉字的文字都是同一种字体时，提升为整段字体（format.font）；
 * 2. 与该字段样式默认字体相同的，不记录（随样式）；
 * 3. 只含字母、数字的文字不记录中文字体；
 * 4. 剩下的才是段中真正混排的字体，保留在文字格式上。
 */
import { STYLE_SPECS } from '../document/styles'
import type { Block, FontFamily, Inline, QuestionBlock, RichParagraph, RichText, TextInline } from '../model/types'

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

export function normalizeFonts(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    switch (b.type) {
      case 'question':
        return normalizeQuestion(b)
      case 'knowledge':
        return { ...b, content: text(b.content, STYLE_SPECS.body.fontRole) }
      case 'paragraph':
        return { ...b, content: text(b.content, STYLE_SPECS.body.fontRole) }
      case 'composite':
        return {
          ...b,
          background: text(b.background, STYLE_SPECS.compositeBackground.fontRole),
          answer: text(b.answer, STYLE_SPECS.answer.fontRole),
          analysis: text(b.analysis, STYLE_SPECS.analysis.fontRole),
          items: b.items.map(normalizeQuestion)
        }
      default:
        return b
    }
  })
}

function normalizeQuestion(b: QuestionBlock): QuestionBlock {
  const q = b.question
  return {
    ...b,
    question: {
      ...q,
      stem: text(q.stem, STYLE_SPECS.question.fontRole),
      options: q.options.map((o) => ({ ...o, content: paragraph(o.content, STYLE_SPECS.option.fontRole) })),
      subQuestions: q.subQuestions.map((s) => ({ ...s, content: text(s.content, STYLE_SPECS.subQuestion.fontRole) })),
      answer: text(q.answer, STYLE_SPECS.answer.fontRole),
      analysis: text(q.analysis, STYLE_SPECS.analysis.fontRole)
    }
  }
}

function text(t: RichText, fallback: FontFamily): RichText {
  return t.map((p) => paragraph(p, fallback))
}

export function paragraph(p: RichParagraph, styleFont: FontFamily): RichParagraph {
  const texts = p.inlines.filter((i): i is TextInline => i.type === 'text' && CJK.test(i.text))
  const fonts = new Set(texts.map((i) => i.marks?.font))
  // 1. 整段同一字体：提升为段落字体
  const whole = fonts.size === 1 ? [...fonts][0] : undefined
  const paraFont = whole ?? p.format?.font ?? styleFont
  const inlines = merge(
    p.inlines.map((i): Inline => {
      if (i.type !== 'text' || i.marks?.font === undefined) return i
      // 2、3. 与整段字体相同，或不含汉字：不记录
      if (i.marks.font === paraFont || !CJK.test(i.text)) return withoutFont(i)
      return i
    })
  )
  const { font: _old, ...restFormat } = p.format ?? {}
  const format = paraFont !== styleFont ? { ...restFormat, font: paraFont } : restFormat
  return Object.keys(format).length > 0 ? { inlines, format } : { inlines }
}

function withoutFont(i: TextInline): TextInline {
  const { font: _font, ...marks } = i.marks ?? {}
  return Object.keys(marks).length > 0 ? { ...i, marks } : { type: 'text', text: i.text }
}

/** 去掉字体后相邻文字格式相同的，合并成一段（编辑框里少一些标记） */
function merge(inlines: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const i of inlines) {
    const last = out[out.length - 1]
    if (i.type === 'text' && last?.type === 'text' && sameMarks(last, i)) {
      out[out.length - 1] = { ...last, text: last.text + i.text }
    } else out.push(i)
  }
  return out
}

function sameMarks(a: TextInline, b: TextInline): boolean {
  const ka = JSON.stringify(Object.entries(a.marks ?? {}).sort())
  const kb = JSON.stringify(Object.entries(b.marks ?? {}).sort())
  return ka === kb
}
