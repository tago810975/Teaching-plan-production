/**
 * 公式编辑器的打开入口。预览（点击公式）与属性面板（插入公式）都通过这里打开同一个编辑器。
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { FormulaEditor } from './FormulaEditor'

export interface FormulaRequest {
  mode: 'edit' | 'insert'
  initialLatex: string
  initialDisplay: boolean
  onSave: (latex: string, display: boolean) => void
  onDelete?: () => void
}

const FormulaContext = createContext<((request: FormulaRequest) => void) | null>(null)

export function FormulaEditorProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<FormulaRequest | null>(null)
  return (
    <FormulaContext.Provider value={setRequest}>
      {children}
      {request !== null && (
        <FormulaEditor
          key={`${request.mode}:${request.initialLatex}`}
          mode={request.mode}
          initialLatex={request.initialLatex}
          initialDisplay={request.initialDisplay}
          onCancel={() => setRequest(null)}
          onSave={(latex, display) => {
            setRequest(null)
            request.onSave(latex, display)
          }}
          {...(request.onDelete !== undefined
            ? {
                onDelete: () => {
                  setRequest(null)
                  request.onDelete!()
                }
              }
            : {})}
        />
      )}
    </FormulaContext.Provider>
  )
}

/** 打开公式编辑器；在 FormulaEditorProvider 之外调用时返回 null */
export function useOpenFormulaEditor(): ((request: FormulaRequest) => void) | null {
  return useContext(FormulaContext)
}
