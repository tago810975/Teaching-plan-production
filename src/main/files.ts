/**
 * 首页的本地文件浏览与文件操作：列出文件夹（子文件夹、教学案、Word 文档）、磁盘、重命名。
 * 不依赖 Electron，便于测试；删除（移到回收站）在 index.ts 中用 shell.trashItem 完成。
 */
import { access, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve } from 'node:path'
import { decodeSummary } from '@core/project-file/codec'
import type { FolderEntry, FolderListing } from '@shared/ipc'
import { readProjectFile, writeProjectFile } from './project-io'

/** 不显示的系统文件夹 */
const HIDDEN = new Set(['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws', 'recovery', 'config.msi', 'msocache', 'node_modules'])

export function kindOf(name: string): FolderEntry['kind'] | null {
  const ext = extname(name).toLowerCase()
  if (ext === '.tplan') return 'project'
  // ~$ 开头的是 Word 打开文件时的临时文件
  if (ext === '.docx' && !name.startsWith('~$')) return 'docx'
  return null
}

export async function listFolder(dir: string): Promise<FolderListing> {
  const abs = resolve(dir)
  const dirents = await readdir(abs, { withFileTypes: true })
  const entries: FolderEntry[] = []
  await Promise.all(
    dirents.map(async (d) => {
      const name = d.name
      if (name.startsWith('.') || HIDDEN.has(name.toLowerCase())) return
      const path = join(abs, name)
      if (d.isDirectory()) {
        entries.push({ name, path, kind: 'folder' })
        return
      }
      const kind = d.isFile() ? kindOf(name) : null
      if (kind === null) return
      let info
      try {
        info = await stat(path)
      } catch {
        return
      }
      const base: FolderEntry = { name, path, kind, modifiedAt: info.mtime.toISOString(), sizeBytes: info.size }
      if (kind === 'project') {
        try {
          const bytes = await readFile(path)
          base.summary = await decodeSummary(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
        } catch (err) {
          base.error = err instanceof Error ? err.message : String(err)
        }
      }
      entries.push(base)
    })
  )
  // 文件夹在前，再按名称（中文按拼音）排序
  const collator = new Intl.Collator('zh-CN', { numeric: true })
  entries.sort((a, b) => (a.kind === 'folder') !== (b.kind === 'folder') ? (a.kind === 'folder' ? -1 : 1) : collator.compare(a.name, b.name))
  const parent = dirname(abs)
  return { dir: abs, parent: parent === abs ? null : parent, entries }
}

/** 只列出子文件夹（左侧栏展开文件夹时用） */
export async function listSubfolders(dir: string): Promise<Array<{ name: string; path: string }>> {
  const listing = await listFolder(dir).catch(() => null)
  return listing === null ? [] : listing.entries.filter((e) => e.kind === 'folder').map((e) => ({ name: e.name, path: e.path }))
}

/** 本机磁盘：Windows 下为存在的盘符（C:\ D:\ …），其他系统为根目录 */
export async function listDrives(platform: string = process.platform): Promise<string[]> {
  if (platform !== 'win32') return ['/']
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const found = await Promise.all(
    letters.map(async (l) => {
      try {
        await access(`${l}:\\`)
        return `${l}:\\`
      } catch {
        return null
      }
    })
  )
  return found.filter((d): d is string => d !== null)
}

/** 新文件名（不含扩展名）的问题；没有问题时返回 null */
export function fileNameProblem(stem: string): string | null {
  const s = stem.trim()
  if (s === '') return '请输入名称'
  if (/[\\/:*?"<>|]/.test(s)) return '名称中不能有 \\ / : * ? " < > | 这些符号'
  if (/[. ]$/.test(s)) return '名称不能以句点或空格结尾'
  if (s.length > 120) return '名称太长'
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) return '这个名称是系统保留的，请换一个'
  return null
}

/**
 * 重命名文件，返回新路径。教学案（.tplan）同时把文件中的名称改成新名称（首页、编辑页显示的名称），
 * 读不出内容时只改文件名。目标已存在（不只是大小写不同）时报错。
 */
export async function renameEntry(filePath: string, newStem: string, appVersion: string): Promise<string> {
  const problem = fileNameProblem(newStem)
  if (problem !== null) throw new Error(problem)
  const stem = newStem.trim()
  const { dir, ext } = parse(filePath)
  const target = join(dir, stem + ext)
  const sameFile = target.toLowerCase() === filePath.toLowerCase()
  if (!sameFile && (await exists(target))) throw new Error(`同一文件夹中已有“${basename(target)}”`)
  if (ext.toLowerCase() === '.tplan') {
    let bundle
    try {
      bundle = await readProjectFile(filePath)
    } catch {
      bundle = null
    }
    if (bundle !== null) {
      bundle.project.meta = { ...bundle.project.meta, title: stem, updatedAt: new Date().toISOString() }
      if (sameFile) {
        // 只改大小写或只改名称：先写回原文件，再改名
        await writeProjectFile(filePath, bundle, appVersion)
        if (target !== filePath) await rename(filePath, target)
      } else {
        await writeProjectFile(target, bundle, appVersion)
        await rm(filePath)
      }
      return target
    }
  }
  if (target !== filePath) await rename(filePath, target)
  return target
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
