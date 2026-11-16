import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectMoanImageUrls, convertMoanPlan, extractOptions, headingText, splitPlanName, splitReview, type MoanPlanShow } from '@core/import/moan/convert'
import { htmlPlainText, htmlToRich, parseColor, splitMath } from '@core/import/moan/html'
import { readImageInfo } from '@core/import/moan/image-size'
import { createMoanSession, observeMoanFrame, parseSocketFrame, teachingPlanIdFromUrl } from '@core/import/moan/session'
import { buildDocument, variantLetters } from '@core/document/build'
import { createEmptyProject, createQuestion, para, plainText } from '@core/model/factory'
import { getPreset, resolveQuestionFields } from '@core/presets'
import type { Block, QuestionBlock } from '@core/model/types'

const SECTIONS = getPreset('math-v1').sectionNames
const show = (): MoanPlanShow => JSON.parse(readFileSync('test/fixtures/moan/show-3829.json', 'utf8')) as MoanPlanShow

describe('墨案 HTML → 富文本', () => {
  it('按 <p> 分段，$…$ 为公式（实体先解码）', () => {
    const r = htmlToRich('<p>已知 $0^{\\circ} \\leq \\alpha&lt;180^{\\circ}$ 。</p><p>第二段</p>')
    expect(r).toHaveLength(2)
    expect(r[0]!.inlines).toEqual([
      { type: 'text', text: '已知 ' },
      { type: 'math', latex: '0^{\\circ} \\leq \\alpha<180^{\\circ}' },
      { type: 'text', text: ' 。' }
    ])
    expect(plainText(r[1]!)).toBe('第二段')
  })

  it('$$…$$、\\[…\\] 为行间公式，\\(…\\) 为行内公式', () => {
    expect(splitMath('a $$x^2$$ b \\(y\\) c \\[z\\]')).toEqual([
      { text: 'a ' },
      { latex: 'x^2', display: true },
      { text: ' b ' },
      { latex: 'y', display: false },
      { text: ' c ' },
      { latex: 'z', display: true }
    ])
  })

  it('加粗、颜色、上下标；接近黑色的字色不算颜色', () => {
    const r = htmlToRich('<p><strong>重</strong><span style="color: rgb(255, 0, 0);">红</span><span style="color: rgb(17, 31, 44);">黑</span>H<sub>2</sub>O</p>')
    expect(r[0]!.inlines).toEqual([
      { type: 'text', text: '重', marks: { bold: true } },
      { type: 'text', text: '红', marks: { color: 'FF0000' } },
      { type: 'text', text: '黑H' },
      { type: 'text', text: '2', marks: { script: 'sub' } },
      { type: 'text', text: 'O' }
    ])
    expect(parseColor('#c00000')).toBe('C00000')
    expect(parseColor('rgb(0,0,0)')).toBeUndefined()
  })

  it('首尾空段落去掉，中间的保留；<br> 另起一段；居中保留', () => {
    const r = htmlToRich('<p><br></p><p>审题</p><p><br></p><p style="text-align: center;">讲解</p><p><br></p>')
    expect(r.map((p) => plainText(p))).toEqual(['审题', '', '讲解'])
    expect(r[2]!.format).toEqual({ align: 'center' })
    expect(htmlToRich('<p>甲<br>乙</p>').map((p) => plainText(p))).toEqual(['甲', '乙'])
  })

  it('表格：合并单元格、表头加粗', () => {
    const r = htmlToRich('<table><tbody><tr><th colspan="2">表头</th></tr><tr><td>$a$</td><td>b</td></tr></tbody></table>')
    const t = r[0]!.inlines[0]!
    expect(t.type).toBe('table')
    if (t.type !== 'table') return
    expect(t.rows[0]!.cells[0]!.colSpan).toBe(2)
    expect(t.rows[0]!.cells[0]!.content[0]!.inlines[0]).toEqual({ type: 'text', text: '表头', marks: { bold: true } })
    expect(t.rows[1]!.cells[0]!.content[0]!.inlines[0]).toEqual({ type: 'math', latex: 'a' })
  })

  it('图片由调用方给出资源，取不到时记提示', () => {
    const warns: string[] = []
    const r = htmlToRich('<p><img src="https://x/a.png" alt=""></p><p><img src="https://x/b.png"></p>', {
      image: (src) => (src.endsWith('a.png') ? { type: 'image', assetId: 'A', widthEmu: 1, heightEmu: 1 } : null),
      warn: (m) => warns.push(m)
    })
    expect(r[0]!.inlines).toEqual([{ type: 'image', assetId: 'A', widthEmu: 1, heightEmu: 1 }])
    expect(warns).toEqual(['图片未能导入：https://x/b.png'])
  })

  it('纯文字', () => {
    expect(htmlPlainText('<p><span style="font-size: 22px;"><strong>知识梳理</strong></span></p>')).toBe('知识梳理')
  })
})

