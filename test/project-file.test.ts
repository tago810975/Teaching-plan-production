import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createEmptyBundle, createQuestion } from '@core/model/factory'
import { createAsset, decodeBundle, decodeSummary, encodeBundle, ProjectFileError } from '@core/project-file/codec'
import { CURRENT_FORMAT_VERSION, PROJECT_FILE_MIMETYPE } from '@core/project-file/format'
import { createDemoBundle } from '@core/sample/demo-project'

const opts = { appVersion: '0.1.0-test', now: new Date('2026-11-07T00:00:00Z') }

describe('工程文件编解码', () => {
  it('演示工程保存后再读取，内容完全一致', async () => {
    const bundle = await createDemoBundle(undefined, new Date('2026-11-07T00:00:00Z'))
    const decoded = await decodeBundle(await encodeBundle(bundle, opts))
    expect(decoded.project).toEqual(bundle.project)
    expect(Object.keys(decoded.assets)).toEqual(Object.keys(bundle.assets))
    for (const [id, asset] of Object.entries(bundle.assets)) {
      expect(decoded.assets[id]?.mime).toBe(asset.mime)
      expect(decoded.assets[id]?.data).toEqual(asset.data)
    }
  })

  it('摘要包含名称、题目数与时间', async () => {
    const bundle = await createDemoBundle(undefined, new Date('2026-11-07T00:00:00Z'))
    const summary = await decodeSummary(await encodeBundle(bundle, opts))
    expect(summary).toEqual({
      title: '动态圆专题',
      questionCount: 3,
      createdAt: '2026-11-07T00:00:00.000Z',
      updatedAt: '2026-11-07T00:00:00.000Z'
    })
  })

  it('mimetype 位于压缩包首位且不压缩', async () => {
    const bytes = await encodeBundle(createEmptyBundle(), opts)
    // ZIP 本地文件头：偏移 8 为压缩方式（0 = STORE），偏移 30 起为文件名
    const view = new DataView(bytes.buffer, bytes.byteOffset)
    expect(view.getUint16(8, true)).toBe(0)
    const nameLen = view.getUint16(26, true)
    expect(new TextDecoder().decode(bytes.subarray(30, 30 + nameLen))).toBe('mimetype')
  })

  it('页眉图片随工程保存', async () => {
    const bundle = createEmptyBundle()
    const logo = await createAsset(new Uint8Array([9, 9, 9]), 'image/png')
    bundle.assets[logo.id] = logo
    bundle.project.header.logo = { assetId: logo.id, widthEmu: 100, heightEmu: 50 }
    const decoded = await decodeBundle(await encodeBundle(bundle, opts))
    expect(decoded.assets[logo.id]?.data).toEqual(logo.data)
    expect(decoded.project.header.logo).toEqual(bundle.project.header.logo)
  })

  it('保存时丢弃未被引用的资源', async () => {
    const bundle = createEmptyBundle()
    const orphan = await createAsset(new Uint8Array([1, 2, 3]), 'image/png')
    bundle.assets[orphan.id] = orphan
    const decoded = await decodeBundle(await encodeBundle(bundle, opts))
    expect(decoded.assets).toEqual({})
  })

  it('资源 ID 是内容的 SHA-256', async () => {
    const asset = await createAsset(new TextEncoder().encode('abc'), 'image/png')
    expect(asset.id).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('拒绝非工程文件', async () => {
    await expect(decodeBundle(new Uint8Array([1, 2, 3]))).rejects.toThrow(ProjectFileError)
    const zip = new JSZip()
    zip.file('hello.txt', 'hi')
    await expect(decodeBundle(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      '这不是教学案工程文件'
    )
  })

  it('拒绝更新版本保存的文件', async () => {
    const zip = new JSZip()
    zip.file('mimetype', PROJECT_FILE_MIMETYPE)
    zip.file(
      'manifest.json',
      JSON.stringify({ format: 'teaching-plan', formatVersion: CURRENT_FORMAT_VERSION + 1, appVersion: '9.9.9', savedAt: '' })
    )
    zip.file('project.json', '{}')
    await expect(decodeBundle(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('请升级软件')
  })

  it('旧版（第 1 版）工程自动迁移，排版效果保持不变', async () => {
    const v2 = createEmptyBundle().project
    const { layout: _layout, ...v1 } = v2
    const q = { id: 'q', type: 'question', question: { ...createQuestion(), layout: { ...createQuestion().layout, keepTogether: true } } }
    const q2 = { id: 'q2', type: 'question', question: { ...createQuestion(), layout: { ...createQuestion().layout, keepTogether: false } } }
    const zip = new JSZip()
    zip.file('mimetype', PROJECT_FILE_MIMETYPE)
    zip.file('manifest.json', JSON.stringify({ format: 'teaching-plan', formatVersion: 1, appVersion: '0.1.0', savedAt: '' }))
    zip.file('project.json', JSON.stringify({ ...v1, blocks: [q, q2] }))
    const decoded = await decodeBundle(await zip.generateAsync({ type: 'uint8array' }))
    expect(decoded.project.layout.keepQuestionTogether).toEqual({ teacher: true, student: true })
    const layouts = decoded.project.blocks.map((b) => (b.type === 'question' ? b.question.layout.keepTogether : null))
    expect(layouts).toEqual(['auto', 'never'])
  })

  it('project.json 结构不对时给出具体位置', async () => {
    const zip = new JSZip()
    zip.file('mimetype', PROJECT_FILE_MIMETYPE)
    zip.file('manifest.json', JSON.stringify({ format: 'teaching-plan', formatVersion: 1, appVersion: '', savedAt: '' }))
    zip.file('project.json', JSON.stringify({ meta: {}, templateId: 'x', blocks: [] }))
    await expect(decodeBundle(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow('meta.')
  })

  it('引用了缺失的资源时报错', async () => {
    const bundle = await createDemoBundle()
    bundle.assets = {}
    await expect(encodeBundle(bundle, opts)).rejects.toThrow('不存在的图片资源')
  })

  /** 把当前工程改写成旧版本文件：layout 按 edit 修改，manifest 写成 version */
  async function oldFile(version: number, edit: (layout: Record<string, unknown>) => void): Promise<Uint8Array> {
    const zip = await JSZip.loadAsync(await encodeBundle(createEmptyBundle(), opts))
    const project = JSON.parse(await zip.file('project.json')!.async('string'))
    edit(project.layout)
    zip.file('project.json', JSON.stringify(project))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    manifest.formatVersion = version
    zip.file('manifest.json', JSON.stringify(manifest))
    return zip.generateAsync({ type: 'uint8array' })
  }

  it('旧工程：没改过的选项列位置换成加宽后的默认值；难度显示默认两者都显示', async () => {
    const v5 = await decodeBundle(await oldFile(5, (l) => { delete l.optionStops; delete l.difficultyDisplay }))
    expect(v5.project.layout.optionStops).toEqual({ two: [5460], four: [2940, 5460, 7980] })
    expect(v5.project.layout.difficultyDisplay).toBe('both')
    const v7 = await decodeBundle(await oldFile(7, (l) => { l.optionStops = { two: [5040], four: [2730, 5040, 7350] }; delete l.difficultyDisplay }))
    expect(v7.project.layout.optionStops).toEqual({ two: [5460], four: [2940, 5460, 7980] })
  })

  it('旧工程：用户改过的选项列位置保持不变', async () => {
    const custom = { two: [5000], four: [2600, 5000, 7400] }
    const v7 = await decodeBundle(await oldFile(7, (l) => { l.optionStops = custom; delete l.difficultyDisplay }))
    expect(v7.project.layout.optionStops).toEqual(custom)
  })
})
