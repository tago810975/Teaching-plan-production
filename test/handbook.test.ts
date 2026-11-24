import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { blankKeyPoints, buildDocument } from '@core/document/build'
import type { DocParagraph, DocRun } from '@core/document/ir'
import { importDocx } from '@core/import/import-docx'
import { createEmptyProject, newId, para } from '@core/model/factory'
import { getPreset, PRESETS, setUserPresets, type FormatPreset } from '@core/presets'
import type { Inline, Project } from '@core/model/types'

const SAMPLE = 'reference/samples/物理知识点手册_光/教案_T_知识点清单-光.docx'

const TEST_HANDBOOK: FormatPreset = {
  ...getPreset('lesson-v1'),
  id: 'test-handbook',
  name: '知识点手册（测试）',
  kind: 'handbook',
  header: { variantSuffix: false, left: '知识单' },
  sectionNames: [],
  import: { renameLabels: {}, analysisColor: 'keep' },
  dictation: { enabled: true, colors: ['C00000', 'FF0000'], bold: true, minChars: 4 }
}

describe('知识点手册（用户自定义 handbook 预设）', () => {
  let r: Awaited<ReturnType<typeof importDocx>>
  beforeAll(async () => {
    setUserPresets([TEST_HANDBOOK])
    r = await importDocx(new Uint8Array(readFileSync(SAMPLE)), { presetId: 'test-handbook' })
  })
  afterAll(() => {
    setUserPresets([])
  })
  const project = (): Project => {
    const p = createEmptyProject()
    p.presetId = 'test-handbook'
    p.header = { ...p.header, right: '选修一-光' }
    p.blocks = r.blocks
    return p
  }
  const text = (p: DocParagraph): string =>
    p.runs.map((u) => (u.kind === 'text' ? u.text : u.kind === 'blank' ? `[${u.widthChars}]` : u.kind === 'math' ? '〔公式〕' : '')).join('')

  it('预设：内置教学案与题型整理，用户预设支持 handbook', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['教学案', '题型整理'])
    expect(getPreset('test-handbook')).toMatchObject({ kind: 'handbook', sectionNames: [], header: { variantSuffix: false } })
  })

  it('导入：只有大标题与知识点，不识别题目，没有“知识梳理”等二级标题', () => {
    expect(r.questionCount).toBe(0)
    expect(new Set(r.blocks.map((b) => b.type))).toEqual(new Set(['title', 'knowledge']))
    expect(r.blocks.filter((b) => b.type === 'title').map((b) => (b.type === 'title' ? b.text : ''))).toEqual(['光的折射 全反射', '光的现象'])
    const titles = r.blocks.flatMap((b) => (b.type === 'knowledge' ? [b.title] : []))
    expect(titles.slice(0, 9)).toEqual([
      '一、光的反射和折射',
      '二、光的折射定律',
      '三、折射率',
      '四、光的折射与波长的关系',
      '五、测量玻璃折射率实验',
      '六、视角深度',
      '七、全反射',
      '八、临界角',
      '九、全反射应用'
    ])
    // “1．光的反射”等带编号的段落是知识点内容，不是题目
    const first = r.blocks[1]
    expect(first?.type === 'knowledge' && first.content[0]!.inlines.map((i) => (i.type === 'text' ? i.text : '')).join('')).toMatch(/^1．光的反射/)
  })

  it('导入：EQ 域公式保留红色加粗（用于挖空）', () => {
    const maths: Inline[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v !== null && typeof v === 'object') {
        if ((v as Inline).type === 'math') maths.push(v as Inline)
        Object.values(v).forEach(walk)
      }
    }
    walk(r.blocks)
    expect(maths.some((m) => m.type === 'math' && m.bold === true && m.color === 'C00000' && m.latex?.includes('\\frac'))).toBe(true)
  })

  it('学生版：红色加粗的文字与公式挖空成横线，长度与示例学案相近；黑色加粗的保留', () => {
    const s = buildDocument(project(), 'student').paragraphs.map(text)
    const find = (start: string): string => s.find((x) => x.startsWith(start))!
    // 示例学案：“分界面”8 个下划线、“传播方向”10 个（一个字宽 = 两个下划线）
    expect(find('1．光的反射')).toBe('1．光的反射：光从介质1射到介质1与介质2的[4]时，一部分光会返回到[4]的现象。光的反射遵循光的反射定律。')
    expect(find('2．光的折射')).toContain('改变[5]的现象')
    // 红色加粗的公式（sinθ1/sinθ2）也挖空
    expect(find('当光从介质1射入介质2')).toMatch(/之比为一常数，即\[\d\]= C。$/)
    // 只有红色加粗处挖空：后文普通文字中的“分界面”保留
    expect(s.join('')).toContain('在这两种介质的分界面上发生全反射')
  })

  it('教师版不挖空；页眉不加“(教案)”“(学案)”', () => {
    const t = buildDocument(project(), 'teacher')
    expect(t.paragraphs.some((p) => p.runs.some((u) => u.kind === 'blank'))).toBe(false)
    expect(t.header.right).toBe('选修一-光')
    expect(buildDocument(project(), 'student').header.right).toBe('选修一-光')
  })

  it('教学案预设的学生版不挖空', () => {
    const p = project()
    p.presetId = 'lesson-v1'
    expect(buildDocument(p, 'student').paragraphs.some((x) => x.runs.some((u) => u.kind === 'blank'))).toBe(false)
  })
})

