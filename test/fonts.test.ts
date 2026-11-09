import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { fontFamilyOf } from '@core/document/fonts'
import { STYLE_SPECS } from '@core/document/styles'
import type { Block } from '@core/model/types'

/** 读取模板 styles.xml：样式名 → 东亚字体（沿 basedOn 向上查找） */
async function templateFonts(): Promise<Map<string, string | undefined>> {
  const zip = await JSZip.loadAsync(readFileSync('resources/templates/physics-default/template.docx'))
  const xml = await zip.file('word/styles.xml')!.async('string')
  // 主题字体（eastAsiaTheme）：取主题中简体中文（Hans）的字体
  const theme = (await zip.file('word/theme/theme1.xml')?.async('string')) ?? ''
  const themeFont = (kind: 'major' | 'minor'): string | undefined =>
    new RegExp(`<a:${kind}Font>[\\s\\S]*?<a:font script="Hans" typeface="([^"]*)"`).exec(theme)?.[1]
  const styles = new Map<string, { name: string; basedOn?: string; font?: string }>()
  for (const m of xml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const body = m[2]!
    const name = /<w:name w:val="([^"]+)"/.exec(body)?.[1] ?? m[1]!
    const basedOn = /<w:basedOn w:val="([^"]+)"/.exec(body)?.[1]
    const rFonts = /<w:rFonts\b[^>]*\/>/.exec(body)?.[0] ?? ''
    const themeRef = /w:eastAsiaTheme="(major|minor)EastAsia"/.exec(rFonts)?.[1] as 'major' | 'minor' | undefined
    const font = /w:eastAsia="([^"]+)"/.exec(rFonts)?.[1] ?? (themeRef !== undefined ? themeFont(themeRef) : undefined)
    styles.set(m[1]!, { name, ...(basedOn !== undefined ? { basedOn } : {}), ...(font !== undefined ? { font } : {}) })
  }
  const out = new Map<string, string | undefined>()
  for (const s of styles.values()) {
    let cur: typeof s | undefined = s
    let font: string | undefined
    for (let i = 0; cur !== undefined && i < 10; i++) {
      if (cur.font !== undefined) {
        font = cur.font
        break
      }
      cur = cur.basedOn === undefined ? undefined : styles.get(cur.basedOn)
    }
    out.set(s.name, font)
  }
  return out
}

describe('字体大类', () => {
  it('具体字体名归入大类', () => {
    expect(fontFamilyOf('宋体')).toBe('song')
    expect(fontFamilyOf('SimSun')).toBe('song')
    expect(fontFamilyOf('华文仿宋')).toBe('fang')
    expect(fontFamilyOf('仿宋_GB2312')).toBe('fang')
    expect(fontFamilyOf('楷体_GB2312')).toBe('kai')
    expect(fontFamilyOf('KaiTi')).toBe('kai')
    expect(fontFamilyOf('微软雅黑')).toBe('hei')
    expect(fontFamilyOf('Microsoft YaHei')).toBe('hei')
    expect(fontFamilyOf('黑体')).toBe('hei')
    expect(fontFamilyOf('Times New Roman')).toBeUndefined()
    expect(fontFamilyOf(undefined)).toBeUndefined()
  })

  it('预览样式表的字体与模板 styles.xml 一致（否则预览与导出的字体不同）', async () => {
    const fonts = await templateFonts()
    const mismatches: string[] = []
    for (const [key, spec] of Object.entries(STYLE_SPECS)) {
      const font = fonts.get(spec.wordStyleName)
      const family = fontFamilyOf(font)
      // 模板没有指定可识别的东亚字体时，Word 用默认的宋体
      if ((family ?? 'song') !== spec.fontRole) mismatches.push(`${key}（${spec.wordStyleName}）：模板 ${font ?? '未指定'}，预览 ${spec.fontRole}`)
    }
    expect(mismatches).toEqual([])
  })
})

