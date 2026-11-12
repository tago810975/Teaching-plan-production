/**
 * 切换标签页（首页 ↔ 教学案、教学案之间）时的过场。
 * 内容本身的淡入由 CSS 完成（标签页切换时内容重新挂载）；这里只负责“赤黑”主题的斜切幕布：
 * 三层色块依次向右甩开，露出新的页面。其他主题下这一层不显示。
 */
import { useEffect, useRef, useState } from 'react'

const WIPE_MS = 520

export function TabTransition({ activeKey }: { activeKey: string }) {
  const [run, setRun] = useState(0)
  const prev = useRef(activeKey)

  useEffect(() => {
    // 只在标签页真的变了时播放（启动时不播放）
    if (prev.current === activeKey) return
    prev.current = activeKey
    setRun((n) => n + 1)
    const t = window.setTimeout(() => setRun(0), WIPE_MS)
    return () => window.clearTimeout(t)
  }, [activeKey])

  if (run === 0) return null
  return (
    <div key={run} className="tab-wipe" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}
