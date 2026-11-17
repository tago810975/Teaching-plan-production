/**
 * 导出 Word（主进程）：生成教案 / 学案 .docx 并写入磁盘。
 */
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDocument } from '@core/document/build'
import { writeDocx } from '@core/export/docx-writer'
import type { Variant } from '@core/model/types'
import type { ExportRequest, ExportResult } from '@shared/ipc'
import { exportFileName, pointsFileName } from '@shared/export-name'
import { buildPointsDocument } from '@core/document/points'
import { templateDir } from './template-io'
import { getMathUpright } from './library'

export { exportFileName }

/** 返回目标位置已存在的文件名，用于询问是否覆盖 */
export async function existingExportFiles(dir: string, baseName: string, variants: Variant[], points = false): Promise<string[]> {
  const out: string[] = []
  const names = [...variants.map((v) => exportFileName(baseName, v)), ...(points ? [pointsFileName(baseName)] : [])]
  for (const name of names) {
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
  // 公式字母正体 / 斜体：教学案的版式设置优先，没有设置时用本机设置
  const mathUpright = project.layout.mathUpright ?? (await getMathUpright())
  const jobs = [
    ...req.variants.map((variant) => ({ name: exportFileName(req.baseName, variant), ir: () => buildDocument(project, variant) })),
    // 知识点重点难点汇总
    ...(req.points === true ? [{ name: pointsFileName(req.baseName), ir: () => buildPointsDocument(project) }] : [])
  ]
  for (const job of jobs) {
    const bytes = await writeDocx({ ir: job.ir(), assets, title: project.meta.title, template, mathUpright })
    const path = join(req.dir, job.name)
    try {
      await writeFile(path, bytes)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EBUSY' || code === 'EPERM') {
        throw new Error(`“${job.name}”正在 Word 中打开，请先关闭它再导出。`)
      }
      throw err
    }
    files.push(path)
  }
  return { files }
}
