/**
 * 导入 Word 文档（主进程）：读取文件并识别题目，多个文件依次合并。
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { DocxReadError } from '@core/import/docx-reader'
import { importDocx } from '@core/import/import-docx'
import type { Asset, Block } from '@core/model/types'
import type { ImportedContent } from '@shared/ipc'

export async function importDocxFiles(paths: string[], presetId?: string): Promise<ImportedContent & { firstTitle?: string }> {
  const blocks: Block[] = []
  const assets: Record<string, Asset> = {}
  const warnings: string[] = []
  let questionCount = 0
  let firstTitle: string | undefined

  for (const path of paths) {
    const name = basename(path)
    let result
    try {
      const bytes = await readFile(path)
      result = await importDocx(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), presetId !== undefined ? { presetId } : {})
    } catch (err) {
      if (err instanceof DocxReadError) throw new DocxReadError(`“${name}”：${err.message}`)
      if ((err as NodeJS.ErrnoException).code === 'EBUSY' || (err as NodeJS.ErrnoException).code === 'EPERM') {
        throw new DocxReadError(`“${name}”正被其他程序占用，请在 Word 中关闭该文档后重试。`)
      }
      throw err
    }
    blocks.push(...result.blocks)
    Object.assign(assets, result.assets)
    questionCount += result.questionCount
    firstTitle ??= result.firstTitle
    const prefix = paths.length > 1 ? `“${name}”：` : ''
    warnings.push(...result.warnings.map((w) => prefix + w))
  }

  return {
    blocks,
    assets,
    report: { fileNames: paths.map((p) => basename(p)), questionCount, warnings },
    ...(firstTitle !== undefined ? { firstTitle } : {})
  }
}
