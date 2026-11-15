import { describe, expect, it } from 'vitest'
import { FORMAT_GUIDE, importText, textToParagraphs } from '@core/import/text-import'
import { plainText } from '@core/model/factory'
import { createAsset } from '@core/project-file/codec'
import type { QuestionBlock } from '@core/model/types'

const AI_TEXT = `**1．**（多选）如图所示，一带电粒子以速度 \\(v_0\\) 垂直射入磁感应强度为 $B$ 的匀强磁场，下列说法正确的是（　　）
[图1]
A．粒子做匀速圆周运动　　B．粒子的速度不变
C．半径 $r=\\frac{mv_0}{qB}$　　D．周期与速度有关
【答案】AC
【解析】由 $qvB=\\frac{mv^2}{r}$ 得 $r=\\frac{mv}{qB}$，故 C 正确。
2．质量为 $m$ 的小球从高 $h$ 处自由下落，求：
（1）落地时的速度大小；
（2）下落所用的时间。
$$t=\\sqrt{\\frac{2h}{g}}$$
3．看不清的题【?】，价格 \\$5，图见 [图2]`

describe('从文字导入题目', async () => {
  const png = await createAsset(new Uint8Array([137, 80, 78, 71]), 'image/png')
  const figures = new Map([[1, { asset: png, widthEmu: 1800000, heightEmu: 900000 }]])

  it('识别题号、选项（同一行两个）、小问、答案、解析；公式与插图', () => {
    const r = importText(AI_TEXT, { figures })
    expect(r.questionCount).toBe(3)
    const qs = r.blocks.filter((b): b is QuestionBlock => b.type === 'question')
    expect(qs[0]!.question.options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(qs[0]!.question.options[2]!.content.inlines.some((i) => i.type === 'math' && i.latex === 'r=\\frac{mv_0}{qB}')).toBe(true)
    expect(plainText(qs[0]!.question.answer)).toBe('AC')
    expect(qs[0]!.question.figures.length + qs[0]!.question.stem.flatMap((p) => p.inlines).filter((i) => i.type === 'image').length).toBe(1)
    expect(qs[1]!.question.subQuestions).toHaveLength(2)
    // \\( \\) 写法与 $ $ 一样转为公式；Markdown 的 ** 去掉
    expect(qs[0]!.question.stem[0]!.inlines.some((i) => i.type === 'math' && i.latex === 'v_0')).toBe(true)
    expect(JSON.stringify(qs[0]!.question.stem)).not.toContain('**')
    expect(Object.keys(r.assets)).toEqual([png.id])
  })

  it('列出需要留意的问题：没框选的插图、看不清的地方', () => {
    const r = importText(AI_TEXT, { figures })
    expect(r.issues.some((i) => i.includes('[图2]') && i.includes('没有在原图上框选'))).toBe(true)
    expect(r.issues.some((i) => i.includes('看不清'))).toBe(true)
  })

  it('无法转换为 Word 公式的 LaTeX 会被列出', () => {
    const r = importText('1．求 $\\unknowncommand{x}$ 的值')
    expect(r.issues.some((i) => i.includes('无法转换') && i.includes('unknowncommand'))).toBe(true)
  })

  it('框选了但文字中没有出现的图会提示；没有题号时提示', () => {
    expect(importText('1．题目', { figures }).issues.some((i) => i.includes('[图1]') && i.includes('没有出现'))).toBe(true)
    expect(importText('只是一段话').issues.some((i) => i.includes('没有识别到题目'))).toBe(true)
  })

  it('单独一行的 $$…$$ 是行间公式，与文字同行时为行内；\\$ 是普通的 $；代码块与 # 去掉', () => {
    const { paragraphs } = textToParagraphs('```\n## 第一部分\n$$E=mc^2$$\n速度 $$v=at$$ 很快，花了 \\$3\n```')
    expect(paragraphs.map((p) => p.inlines.map((i) => (i.type === 'text' ? i.text : `〔${i.type}${i.type === 'math' && i.display ? '·行间' : ''}〕`)).join(''))).toEqual([
      '第一部分',
      '〔math·行间〕',
      '速度 〔math〕 很快，花了 $3'
    ])
  })

  it('格式说明中的示例本身能被正确识别', () => {
    const example = FORMAT_GUIDE.slice(FORMAT_GUIDE.indexOf('【示例】') + 5)
    const r = importText(example)
    expect(r.questionCount).toBe(2)
    expect(r.issues.filter((i) => !i.includes('[图1]'))).toEqual([])
  })
})

describe('真实题目图片的转写（test/fixtures/image-import，来自用户提供的常见图片类型）', async () => {
  const { readFileSync } = await import('node:fs')
  const png = await createAsset(new Uint8Array([1, 2, 3]), 'image/png')
  const figures = new Map(Array.from({ length: 6 }, (_, i) => [i + 1, { asset: { ...png, id: `${png.id}-${i + 1}` }, widthEmu: 1000000, heightEmu: 600000 }]))
  const load = (name: string) => importText(readFileSync(`test/fixtures/image-import/${name}`, 'utf8'), { presetId: 'physics-v1', figures })
  const questions = (r: ReturnType<typeof importText>) => r.blocks.filter((b): b is QuestionBlock => b.type === 'question').map((b) => b.question)
  const count = (v: unknown, type: string) => JSON.stringify(v).split(`"type":"${type}"`).length - 1

  it('练习题：图片选项、填空、图注去掉、“四、查漏补缺”为小标题', () => {
    const r = load('练习题-查漏补缺.txt')
    expect(r.questionCount).toBe(5)
    expect(r.blocks[0]).toMatchObject({ type: 'topic', text: '四、查漏补缺' })
    const qs = questions(r)
    expect(qs.map((q) => q.options.length)).toEqual([4, 4, 4, 4, 0])
    expect(qs[1]!.options.every((o) => o.content.inlines.some((i) => i.type === 'image'))).toBe(true)
    expect(qs[2]!.figures).toHaveLength(1)
    expect(qs[4]!.kind).toBe('fill-blank')
    expect(count(qs[4]!.stem, 'blank')).toBe(2)
    expect(JSON.stringify(r.blocks)).not.toContain('题图')
    expect(qs[3]!.kind).toBe('multi-choice')
  })

  it('例题：小问自己的选项跟在小问后面；小问里的①②保留；二维码提示去掉', () => {
    const r = load('例题-质谱仪回旋加速器.txt')
    const qs = questions(r)
    expect(qs.map((q) => q.subQuestions.length)).toEqual([4, 2])
    expect(qs.every((q) => q.options.length === 0)).toBe(true)
    expect(plainText(qs[0]!.subQuestions[1]!.content)).toContain('A．电量和质量')
    expect(plainText(qs[1]!.subQuestions[1]!.content)).toMatch(/①它们的最大速度[\s\S]*②加速氘核/)
    expect(count(qs[0]!.subQuestions[0]!.content, 'blank')).toBe(2)
    expect(JSON.stringify(r.blocks)).not.toContain('扫码')
  })

  it('案例：圈码小问、方括号【解析】；小问与解析交错时重排，学生版不会漏掉小问', () => {
    const r = load('案例-交流电.txt')
    const [q] = questions(r)
    expect(q!.subQuestions.map((s) => plainText(s.content).slice(0, 5))).toEqual(['求交流电的', '当 $t=', '图中线圈中'])
    const analysis = plainText(q!.analysis)
    expect(analysis.startsWith('【解析】（1）根据电流瞬时值表达式')).toBe(true)
    expect(analysis).toContain('（2）当')
    expect(analysis).toContain('（3）')
    expect(analysis).not.toContain('线圈平面位于哪个位置')
  })
})

describe('WorkBuddy 实测的问题（2026-11-15）', () => {
  it('从对话气泡复制的渲染结果（公式被拆散、带零宽字符）给出明确提示', () => {
    const pasted = '1．\n根据电流瞬时值表达式 i=I \nm\n\u200b\n sinωt 可知\n由 ω= \nT\n2π\n\u200b\n  解得\n其中 k= \nnq\n1\n\u200b\n 。'
    const r = importText(pasted)
    expect(r.issues[0]).toMatch(/对话气泡中直接复制/)
  })

  it('单独一行的题号与下一行合并；题号后的来源标注（P823 T1）去掉', () => {
    const r = importText('1．\n正弦交流电的电流 $i$ 随时间 $t$ 的变化规律如图所示。\n2．（P824 T1）如图所示，求有效值。')
    const qs = r.blocks.filter((b): b is QuestionBlock => b.type === 'question')
    expect(qs).toHaveLength(2)
    expect(qs[0]!.question.stem).toHaveLength(1)
    expect(plainText(qs[0]!.question.stem)).toMatch(/^正弦交流电的电流/)
    expect(plainText(qs[1]!.question.stem)).toBe('如图所示，求有效值。')
  })

  it('格式说明要求代码块；代码块的围栏会被去掉', () => {
    expect(FORMAT_GUIDE).toContain('代码块里')
    const r = importText('```text\n1．题目一\nA．甲　　B．乙\n```')
    expect(r.questionCount).toBe(1)
  })
})
