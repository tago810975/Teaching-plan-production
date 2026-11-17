import { describe, expect, it } from 'vitest'
import { latexToOmml } from '@core/math/mathml-to-omml'

const clean = (s: string): string => s.replace(/ xmlns:m="[^"]*"/g, '').replace(/<m:rPr>.*?<\/m:rPr>/g, '').replace(/ xml:space="preserve"/g, '')
const t = (s: string): string => `<m:r><m:t>${s}</m:t></m:r>`

describe('左上下标（核素写法）导出为 Word 的 m:sPre', () => {
  it('_{2}^{4}\\text{He}：上下标在 He 左边，没有空的底数', () => {
    const o = clean(latexToOmml('_{2}^{4}\\text{He}'))
    expect(o).toBe(`<m:oMath><m:sPre><m:sub>${t('2')}</m:sub><m:sup>${t('4')}</m:sup><m:e>${t('He')}</m:e></m:sPre></m:oMath>`)
    expect(o).not.toContain('<m:e></m:e>')
  })

  it('{}^{4}_{2}、负数下标、一个式子里的两个核素', () => {
    expect(clean(latexToOmml('{}_{2}^{4}\\mathrm{He}'))).toContain(`<m:sPre><m:sub>${t('2')}</m:sub><m:sup>${t('4')}</m:sup><m:e>`)
    expect(clean(latexToOmml('_{-1}^{0}e'))).toContain(`<m:sPre><m:sub>${t('−')}${t('1')}</m:sub><m:sup>${t('0')}</m:sup><m:e>${t('e')}</m:e></m:sPre>`)
    const two = clean(latexToOmml('^{235}_{92}\\mathrm{U}+{}_{0}^{1}n'))
    expect(two.match(/<m:sPre>/g)).toHaveLength(2)
    expect(two).not.toContain('<m:sSubSup>')
  })

  it('只有左上标或左下标', () => {
    expect(clean(latexToOmml('{}^{14}\\mathrm{C}'))).toContain(`<m:sPre><m:sub></m:sub><m:sup>${t('14')}</m:sup><m:e>`)
    expect(clean(latexToOmml('{}_{6}\\mathrm{C}'))).toContain(`<m:sPre><m:sub>${t('6')}</m:sub><m:sup></m:sup><m:e>`)
  })

  it('\\prescript（mmultiscripts）也转为 m:sPre', () => {
    const o = clean(latexToOmml('\\prescript{4}{2}{\\mathrm{He}}'))
    expect(o).toContain(`<m:sPre><m:sub>${t('2')}</m:sub><m:sup>${t('4')}</m:sup><m:e>`)
  })

  it('普通的上下标不受影响；末尾单独的空底数上下标保持原样', () => {
    expect(clean(latexToOmml('v_0^2'))).toBe(`<m:oMath><m:sSubSup><m:e>${t('v')}</m:e><m:sub>${t('0')}</m:sub><m:sup>${t('2')}</m:sup></m:sSubSup></m:oMath>`)
    expect(clean(latexToOmml('x+{}^{2}'))).toContain('<m:sSup>')
  })
})
