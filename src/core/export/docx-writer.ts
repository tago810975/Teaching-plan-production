/**
 * Word 导出：DocIR + 模板 → .docx。
 *
 * 与预览一样只读取 DocIR，排版规则全部来自 build.ts。模板提供样式、自动编号、
 * 页眉页脚；这里负责：
 * - 生成正文段落（样式、防跨页、制表位、底纹、作答留白）；
 * - 写入文字、公式（OMML 原样写回，或由 LaTeX 转换）、图片（嵌入与右侧环绕）；
 * - 页眉：替换文字占位符与图片，未设置的元素删除；
 * - 大标题处重新开始题号（如“作业单”）。
 */
import JSZip from 'jszip'
import type { DocCellParagraph, DocIR, DocParagraph, DocRun, DocTable, FloatingImage } from '../document/ir'
import { layoutTable } from '../model/table'
import { A4_PAGE, contentWidthTwip } from '../document/units'
import { FLOAT_GAP_EMU, ROOMY_CELL_TWIP, RULE_LINE_COLOR, RULE_LINE_TWIP, STYLE_SPECS, TEACHER_SHADING, TEMPLATE_OPTION_TAB_STOPS, type StyleKey } from '../document/styles'
import { WORD_FONT_NAMES } from '../document/fonts'
import { applyHeadingStyles } from './heading-styles'
import { applyMathMarks, uprightOmml } from './math-marks'
import { latexToOmml } from '../math/mathml-to-omml'
import type { Asset, FontFamily, HeaderImage, TextMarks } from '../model/types'
import { extForMime } from '../project-file/format'
import { attr, child, descendants, escapeXml, NS, parseXml, serializeXml, type Element } from '../xml/dom'

const { w: W, wp: WP, a: A, r: R } = NS
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'

/** Word 能直接显示的图片格式；其他格式（SVG、WebP）需在调用前转成 PNG */
const WORD_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/x-emf', 'image/x-wmf'])

export interface ExportInput {
  ir: DocIR
  assets: Record<string, Asset>
  title: string
  /** 模板 .docx 的内容 */
  template: Uint8Array
  /** 公式中的字母用正体（不倾斜）；默认 false（保持 Word 的数学斜体），软件中由“设置”决定 */
  mathUpright?: boolean
}

export class DocxExportError extends Error {
  override name = 'DocxExportError'
}

export async function writeDocx({ ir, assets, title, template, mathUpright = false }: ExportInput): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template)
  // 标题格式来自格式预设：写进模板的同名样式
  if (ir.styles !== undefined) zip.file('word/styles.xml', applyHeadingStyles(await readText(zip, 'word/styles.xml'), ir.styles))
  const ctx = new ExportContext(zip, assets)
  ctx.mathUpright = mathUpright
  await ctx.loadTemplate()

  // ---- 正文 ----
  let body = ir.paragraphs.map((p) => ctx.paragraph(p)).join('')
  // 正文不能以表格结尾（Word 要求最后是段落）
  if (body.endsWith('</w:tbl>')) body += '<w:p/>'
  const docPath = 'word/document.xml'
  const doc = await readText(zip, docPath)
  if (!doc.includes('{{body}}')) throw new DocxExportError('模板中缺少正文占位符 {{body}}。')
  zip.file(docPath, doc.replace('{{body}}', body))

  // ---- 页眉 ----
  await ctx.writeHeaders(ir)

  // ---- 关系、编号、类型、属性 ----
  await ctx.finish(title)

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

class ExportContext {
  /** 公式中的字母用正体 */
  mathUpright = false
  private styleIds = new Map<string, string>()
  private docRels: string[] = []
  private relCounter = 0
  private mediaByAsset = new Map<string, string>()
  private usedExtensions = new Set<string>()
  private drawingId = 1000
  /** 题号重新开始：每段新增一个编号实例 */
  private numbering: { questionStyleId: string; numId: string; abstractId: string; questionLevel: string; subLevel: string } | null = null
  private restartNumIds: string[] = []
  private currentNumId: string | null = null

  constructor(
    private zip: JSZip,
    private assets: Record<string, Asset>
  ) {}

