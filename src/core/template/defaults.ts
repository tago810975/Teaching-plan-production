/**
 * 模板提供的默认内容（目前只有页眉）。新建工程时带入，之后随工程保存，
 * 工程文件因此保持独立：换电脑、换模板都不影响已有工程的页眉。
 */
import type { Asset, PageHeader, ProjectBundle } from '../model/types'

export interface TemplateDefaults {
  header: PageHeader
  assets: Record<string, Asset>
}

/** 模板目录中 header/defaults.json 的结构 */
export interface HeaderDefaultsFile {
  left: string
  phone: string
  right: string
  logo?: HeaderImageFile
  phoneIcon?: HeaderImageFile
  watermark?: HeaderImageFile
}

export interface HeaderImageFile {
  file: string
  widthEmu: number
  heightEmu: number
}

/** 返回套用了模板默认页眉的新工程（不修改原对象） */
export function withTemplateDefaults(bundle: ProjectBundle, defaults: TemplateDefaults): ProjectBundle {
  return {
    project: { ...bundle.project, header: structuredClone(defaults.header) },
    assets: { ...bundle.assets, ...defaults.assets }
  }
}
