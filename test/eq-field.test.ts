import { describe, expect, it } from 'vitest'
import { eqFieldToLatex, isEqField } from '@core/import/eq-field'

describe('EQ 域公式', () => {
  it.each([
    ['eq \\f(mv,qB)', '\\frac{mv}{qB}'],
    ['EQ \\F(2πr,v)', '\\frac{2\\pi r}{v}'],
    ['eq \\r(3)', '\\sqrt{3}'],
    ['eq \\r(3,x)', '\\sqrt[3]{x}'],
    ['eq \\o\\al(2,1)', '{}^{2}_{1}'],
    ['eq \\s\\up6(2)', '{}^{2}'],
    ['eq \\b\\lc\\{(\\a\\al\\co1(x=1,y=2))', '\\left\\{\\begin{array}{l}x=1\\\\y=2\\end{array}\\right.'],
    ['eq \\f(\\r(3),2)', '\\frac{\\sqrt{3}}{2}']
  ])('%s → %s', (instr, latex) => {
    expect(isEqField(instr)).toBe(true)
    expect(eqFieldToLatex(instr)).toBe(latex)
  })

  it('不是 EQ 域', () => {
    expect(isEqField(' INCLUDEPICTURE "a.png"')).toBe(false)
  })

  it('无法识别时返回 null', () => {
    expect(eqFieldToLatex('eq \\zz(1)')).toBeNull()
    expect(eqFieldToLatex('eq \\f(1,2')).toBeNull()
  })
})