  async loadTemplate(): Promise<void> {
    const styles = parseXml(await readText(this.zip, 'word/styles.xml')).documentElement as Element
    for (const s of descendants(styles, W, 'style')) {
      const id = attr(s, W, 'styleId')
      const name = attr(child(s, W, 'name'), W, 'val')
      if (id !== undefined && name !== undefined) this.styleIds.set(name, id)
    }
    for (const spec of Object.values(STYLE_SPECS)) {
      if (!this.styleIds.has(spec.wordStyleName)) {
        throw new DocxExportError(`模板中缺少样式“${spec.wordStyleName}”。`)
      }
    }
    this.numbering = await this.findQuestionNumbering(styles)
  }

  /** 找到题目与小问所用的编号定义，用于在大标题处重新开始题号 */
  private async findQuestionNumbering(styles: Element): Promise<ExportContext['numbering']> {
    const qStyleId = this.styleIds.get(STYLE_SPECS.question.wordStyleName)!
    const subStyleId = this.styleIds.get(STYLE_SPECS.subQuestion.wordStyleName)!
    const qStyle = descendants(styles, W, 'style').find((s) => attr(s, W, 'styleId') === qStyleId)
    const numId = attr(qStyle && descendants(qStyle, W, 'numId')[0], W, 'val')
    const numberingXml = await this.zip.file('word/numbering.xml')?.async('string')
    if (numId === undefined || numberingXml === undefined) return null
    const numbering = parseXml(numberingXml).documentElement as Element
    const num = descendants(numbering, W, 'num').find((n) => attr(n, W, 'numId') === numId)
    const abstractId = attr(num && child(num, W, 'abstractNumId'), W, 'val')
    const abstract = descendants(numbering, W, 'abstractNum').find((a) => attr(a, W, 'abstractNumId') === abstractId)
    if (abstractId === undefined || abstract === undefined) return null
    const levelOf = (styleId: string): string | undefined =>
      descendants(abstract, W, 'lvl').find((l) => attr(child(l, W, 'pStyle'), W, 'val') === styleId)?.getAttributeNS(W, 'ilvl') ?? undefined
    const questionLevel = levelOf(qStyleId)
    const subLevel = levelOf(subStyleId)
    if (questionLevel === undefined || subLevel === undefined) return null
    return { questionStyleId: qStyleId, numId, abstractId, questionLevel, subLevel }
  }

  // ---------------- 段落 ----------------

  paragraph(p: DocParagraph): string {
    // 表格不能放在段落里：先写其余内容（如题号）组成的段落，再写表格
    if (p.runs.some((r) => r.kind === 'table')) {
      const rest = p.runs.filter((r) => r.kind !== 'table')
      const hasOther = rest.some((r) => !(r.kind === 'text' && r.text.trim() === ''))
      let out = hasOther || p.label !== undefined ? this.paragraph({ ...p, runs: rest }) : ''
      for (const r of p.runs) if (r.kind === 'table') out += this.table(r.table)
      return out
    }
    const spec = STYLE_SPECS[p.style]
    if (p.restartNumbering === true && this.numbering !== null) {
      this.currentNumId = this.newRestartNum()
    }

    let pPr = `<w:pStyle w:val="${this.styleIds.get(spec.wordStyleName)!}"/>`
    if (p.keepNext === true) pPr += '<w:keepNext/>'
    // 含浮动图片的段落不写“段中不分页”：WPS 遇到这种段落会把图片排在段落上方、文字不环绕
    // （用户用 WPS 对照测试确认：只有“与下段同页”或都不设时正常）。“与下段同页”保留，整题仍连在一起
    if (p.keepLines === true && (p.floatingImages ?? []).length === 0) pPr += '<w:keepLines/>'
    if (p.pageBreakBefore === true) pPr += '<w:pageBreakBefore/>'
    // 不编号的题干：numId 0 取消“题目”样式自带的编号
    const numPr = p.unnumbered === true || p.manualLabel === true ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>' : this.numPrFor(p.style)
    if (numPr !== '') pPr += numPr
    if (p.shaded === true) pPr += `<w:shd w:val="clear" w:color="auto" w:fill="${TEACHER_SHADING}"/>`
    if (p.tabStopsTwip !== undefined) pPr += tabsXml(p.style, p.tabStopsTwip)
    if (p.spacerTwip !== undefined) {
      pPr += `<w:spacing w:before="0" w:after="0" w:line="${p.spacerTwip}" w:lineRule="exact"/>`
    } else if (p.lineAuto !== undefined) {
      // 版式设置中的行距：只改行距，段前段后随样式
      pPr += `<w:spacing w:line="${p.lineAuto}" w:lineRule="auto"/>`
    }
    if (p.manualLabel === true && p.indentLeftTwip === undefined) {
      // 取消了自动编号：悬挂缩进照样式（题号与题干之间的制表符落在左缩进处）
      pPr += `<w:ind w:left="${spec.indentLeftTwip ?? 0}" w:hanging="${spec.hangingTwip ?? 0}"/>`
    } else if (spec.directIndentTwip !== undefined || p.firstLineIndentTwip !== undefined || p.indentLeftTwip !== undefined) {
      const leftTwip = p.indentLeftTwip ?? spec.directIndentTwip
      const left = leftTwip !== undefined ? ` w:left="${leftTwip}"` : ''
      pPr += `<w:ind${left} w:firstLine="${p.firstLineIndentTwip ?? 0}"/>`
    }
    if (p.align !== undefined) pPr += `<w:jc w:val="${p.align}"/>`

    let runs = ''
    for (const f of p.floatingImages ?? []) runs += this.drawing(f, 'anchor', f)
    if (p.label !== undefined && p.manualLabel === true) runs += textRun(p.label, undefined) + '<w:r><w:tab/></w:r>'
    else if (p.label !== undefined && spec.autoNumbered !== true) runs += textRun(p.label, undefined)
    for (const run of p.runs) runs += this.run(run, p.font)
    return `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`
  }

