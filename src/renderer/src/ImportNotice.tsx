import type { ImportReport } from '@shared/ipc'

/** 导入完成后的说明：导入了多少题，以及需要留意的情况 */
export function ImportNotice({ report, onDismiss }: { report: ImportReport; onDismiss: () => void }) {
  const source = report.fileNames.length === 1 ? `“${report.fileNames[0]}”` : `${report.fileNames.length} 个文档`
  return (
    <div className="notice" role="status">
      <div>
        <p className="notice-title">
          已从{source}导入 {report.questionCount} 道题。请在预览中逐题核对识别结果。
        </p>
        {report.warnings.length > 0 && (
          <ul className="notice-list">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" onClick={onDismiss}>
        知道了
      </button>
    </div>
  )
}
