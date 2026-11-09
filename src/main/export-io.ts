/**
 * 导出 Word（主进程）：生成教案 / 学案 .docx 并写入磁盘。
 */
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDocument } from '@core/document/build'
import { writeDocx } from '@core/export/docx-writer'
import type { Variant } from '@core/model/types'
import type { ExportRequest, ExportResult } from '@shared/ipc'
import { exportFileName } from '@shared/export-name'
import { templateDir } from './template-io'

export { exportFileName }

/** 返回目标位置已存在的文件名，用于询问是否覆盖 */
export async function existingExportFiles(dir: string, baseName: string, variants: Variant[]): Promise<string[]> {
  const out: string[] = []
  for (const v of variants) {
    const name = exportFileName(baseName, v)
    try {
      await stat(join(dir, name))
      out.push(name)
    } catch {
      // 不存在
    }
  }
  return out
}

export async function exportWord(req: ExportRequest): Promise<ExportResult> {
  const { project } = req.bundle
  const template = new Uint8Array(await readFile(join(templateDir(project.templateId), 'template.docx')))
  const assets = { ...req.bundle.assets, ...req.replacementAssets }
  const files: string[] = []
  for (const variant of req.variants) {
    const bytes = await writeDocx({
      ir: buildDocument(project, variant),
      assets,
      title: project.meta.title,
      template
    })
    const path = join(req.dir, exportFileName(req.baseName, variant))
    try {
      await writeFile(path, bytes)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EBUSY' || code === 'EPERM') {
        throw new Error(`“${exportFileName(req.baseName, variant)}”正在 Word 中打开，请先关闭它再导出。`)
      }
      throw err
    }
    files.push(path)
  }
  return { files }
}
