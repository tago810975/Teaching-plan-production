/**
 * “点击预览定位到编辑框”：预览中点击某段文字后，属性面板中对应的输入框
 * 滚动到该段，并把光标放在点击位置附近。
 */
import { createContext, useContext, useEffect, useRef, type RefObject } from 'react'
import type { FocusRequest } from '../state/store'
import { caretPosition } from '@shared/caret'

export const FieldFocusContext = createContext<FocusRequest | null>(null)

/**
 * 输入框登记自己的 fieldId；收到匹配的定位请求时，定位到第 paragraph 段中点击的位置。
 * 每个请求只处理一次（按 nonce 判断）。
 */
export function useFieldFocus(fieldId: string | undefined, ref: RefObject<HTMLTextAreaElement | HTMLInputElement | null>): void {
  const request = useContext(FieldFocusContext)
  const handled = useRef(0)
  // 记下输入框标识：撤销 / 重做时据此知道光标在哪个输入框
  useEffect(() => {
    const el = ref.current
    if (el !== null && fieldId !== undefined) el.dataset.fieldId = fieldId
  }, [fieldId, ref])
  useEffect(() => {
    const el = ref.current
    if (fieldId === undefined || request === null || el === null) return
    if (request.field !== fieldId || request.nonce === handled.current) return
    handled.current = request.nonce
    if (request.caret !== undefined) {
      // 撤销 / 重做：光标放回原处，不滚动、不高亮
      const caret = Math.min(request.caret, el.value.length)
      el.focus({ preventScroll: true })
      el.setSelectionRange(caret, caret)
      return
    }
    const caret = caretPosition(el.value, request.paragraph, request.before, request.after)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus({ preventScroll: true })
    el.setSelectionRange(caret, caret)
    if (el instanceof HTMLTextAreaElement) scrollTextareaTo(el, caret)
    // 短暂高亮，提示定位到了哪里
    el.classList.remove('is-located')
    void el.offsetWidth
    el.classList.add('is-located')
  }, [fieldId, request, ref])
}

/** 文本框内滚动到光标所在行：用一个样式相同的隐藏元素测出光标之前文字的高度 */
function scrollTextareaTo(el: HTMLTextAreaElement, caret: number): void {
  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  for (const prop of ['fontFamily', 'fontSize', 'lineHeight', 'paddingLeft', 'paddingRight', 'paddingTop', 'borderLeftWidth', 'borderRightWidth', 'letterSpacing'] as const) {
    mirror.style[prop] = style[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.width = `${el.clientWidth}px`
  mirror.textContent = el.value.slice(0, caret)
  document.body.appendChild(mirror)
  const height = mirror.scrollHeight
  mirror.remove()
  el.scrollTop = Math.max(0, height - el.clientHeight / 2)
}