describe('墨案教案 → 教学案', () => {
  it('教案名拆成标题与页眉', () => {
    expect(splitPlanName('2026高二数学解析几何第1讲：直线方程')).toEqual({ title: '直线方程', headerRight: '2026高二数学解析几何第1讲' })
    expect(splitPlanName('直线方程')).toEqual({ title: '直线方程', headerRight: '直线方程' })
  })

  it('栏目标题：加粗大字或预设中的栏目名', () => {
    expect(headingText('<p><span style="font-size: 22px;"><strong>例题精讲</strong></span></p>', SECTIONS)).toBe('例题精讲')
    expect(headingText('<p>课后练习</p>', SECTIONS)).toBe('课后练习')
    expect(headingText('<p>本节课的主要内容为直线方程，直线是高中非常重要的板块</p>', SECTIONS)).toBeNull()
  })

  it('选项：题干末尾依次以 A. B. C. D. 开头的段落', () => {
    const { stem, options } = extractOptions(htmlToRich('<p>直线方程是</p><p>A. $x$</p><p>B. $y$</p><p>C. 1</p><p>D. 2</p>'))
    expect(stem.map((p) => plainText(p))).toEqual(['直线方程是'])
    expect(options.map((o) => [o.label, plainText(o.content)])).toEqual([
      ['A', '$x$'],
      ['B', '$y$'],
      ['C', '1'],
      ['D', '2']
    ])
  })

  it('真实教案“直线方程”：栏目、知识点、19 道题与 16 道变式题', () => {
    const data = show()
    const urls = collectMoanImageUrls(data)
    expect(urls).toHaveLength(2)
    const images = new Map(urls.map((u, i) => [u, { assetId: `img${i}`, width: 400, height: 300 }]))
    const r = convertMoanPlan(data, images, SECTIONS)
    expect(r.title).toBe('直线方程')
    expect(r.headerRight).toBe('2026高二数学解析几何第1讲')
    expect(r.questionCount).toBe(35)
    expect(r.warnings).toEqual([])

    const kinds = r.blocks.map((b) => b.type)
    expect(kinds[0]).toBe('title')
    const sections = r.blocks.filter((b): b is Extract<Block, { type: 'section' }> => b.type === 'section')
    expect(sections.map((s) => [s.text, s.pageBreakBefore === true])).toEqual([
      ['知识梳理', false],
      ['例题精讲', true],
      ['课堂总结', true],
      ['课后练习', true]
    ])
    // 知识梳理中的三张卡片都是知识点（“5. 两条直线的位置关系”是文字卡片，也按知识点导入）
    expect(r.blocks.filter((b) => b.type === 'knowledge')).toHaveLength(3)

    const qs = r.blocks.filter((b): b is QuestionBlock => b.type === 'question').map((b) => b.question)
    expect(qs).toHaveLength(35)
    expect(qs.filter((q) => q.numberStyle !== 'variant')).toHaveLength(19)
    const first = qs[0]!
    expect(plainText(first.stem)).toBe('已知直线 $l$ 的方程为 $2 x+y+1=0$, 则直线 $l$ 的倾斜角为___________')
    expect(first.kind).toBe('fill-blank')
    expect(first.stars).toBe(5)
    expect(first.layout.studentSpaceLines).toBe(5)
    expect(plainText(first.answer)).toBe('标准答案: $\\pi-\\arctan 2$')
    // 审题单独拆出，解析从“讲解提要”开始
    expect(plainText(first.review ?? [])).toBe('倾斜角与斜率')
    expect(plainText(first.analysis).startsWith('【解析】讲解提要')).toBe(true)
    expect(qs.filter((q) => q.review !== undefined)).toHaveLength(34)
    // 重点题
    expect(qs.filter((q) => q.important === true)).toHaveLength(11)
    expect(qs[1]!.important).toBe(true)
    expect(first.source?.moan).toEqual({ itemId: 102417, exerciseId: 249, questionTypeId: 1 })
    // 第 19 题是选择题
    const last = qs[qs.length - 1]!
    expect(last.kind).toBe('single-choice')
    expect(last.options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(plainText(last.answer)).toBe('A')
    // 8b 的题图排在题干下方
    const withFigure = qs.filter((q) => q.figures.length > 0)
    expect(withFigure).toHaveLength(1)
    expect(withFigure[0]!.figures[0]).toMatchObject({ assetId: 'img1', placement: 'below', widthEmu: 400 * 9525 })
    // “≠”保留为 LaTeX（PDF 文字层里会变成“=”）
    const k = r.blocks.find((b) => b.type === 'knowledge' && plainText(b.content).includes('两条直线的位置关系'))
    expect(k !== undefined && plainText((k as Extract<Block, { type: 'knowledge' }>).content).includes('c_1 \\neq \\lambda c_2')).toBe(true)
  })

  it('题号：1. a. b. 2. a. …，与墨案一致', () => {
    const r = convertMoanPlan(show(), new Map(), SECTIONS)
    const project = { ...createEmptyProject(), presetId: 'math-v1', blocks: r.blocks }
    const labels = buildDocument(project, 'teacher')
      .paragraphs.filter((p) => p.style === 'question' && p.label !== undefined)
      .map((p) => p.label)
    expect(labels.slice(0, 9)).toEqual(['1.', 'a.', 'b.', '2.', 'a.', 'b.', '3.', 'a.', 'b.'])
    expect(labels.filter((l) => /^\d/.test(l!))).toHaveLength(19)
    expect(labels[labels.length - 1]).toBe('19.')
  })
})

describe('表格形式的选项', () => {
  const opts = (r: ReturnType<typeof extractOptions>) => r.options.map((o) => o.label + ':' + plainText([o.content]))
  it('一行四格 → 4 列', () => {
    const r = extractOptions(htmlToRich('<p>则拉力（　　）</p><table><tr><td><p>A. <i>T</i><sub>2</sub>=<i>T</i><sub>1</sub></p></td><td><p>B. 0</p></td><td><p>C. 1</p></td><td><p>D. 2</p></td></tr></table>'))
    expect(r.stem.map((p) => plainText([p]))).toEqual(['则拉力（　　）'])
    expect(opts(r)).toEqual(['A:T2=T1', 'B:0', 'C:1', 'D:2'])
    expect(r.optionColumns).toBe(4)
  })
  it('两行两格 → 2 列；一列四行 → 1 列；空格与末尾空段忽略', () => {
    const two = extractOptions(htmlToRich('<p>题干</p><table><tr><td>A. 甲</td><td>B. 乙</td></tr><tr><td>C. 丙</td><td>D. 丁</td></tr></table><p></p>'))
    expect(opts(two)).toEqual(['A:甲', 'B:乙', 'C:丙', 'D:丁'])
    expect(two.optionColumns).toBe(2)
    const one = extractOptions(htmlToRich('<p>题干</p><table><tr><td>A. 甲</td><td></td></tr><tr><td>B. 乙</td></tr><tr><td>C. 丙</td></tr><tr><td>D. 丁</td></tr></table>'))
    expect(opts(one)).toEqual(['A:甲', 'B:乙', 'C:丙', 'D:丁'])
    expect(one.optionColumns).toBe(1)
  })
  it('普通表格（不是依次以 A. B. 开头）留在题干里', () => {
    const r = extractOptions(htmlToRich('<p>下表为实验数据</p><table><tr><td>电流 I</td><td>0.1</td></tr><tr><td>拉力 F</td><td>0.2</td></tr></table>'))
    expect(r.options).toEqual([])
    expect(r.stem).toHaveLength(2)
    const notSeq = extractOptions(htmlToRich('<p>题干</p><table><tr><td>A. 甲</td><td>C. 丙</td></tr></table>'))
    expect(notSeq.options).toEqual([])
  })
})

describe('拆出审题', () => {
  it('“审题：”一段放进审题，其余为解析；同一段中的“讲解提要”归还解析', () => {
    const a = splitReview(htmlToRich('<p><br></p><p>审题：倾斜角与斜率</p><p>讲解提要：</p><p>A1：$k=-2$</p>'))
    expect(a.review.map((p) => plainText(p))).toEqual(['倾斜角与斜率'])
    expect(a.analysis.map((p) => plainText(p))).toEqual(['讲解提要：', 'A1：$k=-2$'])
    const b = splitReview(htmlToRich('<p>审题: 求直线方程讲解提要:</p><p>A1</p>'))
    expect(b.review.map((p) => plainText(p))).toEqual(['求直线方程'])
    expect(b.analysis.map((p) => plainText(p))).toEqual(['讲解提要:', 'A1'])
    const c = splitReview(htmlToRich('<p>讲解提要：</p><p>A1</p>'))
    expect(c.review).toEqual([])
    expect(c.analysis).toHaveLength(2)
  })
})

describe('题目可选项：审题、重点题', () => {
  const q = createQuestion({ kind: 'solve', stem: [para('题干')], analysis: [para('【解析】讲解')], review: [para('先求斜率')], important: true })
  const doc = (presetId: string, layout: Partial<ReturnType<typeof createEmptyProject>['layout']> = {}, variant: 'teacher' | 'student' = 'teacher') => {
    const p = createEmptyProject()
    return buildDocument({ ...p, presetId, layout: { ...p.layout, ...layout }, blocks: [{ id: 'q', type: 'question', question: q }] }, variant)
  }
  const texts = (ir: ReturnType<typeof buildDocument>): string[] => ir.paragraphs.map((p) => p.runs.map((r) => (r.kind === 'text' ? r.text : '')).join(''))

  it('数学教学案默认打开：审题排在解析之前，教师版题干前有【重点题】', () => {
    expect(resolveQuestionFields({}, getPreset('math-v1'))).toEqual({ review: true, important: true })
    const t = texts(doc('math-v1'))
    expect(t[0]).toBe('【重点题】题干')
    expect(t.indexOf('【审题】先求斜率')).toBeGreaterThan(0)
    expect(t.indexOf('【审题】先求斜率')).toBe(t.indexOf('【解析】讲解') - 1)
    // 学生版两者都不出现
    const s2 = texts(doc('math-v1', {}, 'student'))
    expect(s2[0]).toBe('题干')
    expect(s2.some((x) => x.includes('审题'))).toBe(false)
  })

  it('其他预设默认关闭（数据保留）；工程的版式设置可以打开', () => {
    expect(resolveQuestionFields({}, getPreset('physics-v1'))).toEqual({ review: false, important: false })
    const off = texts(doc('physics-v1'))
    expect(off[0]).toBe('题干')
    expect(off.some((x) => x.includes('审题'))).toBe(false)
    const on = texts(doc('physics-v1', { questionFields: { review: true } }))
    expect(on[0]).toBe('题干')
    expect(on.includes('【审题】先求斜率')).toBe(true)
    // 数学预设也可以关掉其中一项
    expect(texts(doc('math-v1', { questionFields: { important: false } }))[0]).toBe('题干')
  })
})

describe('变式题题号', () => {
  it('字母：a～z，之后 aa', () => {
    expect([1, 2, 26, 27].map(variantLetters)).toEqual(['a', 'b', 'z', 'aa'])
  })

  it('文档开头的变式题按普通题编号；变式题的题号由导出写成文字', () => {
    const r = convertMoanPlan(show(), new Map(), SECTIONS)
    const qs = r.blocks.filter((b): b is QuestionBlock => b.type === 'question').slice(1, 3)
    const ir = buildDocument({ ...createEmptyProject(), blocks: qs }, 'student')
    const heads = ir.paragraphs.filter((p) => p.style === 'question')
    expect(heads.map((p) => [p.label, p.manualLabel === true])).toEqual([
      ['1.', false],
      ['a.', true]
    ])
  })
})

describe('墨案会话', () => {
  it('解析 socket.io 帧', () => {
    expect(parseSocketFrame('42/moan-teaching-plan,3["show",{"id":"3829"}]')).toEqual({ type: '42', namespace: 'moan-teaching-plan', ackId: 3, data: ['show', { id: '3829' }] })
    expect(parseSocketFrame('2')).toBeNull()
  })

  it('从网页发出的帧中得到服务器地址、令牌与当前文件夹；从回应中得到文件夹名称', () => {
    const s = createMoanSession()
    const url = 'wss://server.modijiaoyu.com/socket.io/?EIO=3&transport=websocket'
    observeMoanFrame(s, 'send', url, '40/user,')
    expect(s.token).toBeUndefined()
    observeMoanFrame(s, 'send', url, '42/moan-teaching-plan,2["list",{"folder_id":544,"hadChild":1,"user_id":"","token":"T%3D"}]')
    observeMoanFrame(s, 'receive', url, '43/teaching-plan,0[{"code":"0000","content":{"folders":[{"id":544,"name":"解析几何"}]}}]')
    expect(s).toMatchObject({ wsUrl: url, token: 'T%3D', folderId: 544 })
    expect(s.folderNames.get(544)).toBe('解析几何')
  })

  it('教案编辑页的地址', () => {
    expect(teachingPlanIdFromUrl('https://moan.modijiaoyu.com/#/teach/edit_teachingPlan/3829?type=teachingPlan')).toBe(3829)
    expect(teachingPlanIdFromUrl('https://moan.modijiaoyu.com/#/teach/standard_content')).toBeNull()
  })
})

describe('图片尺寸', () => {
  it('PNG、GIF、JPEG', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 44, 0, 0, 0, 200])
    expect(readImageInfo(png)).toEqual({ mime: 'image/png', width: 300, height: 200 })
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0])
    expect(readImageInfo(gif)).toEqual({ mime: 'image/gif', width: 10, height: 20 })
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 50, 0, 80, 3, 0, 0, 0])
    expect(readImageInfo(jpg)).toEqual({ mime: 'image/jpeg', width: 80, height: 50 })
    expect(readImageInfo(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('墨案中的 MathML 公式（从 Word 粘贴）', () => {
  const latexOf = (html: string): string[] => htmlToRich(html).flatMap((p) => p.inlines).flatMap((i) => (i.type === 'math' ? [i.latex ?? ''] : []))
  it('分数、根号、科学计数法', () => {
    expect(latexOf('<p>B. <math><mfrac><mi>π</mi><mn>2</mn></mfrac><mi>I</mi></math></p>')).toEqual(['\\frac{\\pi}{2}I'])
    expect(latexOf('<p>D. <math><mfrac><mrow><mn>2</mn><mi>π</mi></mrow><mn>3</mn></mfrac><mi>I</mi></math></p>')).toEqual(['\\frac{2\\pi}{3}I'])
    expect(latexOf('<p>C. <math><msqrt><mn>2</mn></msqrt><mi>B</mi><mi>I</mi><mi>l</mi></math></p>')).toEqual(['\\sqrt{2}BIl'])
    expect(latexOf('<p>A. <math><mn>2.4</mn><mo>×</mo><msup><mn>10</mn><mrow><mo>−</mo><mn>3</mn></mrow></msup></math>N，竖直向上</p>')).toEqual(['2.4\\times {10}^{-3}'])
  })
  it('选项表格中的公式：文字与公式都留在选项里', () => {
    const r = extractOptions(htmlToRich('<p>则电流为（　　）</p><table><tr><td>A. <math><mi>I</mi></math></td><td>B. <math><mfrac><mi>π</mi><mn>2</mn></mfrac><mi>I</mi></math></td><td>C. <math><mi>π</mi><mi>I</mi></math></td><td>D. <math><mfrac><mrow><mn>2</mn><mi>π</mi></mrow><mn>3</mn></mfrac><mi>I</mi></math></td></tr></table>'))
    expect(r.options.map((o) => o.content.inlines.map((i) => (i.type === 'math' ? `$${i.latex}$` : i.type === 'text' ? i.text : '')).join(''))).toEqual(['$I$', '$\\frac{\\pi}{2}I$', '$\\pi I$', '$\\frac{2\\pi}{3}I$'])
  })
  it('命名空间前缀、函数名、下标、向量、TeX 注释、KaTeX 渲染结果', () => {
    expect(latexOf('<p><m:math><m:msub><m:mi>F</m:mi><m:mn>1</m:mn></m:msub></m:math></p>')).toEqual(['F_{1}'])
    expect(latexOf('<p><math><mi>sin</mi><mo>\u2061</mo><mi>θ</mi></math></p>')).toEqual(['\\sin\\theta'])
    expect(latexOf('<p><math><mover><mi>F</mi><mo>→</mo></mover></math></p>')).toEqual(['\\overrightarrow{F}'])
    expect(latexOf('<p><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">\\dfrac{1}{2}mv^2</annotation></semantics></math></p>')).toEqual(['\\dfrac{1}{2}mv^2'])
    const katex = '<p>由 <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span>ab</span></span></span> 得</p>'
    expect(latexOf(katex)).toEqual(['\\frac{a}{b}'])
    expect(plainText(htmlToRich(katex))).toBe('由 $\\frac{a}{b}$ 得')
  })
  it('不认识的结构按文字导入并提示', () => {
    const warns: string[] = []
    const r = htmlToRich('<p><math><mfoo><mi>x</mi></mfoo></math></p>', { warn: (m) => warns.push(m) })
    expect(r[0]!.inlines[0]).toMatchObject({ type: 'math', latex: 'x' })
    expect(warns[0]).toContain('mfoo')
  })
})

describe('不认识的标签', () => {
  it('按文字导入，每种标签提示一次', () => {
    const warns: string[] = []
    const r = htmlToRich('<p>由<mjx-frac><mjx-num>1</mjx-num><mjx-den>2</mjx-den></mjx-frac>得<mjx-frac>3</mjx-frac></p>', { warn: (m) => warns.push(m) })
    expect(plainText(r)).toBe('由12得3')
    expect(warns.filter((w) => w.includes('<mjx-frac>'))).toHaveLength(1)
  })
})

describe('知识点、答案、解析中的图片', () => {
  it('单独成段的图片导入为插图', () => {
    const show = {
      teachingPlan: { id: 1, name: '测试' },
      mainTeachingPlanExtra: [
        { id: 1, type_id: 5, sort_id: 1, name: '<p>洛伦兹力方向</p><p><img src="https://x/a.png"></p><p>左手定则</p>' },
        { id: 2, type_id: 1, sort_id: 2, name: '<p>求力</p>', answer: '<p>F=qvB</p><p><img src="https://x/b.png"></p>', review_topic: '<p><img src="https://x/c.png"></p><p>讲解提要：</p>' }
      ],
      childTeachingPlanExtra: {}
    } as unknown as MoanPlanShow
    const images = new Map([['https://x/a.png', { assetId: 'A', width: 100, height: 50 }], ['https://x/b.png', { assetId: 'B', width: 100, height: 50 }], ['https://x/c.png', { assetId: 'C', width: 100, height: 50 }]])
    const r = convertMoanPlan(show, images, [])
    const k = r.blocks.find((b) => b.type === 'knowledge')!
    expect(k.type === 'knowledge' && k.figures.map((f) => [f.assetId, f.anchorParagraph])).toEqual([['A', 0]])
    expect(k.type === 'knowledge' && k.content.map((p) => plainText([p]))).toEqual(['洛伦兹力方向', '左手定则'])
    const q = r.blocks.find((b) => b.type === 'question')!
    if (q.type !== 'question') throw new Error()
    expect(q.question.answerFigures?.map((f) => f.assetId)).toEqual(['B'])
    expect(q.question.analysisFigures?.map((f) => f.assetId)).toEqual(['C'])
    expect(plainText(q.question.analysis)).toBe('【解析】讲解提要：')
  })
})
