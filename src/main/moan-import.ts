/**
 * 从墨案导入教案（主进程）：读取教案数据 → 下载图片 → 转换 → 在教学案库中生成教学案文件。
 *
 * 数据通过墨案窗口里的网页向墨案服务器请求（socket.io，见 moan-page-scripts.ts 的 socketCallScript），
 * 用的是老师在窗口里登录后网页自己带的令牌（session.ts，只在内存中）。转换见 core/import/moan/convert.ts。
 */
import { session as electronSession, type WebContents } from 'electron'
import { join } from 'node:path'
import { convertMoanPlan, collectMoanImageUrls, type MoanImage, type MoanPlanShow } from '@core/import/moan/convert'
import { readImageInfo } from '@core/import/moan/image-size'
import { isMoanSessionReady, type MoanSession } from '@core/import/moan/session'
import { createAsset } from '@core/project-file/codec'
import { getPreset } from '@core/presets'
import type { Asset } from '@core/model/types'
import { DEFAULT_PRESET_ID, DEFAULT_TEMPLATE_ID } from '@core/model/factory'
import { createProject, getLibraryDir } from './library'
import { socketCallScript } from './moan-page-scripts'

export const MOAN_PRESET_ID = DEFAULT_PRESET_ID
export const MOAN_IMPORT_DIR = '墨案导入'

export class MoanImportError extends Error {
  override name = 'MoanImportError'
}

export interface MoanImportResult {
  filePath: string
  title: string
  questionCount: number
  warnings: string[]
}

interface SocketReply {
  code?: string
  msg?: string
  message?: string
  content?: unknown
}

async function call(wc: WebContents, s: MoanSession, namespace: string, event: string, params: Record<string, unknown>): Promise<unknown> {
  if (!isMoanSessionReady(s)) throw new MoanImportError('还没有登录墨案，或网页还没有连上墨案服务器。请先登录，等页面加载完再导入。')
  const text = (await wc.executeJavaScript(socketCallScript(s.wsUrl, namespace, event, { ...params, token: s.token }), true)) as string
  const r = JSON.parse(text) as { ok?: boolean; data?: SocketReply; error?: string }
  if (r.ok !== true || r.data === undefined) throw new MoanImportError(r.error ?? '墨案没有回应')
  if (r.data.code !== undefined && r.data.code !== '0000') {
    throw new MoanImportError(`墨案返回错误（${r.data.code}）：${r.data.msg ?? r.data.message ?? '未知原因'}。登录可能已过期，请在窗口中重新登录。`)
  }
  return r.data.content
}

/** 读取一份教案的全部内容 */
export async function fetchMoanPlan(wc: WebContents, s: MoanSession, planId: number): Promise<MoanPlanShow> {
  const content = (await call(wc, s, 'moan-teaching-plan', 'show', { id: String(planId) })) as Partial<MoanPlanShow> | undefined
  if (content === undefined || content.teachingPlan === undefined || !Array.isArray(content.mainTeachingPlanExtra)) {
    throw new MoanImportError(`没有读到教案 ${planId} 的内容`)
  }
  return content as MoanPlanShow
}

/** 文件夹中的教案（id 与名称） */
export async function fetchMoanFolderPlans(wc: WebContents, s: MoanSession, folderId: number): Promise<Array<{ id: number; name: string }>> {
  const content = (await call(wc, s, 'moan-teaching-plan', 'list', { folder_id: folderId, hadChild: 1, user_id: '' })) as
    | { teaching_plan_list?: Array<{ id: number; name: string }> }
    | undefined
  return (content?.teaching_plan_list ?? []).filter((p) => typeof p.id === 'number' && typeof p.name === 'string').map((p) => ({ id: p.id, name: p.name }))
}

/** 下载教案中的图片（墨案的图片存在腾讯云上，可直接下载），4 张同时进行 */
async function downloadImages(urls: string[], onProgress: (done: number, total: number) => void): Promise<{ images: Map<string, MoanImage>; assets: Record<string, Asset>; warnings: string[] }> {
  const images = new Map<string, MoanImage>()
  const assets: Record<string, Asset> = {}
  const warnings: string[] = []
  const ses = electronSession.fromPartition('persist:moan')
  let next = 0
  let done = 0
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const url = urls[next++]!
      try {
        const res = await ses.fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = new Uint8Array(await res.arrayBuffer())
        const info = readImageInfo(data)
        if (info === null) throw new Error('不是可识别的图片格式')
        const asset = await createAsset(data, info.mime)
        assets[asset.id] = asset
        images.set(url, { assetId: asset.id, width: info.width, height: info.height })
      } catch (err) {
        warnings.push(`图片下载失败：${url}（${err instanceof Error ? err.message : String(err)}）`)
      }
      onProgress(++done, urls.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker))
  return { images, assets, warnings }
}

/**
 * 导入一份教案，在“教学案库\墨案导入[\子文件夹]”中生成教学案文件（同名时自动加“(2)”）。
 */
export async function importMoanPlan(
  wc: WebContents,
  s: MoanSession,
  planId: number,
  options: { subDir?: string; onStatus?: (text: string) => void } = {}
): Promise<MoanImportResult> {
  const status = options.onStatus ?? ((): void => undefined)
  status('正在读取教案…')
  const show = await fetchMoanPlan(wc, s, planId)
  const urls = collectMoanImageUrls(show)
  const { images, assets, warnings: imageWarnings } = await downloadImages(urls, (d, t) => status(`正在下载图片 ${d}/${t}…`))
  const preset = getPreset(MOAN_PRESET_ID)
  const result = convertMoanPlan(show, images, preset.sectionNames)
  status('正在保存…')
  const dir = join(await getLibraryDir(), MOAN_IMPORT_DIR, ...(options.subDir !== undefined && options.subDir !== '' ? [safeDirName(options.subDir)] : []))
  const opened = await createProject(result.title, dir, DEFAULT_TEMPLATE_ID, { blocks: result.blocks, assets }, MOAN_PRESET_ID, (bundle) => {
    bundle.project.header = { ...bundle.project.header, right: result.headerRight }
    // 墨案的教案不显示难度，但保留审题与重点题标记（可在版式设置中调整）
    bundle.project.layout = { ...bundle.project.layout, difficultyDisplay: 'none', questionFields: { review: true, important: true } }
  })
  return { filePath: opened.filePath, title: result.title, questionCount: result.questionCount, warnings: [...imageWarnings, ...result.warnings] }
}

function safeDirName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名'
}
