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

describe('去白底', async () => {
  const { whiteToAlpha } = await import('@core/image/transparent')
  const px = (p: { data: ArrayLike<number>; width: number }, x: number, y: number): number[] => [0, 1, 2, 3].map((k) => p.data[(y * p.width + x) * 4 + k]!)

  it('白色透明；黑色与彩色不透明、颜色不变；边缘的浅灰变为半透明（叠在白底上不变）', () => {
    const img = { data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 233, 82, 131, 255, 160, 160, 160, 255]), width: 4, height: 1 }
    const r = whiteToAlpha(img)
    expect(px(r, 0, 0)[3]).toBe(0)
    expect(px(r, 1, 0)).toEqual([0, 0, 0, 255])
    const red = px(r, 2, 0)
    expect(red[3]).toBe(255)
    expect(red.slice(0, 3)).toEqual([233, 82, 131])
    const gray = px(r, 3, 0)
    expect(gray[3]).toBeGreaterThan(0)
    expect(gray[3]).toBeLessThan(255)
    const onWhite = 255 - ((255 - gray[0]!) * gray[3]!) / 255
    expect(Math.abs(onWhite - 160)).toBeLessThan(2)
  })

  it('enhanceFigure：只去白底（不做其他处理）；变清晰 + 去白底', () => {
    const img = { data: new Uint8ClampedArray(30 * 20 * 4).fill(255), width: 30, height: 20 }
    for (let x = 2; x < 28; x++) img.data.set([0, 0, 0, 255], (10 * 30 + x) * 4)
    const only = enhanceFigure(img, 'none', { transparent: true })
    expect([only.width, only.height]).toEqual([30, 20])
    expect(px(only, 15, 2)[3]).toBe(0)
    expect(px(only, 15, 10)).toEqual([0, 0, 0, 255])
    const both = enhanceFigure(img, 'normal', { transparent: true })
    expect(both.width).toBe(90)
    expect(px(both, 45, 4)[3]).toBe(0)
    expect(px(both, 45, 31)[3]).toBeGreaterThan(200)
  })
})

describe('扫描件发灰：一键加深与手动调整', async () => {
  const { autoLevels, adjustPixels, NO_ADJUST } = await import('@core/image/adjust')
  const lums = (p: { data: ArrayLike<number>; width: number; height: number }): number[] => {
    const out: number[] = []
    for (let i = 0; i < p.width * p.height; i++) if (p.data[i * 4 + 3]! > 0) out.push((p.data[i * 4]! + p.data[i * 4 + 1]! + p.data[i * 4 + 2]!) / 3)
    return out.sort((a, b) => a - b)
  }

  // 线条（非纸色）像素亮度的 q 分位
  const inkP = (p: { data: ArrayLike<number>; width: number; height: number }, q: number): number => {
    const ink = lums(p).filter((v) => v < 235)
    return ink[Math.floor(ink.length * q)]!
  }

  it('一键加深（用户的扫描图）：最深的线条由灰（约 110）变为接近黑；线条整体明显加深；纸张仍为白', () => {
    const src = readPng(`${DIR}/发灰的正弦图像.png`)
    const out = autoLevels(src)
    expect(inkP(src, 0.01)).toBeGreaterThan(100)
    expect(inkP(out, 0.01)).toBeLessThan(35)
    expect(inkP(out, 0.3)).toBeLessThan(inkP(src, 0.3) - 40)
    const all = lums(out)
    expect(all[Math.floor(all.length * 0.9)]).toBeGreaterThan(250)
  })

  it('一键加深：彩色色相不变（红仍是红，更鲜明）；透明通道不变；全白的图不变', () => {
    const img = { data: new Uint8ClampedArray([255, 255, 255, 255, 120, 120, 120, 255, 233, 140, 160, 255, 200, 200, 200, 0]), width: 4, height: 1 }
    const r = autoLevels(img)
    expect(r.data[4]).toBeLessThan(40)
    expect(r.data[8]! > r.data[9]! && r.data[8]! > r.data[10]!).toBe(true)
    expect(r.data[8]! - r.data[9]!).toBeGreaterThan(233 - 140)
    expect(r.data[15]).toBe(0)
    const white = { data: new Uint8ClampedArray(16).fill(255), width: 4, height: 1 }
    expect(autoLevels(white)).toBe(white)
  })

  it('手动调整：亮度、对比度、饱和度（0 为黑白）；不调整时原样返回', () => {
    const img = { data: new Uint8ClampedArray([200, 100, 50, 255, 128, 128, 128, 255]), width: 2, height: 1 }
    expect(adjustPixels(img, NO_ADJUST)).toBe(img)
    const bright = adjustPixels(img, { brightness: 20, contrast: 0, saturation: 100 })
    expect(bright.data[4]).toBe(179)
    const contrast = adjustPixels(img, { brightness: 0, contrast: 50, saturation: 100 })
    expect(contrast.data[0]).toBeGreaterThan(200)
    expect(contrast.data[4]).toBe(128)
    const gray = adjustPixels(img, { brightness: 0, contrast: 0, saturation: 0 })
    expect(gray.data[0]).toBe(gray.data[1])
    expect(gray.data[1]).toBe(gray.data[2])
  })

  it('enhanceFigure：一键加深在清理、放大之前', () => {
    const src = readPng(`${DIR}/发灰的正弦图像.png`)
    const r = enhanceFigure(src, 'none', { autoLevels: true })
    expect([r.width, r.height]).toEqual([src.width, src.height])
    expect(inkP(r, 0.01)).toBeLessThan(35)
  })
})
