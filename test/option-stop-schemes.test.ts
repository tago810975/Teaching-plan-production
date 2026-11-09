import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTION_STOPS, LEGACY_OPTION_STOPS } from '@core/model/factory'
import { BUILTIN_OPTION_STOP_SCHEMES, matchScheme, sanitizeSchemes, schemeNameProblem, validStops } from '@core/model/option-stop-schemes'

const custom = { two: [5000] as [number], four: [2600, 5000, 7400] as [number, number, number] }

describe('选项间距方案', () => {
  it('内置方案：默认（14/26/38 字）与模板原位置', () => {
    expect(BUILTIN_OPTION_STOP_SCHEMES.map((s) => s.name)).toEqual(['默认', '模板原位置（较窄）'])
    expect(BUILTIN_OPTION_STOP_SCHEMES[0]!.stops).toEqual({ two: [26 * 210], four: [14 * 210, 26 * 210, 38 * 210] })
    expect(matchScheme(DEFAULT_OPTION_STOPS, [])?.name).toBe('默认')
    expect(matchScheme(LEGACY_OPTION_STOPS, [])?.name).toBe('模板原位置（较窄）')
  })

  it('匹配用户方案；对不上任何方案时为自定义', () => {
    expect(matchScheme(custom, [{ name: '宽松', stops: custom }])?.name).toBe('宽松')
    expect(matchScheme({ two: [5001], four: custom.four }, [{ name: '宽松', stops: custom }])).toBeUndefined()
  })

  it('名称检查：不能为空、过长或与内置方案同名', () => {
    expect(schemeNameProblem('  ')).not.toBeNull()
    expect(schemeNameProblem('默认')).not.toBeNull()
    expect(schemeNameProblem('一'.repeat(21))).not.toBeNull()
    expect(schemeNameProblem('图片选项宽松')).toBeNull()
  })

  it('列位置检查：从小到大、每列至少两个字宽、不超出栏宽', () => {
    expect(validStops(custom.four)).toBe(true)
    expect(validStops([5000, 2600, 7400])).toBe(false)
    expect(validStops([600])).toBe(false)
    expect(validStops([2600, 5000, 10400])).toBe(false)
  })

  it('读取设置时丢弃无效、重名与内置同名的方案', () => {
    const raw = [
      { name: '宽松', stops: custom },
      { name: '宽松', stops: DEFAULT_OPTION_STOPS },
      { name: '默认', stops: custom },
      { name: '坏的', stops: { two: [1], four: [1, 2, 3] } },
      { name: '缺字段' },
      'abc'
    ]
    expect(sanitizeSchemes(raw)).toEqual([{ name: '宽松', stops: custom }])
    expect(sanitizeSchemes(null)).toEqual([])
  })
})
