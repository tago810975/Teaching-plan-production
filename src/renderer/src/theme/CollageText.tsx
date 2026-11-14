/**
 * 拼贴字：把一段短标题拆成一个个字，每个字带一组固定的“剪报”样式编号（底色、字体、角度、大小）。
 * “赤黑”主题把这些编号画成剪报拼贴；“月潮”让每个字依次从水中浮起、轻轻漂动；其他主题下看起来就是普通文字。
 * 样式由文字内容算出，同一个标题每次显示都一样，不会每次刷新都乱跳。
 * 读屏读的是隐藏的整段文字，拆开的字对读屏隐藏。
 */
const VARIANTS = 7

function hash(s: string, i: number): number {
  let h = 2166136261 ^ i
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619)
  h = Math.imul(h ^ (i * 374761393), 668265263)
  return (h ^ (h >>> 15)) >>> 0
}

export function CollageText({ text }: { text: string }) {
  const chars = Array.from(text)
  let prev = -1
  return (
    <span className="collage">
      <span className="collage-sr">{text}</span>
      <span className="collage-chars" aria-hidden="true">
        {chars.map((c, i) => {
          if (c.trim() === '') return <span key={i} className="collage-gap" />
          const h = hash(text + c, i)
          // 相邻两个字不用同一种剪报
          let v = h % VARIANTS
          if (v === prev) v = (v + 1 + ((h >>> 3) % (VARIANTS - 1))) % VARIANTS
          prev = v
          const rot = ((h >>> 8) % 15) - 7 // −7° ~ 7°
          const scale = 0.92 + ((h >>> 12) % 26) / 100 // 0.92 ~ 1.17
          const dy = ((h >>> 18) % 7) - 3 // −3 ~ 3px
          const font = (h >>> 22) % 3
          return (
            <span
              key={i}
              className="collage-char"
              data-v={v}
              data-f={font}
              style={{ '--r': `${rot}deg`, '--s': scale, '--dy': `${dy}px`, '--i': i } as React.CSSProperties}
            >
              {c}
            </span>
          )
        })}
      </span>
    </span>
  )
}
