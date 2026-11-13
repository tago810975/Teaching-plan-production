/**
 * 切换标签页（首页 ↔ 教学案、教学案之间）时的过场，只在“赤黑”主题下出现；
 * 其他主题只有内容淡入（纯 CSS，见 app.css）。
 *
 * 过程：幕布从左上方斜着落下，盖住旧页面；盖严之后旧页面换成新页面；幕布再向右滑开。
 * 标签页一切换 React 就把旧页面换掉了，所以在换掉之前先给旧页面拍一张“快照”（复制一份 DOM），
 * 盖在新页面上面，等幕布盖严了再撤掉。
 *
 * 快照要在旧页面被移除之前拍：靠的是布局副作用的清理函数——本组件排在内容区之前，
 * React 提交更新时会先执行它的清理函数，再移除后面的旧内容。万一时机不对（拍到的已是新页面），
 * 效果只是退化成“幕布盖住新页面再滑开”，不会出错。
 */
import { useLayoutEffect, useRef } from 'react'

/** 与 app.css 中 noir-curtain 的时长一致 */
const TOTAL_MS = 640
/** 需要保留滚动位置的区域 */
const SCROLLERS = ['.preview', '.outline-list', '.inspector-body', '.home-main', '.home-side']

function enabled(): boolean {
  const root = document.documentElement
  if (root.dataset['theme'] !== 'noir') return false
  if (root.dataset['reduceMotion'] === 'true') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Shot {
  node: HTMLElement
  scrolls: Array<[selector: string, top: number]>
}

function takeShot(): Shot | null {
  const src = document.querySelector<HTMLElement>('.app-shell-body > .app, .app-shell-body > .home')
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
    const curtain = document.createElement('span')
    curtain.className = 'tab-wipe-curtain'
    wipe.append(curtain)
    body.append(wipe)
    // 滚动位置要等快照进了页面才能设
    taken?.scrolls.forEach(([sel, top]) => {
      const el = wipe.querySelector(sel)
      if (el !== null) el.scrollTop = top
    })
    const t = window.setTimeout(() => wipe.remove(), TOTAL_MS + 60)
    return () => {
      window.clearTimeout(t)
      wipe.remove()
    }
  }, [activeKey])

  return null
}
