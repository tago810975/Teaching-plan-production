/**
 * 切换标签页（首页 ↔ 教学案、教学案之间）时的过场，只在“赤黑”“月潮”主题下出现；
 * 其他主题只有内容淡入（纯 CSS，见 app.css）。
 *
 * 赤黑：一道斜幕布从左上扫到右下，幕布前面是旧页面，后面是新页面。
 * 月潮：旧页面向后仰倒沉入水中，水面漫过、气泡上升，新页面从水中浮现。
 * 标签页一切换 React 就把旧页面换掉了，所以在换掉之前先给旧页面拍一张“快照”（复制一份 DOM），
 * 盖在新页面上面，随幕布前缘一起裁掉（裁切动画在 app.css）。
 *
 * 快照要在旧页面被移除之前拍：靠的是布局副作用的清理函数——本组件排在内容区之前，
 * React 提交更新时会先执行它的清理函数，再移除后面的旧内容。万一时机不对（拍到的已是新页面），
 * 效果只是退化成“幕布盖住新页面再滑开”，不会出错。
 */
import { useLayoutEffect, useRef } from 'react'

/** 各主题过场的总时长，与 app.css 中的动画时长一致 */
const TOTAL_MS: Record<string, number> = { noir: 720, tide: 1000 }
/** 月潮：沉入水中时升起的气泡（横向位置 %、大小 px、延迟 ms） */
const BUBBLES: ReadonlyArray<[number, number, number]> = [
  [12, 10, 80],
  [24, 6, 220],
  [37, 14, 0],
  [51, 8, 300],
  [63, 12, 140],
  [74, 5, 360],
  [86, 9, 60],
  [93, 7, 260]
]
/** 需要保留滚动位置的区域 */
const SCROLLERS = ['.preview', '.outline-list', '.inspector-body', '.home-main', '.home-side']

function enabled(): boolean {
  const root = document.documentElement
  // 带页面切换幕布的风格主题
  if (root.dataset['theme'] !== 'noir' && root.dataset['theme'] !== 'tide') return false
  if (root.dataset['reduceMotion'] === 'true') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Shot {
  node: HTMLElement
  scrolls: Array<[selector: string, top: number]>
}

function takeShot(): Shot | null {
  // 后台标签页的编辑器也在（隐藏着），只拍当前显示的
  const src = document.querySelector<HTMLElement>('.app-shell-body > .app:not(.is-inactive), .app-shell-body > .home')
  if (src === null) return null
  const node = src.cloneNode(true) as HTMLElement
  // 快照只用来看：去掉对话框与浮动卡片，避免重复的弹层
  node.querySelectorAll('dialog, .export-toast, .context-menu, .quick-menu, .selection-toolbar').forEach((el) => el.remove())
  const scrolls = SCROLLERS.flatMap((sel): Array<[string, number]> => {
    const el = src.querySelector(sel)
    return el !== null && el.scrollTop > 0 ? [[sel, el.scrollTop]] : []
  })
  return { node, scrolls }
}

export function TabTransition({ activeKey }: { activeKey: string }) {
  const shot = useRef<Shot | null>(null)
  const prevKey = useRef(activeKey)

  // 清理函数在标签页切换的那次提交中、旧内容被移除之前执行：拍快照
  useLayoutEffect(
    () => () => {
      shot.current = enabled() ? takeShot() : null
    },
    [activeKey]
  )

  useLayoutEffect(() => {
    const taken = shot.current
    shot.current = null
    if (prevKey.current === activeKey) return
    prevKey.current = activeKey
    const body = document.querySelector<HTMLElement>('.app-shell-body')
    if (body === null || !enabled()) return

    body.querySelectorAll(':scope > .tab-wipe').forEach((el) => el.remove())
    const wipe = document.createElement('div')
    wipe.className = 'tab-wipe'
    wipe.setAttribute('aria-hidden', 'true')
    wipe.inert = true
    if (taken !== null) {
      const old = document.createElement('div')
      old.className = 'tab-wipe-old'
      old.append(taken.node)
      wipe.append(old)
    }
    const theme = document.documentElement.dataset['theme'] ?? ''
    if (theme === 'tide') {
      // 月潮：旧页面向后仰倒、沉入水中；水面从下往上漫过，气泡上升，再从水中浮现新页面
      const water = document.createElement('span')
      water.className = 'tab-wipe-water'
      wipe.append(water)
      const rays = document.createElement('span')
      rays.className = 'tab-wipe-rays'
      wipe.append(rays)
      for (const [x, size, delay] of BUBBLES) {
        const b = document.createElement('span')
        b.className = 'tab-wipe-bubble'
        b.style.setProperty('--x', `${x}%`)
        b.style.setProperty('--size', `${size}px`)
        b.style.setProperty('--delay', `${delay}ms`)
        wipe.append(b)
      }
    } else {
      const curtain = document.createElement('span')
      curtain.className = 'tab-wipe-curtain'
      wipe.append(curtain)
    }
    body.append(wipe)
    // 滚动位置要等快照进了页面才能设
    taken?.scrolls.forEach(([sel, top]) => {
      const el = wipe.querySelector(sel)
      if (el !== null) el.scrollTop = top
    })
    const t = window.setTimeout(() => wipe.remove(), (TOTAL_MS[theme] ?? 720) + 60)
    return () => {
      window.clearTimeout(t)
      wipe.remove()
    }
  }, [activeKey])

  return null
}
