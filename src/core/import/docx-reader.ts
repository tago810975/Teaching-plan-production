/**
 * 读取 .docx，把正文转换为“段落列表”：每段带有样式名、行内内容（文字、公式、图片）
 * 以及锚定在该段的浮动图片。题目识别在 recognize.ts 中进行。
 */
import JSZip from 'jszip'
import type { Asset, Inline, TextMarks } from '../model/types'
import { createAsset } from '../project-file/codec'
import { mimeForExt } from '../project-file/format'
import { attr, child, children, descendants, NS, parseXml, serializeXml, type Element } from '../xml/dom'

const { w: W, m: M, r: R, wp: WP, a: A, mc: MC, v: V } = NS

export interface DocxImage {
  assetId: string
  widthEmu: number
  heightEmu: number
  /** 图片替代文字，题库导出的文档中形如 @@@<uuid> */
  description?: string
}

export interface ReadParagraph {
  /** 段落样式名（如“物理排版 题目”），无样式时为 undefined */
  styleName?: string
  /** 段落是否带有 Word 自动编号 */
  numbered: boolean
  inlines: Inline[]
  /** 四周环绕或浮于文字上方的图片 */
  floating: DocxImage[]
}

export interface ReadResult {
  paragraphs: ReadParagraph[]
  assets: Record<string, Asset>
  warnings: string[]
}

export class DocxReadError extends Error {
  override name = 'DocxReadError'
}

export async function readDocx(bytes: Uint8Array): Promise<ReadResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new DocxReadError('文件已损坏，或不是 Word 文档（.docx）。旧版 .doc 文件请先在 Word 中另存为 .docx。')
  }
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (docXml === undefined) throw new DocxReadError('这不是有效的 Word 文档（缺少 word/document.xml）。')

  const reader = new Reader(zip)
  await reader.loadPackage()
  const body = child(parseXml(docXml).documentElement as Element, W, 'body')
  if (body === undefined) throw new DocxReadError('Word 文档没有正文内容。')
  await reader.readContainer(body)
  return { paragraphs: reader.paragraphs, assets: reader.assets, warnings: reader.warningList() }
}

class Reader {
  paragraphs: ReadParagraph[] = []
  assets: Record<string, Asset> = {}
  private rels = new Map<string, string>()
  private styles = new Map<string, string>()
  private assetByTarget = new Map<string, Asset>()
  private counts = { vectorImages: 0, oleObjects: 0, textBoxes: 0, tables: 0, missingImages: 0 }

  constructor(private zip: JSZip) {}

  async loadPackage(): Promise<void> {
    const relsXml = await this.zip.file('word/_rels/document.xml.rels')?.async('string')
    if (relsXml !== undefined) {
      for (const rel of descendants(parseXml(relsXml).documentElement as Element, NS.rel, 'Relationship')) {
        const id = rel.getAttribute('Id')
        const target = rel.getAttribute('Target')
        if (id !== null && target !== null) this.rels.set(id, target)
      }
    }
    const stylesXml = await this.zip.file('word/styles.xml')?.async('string')
    if (stylesXml !== undefined) {
      for (const style of descendants(parseXml(stylesXml).documentElement as Element, W, 'style')) {
        const id = attr(style, W, 'styleId')
        const name = attr(child(style, W, 'name'), W, 'val')
        if (id !== undefined && name !== undefined) this.styles.set(id, name)
      }
    }
  }

  warningList(): string[] {
    const c = this.counts
    const out: string[] = []
    if (c.vectorImages > 0) out.push(`${c.vectorImages} 张图片是 EMF/WMF 矢量格式，预览中暂时无法显示，导出 Word 后正常。`)
    if (c.oleObjects > 0) out.push(`${c.oleObjects} 个 MathType 等嵌入对象已按图片导入，无法在软件中修改。`)
    if (c.textBoxes > 0) out.push(`${c.textBoxes} 个文本框中的文字已拆成普通段落，请检查位置是否合适。`)
    if (c.tables > 0) out.push(`${c.tables} 个表格已按段落导入，表格格式没有保留。`)
    if (c.missingImages > 0) out.push(`${c.missingImages} 张图片在文档中找不到对应文件，已跳过。`)
    return out
  }

  /** 读取 body、表格单元格、文本框等容器中的段落 */
  async readContainer(container: Element): Promise<void> {
    for (const el of children(container)) {
      if (el.namespaceURI !== W) continue
      if (el.localName === 'p') await this.readParagraph(el)
      else if (el.localName === 'tbl') {
        this.counts.tables += 1
        for (const tc of descendants(el, W, 'tc')) await this.readContainer(tc)
      } else if (el.localName === 'sdt') {
        const content = child(el, W, 'sdtContent')
        if (content !== undefined) await this.readContainer(content)
      }
    }
  }

