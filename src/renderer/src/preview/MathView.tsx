import { memo, type KeyboardEvent, type MouseEvent } from 'react'
import temml from 'temml'
import { ommlToMathml } from '@core/math/omml-to-mathml'

interface Props {
  latex?: string
  omml?: string
  display?: boolean
  /** 提供时公式可点击编辑 */
  onEdit?: () => void
}

/** 转换结果缓存：同一公式在预览和测量区各渲染一次，教学案中也常有重复公式 */
const ommlCache = new Map<string, string>()

/**
 * 公式显示，由 Chromium 原生渲染 MathML。
 * - 软件中新建或修改过的公式：LaTeX 经 temml 转换。
 * - 从 Word 导入且未修改的公式：OMML 经 omml-to-mathml 转换。
 */
export const MathView = memo(function MathView({ latex, omml, display, onEdit }: Props) {
  const editable =
    onEdit === undefined
      ? {}
      : {
          role: 'button',
          tabIndex: 0,
          title: '点击编辑公式',
          onClick: (e: MouseEvent) => {
            e.stopPropagation()
            onEdit()
          },
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') onEdit()
          }
        }
  if (latex !== undefined) {
    let html: string
    try {
      html = temml.renderToString(latex, { displayMode: display === true, throwOnError: true })
    } catch {
      return (
        <span className="math-error" title="公式有误，请检查 LaTeX 写法" {...editable}>
          {latex}
        </span>
      )
    }
    return <span className={mathClass(display, onEdit)} dangerouslySetInnerHTML={{ __html: html }} {...editable} />
  }
  if (omml !== undefined) {
    const key = `${display === true ? 'D' : 'I'}${omml}`
    let html = ommlCache.get(key)
    if (html === undefined) {
      html = ommlToMathml(omml, display === true).mathml
      if (ommlCache.size > 5000) ommlCache.clear()
      ommlCache.set(key, html)
    }
    return <span className={mathClass(display, onEdit)} dangerouslySetInnerHTML={{ __html: html }} {...editable} />
  }
  return null
})

function mathClass(display: boolean | undefined, onEdit: (() => void) | undefined): string {
  return ['math', display === true ? 'math--display' : '', onEdit !== undefined ? 'math--editable' : ''].filter(Boolean).join(' ')
}
