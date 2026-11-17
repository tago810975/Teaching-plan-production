import { useEffect, useRef, useState } from 'react'
import type { ImportReport } from '@shared/ipc'

/** 自动关闭的时长（与导出完成提示一致） */
const NOTICE_MS = 8000
const FADE_MS = 180

/**
 * 导入完成提示（右下角的浮动卡片，与导出完成提示相同）：导入了多少题 / 知识点，以及需要留意的情况。
 * 没有需要留意的情况时 8 秒后自动淡出；有时不自动关闭，留给老师看完。鼠标停在提示上时暂停计时。
 */
export function ImportNotice({ report, onDismiss }: { report: ImportReport; onDismiss: () => void }) {
  // 没有文件（直接粘贴文字导入）时只说导入了什么
  const source = report.fileNames.length === 0 ? '' : report.fileNames.length === 1 ? `从“${report.fileNames[0]}”` : `从 ${report.fileNames.length} 个文件`
  const what = report.knowledgeCount !== undefined ? `${report.knowledgeCount} 个知识点` : `${report.questionCount} 道题`
  const [hold, setHold] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const sticky = report.warnings.length > 0

  // 又导入了一次：重新开始
  useEffect(() => setLeaving(false), [report])
  useEffect(() => {
    if (hold || sticky || leaving) return
    const t = window.setTimeout(() => setLeaving(true), NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [hold, sticky, leaving, report])
  useEffect(() => {
    if (!leaving) return
    const t = window.setTimeout(() => dismissRef.current(), FADE_MS)
    return () => window.clearTimeout(t)
  }, [leaving])

  return (
    <div
      className={leaving ? 'export-toast import-toast is-leaving' : 'export-toast import-toast'}
      role="status"
      onMouseEnter={() => {
        setHold(true)
        setLeaving(false)
      }}
      onMouseLeave={() => setHold(false)}
    >
      <div className="export-toast-head">
        <span className="export-toast-mark" aria-hidden="true" />
        <p className="export-toast-title">已{source}导入 {what}</p>
        <button type="button" className="export-toast-close" aria-label="关闭" title="关闭" onClick={onDismiss}>
          ×
        </button>
      </div>
      <p className="import-toast-hint">请在预览中逐项核对识别结果。</p>
      {sticky && (
        <ul className="import-toast-list">
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
