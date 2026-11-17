import { describe, expect, it } from 'vitest'
import { fixOmmlPrescripts } from '@core/math/omml-prescripts'
import { uprightOmml } from '@core/export/math-marks'

// 用户 Word 文档中 ⁴₂He 的写法：空底数（<m:e/>）的上下标 + He
const HE = '<m:oMath><m:sSubSup><m:sSubSupPr/><m:e/><m:sub><m:r><m:rPr/><m:t>2</m:t></m:r></m:sub><m:sup><m:r><m:rPr/><m:t>4</m:t></m:r></m:sup></m:sSubSup><m:r><m:rPr><m:nor/></m:rPr><m:t>He</m:t></m:r></m:oMath>'

describe('Word 公式中的左上下标', () => {
  it('空底数的上下标 + He → m:sPre（He 在其中）', () => {
    expect(fixOmmlPrescripts(HE)).toBe(
      '<m:oMath><m:sPre><m:sub><m:r><m:rPr/><m:t>2</m:t></m:r></m:sub><m:sup><m:r><m:rPr/><m:t>4</m:t></m:r></m:sup><m:e><m:r><m:rPr><m:nor/></m:rPr><m:t>He</m:t></m:r></m:e></m:sPre></m:oMath>'
    )
  })

  it('只有上标或下标、嵌在其他结构中、带命名空间声明的公式', async () => {
    expect(fixOmmlPrescripts('<m:oMath><m:sSup><m:e></m:e><m:sup><m:r><m:t>14</m:t></m:r></m:sup></m:sSup><m:r><m:t>C</m:t></m:r></m:oMath>')).toContain(
      '<m:sPre><m:sub/><m:sup><m:r><m:t>14</m:t></m:r></m:sup><m:e><m:r><m:t>C</m:t></m:r></m:e></m:sPre>'
    )
    expect(fixOmmlPrescripts('<m:oMath><m:f><m:num>' + HE.slice(9, -10) + '</m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>')).toContain('<m:num><m:sPre>')
    // 带命名空间声明的（预览时要解析）：声明保留，可以转为预览用的公式
    const declared = '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' + HE.slice(9)
    const fixed = fixOmmlPrescripts(declared)
    expect(fixed).toContain('<m:sPre>')
    expect(fixed).toContain('xmlns:m=')
    const { ommlToMathml } = await import('@core/math/omml-to-mathml')
    expect(ommlToMathml(fixed).mathml).toMatch(/He/)
  })

  it('普通上下标、末尾单独的空底数上下标不变；没有上下标的公式原样返回', () => {
    const normal = '<m:oMath><m:sSub><m:e><m:r><m:t>v</m:t></m:r></m:e><m:sub><m:r><m:t>0</m:t></m:r></m:sub></m:sSub></m:oMath>'
    expect(fixOmmlPrescripts(normal)).toBe(normal)
    const tail = '<m:oMath><m:r><m:t>x</m:t></m:r><m:sSup><m:e/><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>'
    expect(fixOmmlPrescripts(tail)).toBe(tail)
    expect(fixOmmlPrescripts('<m:oMath><m:r><m:t>a</m:t></m:r></m:oMath>')).toBe('<m:oMath><m:r><m:t>a</m:t></m:r></m:oMath>')
  })
})

describe('公式字母正体：已有空的 <m:rPr/> 时不再重复添加', () => {
  it('一个 m:r 中只有一个 m:rPr', () => {
    const out = uprightOmml('<m:oMath><m:r><m:rPr/><m:t>x</m:t></m:r></m:oMath>')
    expect(out).toBe('<m:oMath><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>x</m:t></m:r></m:oMath>')
  })
})
