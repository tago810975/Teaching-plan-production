import { describe, expect, it } from 'vitest'
import { REDRAW_GUIDE, redrawSizes, validateSvg } from '@core/import/svg-redraw'

const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect x="10" y="10" width="40" height="200" fill="none" stroke="#000" stroke-width="4"/><text x="300" y="50" font-style="italic">a</text></svg>'

describe('AI 重绘的 SVG：检查与净化', () => {
  it('合法的 SVG 通过；按 viewBox 补上宽高；返回宽高比', () => {
    const r = validateSvg(GOOD)
    expect(r.ok).toBe(true)
    expect(r.aspect).toBe(1.5)
    expect(r.svg).toMatch(/width="600"/)
    expect(r.issues).toEqual([])
  })

  it('去掉代码块围栏与 SVG 前后的说明文字', () => {
    expect(validateSvg('好的，下面是图1：\n```svg\n' + GOOD + '\n```\n以上').ok).toBe(true)
  })

  it('去掉脚本、外部图片、事件属性与外部链接，并提示', () => {
    const bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><script>alert(1)</script><image href="http://x/a.png"/><a href="http://x"><rect width="5" height="5"/></a><circle cx="5" cy="5" r="3" onclick="x()" fill="url(http://x/p)"/><use href="#c"/></svg>'
    const r = validateSvg(bad)
    expect(r.ok).toBe(true)
    expect(r.svg).not.toMatch(/script|onload|onclick|http:\/\/x|<image|<a /)
    expect(r.svg).toContain('href="#c"')
    expect(r.issues[0]).toMatch(/<script>.*<image>|<image>.*<script>/)
  })

  it('不合格：不是 SVG、XML 错误、缺 viewBox、没有图形', () => {
    expect(validateSvg('我画不出来').issues[0]).toMatch(/没有找到完整的/)
    expect(validateSvg('<svg viewBox="0 0 10 10"><rect></svg>').issues[0]).toMatch(/不是合法的 XML/)
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>').issues[0]).toMatch(/缺少 viewBox/)
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g/></svg>').issues[0]).toMatch(/没有任何图形/)
    // 只有宽高也行：补上 viewBox
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><line x1="0" y1="0" x2="1" y2="1"/></svg>').aspect).toBe(1.5)
  })

  it('提示词：忠实还原放在第一位，配色与示例一致', () => {
    expect(REDRAW_GUIDE).toMatch(/第一要求是忠实还原/)
    for (const c of ['#000000', '#E95283', '#0599D9']) expect(REDRAW_GUIDE).toContain(c)
  })
})

describe('重绘的字号与线宽按原图换算', () => {
  it('小图（177 像素宽、字高 16）：字号 54，线宽约为字高的 1/8；大图字号小', () => {
    expect(redrawSizes(177, 16)).toEqual({ fontSize: 54, stroke: 7, thin: 4.5 })
    expect(redrawSizes(600, 16).fontSize).toBe(20)
    expect(redrawSizes(40, 16).fontSize).toBe(90)
  })
})
