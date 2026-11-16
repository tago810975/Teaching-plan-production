import { describe, expect, it } from 'vitest'
import { cleanBackground, enhanceFigure, MAX_UPSCALE_PIXELS } from '@core/image/enhance'
import { fsrcnnY } from '@core/image/fsrcnn'
import { readPng } from './helpers/png'

const DIR = 'test/fixtures/figure-enhance'

describe('FSRCNN ×3（TypeScript 实现）', () => {
  it('与 OpenCV dnn_superres 的输出逐像素一致（第 16 题插图的亮度通道）', () => {
    const src = readPng(`${DIR}/第16题.png`)
    const ref = readPng(`${DIR}/第16题-FSRCNN亮度-OpenCV.png`)
    const n = src.width * src.height
    const y = new Float32Array(n)
    for (let i = 0; i < n; i++) y[i] = Math.round(0.299 * src.data[i * 4]! + 0.587 * src.data[i * 4 + 1]! + 0.114 * src.data[i * 4 + 2]!) / 255
    const t0 = performance.now()
    const out = fsrcnnY(y, src.width, src.height)
    const ms = performance.now() - t0
    expect([ref.width, ref.height]).toEqual([src.width * 3, src.height * 3])
    let sum = 0
    let max = 0
    for (let i = 0; i < out.length; i++) {
      const d = Math.abs(Math.round(out[i]! * 255) - ref.data[i * 4]!)
      sum += d
      max = Math.max(max, d)
    }
    expect(sum / out.length).toBeLessThan(0.3)
    expect(max).toBeLessThanOrEqual(6)
    expect(ms).toBeLessThan(5000)
  }, 20000)
})

describe('清理纸张底色', () => {
  // 灰色纸张（200）上：深色填充块（90）与一条细线（40）
  const W = 120
  const H = 100
  const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H }
  for (let i = 0; i < W * H; i++) img.data.set([200, 200, 196, 255], i * 4)
  for (let y = 20; y < 70; y++) for (let x = 15; x < 55; x++) img.data.set([90, 88, 95, 255], (y * W + x) * 4)
  for (let x = 60; x < 110; x++) img.data.set([40, 40, 40, 255], (50 * W + x) * 4)
  const px = (p: { data: ArrayLike<number>; width: number }, x: number, y: number): number => p.data[(y * p.width + x) * 4]!

  it('纸色变为纯白；大块深色填充保留（不被当成底色提亮）；细线加深', () => {
    const c = cleanBackground(img)
    expect(px(c, 100, 90)).toBe(255)
    expect(px(c, 35, 45)).toBeLessThan(140)
    expect(px(c, 80, 50)).toBeLessThan(45)
  })

  it('小图放大 3 倍；大图只清理不放大', () => {
    const e = enhanceFigure(img)
    expect([e.width, e.height]).toEqual([W * 3, H * 3])
    expect(px(e, 300, 270)).toBeGreaterThan(245)
    const side = Math.ceil(Math.sqrt(MAX_UPSCALE_PIXELS)) + 10
    const big = { data: new Uint8ClampedArray(side * side * 4).fill(230), width: side, height: side }
    const eb = enhanceFigure(big)
    expect([eb.width, eb.height]).toEqual([side, side])
  }, 20000)
})
