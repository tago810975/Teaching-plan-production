/**
 * 读取 .docx，把正文转换为“段落列表”：每段带有样式名、行内内容（文字、公式、图片）
 * 以及锚定在该段的浮动图片。题目识别在 recognize.ts 中进行。
 */
import { fontFamilyOf } from '../document/fonts'
import JSZip from 'jszip'
import type { Asset, Inline, ParagraphFormat, RichText, TableCell, TableInline, TableRow, TextMarks } from '../model/types'
import { layoutTable } from '../model/table'
import { createAsset } from '../project-file/codec'
import { mimeForExt } from '../project-file/format'
import { attr, child, children, descendants, NS, parseXml, serializeXml, type Element } from '../xml/dom'
import { drawingToSvg, isPlainTextBox, isShapeDrawing, type ResolvedImage } from './drawing-svg'
import { eqFieldToLatex, isEqField } from './eq-field'
import { mathTypeToLatex } from './mathtype'

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
  /** 段落格式（首行缩进、对齐），已合并段落样式中的设置 */
  format?: ParagraphFormat
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
  /** 样式的段落格式与所继承的样式，用于计算段落实际的首行缩进与对齐 */
  private styleFormats = new Map<string, { format: ParagraphFormat; basedOn?: string }>()
  private assetByTarget = new Map<string, Asset>()
  private counts = {
    vectorImages: 0,
    oleObjects: 0,
    mathTypeConverted: 0,
    drawingsConverted: 0,
    eqConverted: 0,
    eqFailed: 0,
    textBoxes: 0,
    tables: 0,
    missingImages: 0
  }
  /**
   * 正在读取的域（可嵌套）。phase 为 instr 时正在读域代码；
   * skip 为 true 时跳过域结果（EQ 域的结果是 Word 缓存的显示效果，已按代码转成公式）。
   */
  private fields: Array<{ instr: string; phase: 'instr' | 'result'; skip: boolean; marks: TextMarks }> = []

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
        if (id !== undefined && style.getAttributeNS(W, 'type') !== 'character') {
          const basedOn = attr(child(style, W, 'basedOn'), W, 'val')
          this.styleFormats.set(id, { format: paragraphFormat(child(style, W, 'pPr')), ...(basedOn !== undefined ? { basedOn } : {}) })
        }
      }
    }
  }

  /** 样式（含继承）中的段落格式；越靠近的样式优先 */
  private styleFormat(styleId: string | undefined, depth = 0): ParagraphFormat {
    if (styleId === undefined || depth > 10) return {}
    const entry = this.styleFormats.get(styleId)
    if (entry === undefined) return {}
    return { ...this.styleFormat(entry.basedOn, depth + 1), ...entry.format }
  }

  warningList(): string[] {
    const c = this.counts
    const out: string[] = []
    if (c.vectorImages > 0) out.push(`${c.vectorImages} 张图片是 EMF/WMF 矢量格式，预览中暂时无法显示，导出 Word 后正常。`)
    if (c.mathTypeConverted + c.eqConverted > 0) {
      const parts = [
        c.mathTypeConverted > 0 ? `${c.mathTypeConverted} 个 MathType 公式` : '',
        c.eqConverted > 0 ? `${c.eqConverted} 个 EQ 域公式` : ''
      ].filter(Boolean)
      out.push(`已将${parts.join('、')}转换为可编辑的公式，导出时为 Word 公式。`)
    }
    if (c.drawingsConverted > 0) out.push(`${c.drawingsConverted} 幅用形状绘制的示意图已转换为图片，请核对显示效果。`)
    if (c.oleObjects > 0) out.push(`${c.oleObjects} 个嵌入对象（无法识别的公式等）已按图片导入，无法在软件中修改。`)
    if (c.eqFailed > 0) out.push(`${c.eqFailed} 个 EQ 域公式无法识别，已保留其中的文字，请检查。`)
    if (c.textBoxes > 0) out.push(`${c.textBoxes} 个文本框中的文字已拆成普通段落，请检查位置是否合适。`)
    if (c.tables > 0) out.push(`导入了 ${c.tables} 个表格，请核对合并单元格与列宽。`)
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
        // 表格独占一段
        this.paragraphs.push({ numbered: false, inlines: [await this.readTable(el)], floating: [] })
      } else if (el.localName === 'sdt') {
        const content = child(el, W, 'sdtContent')
        if (content !== undefined) await this.readContainer(content)
      }
    }
  }

  /**
   * 读取表格：横向合并（gridSpan）记为 colSpan；纵向合并（vMerge）的续行单元格不单独记录，
   * 而是加到上方起始单元格的 rowSpan 上。单元格内容按段落读取（公式、图片、格式都保留，表格可嵌套）。
   */
  private async readTable(tbl: Element): Promise<TableInline> {
    const grid = child(tbl, W, 'tblGrid')
    const colWidthsTwip = grid !== undefined ? children(grid, W, 'gridCol').map((g) => Number(attr(g, W, 'w') ?? 0)) : []
    const rows: TableRow[] = []
    // 每一列上正在向下合并的单元格
    const merging = new Map<number, TableCell>()
    for (const tr of children(tbl, W, 'tr')) {
      const cells: TableCell[] = []
      const trPr = child(tr, W, 'trPr')
      let col = trPr !== undefined ? Number(attr(child(trPr, W, 'gridBefore'), W, 'val') ?? 0) : 0
      for (const tc of children(tr, W, 'tc')) {
        const tcPr = child(tc, W, 'tcPr')
        const span = Math.max(1, Number((tcPr !== undefined ? attr(child(tcPr, W, 'gridSpan'), W, 'val') : undefined) ?? 1))
        const vMerge = tcPr !== undefined ? child(tcPr, W, 'vMerge') : undefined
        const vMergeVal = vMerge !== undefined ? (attr(vMerge, W, 'val') ?? 'continue') : undefined
        if (vMergeVal === 'continue') {
          const top = merging.get(col)
          if (top !== undefined) {
            top.rowSpan = (top.rowSpan ?? 1) + 1
            col += span
            continue
          }
        }
        const fill = tcPr !== undefined ? attr(child(tcPr, W, 'shd'), W, 'fill') : undefined
        const cell: TableCell = {
          content: await this.readCell(tc),
          ...(span > 1 ? { colSpan: span } : {}),
          ...(fill !== undefined && /^[0-9A-Fa-f]{6}$/.test(fill) && fill.toUpperCase() !== 'FFFFFF' ? { shading: fill.toUpperCase() } : {})
        }
        if (vMergeVal === 'restart') merging.set(col, cell)
        else merging.delete(col)
        cells.push(cell)
        col += span
      }
      rows.push({ cells })
    }
    const cols = layoutTable(rows).cols
    const widthsOk = colWidthsTwip.length === cols && colWidthsTwip.every((w) => w > 0)
    return { type: 'table', rows, ...(widthsOk ? { colWidthsTwip } : {}) }
  }

  /** 单元格中的段落 → 富文本（只保留对齐；浮动图片改为行内图片） */
  private async readCell(tc: Element): Promise<RichText> {
    const saved = this.paragraphs
    this.paragraphs = []
    await this.readContainer(tc)
    const read = this.paragraphs
    this.paragraphs = saved
    const out: RichText = []
    for (const p of read) {
      const inlines: Inline[] = [...p.inlines, ...p.floating.map((f): Inline => ({ type: 'image', assetId: f.assetId, widthEmu: f.widthEmu, heightEmu: f.heightEmu }))]
      // 去掉首尾空白
      const first = inlines[0]
      if (first?.type === 'text') inlines[0] = { ...first, text: first.text.replace(/^[\s\u3000]+/, '') }
      const last = inlines[inlines.length - 1]
      if (last?.type === 'text') inlines[inlines.length - 1] = { ...last, text: last.text.replace(/[\s\u3000]+$/, '') }
      const kept = inlines.filter((i) => i.type !== 'text' || i.text !== '')
      const align = p.format?.align
      out.push({ inlines: kept, ...(align !== undefined ? { format: { align } } : {}) })
    }
    // 去掉末尾的空段落，至少留一段
    while (out.length > 1 && out[out.length - 1]!.inlines.length === 0) out.pop()
    return out.length > 0 ? out : [{ inlines: [] }]
  }

  private async readParagraph(p: Element): Promise<void> {
    const pPr = child(p, W, 'pPr')
    const styleId = attr(pPr && child(pPr, W, 'pStyle'), W, 'val')
    const format = { ...this.styleFormat(styleId), ...paragraphFormat(pPr) }
    if (format.firstLineChars === 0) delete format.firstLineChars
    const para: ReadParagraph = {
      ...(styleId !== undefined ? { styleName: this.styles.get(styleId) ?? styleId } : {}),
      numbered: pPr !== undefined && child(pPr, W, 'numPr') !== undefined,
      inlines: [],
      floating: [],
      ...(Object.keys(format).length > 0 ? { format } : {})
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
        para.inlines.push({ type: 'math', omml: serializeMath(node), ...ommlMarks(node) })
      } else if (ns === M && name === 'oMathPara') {
        for (const om of children(node, M, 'oMath')) para.inlines.push({ type: 'math', omml: serializeMath(om), display: true, ...ommlMarks(om) })
      } else if (ns === W && name === 'r') {
        await this.readRun(node, para, textBoxes)
      } else if (ns === W && name === 'fldSimple' && isEqField(attr(node, W, 'instr') ?? '')) {
        this.pushEq(attr(node, W, 'instr')!, para)
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
      if (node.namespaceURI === W && name === 'fldChar') {
        this.fieldChar(attr(node, W, 'fldCharType'), para, marks)
        continue
      }
      if (node.namespaceURI === W && name === 'instrText') {
        const top = this.fields[this.fields.length - 1]
        if (top?.phase === 'instr') top.instr += node.textContent ?? ''
        continue
      }
      // 域代码部分、以及已转为公式的 EQ 域结果，不读取其中的内容
      if (this.fields.some((f) => f.phase === 'instr' || f.skip)) continue
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

  private fieldChar(type: string | undefined, para: ReadParagraph, marks: TextMarks): void {
    if (type === 'begin') {
      // 记下域开始处的文字格式：EQ 域公式随之加粗、加下划线、设颜色（如知识点手册中红色加粗的重点公式）
      this.fields.push({ instr: '', phase: 'instr', skip: false, marks })
      return
    }
    const top = this.fields[this.fields.length - 1]
    if (top === undefined) return
    if (type === 'separate') {
      top.phase = 'result'
      if (isEqField(top.instr)) {
        this.pushEq(top.instr, para, top.marks)
        top.skip = true
      }
    } else if (type === 'end') {
      if (top.phase === 'instr' && isEqField(top.instr)) this.pushEq(top.instr, para, top.marks)
      this.fields.pop()
    }
  }

  private pushEq(instr: string, para: ReadParagraph, marks: TextMarks = {}): void {
    const latex = eqFieldToLatex(instr)
    if (latex !== null) {
      this.counts.eqConverted += 1
      para.inlines.push({ type: 'math', latex, ...mathMarks(marks) })
    } else {
      this.counts.eqFailed += 1
      pushText(para, instr.replace(/^\s*eq\s*/i, ''), {})
    }
  }

  private async readDrawing(drawing: Element, para: ReadParagraph, textBoxes: Element[]): Promise<void> {
    const anchor = child(drawing, WP, 'anchor')
    const inline = child(drawing, WP, 'inline')
    const holder = anchor ?? inline
    if (holder === undefined) return

    // 用形状绘制的示意图（WPS / Word 的形状与组合）→ SVG 图片
    const graphicData = descendants(holder, A, 'graphicData')[0]
    if (graphicData !== undefined && isShapeDrawing(graphicData) && !isPlainTextBox(graphicData)) {
      const image = await this.shapeDrawing(holder, graphicData)
      if (image !== undefined) {
        this.counts.drawingsConverted += 1
        const wraps = anchor !== undefined && children(anchor).some((c) => c.namespaceURI === WP && /^wrap(Square|Tight|Through|TopAndBottom)$/.test(c.localName ?? ''))
        if (anchor !== undefined && anchor.getAttribute('behindDoc') !== '1' && wraps) para.floating.push(image)
        else para.inlines.push({ type: 'image', assetId: image.assetId, widthEmu: image.widthEmu, heightEmu: image.heightEmu })
        return
      }
    }

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

  /** 形状绘制的示意图渲染为 SVG，作为图片资源 */
  private async shapeDrawing(holder: Element, graphicData: Element): Promise<DocxImage | undefined> {
    const extent = child(holder, WP, 'extent')
    const cx = Number(extent?.getAttribute('cx') ?? 0)
    const cy = Number(extent?.getAttribute('cy') ?? 0)
    if (cx <= 0 || cy <= 0) return undefined
    // 先读出组合中用到的图片，渲染时以 data URI 嵌入
    const images = new Map<string, ResolvedImage>()
    for (const blip of descendants(graphicData, A, 'blip')) {
      const rid = blip.getAttributeNS(R, 'embed')
      const target = rid ? this.rels.get(rid) : undefined
      if (!rid || target === undefined || images.has(rid)) continue
      const path = resolveTarget(target)
      const data = await this.zip.file(path)?.async('uint8array')
      if (data === undefined) continue
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      images.set(rid, { mime: mimeForExt(ext === 'jpeg' ? 'jpg' : ext), base64: toBase64(data) })
    }
    const rendered = drawingToSvg(graphicData, cx, cy, (rid) => images.get(rid))
    if (rendered === null) return undefined
    const asset = await createAsset(new TextEncoder().encode(rendered.svg), 'image/svg+xml')
    this.assets[asset.id] = asset
    return { assetId: asset.id, widthEmu: rendered.widthEmu, heightEmu: rendered.heightEmu }
  }

  /** 旧式 VML 图片与 OLE 对象（如 MathType 公式），取其预览图 */
  private async readVml(el: Element, para: ReadParagraph, textBoxes: Element[], isObject: boolean): Promise<void> {
    const txbx = descendants(el, W, 'txbxContent')
    if (txbx.length > 0) {
      this.counts.textBoxes += txbx.length
      textBoxes.push(...txbx)
      return
    }
    if (isObject) {
      const latex = await this.mathTypeLatex(el)
      if (latex !== null) {
        this.counts.mathTypeConverted += 1
        para.inlines.push({ type: 'math', latex })
        return
      }
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

  /** 嵌入的 MathType 公式对象 → LaTeX；不是 MathType 或无法解析时返回 null */
  private async mathTypeLatex(object: Element): Promise<string | null> {
    const ole = descendants(object, NS.o, 'OLEObject')[0]
    const progId = ole?.getAttribute('ProgID') ?? ''
    if (ole === undefined || !/^Equation\.(DSMT|3)/i.test(progId)) return null
    const rid = ole.getAttributeNS(R, 'id')
    const target = rid === null ? undefined : this.rels.get(rid)
    if (target === undefined) return null
    const data = await this.zip.file(resolveTarget(target))?.async('uint8array')
    return data === undefined ? null : mathTypeToLatex(data)
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
/** 文字格式中公式也支持的部分：加粗、下划线、颜色 */
function mathMarks(m: TextMarks): Pick<Extract<Inline, { type: 'math' }>, 'bold' | 'underline' | 'color'> {
  return {
    ...(m.bold === true ? { bold: true } : {}),
    ...(m.underline === true ? { underline: true } : {}),
    ...(m.color !== undefined ? { color: m.color } : {})
  }
}

/**
 * OMML 公式整体的加粗、颜色：每个 <m:r> 都是同一颜色、都加粗时才算（只有部分字符变色的不算）。
 * 用于知识点手册中把红色加粗的重点公式挖空。
 */
function ommlMarks(oMath: Element): Pick<Extract<Inline, { type: 'math' }>, 'bold' | 'color'> {
  const runs = descendants(oMath, M, 'r')
  if (runs.length === 0) return {}
  const colors = new Set<string | undefined>()
  let bold = true
  for (const r of runs) {
    const rPr = child(r, W, 'rPr')
    const mrPr = child(r, M, 'rPr')
    const c = rPr !== undefined ? attr(child(rPr, W, 'color'), W, 'val') : undefined
    colors.add(c !== undefined && /^[0-9A-Fa-f]{6}$/.test(c) && c !== '000000' ? c.toUpperCase() : undefined)
    const b = rPr !== undefined ? child(rPr, W, 'b') : undefined
    const sty = mrPr !== undefined ? attr(child(mrPr, M, 'sty'), M, 'val') : undefined
    if (!(b !== undefined && attr(b, W, 'val') !== '0' && attr(b, W, 'val') !== 'false') && sty !== 'b' && sty !== 'bi') bold = false
  }
  const color = colors.size === 1 ? [...colors][0] : undefined
  return { ...(bold ? { bold: true } : {}), ...(color !== undefined ? { color } : {}) }
}

function serializeMath(oMath: Element): string {
  let xml = serializeXml(oMath)
  if (!xml.includes(`xmlns:m="${M}"`)) xml = xml.replace(/^<m:oMath\b/, `<m:oMath xmlns:m="${M}"`)
  if (xml.includes('<w:') && !xml.includes(`xmlns:w="${W}"`)) xml = xml.replace(/^<m:oMath\b/, `<m:oMath xmlns:w="${W}"`)
  return xml
}

/**
 * 段落属性中的首行缩进与对齐。首行缩进优先取“字符”单位（firstLineChars，单位 1/100 字符），
 * 否则由 twip 换算（五号字一个字约 210 twip）；悬挂缩进视为没有首行缩进。
 */
function paragraphFormat(pPr: Element | undefined): ParagraphFormat {
  const out: ParagraphFormat = {}
  if (pPr === undefined) return out
  const ind = child(pPr, W, 'ind')
  if (ind !== undefined) {
    const chars = attr(ind, W, 'firstLineChars')
    const twip = attr(ind, W, 'firstLine')
    const hanging = attr(ind, W, 'hanging') ?? attr(ind, W, 'hangingChars')
    // 字符单位为 0 时 Word 改用 twip 数值（WPS 常写成 firstLine="420" firstLineChars="0"）
    if (hanging !== undefined && Number(hanging) > 0) out.firstLineChars = 0
    else if (chars !== undefined && Number(chars) > 0) out.firstLineChars = Math.round(Number(chars) / 50) / 2
    else if (twip !== undefined) out.firstLineChars = Math.round((Number(twip) / 210) * 2) / 2
    else if (chars !== undefined) out.firstLineChars = 0
  }
  const jc = attr(child(pPr, W, 'jc'), W, 'val')
  if (jc === 'center') out.align = 'center'
  else if (jc === 'right' || jc === 'end') out.align = 'right'
  return out
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
  // 文字颜色：黑色与“自动”视为没有颜色
  const color = attr(child(rPr, W, 'color'), W, 'val')
  if (color !== undefined && /^[0-9A-Fa-f]{6}$/.test(color) && color !== '000000') marks.color = color.toUpperCase()
  // 中文字体：只看东亚字体，归入宋体、黑体、楷体、仿宋四类；认不出的（如主题字体）不记录
  const font = fontFamilyOf(attr(child(rPr, W, 'rFonts'), W, 'eastAsia'))
  if (font !== undefined) marks.font = font
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
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.script === b.script && a.color === b.color && a.font === b.font
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
  if (choice !== undefined) {
    // 新格式中有图片，或有可以渲染的形状绘图时，用新格式
    if (descendants(choice, A, 'blip').length > 0) return choice
    const gd = descendants(choice, A, 'graphicData')[0]
    if (gd !== undefined && isShapeDrawing(gd) && !isPlainTextBox(gd)) return choice
  }
  return fallback ?? choice
}

/** Uint8Array → Base64（主进程与界面通用，不依赖 Buffer） */
function toBase64(data: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < data.length; i += chunk) s += String.fromCharCode(...data.subarray(i, i + chunk))
  return btoa(s)
}
