import {
  describeReceivedSummary,
  type ImageImportKind,
  type ImageImportRedrawProgress,
  type ImageImportSummary
} from '../state/imageImportSession'

interface Props {
  kind: ImageImportKind
  arrivalKind: 'recognition' | 'redraw'
  summary: ImageImportSummary | null
  redrawProgress: ImageImportRedrawProgress | null
  targetTitle: string | null
  actionLabel?: string
  onOpen: () => void
  onDismiss: () => void
}

/**
 * 后台等待 WorkBuddy / Antigravity 等 MCP Agent 期间收到结果后的自动提醒卡片（右下角，与导出/导入完成提示同样式）。
 * 不自动超时关闭，确保老师忙完手头编辑后能一键展开查看并处理。
 */
export function WorkBuddyReadyNotice({
  kind,
  arrivalKind,
  summary,
  redrawProgress,
  targetTitle,
  actionLabel = '查看并导入',
  onOpen,
  onDismiss
}: Props) {
  const title = arrivalKind === 'redraw' ? '已收到 AI 重绘插图' : '已收到 AI 识别结果'
  const detail =
    arrivalKind === 'redraw'
      ? `已收到 ${redrawProgress?.received ?? 0}/${redrawProgress?.total ?? 0} 张重绘插图，可与原图逐张对照后选用。`
      : describeReceivedSummary(kind, summary)

  return (
    <div className="export-toast wb-toast" role="status" aria-live="polite">
      <div className="export-toast-head">
        <span className="export-toast-mark" aria-hidden="true" />
        <p className="export-toast-title">{title}</p>
        <button type="button" className="export-toast-close" aria-label="关闭" title="关闭" onClick={onDismiss}>
          ×
        </button>
      </div>
      <p className="wb-toast-body">{detail}</p>
      <p className="wb-toast-target">
        {targetTitle !== null ? `目标教学案：《${targetTitle}》` : '当前没有打开的教学案，请先打开一个教学案后再导入'}
      </p>
      <div className="export-toast-actions wb-toast-actions">
        <button type="button" onClick={onDismiss}>
          稍后处理
        </button>
        <button type="button" className="primary" onClick={onOpen}>
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