  private newRestartNum(): string {
    const id = String(9000 + this.restartNumIds.length)
    this.restartNumIds.push(id)
    return id
  }

  /** 重新开始编号后，题目与小问段落要显式指向新的编号实例 */
  private numPrFor(style: StyleKey): string {
    if (this.currentNumId === null || this.numbering === null) return ''
    if (style === 'question') return `<w:numPr><w:ilvl w:val="${this.numbering.questionLevel}"/><w:numId w:val="${this.currentNumId}"/></w:numPr>`
    if (style === 'subQuestion') return `<w:numPr><w:ilvl w:val="${this.numbering.subLevel}"/><w:numId w:val="${this.currentNumId}"/></w:numPr>`
    return ''
  }

  /**
   * 表格：细实线边框、固定列宽、居中；合并单元格写成 gridSpan / vMerge（被上方单元格覆盖的位置写续行单元格）。
   * 单元格中的段落用正文样式，但不缩进、段前段后为 0。
   */
  private table(t: DocTable): string {
    const grid = layoutTable(t.rows)
    const widths = t.colWidthsTwip.length === grid.cols ? t.colWidthsTwip : Array.from({ length: grid.cols }, () => Math.floor(contentWidthTwip(A4_PAGE) / Math.max(1, grid.cols)))
    const total = widths.reduce((a, b) => a + b, 0)
    const span = (c: number, n: number): number => widths.slice(c, c + n).reduce((a, b) => a + b, 0)
    const colored = t.borderColor !== undefined
    const border = (name: string): string => `<w:${name} w:val="single" w:sz="${colored ? 6 : 4}" w:space="0" w:color="${t.borderColor ?? 'auto'}"/>`
    const bodyStyle = this.styleIds.get(STYLE_SPECS.body.wordStyleName)
    // 书写横线：固定行高的空段落，下方虚线（相邻的几行边框相同，Word 会合成一组，所以同时写 between）
    const ruleBorder = (name: string): string => `<w:${name} w:val="dotted" w:sz="6" w:space="1" w:color="${RULE_LINE_COLOR}"/>`
    const cellPara = (cp: DocCellParagraph | undefined): string =>
      cp?.ruleLine === true
        ? `<w:p><w:pPr>${bodyStyle !== undefined ? `<w:pStyle w:val="${bodyStyle}"/>` : ''}<w:pBdr>${ruleBorder('bottom')}${ruleBorder('between')}</w:pBdr><w:spacing w:before="0" w:after="0" w:line="${RULE_LINE_TWIP}" w:lineRule="exact"/><w:ind w:left="0" w:firstLine="0" w:firstLineChars="0"/></w:pPr></w:p>`
        : `<w:p><w:pPr>${bodyStyle !== undefined ? `<w:pStyle w:val="${bodyStyle}"/>` : ''}<w:spacing w:before="0" w:after="0"/><w:ind w:left="0" w:firstLine="0" w:firstLineChars="0"/>${cp?.align !== undefined ? `<w:jc w:val="${cp.align}"/>` : ''}</w:pPr>${(cp?.runs ?? []).map((r) => this.run(r, cp?.font)).join('')}</w:p>`
    let xml =
      `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:jc w:val="center"/>` +
      `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
      `<w:tblLayout w:type="fixed"/>` +
      // 彩色边框的表格（题型整理对照表）单元格留白大一些，与样张一致；预览的 .doc-table--roomy 与此相同
      (colored
        ? `<w:tblCellMar><w:top w:w="${ROOMY_CELL_TWIP.top}" w:type="dxa"/><w:left w:w="${ROOMY_CELL_TWIP.side}" w:type="dxa"/><w:bottom w:w="${ROOMY_CELL_TWIP.top}" w:type="dxa"/><w:right w:w="${ROOMY_CELL_TWIP.side}" w:type="dxa"/></w:tblCellMar></w:tblPr>`
        : `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`) +
      `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
    for (let r = 0; r < grid.rows; r++) {
      // 彩色边框的表格（题型整理对照表）：行不跨页、表头在续页重复，与样张一致
      xml += colored ? `<w:tr><w:trPr><w:cantSplit/>${r === 0 && t.headerRow === true ? '<w:tblHeader/>' : ''}</w:trPr>` : '<w:tr>'
      for (let c = 0; c < grid.cols; ) {
        const owner = grid.owner[r]![c]
        if (owner === undefined) {
          // 行中缺的格子补空单元格
          xml += `<w:tc><w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/></w:tcPr>${cellPara(undefined)}</w:tc>`
          c += 1
          continue
        }
        const gridSpan = owner.colSpan > 1 ? `<w:gridSpan w:val="${owner.colSpan}"/>` : ''
        const w = `<w:tcW w:w="${span(c, owner.colSpan)}" w:type="dxa"/>`
        if (owner.row !== r) {
          // 被上方单元格覆盖：续行单元格
          xml += `<w:tc><w:tcPr>${w}${gridSpan}<w:vMerge/></w:tcPr>${cellPara(undefined)}</w:tc>`
        } else {
          const cell = owner.cell
          const vMerge = owner.rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''
          const shd = cell.shading !== undefined ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shading}"/>` : ''
          const paras = cell.paragraphs.length > 0 ? cell.paragraphs.map(cellPara).join('') : cellPara(undefined)
          xml += `<w:tc><w:tcPr>${w}${gridSpan}${vMerge}${shd}<w:vAlign w:val="${t.valign ?? 'center'}"/></w:tcPr>${paras}</w:tc>`
        }
        c += owner.colSpan
      }
      xml += '</w:tr>'
    }
    return xml + '</w:tbl>'
  }

  private run(run: DocRun, paraFont: FontFamily | undefined): string {
    switch (run.kind) {
      case 'text':
        // 文字自身的字体优先，其次是整段字体；都没有时随样式
        return textRun(run.text, paraFont !== undefined && run.marks?.font === undefined ? { ...run.marks, font: paraFont } : run.marks)
      case 'tab':
        return '<w:r><w:tab/></w:r>'
      case 'blank':
        return `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${'\u3000'.repeat(Math.max(1, Math.round(run.widthChars)))}</w:t></w:r>`
      case 'table':
        // 由 paragraph() 单独写成 <w:tbl>
        return ''
      case 'image':
        return this.drawing(run, 'inline')
      case 'math': {
        let omml = run.omml
        if (omml === undefined && run.latex !== undefined) {
          try {
            omml = latexToOmml(run.latex)
          } catch {
            // LaTeX 有误时按文字写出，老师在 Word 中能看到并修改
            return textRun(run.latex, { italic: true, color: 'C00000' })
          }
        }
        if (omml === undefined) return ''
        omml = applyMathMarks(normalizeOmml(omml), run)
        if (this.mathUpright) omml = uprightOmml(omml)
        return run.display === true ? `<m:oMathPara>${omml}</m:oMathPara>` : omml
      }
    }
  }

  // ---------------- 图片 ----------------

  private mediaRel(assetId: string): string {
    const existing = this.mediaByAsset.get(assetId)
    if (existing !== undefined) return existing
    const asset = this.assets[assetId]
    if (asset === undefined) throw new DocxExportError(`缺少图片资源：${assetId}`)
    if (!WORD_IMAGE_MIMES.has(asset.mime)) {
      throw new DocxExportError(`图片格式 ${asset.mime} 需要先转换为 PNG。`)
    }
    const ext = extForMime(asset.mime)
    this.usedExtensions.add(ext)
    const rid = `rIdTp${++this.relCounter}`
    const target = `media/tp-${assetId.slice(0, 16)}.${ext}`
    this.zip.file(`word/${target}`, asset.data)
    this.docRels.push(`<Relationship Id="${rid}" Type="${IMAGE_REL}" Target="${target}"/>`)
    this.mediaByAsset.set(assetId, rid)
    return rid
  }

  private drawing(
    img: { assetId: string; widthEmu: number; heightEmu: number },
    mode: 'inline' | 'anchor',
    float?: FloatingImage
  ): string {
    const rid = this.mediaRel(img.assetId)
    const id = ++this.drawingId
    const cx = Math.round(img.widthEmu)
    const cy = Math.round(img.heightEmu)
    const graphic =
      `<wp:docPr id="${id}" name="图片 ${id}"/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC_NS}"><pic:pic xmlns:pic="${PIC_NS}">` +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="图片 ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic>`
    if (mode === 'inline') {
      return (
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
        `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${graphic}</wp:inline></w:drawing></w:r>`
      )
    }
    // 浮动图：四周型环绕，垂直方向相对所在段落。写法与用户在 Word / WPS 中排好的文档完全一致——
    // 水平位置用距栏左侧的数值（不用 <wp:align>）、wrapText="bothSides"、allowOverlap="1"、左右间距 FLOAT_GAP_EMU。
    // 曾写成 wrapText="left"（文字只在左侧）+ 右对齐 + allowOverlap="0"：Word 正常，但 WPS 把图排到段落上方、
    // 文字不环绕。图片贴着栏的一侧，另一侧放不下文字，bothSides 与只在一侧环绕效果相同。
    const f = float!
    const columnEmu = contentWidthTwip(A4_PAGE) * 635
    const x = Math.max(0, Math.round(f.side === 'right' ? columnEmu - f.edgeEmu - cx : f.edgeEmu))
    return (
      `<w:r><w:drawing><wp:anchor distT="0" distB="45720" distL="${FLOAT_GAP_EMU}" distR="${FLOAT_GAP_EMU}" simplePos="0" relativeHeight="${251659264 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(f.offsetYEmu)}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:wrapSquare wrapText="bothSides"/>${graphic}</wp:anchor></w:drawing></w:r>`
    )
  }

  // ---------------- 页眉 ----------------

  async writeHeaders(ir: DocIR): Promise<void> {
    const headerPaths = Object.keys(this.zip.files).filter((p) => /^word\/header\d+\.xml$/.test(p))
    for (const path of headerPaths) {
      const relsPath = path.replace('word/', 'word/_rels/') + '.rels'
      const headerDoc = parseXml(await readText(this.zip, path))
      const root = headerDoc.documentElement as Element
      const relsXml = (await this.zip.file(relsPath)?.async('string')) ?? `<Relationships xmlns="${NS.rel}"></Relationships>`
      const relsDoc = parseXml(relsXml)
      const relsRoot = relsDoc.documentElement as Element

      const images: Record<string, HeaderImage | undefined> = {
        'tp:logo': ir.header.logo,
        'tp:phone-icon': ir.header.phone === '' ? undefined : ir.header.phoneIcon,
        'tp:watermark': ir.header.watermark
      }
      for (const docPr of descendants(root, WP, 'docPr')) {
        const name = docPr.getAttribute('name') ?? ''
        if (!(name in images)) continue
        const holder = docPr.parentNode as Element // wp:inline 或 wp:anchor
        const img = images[name]
        if (img === undefined) {
          removeEnclosingRun(holder)
          continue
        }
        const asset = this.assets[img.assetId]
        if (asset === undefined || !WORD_IMAGE_MIMES.has(asset.mime)) {
          removeEnclosingRun(holder)
          continue
        }
        const ext = extForMime(asset.mime)
        this.usedExtensions.add(ext)
        const target = `media/tp-header-${name.slice(3)}.${ext}`
        this.zip.file(`word/${target}`, asset.data)
        const rid = `rIdTpH${++this.relCounter}`
        const rel = relsDoc.createElementNS(NS.rel, 'Relationship')
        rel.setAttribute('Id', rid)
        rel.setAttribute('Type', IMAGE_REL)
        rel.setAttribute('Target', target)
        relsRoot.appendChild(rel)
        for (const blip of descendants(holder, A, 'blip')) blip.setAttributeNS(R, 'r:embed', rid)
        for (const ext of [...descendants(holder, WP, 'extent'), ...descendants(holder, A, 'ext')]) {
          if (ext.hasAttribute('cx')) {
            ext.setAttribute('cx', String(Math.round(img.widthEmu)))
            ext.setAttribute('cy', String(Math.round(img.heightEmu)))
          }
        }
      }

      // 文字占位符
      const values: Record<string, string> = {
        '{{headerLeft}}': ir.header.left,
        '{{headerRight}}': ir.header.right,
        '{{phone}}': ir.header.phone
      }
      for (const t of descendants(root, W, 't')) {
        const text = t.textContent ?? ''
        if (!text.includes('{{')) continue
        let next = text
        for (const [k, v] of Object.entries(values)) next = next.split(k).join(v)
        if (next === '' && text === '{{phone}}') {
          removeEnclosingRun(t)
          continue
        }
        t.textContent = next
        t.setAttribute('xml:space', 'preserve')
      }

      // 删掉不再引用的图片关系与文件
      const xml = serializeXml(headerDoc)
      for (const rel of Array.from(descendants(relsRoot, NS.rel, 'Relationship'))) {
        const id = rel.getAttribute('Id') ?? ''
        const isImage = (rel.getAttribute('Type') ?? '').endsWith('/image')
        if (isImage && !xml.includes(`"${id}"`)) {
          const target = rel.getAttribute('Target') ?? ''
          rel.parentNode?.removeChild(rel)
          if (!(await this.isMediaReferencedElsewhere(target, relsPath))) this.zip.remove(`word/${target}`)
        }
      }

      this.zip.file(path, xml)
      this.zip.file(relsPath, serializeXml(relsDoc))
    }
  }

  private async isMediaReferencedElsewhere(target: string, exceptRels: string): Promise<boolean> {
    for (const p of Object.keys(this.zip.files)) {
      if (!p.endsWith('.rels') || p === exceptRels) continue
      if ((await this.zip.file(p)!.async('string')).includes(`"${target}"`)) return true
    }
    return false
  }

  // ---------------- 收尾 ----------------

  async finish(title: string): Promise<void> {
    // 正文图片关系
    const relsPath = 'word/_rels/document.xml.rels'
    let rels = await readText(this.zip, relsPath)
    rels = rels.replace('</Relationships>', `${this.docRels.join('')}</Relationships>`)
    this.zip.file(relsPath, rels)

    // 重新开始编号的实例
    if (this.restartNumIds.length > 0 && this.numbering !== null) {
      const { abstractId, questionLevel } = this.numbering
      let numbering = await readText(this.zip, 'word/numbering.xml')
      const nums = this.restartNumIds
        .map(
          (id) =>
            `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractId}"/><w:lvlOverride w:ilvl="${questionLevel}"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`
        )
        .join('')
      // w:num 必须位于全部 w:abstractNum 之后：追加到末尾即可
      numbering = numbering.replace('</w:numbering>', `${nums}</w:numbering>`)
      this.zip.file('word/numbering.xml', numbering)
    }

    // 内容类型
    let types = await readText(this.zip, '[Content_Types].xml')
    const contentTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      gif: 'image/gif',
      bmp: 'image/bmp',
      emf: 'image/x-emf',
      wmf: 'image/x-wmf'
    }
    for (const ext of this.usedExtensions) {
      if (!new RegExp(`Extension="${ext}"`, 'i').test(types) && contentTypes[ext] !== undefined) {
        types = types.replace('<Default ', `<Default Extension="${ext}" ContentType="${contentTypes[ext]}"/><Default `)
      }
    }
    this.zip.file('[Content_Types].xml', types)

    // 文档属性：标题
    const corePath = 'docProps/core.xml'
    const core = await this.zip.file(corePath)?.async('string')
    if (core !== undefined) {
      const escaped = escapeXml(title)
      const next = /<dc:title>[^<]*<\/dc:title>/.test(core)
        ? core.replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${escaped}</dc:title>`)
        : core.replace('</cp:coreProperties>', `<dc:title>${escaped}</dc:title></cp:coreProperties>`)
      this.zip.file(corePath, next)
    }
  }
}

// ---------------- 工具函数 ----------------

/**
 * 段落制表位。Word 中段落的制表位叠加在样式的制表位之上，所以选项段落要先清除
 * 模板“题目 选项”样式自带、但这次没用到的制表位，否则 Tab 会先停在旧位置。
 */
function tabsXml(style: StyleKey, stops: readonly number[]): string {
  const entries = stops.map((pos) => ({ pos, val: 'left' }))
  if (style === 'option') {
    for (const pos of TEMPLATE_OPTION_TAB_STOPS) if (!stops.includes(pos)) entries.push({ pos, val: 'clear' })
  }
  entries.sort((a, b) => a.pos - b.pos)
  return `<w:tabs>${entries.map((e) => `<w:tab w:val="${e.val}" w:pos="${e.pos}"/>`).join('')}</w:tabs>`
}

function textRun(text: string, marks: TextMarks | undefined): string {
  if (text === '') return ''
  let rPr = ''
  if (marks !== undefined) {
    // 只设东亚字体：字母、数字仍用样式中的西文字体
    if (marks.font !== undefined) rPr += `<w:rFonts w:eastAsia="${WORD_FONT_NAMES[marks.font]}" w:hint="eastAsia"/>`
    if (marks.bold === true) rPr += '<w:b/><w:bCs/>'
    if (marks.italic === true) rPr += '<w:i/><w:iCs/>'
    if (marks.color !== undefined) rPr += `<w:color w:val="${marks.color}"/>`
    if (marks.underline === true) rPr += '<w:u w:val="single"/>'
    if (marks.script !== undefined) rPr += `<w:vertAlign w:val="${marks.script === 'sup' ? 'superscript' : 'subscript'}"/>`
  }
  return `<w:r>${rPr === '' ? '' : `<w:rPr>${rPr}</w:rPr>`}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

/**
 * 整理公式 XML：
 * - 正文根元素已声明 m、w 命名空间，去掉公式自带的重复声明；
 * - WPS 会在同一段公式文字上同时写“普通文本”(m:nor) 与“正体”(m:sty)，规范只允许二者之一，
 *   普通文本本身就是正体，所以去掉 m:sty。
 */
function normalizeOmml(omml: string): string {
  return omml
    .replace(/ xmlns:(m|w)="[^"]*"/g, '')
    .replace(/<m:rPr>((?:(?!<\/m:rPr>).)*)<\/m:rPr>/g, (whole, inner: string) =>
      /<m:nor\b/.test(inner) ? `<m:rPr>${inner.replace(/<m:sty\b[^>]*\/>/g, '')}</m:rPr>` : whole
    )
}

function removeEnclosingRun(node: Element): void {
  let el: Element | null = node
  while (el !== null && !(el.namespaceURI === W && el.localName === 'r')) el = el.parentNode as Element | null
  const target = el ?? node
  target.parentNode?.removeChild(target)
}

async function readText(zip: JSZip, path: string): Promise<string> {
  const text = await zip.file(path)?.async('string')
  if (text === undefined) throw new DocxExportError(`模板中缺少 ${path}。`)
  return text
}
