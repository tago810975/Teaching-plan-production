/**
 * 从参考样例生成 Word 导出模板：resources/templates/physics-default/template.docx
 *
 * 处理内容：
 * 1. 清空正文，只保留分节设置（纸张、页边距、页眉页脚引用）；
 * 2. 把页眉文字替换为占位符 {{headerLeft}}、{{phone}}、{{headerRight}}，
 *    并给页眉中的三张图片标上名称 tp:logo、tp:phone-icon、tp:watermark，
 *    导出时据此替换为工程中的图片，或在工程未设置时删除；
 * 3. 删除正文图片及其关系，只保留页眉页脚用到的图片（Logo、水印）。
 *
 * 用法：node scripts/build-template.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'

const root = join(import.meta.dirname, '..')
const SAMPLE = join(root, 'reference/samples/2026秋季高二物理敏思_动态圆专题/教案_T_动态圆专题.docx')
const OUT = join(root, 'resources/templates/physics-default/template.docx')

const zip = await JSZip.loadAsync(await readFile(SAMPLE))

// 1. 正文只留 sectPr
const docPath = 'word/document.xml'
let doc = await zip.file(docPath).async('string')
const bodyStart = doc.indexOf('<w:body>') + '<w:body>'.length
const sectStart = doc.lastIndexOf('<w:sectPr')
if (bodyStart < 8 || sectStart < bodyStart) throw new Error('未找到正文或分节设置')
doc = doc.slice(0, bodyStart) + '{{body}}' + doc.slice(sectStart)
zip.file(docPath, doc)

// 2. 页眉占位符：把相连的文字片段合并替换
const headerPath = 'word/header1.xml'
let header = await zip.file(headerPath).async('string')
header = replaceRunTexts(header, ['墨帝教育', '秋', '季学期'], '{{headerLeft}}')
header = replaceRunTexts(header, ['高二物理', '勤敏', '(', '教', '案)'], '{{headerRight}}')
header = replaceRunTexts(header, ['134-8210-2204'], '{{phone}}')
for (const [from, to] of [
  ['图片 1', 'tp:logo'],
  ['图片 2', 'tp:phone-icon'],
  ['WordPictureWatermark56565', 'tp:watermark']
]) {
  if (!header.includes(`name="${from}"`)) throw new Error(`页眉中未找到图片：${from}`)
  header = header.replace(`name="${from}"`, `name="${to}"`)
}
zip.file(headerPath, header)

// 3. 只保留正文以外仍被引用的关系
const relsPath = 'word/_rels/document.xml.rels'
let rels = await zip.file(relsPath).async('string')
const removedTargets = []
rels = rels.replace(/<Relationship [^>]*\/>/g, (rel) => {
  const isImage = /Type="[^"]*\/image"/.test(rel)
  const id = rel.match(/Id="([^"]+)"/)[1]
  if (isImage && !doc.includes(`"${id}"`)) {
    removedTargets.push(rel.match(/Target="([^"]+)"/)[1])
    return ''
  }
  return rel
})
zip.file(relsPath, rels)

const headerRels = (await zip.file('word/_rels/header1.xml.rels')?.async('string')) ?? ''
for (const target of removedTargets) {
  if (!headerRels.includes(`"${target}"`)) zip.remove(`word/${target}`)
}

// 去掉 WPS 自定义属性与 customXml，模板不需要
zip.remove('docProps/custom.xml')
zip.remove('customXml')
let types = await zip.file('[Content_Types].xml').async('string')
types = types.replace(/<Override PartName="\/(docProps\/custom\.xml|customXml\/[^"]+)"[^>]*\/>/g, '')
zip.file('[Content_Types].xml', types)
let rootRels = await zip.file('_rels/.rels').async('string')
rootRels = rootRels.replace(/<Relationship [^>]*Target="docProps\/custom\.xml"[^>]*\/>/g, '')
zip.file('_rels/.rels', rootRels)
let docRels = await zip.file(relsPath).async('string')
docRels = docRels.replace(/<Relationship [^>]*Target="\.\.\/customXml\/[^"]+"[^>]*\/>/g, '')
zip.file(relsPath, docRels)

const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
await writeFile(OUT, bytes)
console.log(`已生成 ${OUT}（${(bytes.length / 1024).toFixed(0)} KB），删除正文图片 ${removedTargets.length} 张`)

/**
 * 页眉中一段文字被拆成多个 <w:t>：把第一段替换为 replacement，其余各段清空。
 * 要求这些片段按顺序出现且彼此相邻（中间只隔 XML 标签）。
 */
function replaceRunTexts(xml, pieces, replacement) {
  const textRe = /(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g
  const matches = [...xml.matchAll(textRe)]
  for (let i = 0; i + pieces.length <= matches.length; i++) {
    if (pieces.every((p, k) => matches[i + k][2] === p)) {
      let out = ''
      let last = 0
      matches.slice(i, i + pieces.length).forEach((m, k) => {
        out += xml.slice(last, m.index) + m[1] + (k === 0 ? replacement : '') + m[3]
        last = m.index + m[0].length
      })
      return out + xml.slice(last)
    }
  }
  throw new Error(`页眉中未找到文字：${pieces.join('')}`)
}
