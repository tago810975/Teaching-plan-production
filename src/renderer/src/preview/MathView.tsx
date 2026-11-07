import { memo } from 'react'
import temml from 'temml'

interface Props {
  latex?: string
  omml?: string
  display?: boolean
}

/**
 * 公式显示。LaTeX 经 temml 转为 MathML，由 Chromium 原生渲染。
 * 仅有 OMML 的公式（从 Word 导入且未修改）待导入模块完成 OMML → MathML 后接入。
 */
export const MathView = memo(function MathView({ latex, omml, display }: Props) {
  if (latex !== undefined) {
    let html: string
    try {
      html = temml.renderToString(latex, { displayMode: display === true, throwOnError: true })
    } catch {
      return (
        <span className="math-error" title="公式有误，请检查 LaTeX 写法">
          {latex}
        </span>
      )
    }
    return <span className="math" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return (
    <span className="math-pending" title={omml === undefined ? '' : '从 Word 导入的公式，显示功能开发中'}>
      [公式]
    </span>
  )
})
