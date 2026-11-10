/**
 * 用户模板：老师自制的格式预设与 Word 模板，放在“教学案库\模板”下（默认为“文档\教学案\模板”）。
 *
 * 每个模板一个文件夹：
 *   preset.json      格式预设（必需；字段见 docs/模板制作指南.md）
 *   template.docx    Word 模板（可省；省略时用 preset.json 中 templateId 指向的内置模板）
 *   header/          默认页眉 defaults.json 与图片（可省；省略时用内置 physics-default 的页眉）
 *   README.md        说明（可省）
 *
 * 带 template.docx 的模板，其 Word 模板 ID 记为“user-<预设 id>”，工程文件中保存的就是这个 ID。
 * 内置模板在安装目录（只读，随软件升级），用户模板在这里（可写，升级不覆盖）。
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { allPresets, getPreset, isBuiltinPreset, parsePreset, PRESETS, setUserPresets, type FormatPreset } from '@core/presets'
import { checkWordTemplate } from '@core/template/check'
import type { TemplateCatalog, TemplateProblem } from '@shared/ipc'
import { getLibraryDir } from './library'
import { builtinTemplateDir, setUserTemplateDirs, templateDir } from './template-io'

export const USER_TEMPLATE_FOLDER = '模板'

/** 用户模板目录（不存在时创建） */
export async function userTemplatesDir(): Promise<string> {
  const dir = join(await getLibraryDir(), USER_TEMPLATE_FOLDER)
  await mkdir(dir, { recursive: true })
  return dir
}

/** 带 Word 模板的用户模板的模板 ID */
export const userTemplateId = (presetId: string): string => `user-${presetId}`

let catalog: TemplateCatalog = { dir: '', builtin: [], user: [], problems: [], presets: [] }

/** 读取全部用户模板并登记（主进程中的 getPreset、templateDir 随之生效）；返回给界面登记 */
export async function loadUserTemplates(): Promise<TemplateCatalog> {
  const dir = await userTemplatesDir()
  const problems: TemplateProblem[] = []
  const presets: FormatPreset[] = []
  const user: TemplateCatalog['user'] = []
  const dirs = new Map<string, string>()
  let entries: string[] = []
  try {
    entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  } catch {
    entries = []
  }
  for (const folder of entries.sort()) {
    const full = join(dir, folder)
    const result = await readTemplateFolder(full)
    if (!result.ok) {
      problems.push({ folder, message: result.error })
      continue
    }
    let preset = result.preset
    if (isBuiltinPreset(preset.id)) {
      problems.push({ folder, message: `id“${preset.id}”与内置预设相同，请在 preset.json 中改成别的 id` })
      continue
    }
    if (presets.some((p) => p.id === preset.id)) {
      problems.push({ folder, message: `id“${preset.id}”与另一个模板文件夹重复，请改成别的 id` })
      continue
    }
    if (result.hasWordTemplate) {
      preset = { ...preset, templateId: userTemplateId(preset.id) }
      dirs.set(preset.templateId, full)
    } else if (!PRESETS.some((p) => p.templateId === preset.templateId) && !preset.templateId.startsWith('user-')) {
      problems.push({ folder, message: `没有 template.docx，而 templateId“${preset.templateId}”不是内置模板` })
      continue
    }
    presets.push(preset)
    user.push({ id: preset.id, name: preset.name, description: preset.description, dir: full, hasWordTemplate: result.hasWordTemplate })
  }
  // 引用了其他用户模板的 Word 模板（templateId 为 user-xxx）但那个模板不存在
  for (const p of presets.slice()) {
    if (p.templateId.startsWith('user-') && !dirs.has(p.templateId)) {
      const info = user.find((u) => u.id === p.id)!
      problems.push({ folder: info.dir.slice(dir.length + 1), message: `templateId“${p.templateId}”指向的用户模板不存在` })
      presets.splice(presets.indexOf(p), 1)
      user.splice(user.indexOf(info), 1)
    }
  }
  setUserTemplateDirs(dirs)
  setUserPresets(presets)
  catalog = {
    dir,
    builtin: PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description })),
    user,
    problems,
    presets
  }
  return catalog
}

export function currentCatalog(): TemplateCatalog {
  return catalog
}

type FolderResult = { ok: true; preset: FormatPreset; hasWordTemplate: boolean } | { ok: false; error: string }

async function readTemplateFolder(full: string): Promise<FolderResult> {
  let json: unknown
  try {
    json = JSON.parse(await readFile(join(full, 'preset.json'), 'utf8'))
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
    return { ok: false, error: missing ? '缺少 preset.json' : `preset.json 不是有效的 JSON：${(err as Error).message}` }
  }
  const parsed = parsePreset(json)
  if (!parsed.ok) return parsed
  const docx = join(full, 'template.docx')
  const hasWordTemplate = await exists(docx)
  if (hasWordTemplate) {
    const problem = await checkWordTemplate(new Uint8Array(await readFile(docx)))
    if (problem !== null) return { ok: false, error: problem }
  }
  return { ok: true, preset: parsed.preset, hasWordTemplate }
}

// ---------------- 导出、导入、复制、删除 ----------------

