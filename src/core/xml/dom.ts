/**
 * XML 工具。统一使用 @xmldom/xmldom，主进程、界面和测试中行为一致。
 */
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom'

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  v: 'urn:schemas-microsoft-com:vml',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships'
} as const

export type { Document, Element, Node }

export function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/xml')
}

export function serializeXml(node: Node): string {
  return new XMLSerializer().serializeToString(node)
}

/** 直接子元素 */
export function children(el: Element, ns?: string, local?: string): Element[] {
  const out: Element[] = []
  for (let n = el.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType !== 1) continue
    const e = n as Element
    if ((ns === undefined || e.namespaceURI === ns) && (local === undefined || e.localName === local)) out.push(e)
  }
  return out
}

export function child(el: Element, ns: string, local: string): Element | undefined {
  return children(el, ns, local)[0]
}

/** 所有后代元素（文档顺序） */
export function descendants(el: Element, ns: string, local: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(ns, local)) as Element[]
}

/** 读取 w:val / m:val 这类属性 */
export function attr(el: Element | undefined, ns: string, local: string): string | undefined {
  if (el === undefined) return undefined
  const v = el.getAttributeNS(ns, local)
  return v === null || v === '' ? undefined : v
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
