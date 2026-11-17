/**
 * Word 公式（OMML）中的左上下标：“底数为空的 m:sSub / m:sSup / m:sSubSup + 下一个元素”改为 m:sPre。
 *
 * 核素 ⁴₂He 等在 Word 中常被写成“空底数的上下标 + He”：Word、WPS 都显示一个虚线空框带右上下标、He 排在后面。
 * 从 Word 导入时原样保留的公式不经过 LaTeX 转换（mathml-to-omml 中有同样的处理），导出与预览前都经过这里。
 */
import { NS, parseXml, serializeXml } from '../xml/dom'
import type { Element } from '@xmldom/xmldom'

const M = NS.m
const SCRIPTS = new Set(['sSub', 'sSup', 'sSubSup'])

const kids = (el: Element): Element[] => {
  const out: Element[] = []
  for (let n = el.firstChild; n !== null; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element)
  return out
}
const childNamed = (el: Element, local: string): Element | undefined => kids(el).find((k) => k.namespaceURI === M && k.localName === local)

/** 底数为空（没有文字）的上下标 */
function isEmptyBaseScript(el: Element): boolean {
  if (el.namespaceURI !== M || !SCRIPTS.has(el.localName ?? '')) return false
  const e = childNamed(el, 'e')
  return e === undefined || (e.textContent ?? '').trim() === ''
}

/** 可以作为主体的元素（属性元素如 m:ctrlPr、m:rPr 不行） */
const isContent = (el: Element): boolean => !(el.localName ?? '').endsWith('Pr')

function fix(el: Element): boolean {
  let changed = false
  const list = kids(el)
  for (let i = 0; i < list.length; i++) {
    const k = list[i]!
    const next = list[i + 1]
    if (isEmptyBaseScript(k) && next !== undefined && isContent(next) && !isEmptyBaseScript(next)) {
      const doc = el.ownerDocument!
      const pre = doc.createElementNS(M, 'm:sPre')
      for (const part of ['sub', 'sup'] as const) {
        const src = childNamed(k, part)
        pre.appendChild(src !== undefined ? src : doc.createElementNS(M, `m:${part}`))
      }
      const e = doc.createElementNS(M, 'm:e')
      e.appendChild(next)
      pre.appendChild(e)
      el.replaceChild(pre, k)
      changed = true
      i++
      fix(e)
      continue
    }
    if (fix(k)) changed = true
  }
  return changed
}

export function fixOmmlPrescripts(omml: string): string {
  if (!/<m:s(Sub|Sup|SubSup)\b/.test(omml)) return omml
  // 包一层声明命名空间的根（存下的公式可能没有声明 m、w）
  let doc
  try {
    doc = parseXml(`<root xmlns:m="${M}" xmlns:w="${NS.w}">${omml}</root>`)
  } catch {
    return omml
  }
  const root = doc.documentElement
  if (root === null || !fix(root as unknown as Element)) return omml
  const out = kids(root as unknown as Element)
    .map((k) => serializeXml(k))
    .join('')
  // 原来带命名空间声明的（预览时要解析）保留；原来没有的（正文中已声明）去掉序列化时补上的声明
  return /xmlns:m=/.test(omml) ? out : out.replace(/ xmlns:(m|w)="[^"]*"/g, '')
}