  private async readParagraph(p: Element): Promise<void> {
    const pPr = child(p, W, 'pPr')
    const styleId = attr(pPr && child(pPr, W, 'pStyle'), W, 'val')
    const para: ReadParagraph = {
      ...(styleId !== undefined ? { styleName: this.styles.get(styleId) ?? styleId } : {}),
      numbered: pPr !== undefined && child(pPr, W, 'numPr') !== undefined,
      inlines: [],
      floating: []
    }
    const textBoxes: Element[] = []
    await this.readInlines(p, para, {}, textBoxes)
    this.paragraphs.push(para)
    // 文本框里的段落排在所在段落之后
    for (const tb of textBoxes) await this.readContainer(tb)
  }

  private async readInlines(el: Element, para: ReadParagraph, marks: TextMarks, textBoxes: Element[]): Promise<void> {
    for (const node of children(el)) {
      const ns = node.namespaceURI
      const name = node.localName
      if (ns === M && name === 'oMath') {
        para.inlines.push({ type: 'math', omml: serializeMath(node) })
      } else if (ns === M && name === 'oMathPara') {
        for (const om of children(node, M, 'oMath')) para.inlines.push({ type: 'math', omml: serializeMath(om), display: true })
      } else if (ns === W && name === 'r') {
        await this.readRun(node, para, textBoxes)
      } else if (ns === W && (name === 'hyperlink' || name === 'ins' || name === 'smartTag' || name === 'fldSimple' || name === 'customXml')) {
        await this.readInlines(node, para, marks, textBoxes)
      } else if (ns === W && name === 'sdt') {
        const content = child(node, W, 'sdtContent')
        if (content !== undefined) await this.readInlines(content, para, marks, textBoxes)
      } else if (ns === MC && name === 'AlternateContent') {
        const pick = pickAlternate(node)
        if (pick !== undefined) await this.readInlines(pick, para, marks, textBoxes)
      }
      // w:del（已删除的修订）、w:pPr、书签等忽略
    }
  }

  private async readRun(r: Element, para: ReadParagraph, textBoxes: Element[]): Promise<void> {
    await this.readRunContent(r, para, runMarks(child(r, W, 'rPr')), textBoxes)
  }

  /** 运行（w:r）的内容；也用于运行内 mc:AlternateContent 选中的分支 */
  private async readRunContent(container: Element, para: ReadParagraph, marks: TextMarks, textBoxes: Element[]): Promise<void> {
    for (const node of children(container)) {
      const name = node.localName
      if (node.namespaceURI === W) {
        if (name === 't') pushText(para, node.textContent ?? '', marks)
        else if (name === 'tab' || name === 'ptab') pushText(para, '\t', marks)
        else if (name === 'br' || name === 'cr') pushText(para, ' ', marks)
        else if (name === 'sym') pushText(para, symbolChar(node), marks)
        else if (name === 'drawing') await this.readDrawing(node, para, textBoxes)
        else if (name === 'pict' || name === 'object') await this.readVml(node, para, textBoxes, name === 'object')
      } else if (node.namespaceURI === MC && name === 'AlternateContent') {
        const pick = pickAlternate(node)
        if (pick !== undefined) await this.readRunContent(pick, para, marks, textBoxes)
      }
    }
  }

  private async readDrawing(drawing: Element, para: ReadParagraph, textBoxes: Element[]): Promise<void> {
    const anchor = child(drawing, WP, 'anchor')
    const inline = child(drawing, WP, 'inline')
    const holder = anchor ?? inline
    if (holder === undefined) return

    const txbx = descendants(holder, W, 'txbxContent')
    if (txbx.length > 0 && descendants(holder, A, 'blip').length === 0) {
      this.counts.textBoxes += txbx.length
      textBoxes.push(...txbx)
      return
    }

    const blip = descendants(holder, A, 'blip')[0]
    const rid = blip?.getAttributeNS(R, 'embed') ?? blip?.getAttributeNS(R, 'link')
    if (rid === undefined || rid === null || rid === '') return
    const extent = child(holder, WP, 'extent')
    const docPr = child(holder, WP, 'docPr')
    const image = await this.image(rid, Number(extent?.getAttribute('cx') ?? 0), Number(extent?.getAttribute('cy') ?? 0), docPr?.getAttribute('descr') ?? undefined)
    if (image === undefined) return

    // 浮动图：衬于文字下方的（水印、背景）忽略
    if (anchor !== undefined) {
      if (anchor.getAttribute('behindDoc') === '1') return
      const wrapsText = children(anchor).some((c) => c.namespaceURI === WP && /^wrap(Square|Tight|Through)$/.test(c.localName ?? ''))
      if (wrapsText) {
        para.floating.push(image)
        return
      }
    }
    para.inlines.push({ type: 'image', assetId: image.assetId, widthEmu: image.widthEmu, heightEmu: image.heightEmu })
  }

