import { describe, expect, it } from 'vitest'
import { createEmptyBundle } from '@core/model/factory'
import { encodeBundle, decodeBundle } from '@core/project-file/codec'
import { projectSchema } from '@core/model/schema'

describe('版式设置中的公式字母正体 / 斜体', () => {
  it('保存后再打开仍保留；不设置时没有这个字段（用本机设置）', async () => {
    const bundle = createEmptyBundle()
    expect(bundle.project.layout.mathUpright).toBeUndefined()
    bundle.project.layout.mathUpright = false
    const back = await decodeBundle(await encodeBundle(bundle, { appVersion: 'test' }))
    expect(back.project.layout.mathUpright).toBe(false)
  })

  it('旧版本的校验不认识这个字段时会忽略它（不报错）', () => {
    const bundle = createEmptyBundle()
    const parsed = projectSchema.safeParse({ ...bundle.project, layout: { ...bundle.project.layout, mathUpright: true, notKnown: 1 } })
    expect(parsed.success).toBe(true)
  })
})
