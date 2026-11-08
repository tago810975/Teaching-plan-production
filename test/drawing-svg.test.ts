import { describe, expect, it } from 'vitest'
import { drawingToSvg, isPlainTextBox, isShapeDrawing } from '@core/import/drawing-svg'
import { parseXml, type Element } from '@core/xml/dom'

const NSDECL =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ' +
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

const gd = (inner: string): Element => parseXml(`<a:graphicData ${NSDECL}>${inner}</a:graphicData>`).documentElement as Element

const wsp = (spPr: string, extra = ''): string => `<wps:wsp><wps:spPr>${spPr}</wps:spPr>${extra}</wps:wsp>`
const xfrm = (x: number, y: number, cx: number, cy: number, attrs = ''): string =>
  `<a:xfrm${attrs}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
const line = '<a:ln w="9525"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>'

describe('形状示意图 → SVG', () => {
  it('带箭头的直线：红色描边并带线端箭头', () => {
    const svg = drawingToSvg(gd(wsp(`${xfrm(0, 0, 1000, 0)}<a:prstGeom prst="straightConnector1"/>${line}`)), 1000, 100, () => undefined)!
    expect(svg.svg).toContain('stroke="#FF0000"')
    expect(svg.svg).toMatch(/marker-end="url\(#m-triangle/)
    expect(svg.svg).toContain('<marker')
  })

  it('组合：子坐标映射到组合外框', () => {
    const group =
      `<wpg:wgp><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000" cy="2000"/><a:chOff x="100" y="100"/><a:chExt cx="1000" cy="1000"/></a:xfrm></wpg:grpSpPr>` +
      wsp(`${xfrm(100, 100, 500, 500)}<a:prstGeom prst="ellipse"/><a:noFill/>${line}`) +
      `</wpg:wgp>`
    const svg = drawingToSvg(gd(group), 2000, 2000, () => undefined)!.svg
    expect(svg).toContain('scale(2 2) translate(-100 -100)')
    expect(svg).toContain('<ellipse')
  })

  it('旋转与翻转', () => {
    const svg = drawingToSvg(gd(wsp(`${xfrm(0, 0, 100, 50, ' rot="5400000" flipH="1"')}<a:prstGeom prst="rect"/>${line}`)), 100, 50, () => undefined)!.svg
    expect(svg).toContain('rotate(90 50 25)')
    expect(svg).toContain('scale(-1 1)')
  })

  it('文本框标注：斜体与下标，字号以磅书写', () => {
    const txbx =
      '<wps:txbx><w:txbxContent><w:p><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t>B</w:t></w:r>' +
      '<w:r><w:rPr><w:vertAlign w:val="subscript"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:p></w:txbxContent></wps:txbx>'
    const svg = drawingToSvg(gd(wsp(`${xfrm(0, 0, 300000, 200000)}<a:prstGeom prst="rect"/>${line}`, txbx)), 300000, 200000, () => undefined)!.svg
    expect(svg).toContain('<tspan font-size="9" font-style="italic">B</tspan>')
    expect(svg).toMatch(/<tspan font-size="5\.85" baseline-shift="-1\.8">1<\/tspan>/)
    expect(svg).toContain('transform="scale(12700)"')
  })

  it('识别可渲染的形状；纯文本框与成段文字框按文字导入', () => {
    const shape = gd(wsp(`${xfrm(0, 0, 10, 10)}<a:prstGeom prst="rect"/>${line}`))
    expect(isShapeDrawing(shape)).toBe(true)
    expect(isPlainTextBox(shape)).toBe(false)
    const textFrame = gd(
      wsp(`${xfrm(0, 0, 10, 10)}<a:prstGeom prst="rect"/>${line}`, '<wps:txbx><w:txbxContent><w:p><w:r><w:t>这是一段很长的知识点说明文字内容</w:t></w:r></w:p></w:txbxContent></wps:txbx>')
    )
    expect(isPlainTextBox(textFrame)).toBe(true)
    const noBorder = gd(
      wsp(`${xfrm(0, 0, 10, 10)}<a:prstGeom prst="rect"/><a:noFill/><a:ln><a:noFill/></a:ln>`, '<wps:txbx><w:txbxContent><w:p><w:r><w:t>B</w:t></w:r></w:p></w:txbxContent></wps:txbx>')
    )
    expect(isPlainTextBox(noBorder)).toBe(true)
  })
})
