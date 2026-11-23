/**
 * 读取模板资源（resources/templates/<模板名>/）。
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createAsset } from '@core/project-file/codec'
import { mimeForExt } from '@core/project-file/format'
import type { HeaderImage } from '@core/model/types'
import type { HeaderDefaultsFile, HeaderImageFile, TemplateDefaults } from '@core/template/defaults'
import type { Asset } from '@core/model/types'

/** 资源目录：开发时在项目根目录，打包后在安装目录的 resources 下 */
export function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
}

/** 内置 Word 模板（安装目录，只读） */
export function builtinTemplateDir(templateId: string): string {
  if (!/^[a-z0-9-]+$/.test(templateId)) throw new Error(`模板名称无效：${templateId}`)
  return join(resourcesDir(), 'templates', templateId)
}

/** 用户模板中的 Word 模板：模板 ID（user-<预设 id>）→ 文件夹，由 user-templates.ts 登记 */
let userTemplateDirs: ReadonlyMap<string, string> = new Map()
/** 全部用户模板：预设 ID → 文件夹，由 user-templates.ts 登记（用于读取不带 template.docx 的模板页眉） */
let userPresetDirs: ReadonlyMap<string, string> = new Map()

export function setUserTemplateDirs(dirs: ReadonlyMap<string, string>): void {
  userTemplateDirs = dirs
}

export function setUserPresetDirs(dirs: ReadonlyMap<string, string>): void {
  userPresetDirs = dirs
}

/** Word 模板所在的文件夹：用户模板优先，其次是内置模板 */
export function templateDir(templateId: string): string {
  const user = userTemplateDirs.get(templateId)
  if (user !== undefined) return user
  if (templateId.startsWith('user-')) throw new Error(`找不到自制模板“${templateId.slice(5)}”：它可能已被删除或移出模板文件夹`)
  return builtinTemplateDir(templateId)
}

export async function readTemplateDefaults(templateId: string, presetId?: string): Promise<TemplateDefaults> {
  // 优先用用户预设自带的 header/（即使该模板没有自定义 template.docx）；其次用 Word 模板目录；最后用内置默认页眉
  const presetDir = presetId !== undefined ? userPresetDirs.get(presetId) : undefined
  let dir = presetDir !== undefined ? join(presetDir, 'header') : ''
  if (dir === '' || !existsSync(join(dir, 'defaults.json'))) dir = join(templateDir(templateId), 'header')
  if (!existsSync(join(dir, 'defaults.json'))) dir = join(builtinTemplateDir('physics-default'), 'header')
  const file = JSON.parse(await readFile(join(dir, 'defaults.json'), 'utf8')) as HeaderDefaultsFile
  const assets: Record<string, Asset> = {}

  const load = async (img: HeaderImageFile | undefined): Promise<HeaderImage | undefined> => {
    if (img === undefined) return undefined
    const ext = img.file.slice(img.file.lastIndexOf('.') + 1)
    const asset = await createAsset(new Uint8Array(await readFile(join(dir, img.file))), mimeForExt(ext))
    assets[asset.id] = asset
    return { assetId: asset.id, widthEmu: img.widthEmu, heightEmu: img.heightEmu }
  }

  const [logo, phoneIcon, watermark] = await Promise.all([
    load(file.logo),
    load(file.phoneIcon),
    load(file.watermark)
  ])
  return {
    header: {
      ...(logo !== undefined ? { logo } : {}),
      left: file.left,
      ...(phoneIcon !== undefined ? { phoneIcon } : {}),
      phone: file.phone,
      right: file.right,
      ...(watermark !== undefined ? { watermark } : {})
    },
    assets
  }
}
