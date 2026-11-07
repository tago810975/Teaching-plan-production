import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { importDocx } from '@core/import/import-docx'
import { readDocx } from '@core/import/docx-reader'
import { splitOptions } from '@core/import/recognize'
import { ommlToMathml } from '@core/math/omml-to-mathml'
import { plainText } from '@core/model/factory'
import type { Block, Question } from '@core/model/types'

const SAMPLE_DIR = 'reference/samples/2026秋季高二物理敏思_动态圆专题'
const load = (name: string): Uint8Array => new Uint8Array(readFileSync(`${SAMPLE_DIR}/${name}`))
const questions = (blocks: Block[]): Question[] =>
  blocks.flatMap((b) => (b.type === 'question' ? [b.question] : []))

describe('导入样例教案（教师版）', async () => {
  const result = await importDocx(load('教案_T_动态圆专题.docx'))
  const qs = questions(result.blocks)

  it('识别出全部 20 道题与大标题', () => {
    expect(result.questionCount).toBe(20)
    expect(result.firstTitle).toBe('动态圆专题')
    const titles = result.blocks.filter((b) => b.type === 'title')
    expect(titles.map((t) => (t.type === 'title' ? [t.text, t.restartNumbering ?? false] : []))).toEqual([
      ['动态圆专题', false],
      ['作业单-动态圆', true]
    ])
  })

  it('栏目与题型分组', () => {
    const sections = result.blocks.flatMap((b) => (b.type === 'section' ? [b.text] : []))
    expect(sections).toEqual(['知识梳理', '例题精讲', '课堂练习'])
    expect(result.blocks.filter((b) => b.type === 'topic').length).toBeGreaterThanOrEqual(13)
  })

  it('第 1 题：多选、四个选项、答案、知识点、详解', () => {
    const q = qs[0]!
    expect(q.kind).toBe('multi-choice')
    expect(q.options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(plainText(q.answer)).toBe('BC')
    expect(q.knowledgePoints).toEqual(['放缩圆'])
    expect(plainText(q.analysis)).toContain('【详解】')
    expect(q.figures).toHaveLength(1)
    // 选项中的公式保留为原始 OMML
    expect(q.options[1]!.content.inlines.some((i) => i.type === 'math' && i.omml !== undefined)).toBe(true)
  })

  it('图片选项（A．[图]B．[图]…）拆分正确', () => {
    const q = qs[1]!
    expect(q.options).toHaveLength(4)
    for (const opt of q.options) expect(opt.content.inlines.map((i) => i.type)).toEqual(['image'])
  })

  it('课堂练习：难度、小问、重点与难点', () => {
    expect(qs[6]!.difficulty).toBe('B')
    expect(qs[6]!.subQuestions).toHaveLength(2)
    expect(qs[6]!.keyPoint).toBe('电性未知导致多解')
    expect(qs[7]!.difficulty).toBe('C')
    expect(qs[7]!.difficultPoint).toBe('角度计算')
    expect(qs[8]!.subQuestions.length).toBeGreaterThanOrEqual(2) // ⑴⑵ 形式的小问
  })

  it('每道题都有答案和知识点', () => {
    for (const q of qs) {
      expect(q.answer.length).toBeGreaterThan(0)
      expect(q.knowledgePoints.length).toBeGreaterThan(0)
    }
  })

  it('只保留正文引用的图片（不含页眉 Logo 与水印）', () => {
    expect(Object.keys(result.assets).length).toBeGreaterThan(40)
    const sizes = Object.values(result.assets).map((a) => a.data.length)
    expect(sizes).not.toContain(177162) // 水印图片
  })
})

describe('导入样例学案（学生版）', async () => {
  const result = await importDocx(load('学案_S_动态圆专题.docx'))
  const qs = questions(result.blocks)

  it('20 道题，均无答案', () => {
    expect(result.questionCount).toBe(20)
    for (const q of qs) expect(q.answer).toEqual([])
  })

  it('四周环绕的题图识别为“右侧”', () => {
    expect(qs[0]!.figures.map((f) => f.placement)).toEqual(['right'])
  })
})

describe('OMML 公式转换', () => {
  it('两份样例中的全部公式都能转换，且没有不支持的结构', async () => {
    let count = 0
    for (const name of ['教案_T_动态圆专题.docx', '学案_S_动态圆专题.docx']) {
      const read = await readDocx(load(name))
      for (const p of read.paragraphs) {
        for (const i of p.inlines) {
          if (i.type !== 'math') continue
          count += 1
          const r = ommlToMathml(i.omml!)
          expect(r.unknown).toEqual([])
          expect(r.mathml.startsWith('<math')).toBe(true)
        }
      }
    }
    expect(count).toBe(373)
  })

  const om = (inner: string): string =>
    `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${inner}</m:oMath>`
  const r = (t: string, sty?: string): string =>
    `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ''}<m:t>${t}</m:t></m:r>`

  it('分数、下标、根号', () => {
    expect(ommlToMathml(om(`<m:f><m:num>${r('5')}</m:num><m:den>${r('4')}</m:den></m:f>`)).mathml).toBe(
      '<math><mrow><mfrac><mrow><mn>5</mn></mrow><mrow><mn>4</mn></mrow></mfrac></mrow></math>'
    )
    expect(ommlToMathml(om(`<m:sSub><m:e>${r('t')}</m:e><m:sub>${r('0')}</m:sub></m:sSub>`)).mathml).toContain(
      '<msub><mrow><mi>t</mi></mrow><mrow><mn>0</mn></mrow></msub>'
    )
    expect(
      ommlToMathml(om(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('3')}</m:e></m:rad>`)).mathml
    ).toContain('<msqrt><mrow><mn>3</mn></mrow></msqrt>')
  })

  it('矢量箭头、正体字母、函数名', () => {
    expect(ommlToMathml(om(`<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr><m:e>${r('F')}</m:e></m:acc>`)).mathml).toContain(
      '<mo>→</mo>'
    )
    expect(ommlToMathml(om(r('kg', 'p'))).mathml).toContain('<mi mathvariant="normal">k</mi>')
    expect(ommlToMathml(om(`<m:func><m:fName>${r('sin', 'p')}</m:fName><m:e>${r('θ')}</m:e></m:func>`)).mathml).toContain(
      '<mi mathvariant="normal">sin</mi>'
    )
  })

  it('不认识的结构不会报错，只显示文字', () => {
    const res = ommlToMathml(om(`<m:mystery>${r('x')}</m:mystery>`))
    expect(res.unknown).toEqual(['mystery'])
    expect(res.mathml).toContain('<mtext>x</mtext>')
  })
})

describe('选项拆分', () => {
  const t = (text: string) => ({ type: 'text' as const, text })

  it('一行四项', () => {
    const opts = splitOptions([t('A．2\tB．3\tC．4\tD．5')])
    expect(opts.map((o) => [o.label, plainText(o.content)])).toEqual([
      ['A', '2'],
      ['B', '3'],
      ['C', '4'],
      ['D', '5']
    ])
  })

  it('选项之间没有空格', () => {
    expect(splitOptions([t('A．向左B．向右')]).map((o) => plainText(o.content))).toEqual(['向左', '向右'])
  })

  it('选项内容中的“点B.”不会被误拆', () => {
    const opts = splitOptions([t('A．粒子从点B.射出')])
    expect(opts).toHaveLength(1)
    expect(plainText(opts[0]!.content)).toBe('粒子从点B.射出')
  })

  it('选项字母前有空格时，点号可以不同', () => {
    expect(splitOptions([t('A．甲　B.乙')]).map((o) => o.label)).toEqual(['A', 'B'])
  })

  it('续接上一段的选项字母', () => {
    expect(splitOptions([t('C．甲　D．乙')], 2).map((o) => o.label)).toEqual(['C', 'D'])
  })
})

describe('导入普通格式的 Word 文档（无“物理排版”样式）', async () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const p = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>` +
      [
        '例题精讲',
        '1. 下列说法正确的是（　　）',
        'A. 甲　　B. 乙　　C. 丙　　D. 丁',
        '【答案】B',
        '【解析】因为……',
        '2．【C】一物体做匀加速直线运动。',
        '(1) 求加速度；',
        '(2) 求位移。',
        '【答案】(1) 2 m/s²；(2) 9 m',
        '【详解】略'
      ]
        .map(p)
        .join('') +
      '</w:body></w:document>'
  )
  const result = await importDocx(await zip.generateAsync({ type: 'uint8array' }))
  const qs = questions(result.blocks)

  it('按题号、选项、【答案】【解析】识别', () => {
    expect(result.blocks[0]).toMatchObject({ type: 'section', text: '例题精讲' })
    expect(qs).toHaveLength(2)
    expect(plainText(qs[0]!.stem)).toBe('下列说法正确的是（　　）')
    expect(qs[0]!.options.map((o) => plainText(o.content))).toEqual(['甲', '乙', '丙', '丁'])
    expect(plainText(qs[0]!.answer)).toBe('B')
    expect(plainText(qs[0]!.analysis)).toBe('【解析】因为……')
    expect(qs[1]!.difficulty).toBe('C')
    expect(qs[1]!.subQuestions.map((s) => plainText(s.content))).toEqual(['求加速度；', '求位移。'])
    expect(qs[1]!.kind).toBe('solve')
  })

  it('损坏的文件给出明确提示', async () => {
    await expect(importDocx(new Uint8Array([1, 2, 3]))).rejects.toThrow('不是 Word 文档')
  })
})