describe('导入时识别字体、加粗与颜色', async () => {
  const { importDocx } = await import('@core/import/import-docx')
  const r = await importDocx(new Uint8Array(readFileSync('reference/samples/2026秋季高二物理敏思_带电粒子在磁场中的运动/教案_T_带电粒子在磁场中的运动.docx')))
  const all = JSON.stringify(r.blocks)
  const texts = (pred: (m: Record<string, unknown>) => boolean): string[] => {
    const out: string[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v !== null && typeof v === 'object') {
        const o = v as Record<string, unknown>
        if (o.type === 'text' && o.marks !== undefined && pred(o.marks as Record<string, unknown>)) out.push(o.text as string)
        Object.values(o).forEach(walk)
      }
    }
    walk(r.blocks)
    return out
  }

  it('解析统一为黑色（物理教案 V1.0），知识梳理中的红字保留', () => {
    const colored = (field: 'analysis' | 'knowledge'): number =>
      r.blocks
        .flatMap((b) =>
          field === 'knowledge'
            ? b.type === 'knowledge'
              ? b.content
              : []
            : b.type === 'question'
              ? b.question.analysis
              : b.type === 'composite'
                ? [...b.analysis, ...b.items.flatMap((it) => it.question.analysis)]
                : []
        )
        .flatMap((p) => p.inlines)
        .filter((i) => i.type === 'text' && i.marks?.color !== undefined).length
    expect(colored('analysis')).toBe(0)
    expect(colored('knowledge')).toBeGreaterThan(0)
  })

  it('知识梳理中的红色加粗下划线保留', async () => {
    const r2 = await importDocx(new Uint8Array(readFileSync('reference/samples/2026秋季高二物理敏思_动态圆专题/教案_T_动态圆专题.docx')))
    const marks = r2.blocks.flatMap((b) =>
      b.type === 'knowledge' ? b.content.flatMap((p) => p.inlines.flatMap((i) => (i.type === 'text' && i.marks !== undefined ? [i.marks] : []))) : []
    )
    expect(marks.some((m) => m.color === 'C00000')).toBe(true)
    expect(marks.some((m) => m.bold === true)).toBe(true)
  })

  it('选择保留颜色的预设时，解析中的红字保留', async () => {
    const { applyPresetRules } = await import('@core/import/preset-rules')
    const { getPreset } = await import('@core/presets')
    const { createQuestion } = await import('@core/model/factory')
    const red = { inlines: [{ type: 'text' as const, text: '【详解】红', marks: { color: 'FF0000', bold: true } }] }
    const block = (): Block => ({ id: 'q', type: 'question', question: createQuestion({ analysis: [red] }) })
    const keep = { ...getPreset('physics-v1'), import: { renameLabels: {}, analysisColor: 'keep' as const } }
    const analysisOf = (b: Block | undefined): unknown => (b?.type === 'question' ? b.question.analysis : undefined)
    expect(analysisOf(applyPresetRules([block()], keep)[0])).toEqual([red])
    expect(analysisOf(applyPresetRules([block()], getPreset('physics-v1'))[0])).toEqual([
      { inlines: [{ type: 'text', text: '【解析】红', marks: { bold: true } }] }
    ])
  })

  it('加粗保留', () => {
    expect(texts((m) => m.bold === true).length).toBeGreaterThan(0)
  })

  it('华文仿宋归入仿宋；与样式相同的宋体不记录', () => {
    expect(all).toContain('"fang"')
    expect(all).not.toContain('"font":"song"')
  })

  it('导入文档中与样式相同的字体不会产生文字格式标记', async () => {
    const r2 = await importDocx(new Uint8Array(readFileSync('reference/samples/2026秋季高二物理东湖_期中试卷分析/教案_T_期中试卷分析.docx')))
    // 这份文档每段都标了“宋体”，整理后不应留下任何字体
    expect(JSON.stringify(r2.blocks)).not.toMatch(/"font":/)
  })
})

