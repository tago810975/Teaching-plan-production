/**
 * 教学案库：首页列出的所有教学案。
 *
 * - 库目录：默认“文档/教学案”，新建的教学案保存在这里；首页自动扫描其中的 .tplan 文件。
 * - 最近打开：库目录之外打开过的教学案也会记录下来，一并显示在首页。
 *
 * 设置与记录保存在用户数据目录（Windows 下为 %APPDATA%/<应用名>）。
 */
import { app } from 'electron'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createEmptyBundle } from '@core/model/factory'
import { decodeSummary } from '@core/project-file/codec'
import { PROJECT_FILE_EXTENSION } from '@core/project-file/format'
import { withTemplateDefaults } from '@core/template/defaults'
import type { Asset, Block } from '@core/model/types'
import type { LibraryListing, OpenedProject, ProjectListItem } from '@shared/ipc'
import { isProjectFilePath, sanitizeFileName, writeProjectFile } from './project-io'
import { readTemplateDefaults } from './template-io'
import { getPreset } from '@core/presets'
import { sanitizeSchemes, type OptionStopScheme } from '@core/model/option-stop-schemes'

const MAX_RECENT = 30
/** 扫描库目录时的最大子目录深度（库目录本身为 0） */
const MAX_SCAN_DEPTH = 2

interface Settings {
  libraryDir?: string
  /** 导入（从 Word 新建）时默认使用的格式预设 */
  defaultPresetId?: string
  /** 用户保存的选项间距方案 */
  optionStopSchemes?: unknown
}

interface RecentEntry {
  filePath: string
  openedAt: string
}

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')
const recentPath = (): string => join(app.getPath('userData'), 'recent.json')

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

// ---------- 库目录 ----------

export async function getLibraryDir(): Promise<string> {
  const settings = await readJsonFile<Settings>(settingsPath(), {})
  const dir = settings.libraryDir ?? join(app.getPath('documents'), '教学案')
  await mkdir(dir, { recursive: true })
  return dir
}

export async function setLibraryDir(dir: string): Promise<void> {
  const settings = await readJsonFile<Settings>(settingsPath(), {})
  await writeFile(settingsPath(), JSON.stringify({ ...settings, libraryDir: dir }, null, 2))
}

// ---------- 默认格式预设 ----------

export async function getDefaultPresetId(): Promise<string> {
  const settings = await readJsonFile<Settings>(settingsPath(), {})
  // 设置中的预设已不存在（例如被移除）时回到默认预设
  return getPreset(settings.defaultPresetId).id
}

export async function setDefaultPresetId(presetId: string): Promise<void> {
  const settings = await readJsonFile<Settings>(settingsPath(), {})
  await writeFile(settingsPath(), JSON.stringify({ ...settings, defaultPresetId: getPreset(presetId).id }, null, 2))
}

// ---------- 选项间距方案 ----------

export async function getOptionStopSchemes(): Promise<OptionStopScheme[]> {
  const settings = await readJsonFile<Settings>(settingsPath(), {})
  return sanitizeSchemes(settings.optionStopSchemes)
}

/** 保存并返回整理后的方案列表 */
export async function setOptionStopSchemes(schemes: unknown): Promise<OptionStopScheme[]> {
  const clean = sanitizeSchemes(schemes)
  const settings = await readJsonFile<Settings>(settingsPath(), {})
  await writeFile(settingsPath(), JSON.stringify({ ...settings, optionStopSchemes: clean }, null, 2))
  return clean
}

// ---------- 最近打开 ----------

export async function addRecent(filePath: string): Promise<void> {
  const list = await readJsonFile<RecentEntry[]>(recentPath(), [])
  const key = normalize(filePath)
  const next = [
    { filePath, openedAt: new Date().toISOString() },
    ...list.filter((e) => normalize(e.filePath) !== key)
  ].slice(0, MAX_RECENT)
  await writeFile(recentPath(), JSON.stringify(next, null, 2))
  app.addRecentDocument(filePath)
}

export async function removeRecent(filePath: string): Promise<void> {
  const list = await readJsonFile<RecentEntry[]>(recentPath(), [])
  const key = normalize(filePath)
  await writeFile(recentPath(), JSON.stringify(list.filter((e) => normalize(e.filePath) !== key), null, 2))
}