/** 一个模板（内置或用户）的全部文件：preset.json、template.docx、header/ */
async function templateFiles(presetId: string): Promise<Map<string, Uint8Array | string>> {
  const preset = getPreset(presetId)
  const files = new Map<string, Uint8Array | string>()
  const user = catalog.user.find((u) => u.id === presetId)
  if (user !== undefined) {
    // 用户模板：preset.json 原样（不是登记时改写过 templateId 的那份）
    files.set('preset.json', await readFile(join(user.dir, 'preset.json'), 'utf8'))
  } else {
    files.set('preset.json', JSON.stringify(preset, null, 2) + '\n')
  }
  const wordDir = templateDir(preset.templateId)
  files.set('template.docx', new Uint8Array(await readFile(join(wordDir, 'template.docx'))))
  const headerDir = (await exists(join(wordDir, 'header', 'defaults.json'))) ? join(wordDir, 'header') : join(builtinTemplateDir('physics-default'), 'header')
  for (const name of await readdir(headerDir)) {
    if (HEADER_FILE.test(name)) files.set(`header/${name}`, new Uint8Array(await readFile(join(headerDir, name))))
  }
  if (user !== undefined && (await exists(join(user.dir, 'README.md')))) files.set('README.md', await readFile(join(user.dir, 'README.md'), 'utf8'))
  return files
}

const HEADER_FILE = /^[^/\\]+\.(json|png|jpe?g|gif)$/i

/** 导出为 zip（发给其他老师，或作为自制模板的起点） */
export async function exportTemplate(presetId: string, zipPath: string): Promise<void> {
  const zip = new JSZip()
  for (const [name, data] of await templateFiles(presetId)) zip.file(name, data)
  if (!zip.file('README.md')) zip.file('README.md', readmeFor(getPreset(presetId)))
  await writeFile(zipPath, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}

/** 复制为新的用户模板（id 加 -copy，名称加“（副本）”），返回新文件夹 */
export async function duplicateTemplate(presetId: string): Promise<string> {
  const source = getPreset(presetId)
  const taken = new Set(allPresets().map((p) => p.id))
  let id = `${source.id}-copy`
  for (let n = 2; taken.has(id); n++) id = `${source.id}-copy-${n}`
  const files = await templateFiles(presetId)
  const json = JSON.parse(String(files.get('preset.json'))) as Record<string, unknown>
  files.set('preset.json', JSON.stringify({ ...json, id, name: `${source.name}（副本）` }, null, 2) + '\n')
  if (!files.has('README.md')) files.set('README.md', readmeFor(source))
  const dir = join(await userTemplatesDir(), id)
  await writeFiles(dir, files)
  return dir
}

/** 从 zip 导入：preset.json 可在 zip 根目录或唯一的一层文件夹中；装到“模板\<id>” */
export async function importTemplate(zipPath: string): Promise<string> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(new Uint8Array(await readFile(zipPath)))
  } catch {
    throw new Error('不是有效的模板压缩包（zip）')
  }
  const presetEntry = Object.keys(zip.files).find((n) => /^([^/]+\/)?preset\.json$/.test(n))
  if (presetEntry === undefined) throw new Error('压缩包中没有 preset.json')
  const prefix = presetEntry.slice(0, presetEntry.length - 'preset.json'.length)
  const parsed = parsePreset(JSON.parse(await zip.file(presetEntry)!.async('string')))
  if (!parsed.ok) throw new Error(parsed.error)
  const { id } = parsed.preset
  if (isBuiltinPreset(id)) throw new Error(`模板的 id“${id}”与内置预设相同。请先解压，在 preset.json 中改成别的 id 再导入`)
  if (catalog.user.some((u) => u.id === id)) throw new Error(`已有 id 为“${id}”的模板。如要替换，请先在模板列表中删除它`)
  const files = new Map<string, Uint8Array>()
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith(prefix)) continue
    const rel = name.slice(prefix.length)
    // 只收这几类文件，防止压缩包把文件写到别处
    if (rel === 'preset.json' || rel === 'template.docx' || rel === 'README.md' || (rel.startsWith('header/') && HEADER_FILE.test(rel.slice(7)))) {
      files.set(rel, await entry.async('uint8array'))
    }
  }
  const docx = files.get('template.docx')
  if (docx !== undefined) {
    const problem = await checkWordTemplate(docx)
    if (problem !== null) throw new Error(problem)
  }
  const dir = join(await userTemplatesDir(), id)
  if (await exists(dir)) throw new Error(`模板文件夹中已有“${id}”文件夹，请先移走它`)
  await writeFiles(dir, files)
  return dir
}

/** 删除用户模板：文件夹移到回收站 */
export async function deleteTemplateFolder(dir: string): Promise<void> {
  const { shell } = await import('electron')
  await shell.trashItem(dir)
}

/** 自制模板的文件夹；内置模板不能删除 */
export function userTemplateDir(presetId: string): string {
  const user = catalog.user.find((u) => u.id === presetId)
  if (user === undefined) throw new Error('只能删除自己的模板，内置模板不能删除')
  return user.dir
}

async function writeFiles(dir: string, files: Map<string, Uint8Array | string>): Promise<void> {
  try {
    for (const [name, data] of files) {
      const path = join(dir, name)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
}

function readmeFor(p: FormatPreset): string {
  return `# ${p.name}

${p.description}

这是“教学案制作”软件的模板文件夹。修改方法：

- preset.json：格式预设（标题格式、栏目名、行距、是否编号、页眉文字等）。字段说明见软件仓库中的
  docs/模板制作指南.md 第 3 节。**id 只能用小写字母、数字和连字符，不能与其他模板相同**；name 是显示名。
- template.docx：Word 模板（样式、自动编号、页眉页脚）。样式名必须保留，正文中只留 {{body}}（见指南第 4 节）。
  正文、题目、选项等样式的字体字号目前由软件决定，只改模板里的这些样式会让预览与导出不一致。
- header/：新建教学案时的默认页眉（defaults.json 与图片）。

改完后在软件首页“模板…”中点“重新载入”。
`
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