describe('字体的排版与导出', async () => {
  const { paragraph } = await import('@core/import/normalize-fonts')
  const { buildDocument } = await import('@core/document/build')
  const { writeDocx } = await import('@core/export/docx-writer')
  const { createComposite, createEmptyProject, createQuestion, newId, para } = await import('@core/model/factory')

  it('整段同一字体时提升为段落字体；与样式相同则不记录；混排保留在文字上', () => {
    expect(paragraph({ inlines: [{ type: 'text', text: '甲乙', marks: { font: 'kai' } }, { type: 'text', text: 'AB' }] }, 'song')).toEqual({
      inlines: [{ type: 'text', text: '甲乙AB' }],
      format: { font: 'kai' }
    })
    expect(paragraph({ inlines: [{ type: 'text', text: '甲乙', marks: { font: 'kai' } }] }, 'kai')).toEqual({ inlines: [{ type: 'text', text: '甲乙' }] })
    expect(
      paragraph({ inlines: [{ type: 'text', text: '解：', marks: { font: 'fang', bold: true } }, { type: 'text', text: '略', marks: { font: 'song' } }] }, 'song')
    ).toEqual({ inlines: [{ type: 'text', text: '解：', marks: { font: 'fang', bold: true } }, { type: 'text', text: '略' }] })
  })

  it('段落字体与文字字体写入 Word；综合题背景随模板为楷体', async () => {
    const p = createEmptyProject()
    p.blocks = [
      createComposite({ title: '材料一', background: [para('背景')], items: [], answer: [], analysis: [] }),
      {
        id: newId(),
        type: 'question',
        question: createQuestion({
          stem: [{ inlines: [{ type: 'text', text: '黑体题干' }], format: { font: 'hei' } }],
          answer: [{ inlines: [{ type: 'text', text: '仿宋', marks: { font: 'fang', color: 'FF0000', bold: true } }] }]
        })
      }
    ]
    const ir = buildDocument(p, 'teacher')
    expect(ir.paragraphs.find((x) => x.style === 'question')?.font).toBe('hei')
    const doc = await (
      await JSZip.loadAsync(
        await writeDocx({ ir, assets: {}, title: 't', template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx')) })
      )
    )
      .file('word/document.xml')!
      .async('string')
    expect(doc).toContain('<w:rFonts w:eastAsia="黑体" w:hint="eastAsia"/></w:rPr><w:t xml:space="preserve">黑体题干')
    expect(doc).toContain('<w:rFonts w:eastAsia="仿宋" w:hint="eastAsia"/><w:b/><w:bCs/><w:color w:val="FF0000"/>')
    // 背景没有另设字体：不写 rFonts，由模板样式（楷体）决定
    expect(doc).toMatch(/<w:r><w:t xml:space="preserve">背景<\/w:t>/)
  })

  it('选项段落清除模板样式自带、但没用到的制表位', async () => {
    const p = createEmptyProject()
    p.blocks = [{ id: newId(), type: 'question', question: createQuestion({ options: ['A', 'B', 'C', 'D'].map((label, i) => ({ label, content: para(String(i)) })) }) }]
    const ir = buildDocument(p, 'student')
    const doc = await (
      await JSZip.loadAsync(
        await writeDocx({ ir, assets: {}, title: 't', template: new Uint8Array(readFileSync('resources/templates/physics-default/template.docx')) })
      )
    )
      .file('word/document.xml')!
      .async('string')
    expect(doc).toContain(
      '<w:tabs><w:tab w:val="clear" w:pos="2310"/><w:tab w:val="left" w:pos="2730"/><w:tab w:val="clear" w:pos="4200"/><w:tab w:val="left" w:pos="5040"/><w:tab w:val="clear" w:pos="6090"/><w:tab w:val="left" w:pos="7350"/></w:tabs>'
    )
  })
})
