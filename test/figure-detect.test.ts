import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectFigures, snapBox, snapToFigure, trimBottomLabel, type Box } from '@core/import/figure-detect'
import { readPng } from './helpers/png'

const DIR = 'test/fixtures/figure-detect'
const expected = JSON.parse(readFileSync(`${DIR}/expected.json`, 'utf8')) as Record<string, { textHeight: number; boxes: number[][] }>
const iou = (a: Box, b: Box): number => {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  return inter / (a.w * a.h + b.w * b.h - inter)
}

describe('插图自动检测（用户提供的常用题目图片；预期结果来自 tools/figure-detect-prototype.py）', () => {
  for (const [name, exp] of Object.entries(expected)) {
    it(`${name}：${exp.boxes.length} 张插图，位置与原型一致`, () => {
      const r = detectFigures(readPng(`${DIR}/${name}.png`))
      expect(r.textHeight).toBeCloseTo(exp.textHeight, 0)
      expect(r.boxes).toHaveLength(exp.boxes.length)
      r.boxes.forEach((b, k) => {
        const [x, y, w, h] = exp.boxes[k]!
        expect(iou(b, { x: x!, y: y!, w: w!, h: h! })).toBeGreaterThan(0.9)
      })
    }, 30000)
  }
})

describe('收紧与去掉选项字母', () => {
  // 白底上画：一个 40×30 的方框（图），下方隔 8 像素一个 8×10 的小块（字母“A.”）
  const W = 120
  const H = 100
  const img = { data: new Uint8Array(W * H * 4).fill(255), width: W, height: H }
  const dot = (x: number, y: number): void => {
    img.data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3)
  }
  for (let x = 30; x < 70; x++) {
    dot(x, 20)
    dot(x, 49)
  }
  for (let y = 20; y < 50; y++) {
    dot(30, y)
    dot(69, y)
  }
  for (let y = 58; y < 68; y++) for (let x = 46; x < 54; x++) dot(x, y)

  it('随手拖的大框收紧到墨迹边缘', () => {
    expect(snapBox(img, { x: 5, y: 5, w: 100, h: 90 }, 0)).toEqual({ x: 30, y: 20, w: 40, h: 48 })
  })

  it('选项图去掉底部单独的字母；底部不是单独小块时不变', () => {
    const b = trimBottomLabel(img, { x: 30, y: 20, w: 40, h: 48 }, 10)
    expect(b.y + b.h).toBeLessThanOrEqual(52)
    expect(b.y + b.h).toBeGreaterThanOrEqual(50)
    expect(trimBottomLabel(img, { x: 30, y: 20, w: 40, h: 30 }, 10)).toEqual({ x: 30, y: 20, w: 40, h: 30 })
  })
})

describe('随手拖的框收紧到插图（不含框进来的图注、文字）', () => {
  it('练习册：各种拖法（比图大一圈、切过图注、包住图注）收紧后都与自动找到的框一致', () => {
    const img = readPng(`${DIR}/练习册-查漏补缺.png`)
    const r = detectFigures(img)
    for (const k of [0, 4, 5]) {
      const fig = r.boxes[k]!
      for (const [dx, dt, db] of [[30, 15, 8], [30, 15, 18], [30, 15, 28], [40, 25, 45], [10, 5, 5]] as const) {
        const snapped = snapToFigure(img, { x: fig.x - dx, y: fig.y - dt, w: fig.w + 2 * dx, h: fig.h + dt + db }, r.pieces, 0)
        expect(iou(snapped, fig)).toBeGreaterThan(0.9)
      }
    }
  }, 30000)

  it('框住的是文字（没有插图候选块）时收紧到墨迹边缘', () => {
    const img = readPng(`${DIR}/练习册-查漏补缺.png`)
    const r = detectFigures(img)
    const s = snapToFigure(img, { x: 40, y: 0, w: 300, h: 30 }, r.pieces, 0)
    expect(s.h).toBeLessThanOrEqual(30)
  }, 30000)
})
