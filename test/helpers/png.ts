/** 测试用的 PNG 解码：8 位、非隔行的灰度 / RGB / RGBA（只用 Node 自带的 zlib） */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export function readPng(path: string): { data: Uint8Array; width: number; height: number } {
  const buf = readFileSync(path)
  let p = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const body = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[12] !== 0) throw new Error('只支持 8 位、非隔行的 PNG')
      colorType = body[9]!
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 0
  if (ch === 0) throw new Error(`不支持的颜色类型 ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * ch
  const pixels = new Uint8Array(width * height * ch)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? pixels[y * stride + x - ch]! : 0
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const c = x >= ch && y > 0 ? pixels[(y - 1) * stride + x - ch]! : 0
      let v = line[x]!
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      pixels[y * stride + x] = v & 255
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    if (ch === 1) data.set([pixels[i]!, pixels[i]!, pixels[i]!, 255], i * 4)
    else {
      data[i * 4] = pixels[i * ch]!
      data[i * 4 + 1] = pixels[i * ch + 1]!
      data[i * 4 + 2] = pixels[i * ch + 2]!
      data[i * 4 + 3] = ch === 4 ? pixels[i * ch + 3]! : 255
    }
  }
  return { data, width, height }
}