describe('默写挖空规则', () => {
  const d = TEST_HANDBOOK.dictation
  const P = (runs: DocRun[], style: DocParagraph['style'] = 'body'): DocParagraph => ({ key: 'k', sourceBlockId: 'b', style, runs })
  const red = (t: string): DocRun => ({ kind: 'text', text: t, marks: { bold: true, color: 'C00000' } })

  it('相邻的重点合成一条横线；至少 4 个字宽；字母数字算半个字', () => {
    const out = blankKeyPoints(P([{ kind: 'text', text: '即' }, red('Δx＝'), { kind: 'math', latex: '\\lambda', bold: true, color: 'C00000' }, { kind: 'text', text: '。' }]), d)
    // Δ、x 各半个字，全角“＝”一个字，公式按 5 个字：共 7 个字，再多留一个字
    expect(out.runs).toEqual([{ kind: 'text', text: '即' }, { kind: 'blank', widthChars: 8 }, { kind: 'text', text: '。' }])
    expect(blankKeyPoints(P([red('大')]), d).runs).toEqual([{ kind: 'blank', widthChars: 4 }])
    expect(blankKeyPoints(P([red('频率相同且振动情况完全一致的相干光')]), d).runs).toEqual([{ kind: 'blank', widthChars: 18 }])
  })

  it('只加粗或只红色的不挖空；FF0000 的红色也算；标题不挖空', () => {
    const p = P([{ kind: 'text', text: '黑粗', marks: { bold: true } }, { kind: 'text', text: '红不粗', marks: { color: 'C00000' } }, { kind: 'text', text: '亮红', marks: { bold: true, color: 'ff0000' } }])
    expect(blankKeyPoints(p, d).runs.map((u) => u.kind)).toEqual(['text', 'text', 'blank'])
    expect(blankKeyPoints(P([red('重点')], 'topic'), d).runs[0]!.kind).toBe('text')
  })

  it('“重点”按钮设的红色加粗下划线同样会挖空', () => {
    setUserPresets([TEST_HANDBOOK])
    const p = createEmptyProject()
    p.presetId = 'test-handbook'
    p.blocks = [{ id: newId(), type: 'knowledge', title: '一、测试', content: [{ inlines: [{ type: 'text', text: '光路' }, { type: 'text', text: '可逆', marks: { bold: true, underline: true, color: 'C00000' } }] }, para('完')], figures: [], layout: { keepTogether: 'auto', teacherSpaceLines: 0, studentSpaceLines: 0 } } as never]
    const s = buildDocument(p, 'student').paragraphs.find((x) => x.runs.some((u) => u.kind === 'blank'))!
    expect(s.runs.map((r) => (r.kind === 'text' ? { kind: r.kind, text: r.text } : r))).toEqual([{ kind: 'text', text: '光路' }, { kind: 'blank', widthChars: 4 }])
    setUserPresets([])
  })
})
