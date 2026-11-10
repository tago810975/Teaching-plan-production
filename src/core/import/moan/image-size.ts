/**
 * 从图片文件头读取像素尺寸与类型（PNG、JPEG、GIF、WebP），用于下载的网络图片换算显示尺寸。
 */

export interface ImageInfo {
  mime: string
  width: number
  height: number
}

export function readImageInfo(b: Uint8Array): ImageInfo | null {
  const u16 = (i: number): number => (b[i]! << 8) | b[i + 1]!
  const u16le = (i: number): number => b[i]! | (b[i + 1]! << 8)
  const u24le = (i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)
  const u32 = (i: number): number => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!
  const ascii = (i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n))

  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return { mime: 'image/png', width: u32(16), height: u32(20) }
  if (b.length >= 10 && ascii(0, 3) === 'GIF') return { mime: 'image/gif', width: u16le(6), height: u16le(8) }
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4)
    if (kind === 'VP8X') return { mime: 'image/webp', width: u24le(24) + 1, height: u24le(27) + 1 }
    if (kind === 'VP8L') {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8 ') return { mime: 'image/webp', width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]!
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const len = u16(i + 2)
      // SOF0～SOF15（不含 DHT C4、JPG C8、DAC CC）
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', width: u16(i + 7), height: u16(i + 5) }
      }
      i += 2 + len
    }
    return null
  }
  return null
}
