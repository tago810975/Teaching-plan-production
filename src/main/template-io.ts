/**
 * 读取模板资源（resources/templates/<模板名>/）。
 */
import { app } from 'electron'
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

export function templateDir(templateId: string): string {
  if (!/^[a-z0-9-]+$/.test(templateId)) throw new Error(`模板名称无效：${templateId}`)
  return join(resourcesDir(), 'templates', templateId)
}

export async function readTemplateDefaults(templateId: string): Promise<TemplateDefaults> {
  const dir = join(templateDir(templateId), 'header')
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
