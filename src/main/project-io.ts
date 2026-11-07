/**
 * 工程文件的磁盘读写。
 *
 * 保存采用“先写临时文件，再改名替换”的方式：写入中途断电或崩溃时，
 * 原文件保持完好，不会出现写了一半的损坏文件。
 */
import { open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { decodeBundle, encodeBundle } from '@core/project-file/codec'
import { PROJECT_FILE_EXTENSION } from '@core/project-file/format'
import type { ProjectBundle } from '@core/model/types'

export async function readProjectFile(filePath: string): Promise<ProjectBundle> {
  const bytes = await readFile(filePath)
  return decodeBundle(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

export async function writeProjectFile(
  filePath: string,
  bundle: ProjectBundle,
  appVersion: string
): Promise<void> {
  const bytes = await encodeBundle(bundle, { appVersion })
  const tmpPath = join(dirname(filePath), `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}`)

  const handle = await open(tmpPath, 'w')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await renameWithRetry(tmpPath, filePath)
  } catch (err) {
    await rm(tmpPath, { force: true })
    throw err
  }
}

/**
 * Windows 上目标文件可能被杀毒软件或同步盘短暂占用，导致改名失败（EPERM / EBUSY），
 * 稍等后重试即可。
 */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i >= attempts || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await new Promise((r) => setTimeout(r, 100 * i))
    }
  }
}

/** 补全工程文件扩展名 */
export function ensureProjectExtension(filePath: string): string {
  return extname(filePath).toLowerCase() === `.${PROJECT_FILE_EXTENSION}`
    ? filePath
    : `${filePath}.${PROJECT_FILE_EXTENSION}`
}

export function isProjectFilePath(arg: string): boolean {
  return extname(arg).toLowerCase() === `.${PROJECT_FILE_EXTENSION}`
}

/** 去掉 Windows / macOS 文件名中不允许的字符 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '').trim()
  return cleaned === '' ? '未命名教学案' : cleaned
}