  /** 旧式 VML 图片与 OLE 对象（如 MathType 公式），取其预览图 */
  private async readVml(el: Element, para: ReadParagraph, textBoxes: Element[], isObject: boolean): Promise<void> {
    const txbx = descendants(el, W, 'txbxContent')
    if (txbx.length > 0) {
      this.counts.textBoxes += txbx.length
      textBoxes.push(...txbx)
      return
    }
    const imageData = descendants(el, V, 'imagedata')[0]
    const rid = imageData?.getAttributeNS(R, 'id')
    if (rid === undefined || rid === null || rid === '') return
    if (isObject) this.counts.oleObjects += 1
    const shape = descendants(el, V, 'shape')[0]
    const { widthEmu, heightEmu } = vmlSize(shape?.getAttribute('style') ?? '')
    const image = await this.image(rid, widthEmu, heightEmu)
    if (image !== undefined) {
      para.inlines.push({ type: 'image', assetId: image.assetId, widthEmu: image.widthEmu, heightEmu: image.heightEmu })
    }
  }

  private async image(rid: string, widthEmu: number, heightEmu: number, description?: string): Promise<DocxImage | undefined> {
    const target = this.rels.get(rid)
    if (target === undefined) {
      this.counts.missingImages += 1
      return undefined
    }
    const path = resolveTarget(target)
    let asset = this.assetByTarget.get(path)
    if (asset === undefined) {
      const data = await this.zip.file(path)?.async('uint8array')
      if (data === undefined) {
        this.counts.missingImages += 1
        return undefined
      }
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      if (ext === 'emf' || ext === 'wmf') this.counts.vectorImages += 1
      asset = await createAsset(data, mimeForExt(ext === 'jpeg' ? 'jpg' : ext))
      this.assetByTarget.set(path, asset)
      this.assets[asset.id] = asset
    }
    return {
      assetId: asset.id,
      widthEmu: widthEmu > 0 ? widthEmu : 1800000,
      heightEmu: heightEmu > 0 ? heightEmu : 1800000,
      ...(description !== undefined && description !== '' ? { description } : {})
    }
  }
}

// ---------------- 工具函数 ----------------

/** 保存公式时带上命名空间声明，使其可以单独解析 */
function serializeMath(oMath: Element): string {
  let xml = serializeXml(oMath)
  if (!xml.includes(`xmlns:m="${M}"`)) xml = xml.replace(/^<m:oMath\b/, `<m:oMath xmlns:m="${M}"`)
  if (xml.includes('<w:') && !xml.includes(`xmlns:w="${W}"`)) xml = xml.replace(/^<m:oMath\b/, `<m:oMath xmlns:w="${W}"`)
  return xml
}

function runMarks(rPr: Element | undefined): TextMarks {
  if (rPr === undefined) return {}
  const on = (name: string): boolean => {
    const e = child(rPr, W, name)
    if (e === undefined) return false
    const v = attr(e, W, 'val')
    return v === undefined || (v !== '0' && v !== 'false' && v !== 'none')
  }
  const marks: TextMarks = {}
  if (on('b')) marks.bold = true
  if (on('i')) marks.italic = true
  if (on('u')) marks.underline = true
  const va = attr(child(rPr, W, 'vertAlign'), W, 'val')
  if (va === 'superscript') marks.script = 'sup'
  else if (va === 'subscript') marks.script = 'sub'
  return marks
}

function pushText(para: ReadParagraph, text: string, marks: TextMarks): void {
  if (text === '') return
  const last = para.inlines[para.inlines.length - 1]
  if (last?.type === 'text' && sameMarks(last.marks ?? {}, marks)) {
    last.text += text
  } else {
    para.inlines.push(Object.keys(marks).length > 0 ? { type: 'text', text, marks: { ...marks } } : { type: 'text', text })
  }
}

function sameMarks(a: TextMarks, b: TextMarks): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.script === b.script && a.color === b.color
}

function symbolChar(sym: Element): string {
  const code = attr(sym, W, 'char')
  if (code === undefined) return ''
  let n = parseInt(code, 16)
  // Symbol 字体的私用区编码映射回 ASCII 范围
  if (n >= 0xf000) n -= 0xf000
  return String.fromCodePoint(n)
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = `word/${target}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join('/')
}

/** VML 的 style="width:120pt;height:30pt" → EMU */
function vmlSize(style: string): { widthEmu: number; heightEmu: number } {
  const get = (key: string): number => {
    const m = new RegExp(`${key}:\\s*([\\d.]+)(pt|in|cm|mm|px)?`).exec(style)
    if (m === null) return 0
    const n = Number(m[1])
    const unit = m[2] ?? 'px'
    const perUnit: Record<string, number> = { pt: 12700, in: 914400, cm: 360000, mm: 36000, px: 9525 }
    return Math.round(n * (perUnit[unit] ?? 9525))
  }
  return { widthEmu: get('width'), heightEmu: get('height') }
}

/**
 * 兼容内容：优先选含图片的 Choice 分支（新格式），否则用 Fallback（旧格式 VML，
 * 文本框等在其中也能读到文字）。
 */
function pickAlternate(node: Element): Element | undefined {
  const choice = child(node, MC, 'Choice')
  const fallback = child(node, MC, 'Fallback')
  if (choice !== undefined && descendants(choice, A, 'blip').length > 0) return choice
  return fallback ?? choice
}
