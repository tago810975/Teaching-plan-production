/**
 * 工程文件编解码：ProjectBundle <-> ZIP 字节。
 *
 * 只做内存中的转换，不读写磁盘，因此主进程、渲染进程和测试都能使用。
 * 磁盘读写（含原子写入）在主进程的 project-io.ts 中完成。
 */
import JSZip from 'jszip'
import { projectSchema } from '../model/schema'
import { countQuestions } from '../model/stats'
import { copyStops, DEFAULT_PRESET_ID, LEGACY_OPTION_STOPS } from '../model/factory'
import type { Asset, Project, ProjectBundle } from '../model/types'
import {
  CURRENT_FORMAT_VERSION,
  PROJECT_FILE_MIMETYPE,
  extForMime,
  mimeForExt,
  type Manifest
} from './format'

export class ProjectFileError extends Error {
  override name = 'ProjectFileError'
}

/** 计算资源 ID（内容的 SHA-256 十六进制） */
export async function computeAssetId(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createAsset(data: Uint8Array, mime: string): Promise<Asset> {
  return { id: await computeAssetId(data), mime, data }
}

/** 收集工程中实际引用到的资源 ID */
export function collectAssetRefs(project: Project): Set<string> {
  const refs = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      if (typeof obj.assetId === 'string') refs.add(obj.assetId)
      Object.values(obj).forEach(visit)
    }
  }
  visit(project.header)
  visit(project.blocks)
  return refs
}

export interface EncodeOptions {
  appVersion: string
  now?: Date
}

/** 编码为工程文件字节。未被引用的资源会被丢弃。 */
export async function encodeBundle(
  bundle: ProjectBundle,
  { appVersion, now = new Date() }: EncodeOptions
): Promise<Uint8Array> {
  const zip = new JSZip()
  // mimetype 必须第一个写入且不压缩（同 EPUB / ODF 的约定）
  zip.file('mimetype', PROJECT_FILE_MIMETYPE, { compression: 'STORE' })

  const manifest: Manifest = {
    format: 'teaching-plan',
    formatVersion: CURRENT_FORMAT_VERSION,
    appVersion,
    savedAt: now.toISOString()
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('project.json', JSON.stringify(bundle.project, null, 2))

  for (const id of collectAssetRefs(bundle.project)) {
    const asset = bundle.assets[id]
    if (asset === undefined) {
      throw new ProjectFileError(`工程引用了不存在的图片资源：${id}`)
    }
    // 图片本身已是压缩格式，再压缩收益很小
    zip.file(`assets/${id}.${extForMime(asset.mime)}`, asset.data, { compression: 'STORE' })
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
}

/** 解码工程文件字节。格式不符、版本过新或数据损坏时抛出 ProjectFileError。 */
export async function decodeBundle(bytes: Uint8Array): Promise<ProjectBundle> {
  const { zip, project } = await openProjectZip(bytes)

  const assets: Record<string, Asset> = {}
  const entries = zip.folder('assets')?.filter((_, f) => !f.dir) ?? []
  for (const file of entries) {
    const name = file.name.slice('assets/'.length)
    const dot = name.lastIndexOf('.')
    const id = dot === -1 ? name : name.slice(0, dot)
    const ext = dot === -1 ? '' : name.slice(dot + 1)
    assets[id] = { id, mime: mimeForExt(ext), data: await file.async('uint8array') }
  }

  for (const id of collectAssetRefs(project)) {
    if (assets[id] === undefined) {
      throw new ProjectFileError(`工程文件缺少图片资源：${id}`)
    }
  }

  return { project, assets }
}

/** 工程摘要：首页列表使用，不读取图片 */
export interface ProjectSummary {
  title: string
  questionCount: number
  createdAt: string
  updatedAt: string
}

export function summarizeProject(project: Project): ProjectSummary {
  return {
    title: project.meta.title,
    questionCount: countQuestions(project.blocks),
    createdAt: project.meta.createdAt,
    updatedAt: project.meta.updatedAt
  }
}

/** 只读取工程摘要，比 decodeBundle 快得多（不解压图片） */
export async function decodeSummary(bytes: Uint8Array): Promise<ProjectSummary> {
  return summarizeProject((await openProjectZip(bytes)).project)
}

async function openProjectZip(bytes: Uint8Array): Promise<{ zip: JSZip; project: Project }> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new ProjectFileError('文件已损坏，或不是教学案工程文件。')
  }

  const mimetype = await zip.file('mimetype')?.async('string')
  if (mimetype !== PROJECT_FILE_MIMETYPE) {
    throw new ProjectFileError('这不是教学案工程文件。')
  }

  const manifest = await readJson<Manifest>(zip, 'manifest.json')
  if (manifest.format !== 'teaching-plan' || typeof manifest.formatVersion !== 'number') {
    throw new ProjectFileError('工程文件的 manifest.json 内容无效。')
  }
  if (manifest.formatVersion > CURRENT_FORMAT_VERSION) {
    throw new ProjectFileError(
      `该文件由更新版本的软件（${manifest.appVersion}）保存，请升级软件后再打开。`
    )
  }

  const raw = migrate(await readJson<unknown>(zip, 'project.json'), manifest.formatVersion)
  const parsed = projectSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.join('.') ?? ''
    throw new ProjectFileError(`工程数据格式有误（${where}）：${issue?.message ?? '未知错误'}`)
  }
  return { zip, project: parsed.data }
}