/** 文件改名后，最近打开中的记录跟着改 */
export async function renameRecent(from: string, to: string): Promise<void> {
  const list = await readJsonFile<RecentEntry[]>(recentPath(), [])
  const key = normalize(from)
  await writeFile(recentPath(), JSON.stringify(list.map((e) => (normalize(e.filePath) === key ? { ...e, filePath: to } : e)), null, 2))
}

// ---------- 列表 ----------

export async function listProjects(): Promise<LibraryListing> {
  const libraryDir = await getLibraryDir()
  const recent = await readJsonFile<RecentEntry[]>(recentPath(), [])
  const openedAt = new Map(recent.map((e) => [normalize(e.filePath), e.openedAt]))

  const paths = new Map<string, string>()
  for (const p of await scanDir(libraryDir, 0)) paths.set(normalize(p), p)
  for (const e of recent) if (!paths.has(normalize(e.filePath))) paths.set(normalize(e.filePath), e.filePath)

  const items = await Promise.all(
    [...paths.entries()].map(([key, filePath]) => describe(filePath, libraryDir, openedAt.get(key)))
  )
  return { libraryDir, items }
}

async function describe(filePath: string, libraryDir: string, openedAt?: string): Promise<ProjectListItem> {
  const inLibrary = isInside(filePath, libraryDir)
  const base = { filePath, inLibrary, ...(openedAt !== undefined ? { openedAt } : {}) }
  let info
  try {
    info = await stat(filePath)
  } catch {
    return { ...base, status: 'missing' }
  }
  try {
    const bytes = await readFile(filePath)
    const summary = await decodeSummary(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    return { ...base, status: 'ok', summary, modifiedAt: info.mtime.toISOString(), sizeBytes: info.size }
  } catch (err) {
    return {
      ...base,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      modifiedAt: info.mtime.toISOString()
    }
  }
}

async function scanDir(dir: string, depth: number): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue // 跳过隐藏文件与保存时的临时文件
    const full = join(dir, entry.name)
    if (entry.isFile() && isProjectFilePath(entry.name)) found.push(full)
    else if (entry.isDirectory() && depth < MAX_SCAN_DEPTH) found.push(...(await scanDir(full, depth + 1)))
  }
  return found
}

// ---------- 新建 ----------

export async function createProject(
  title: string,
  dir: string | null,
  templateId: string,
  content?: { blocks: Block[]; assets: Record<string, Asset> },
  presetId?: string
): Promise<OpenedProject> {
  const targetDir = dir ?? (await getLibraryDir())
  await mkdir(targetDir, { recursive: true })
  const filePath = await uniquePath(targetDir, sanitizeFileName(title))

  const defaults = await readTemplateDefaults(templateId)
  const bundle = withTemplateDefaults(createEmptyBundle(), defaults)
  bundle.project.meta.title = title.trim() === '' ? '未命名教学案' : title.trim()
  bundle.project.templateId = templateId
  const preset = getPreset(presetId)
  bundle.project.presetId = preset.id
  // 预设规定的页眉左侧文字（如知识点手册为“墨帝教育物理知识单”）
  if (preset.header.left !== undefined) bundle.project.header = { ...bundle.project.header, left: preset.header.left }
  if (content !== undefined) {
    bundle.project.blocks = content.blocks
    bundle.assets = { ...bundle.assets, ...content.assets }
  }

  await writeProjectFile(filePath, bundle, app.getVersion())
  await addRecent(filePath)
  return { filePath, bundle }
}

/** 同名文件已存在时依次尝试“名称 (2)”“名称 (3)”…… */
async function uniquePath(dir: string, name: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = join(dir, `${i === 1 ? name : `${name} (${i})`}.${PROJECT_FILE_EXTENSION}`)
    try {
      await stat(candidate)
    } catch {
      return candidate
    }
  }
}

// ---------- 工具 ----------

/** Windows 路径不区分大小写 */
function normalize(p: string): string {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

function isInside(filePath: string, dir: string): boolean {
  const rel = relative(normalize(dir), normalize(filePath))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
