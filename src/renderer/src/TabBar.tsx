/**
 * 顶部标签栏（参照 WPS）：首页 + 每个打开的教学案一个标签页，＋ 新建。
 * 点击切换；× 或鼠标中键关闭；拖动调整顺序；未保存的标签页名称前有圆点。
 * 键盘：Ctrl+Tab / Ctrl+Shift+Tab 切换，Ctrl+W 关闭当前标签页。
 */
import { useRef, useState } from 'react'
import type { Tab } from './state/workspace'

export interface BackgroundTaskPill {
  id: string
  label: string
  tone: 'waiting' | 'ready' | 'idle'
  title: string
  cancelLabel: string
  onRestore: () => void
  onCancel: () => void
}

interface Props {
  tabs: Tab[]
  active: string | null
  onActivate: (id: string | null) => void
  onClose: (id: string) => void
  onMove: (id: string, toIndex: number) => void
  onNew: () => void
  /** 收起到后台的 AI 任务胶囊（图片导入、插图重绘） */
  backgroundTasks?: BackgroundTaskPill[]
}

export function TabBar({ tabs, active, onActivate, onClose, onMove, onNew, backgroundTasks = [] }: Props) {
  const dragging = useRef<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  return (
    <div className="tabbar" role="tablist" aria-label="打开的教学案">
      <button
        type="button"
        role="tab"
        aria-selected={active === null}
        className={active === null ? 'tab tab--home is-active' : 'tab tab--home'}
        onClick={() => onActivate(null)}
        title="首页"
      >
        <span className="tab-icon" aria-hidden="true">
          ⌂
        </span>
        首页
      </button>
      {tabs.map((t, i) => {
        const title = t.state.bundle.project.meta.title || '未命名教学案'
        const tip = `${title}${t.state.dirty ? '（未保存）' : ''}\n${t.state.filePath ?? '示例，尚未保存为文件'}`
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            tabIndex={0}
            className={[
              'tab',
              active === t.id ? 'is-active' : '',
              dropAt === i ? 'drop-before' : '',
              dropAt === i + 1 && i === tabs.length - 1 ? 'drop-after' : ''
            ].join(' ')}
            title={tip}
            draggable
            onClick={() => onActivate(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onActivate(t.id)
              }
            }}
            onAuxClick={(e) => {
              // 鼠标中键关闭
              if (e.button === 1) {
                e.preventDefault()
                onClose(t.id)
              }
            }}
            onDragStart={(e) => {
              dragging.current = t.id
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (dragging.current === null) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = dragging.current
              if (id !== null && dropAt !== null) {
                const from = tabs.findIndex((x) => x.id === id)
                onMove(id, from < dropAt ? dropAt - 1 : dropAt)
              }
              dragging.current = null
              setDropAt(null)
            }}
            onDragEnd={() => {
              dragging.current = null
              setDropAt(null)
            }}
          >
            <span className="tab-icon tab-icon--doc" aria-hidden="true">
              案
            </span>
            <span className="tab-title">
              {t.state.dirty && (
                <span className="tab-dirty" aria-label="未保存">
                  ●{' '}
                </span>
              )}
              {title}
            </span>
            <button
              type="button"
              className="tab-close"
              aria-label={`关闭“${title}”`}
              title="关闭（Ctrl+W）"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button type="button" className="tab-new" onClick={onNew} title="新建教学案（Ctrl+N）" aria-label="新建教学案">
        ＋
      </button>
      {backgroundTasks.length > 0 && (
        <div className="tabbar-wb-pills">
          {backgroundTasks.map((task) => (
            <div key={task.id} className={`tabbar-wb-pill is-${task.tone}`} title={task.title}>
              <button type="button" className="tabbar-wb-main" onClick={task.onRestore}>
                <span className="tabbar-wb-dot" aria-hidden="true" />
                <span>{task.label}</span>
              </button>
              <button
                type="button"
                className="tabbar-wb-close"
                aria-label={task.cancelLabel}
                title={task.cancelLabel}
                onClick={(e) => {
                  e.stopPropagation()
                  task.onCancel()
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