async function readJson<T>(zip: JSZip, path: string): Promise<T> {
  const text = await zip.file(path)?.async('string')
  if (text === undefined) throw new ProjectFileError(`工程文件缺少 ${path}。`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProjectFileError(`工程文件中的 ${path} 已损坏。`)
  }
}

/** 将旧版本的 project.json 迁移到当前版本 */
function migrate(raw: unknown, fromVersion: number): unknown {
  let data = raw
  if (fromVersion < 2) data = migrateV1toV2(data)
  if (fromVersion < 3) data = migrateV2toV3(data)
  if (fromVersion < 6) data = migrateV5toV6(data)
  if (fromVersion < 7) data = migrateV6toV7(data)
  return data
}

/** 版本 6 → 7：补上格式预设（此前只有物理教案 V1.0 一种格式） */
function migrateV6toV7(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const project = raw as Record<string, unknown>
  project.presetId ??= DEFAULT_PRESET_ID
  return project
}

/** 版本 5 → 6：补上选项列位置，取模板原有的制表位，保持旧工程的排版效果不变（新建工程用略宽的默认值） */
function migrateV5toV6(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const project = raw as Record<string, unknown>
  const layout = (project.layout ?? {}) as Record<string, unknown>
  layout.optionStops ??= copyStops(LEGACY_OPTION_STOPS)
  project.layout = layout
  return project
}

/**
 * 版本 1 → 2：
 * - 补上工程版式设置。旧工程原本都是“整题同页”，迁移后保持原样，不改变已有的排版效果；
 * - 题目的 keepTogether：true（旧默认）→ auto，false → never。
 */
function migrateV1toV2(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const project = raw as Record<string, unknown>
  project.layout ??= { keepQuestionTogether: { teacher: true, student: true } }
  const blocks = Array.isArray(project.blocks) ? project.blocks : []
  for (const block of blocks as Array<Record<string, unknown>>) {
    const layout = (block?.question as Record<string, unknown> | undefined)?.layout as Record<string, unknown> | undefined
    if (layout !== undefined && typeof layout.keepTogether === 'boolean') {
      layout.keepTogether = layout.keepTogether ? 'auto' : 'never'
    }
  }
  return project
}

/** 版本 2 → 3：补上知识点的默认版式设置（新增的块类型与字段都是可选的，无需改动旧数据） */
function migrateV2toV3(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const project = raw as Record<string, unknown>
  const layout = (project.layout ?? {}) as Record<string, unknown>
  layout.keepKnowledgeTogether ??= { teacher: false, student: false }
  project.layout = layout
  return project
}
