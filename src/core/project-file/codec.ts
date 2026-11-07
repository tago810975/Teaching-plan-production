/**
 * 工程文件编解码：ProjectBundle <-> ZIP 字节。
 *
 * 只做内存中的转换，不读写磁盘，因此主进程、渲染进程和测试都能使用。
 * 磁盘读写（含原子写入）在主进程的 project-io.ts 中完成。
 */
import JSZip from 'jszip'
import { projectSchema } from '../model/schema'
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
  const project: Project = parsed.data

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

async function readJson<T>(zip: JSZip, path: string): Promise<T> {
  const text = await zip.file(path)?.async('string')
  if (text === undefined) throw new ProjectFileError(`工程文件缺少 ${path}。`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProjectFileError(`工程文件中的 ${path} 已损坏。`)
  }
}

/** 将旧版本的 project.json 迁移到当前版本。目前只有版本 1，无需迁移。 */
function migrate(raw: unknown, fromVersion: number): unknown {
  // 将来示例：if (fromVersion < 2) raw = migrateV1toV2(raw)
  void fromVersion
  return raw
}
