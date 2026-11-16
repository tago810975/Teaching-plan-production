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

describe('线稿模式', async () => {
  const { lineArt, fillRatio } = await import('@core/image/lineart')
  // 已放大 3 倍的图：白底上一条灰色细线（6 像素宽）、一个浅灰色实心圆（半径 30）、一条红线、一个 2×2 的噪点
  const W = 300
  const H = 200
  const img = { data: new Uint8ClampedArray(W * H * 4).fill(255), width: W, height: H }
  const set = (x: number, y: number, c: [number, number, number]): void => img.data.set([...c, 255], (y * W + x) * 4)
  for (let x = 10; x < 290; x++) for (let y = 20; y < 26; y++) set(x, y, [120, 120, 120])
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 80) ** 2 + (y - 120) ** 2 <= 30 * 30) set(x, y, [190, 190, 190])
  for (let x = 160; x < 280; x++) for (let y = 100; y < 106; y++) set(x, y, [233, 82, 131])
  for (let y = 170; y < 172; y++) for (let x = 250; x < 252; x++) set(x, y, [60, 60, 60])
  const px = (p: { data: ArrayLike<number>; width: number }, x: number, y: number): number[] => [0, 1, 2].map((k) => p.data[(y * p.width + x) * 4 + k]!)

  it('灰色细线压成纯黑；纸张纯白；成片的浅灰填充保持原样；红线保持红色；噪点去掉', () => {
    const r = lineArt(img, 3)
    expect(px(r, 150, 22).every((v) => v < 20)).toBe(true)
    expect(px(r, 150, 60)).toEqual([255, 255, 255])
    expect(px(r, 80, 120)).toEqual([190, 190, 190])
    const red = px(r, 220, 102)
    expect(red[0]! > 200 && red[1]! < 110 && red[2]! < 160).toBe(true)
    expect(px(r, 250, 170).every((v) => v > 240)).toBe(true)
  })

  it('填充比例：成片的中间调才算（线条边缘不算）', () => {
    expect(fillRatio(img)).toBeGreaterThan(0.5)
    const lines = { data: new Uint8ClampedArray(W * H * 4).fill(255), width: W, height: H }
    for (let x = 10; x < 290; x++) for (let y = 20; y < 22; y++) lines.data.set([150, 150, 150, 255], (y * W + x) * 4)
    expect(fillRatio(lines)).toBe(0)
  })

  it('enhanceFigure 的线稿方式：放大 3 倍后压成线稿', () => {
    const small = { data: new Uint8ClampedArray(60 * 40 * 4).fill(235), width: 60, height: 40 }
    for (let x = 5; x < 55; x++) small.data.set([110, 110, 110, 255], (20 * 60 + x) * 4)
    const r = enhanceFigure(small, 'lineart')
    expect([r.width, r.height]).toEqual([180, 120])
    expect(px(r, 90, 61).every((v) => v < 40)).toBe(true)
    expect(px(r, 90, 20)).toEqual([255, 255, 255])
  })
})
