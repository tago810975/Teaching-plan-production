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
