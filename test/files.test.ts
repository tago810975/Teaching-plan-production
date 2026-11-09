import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileNameProblem, kindOf, listDrives, listFolder, renameEntry } from '../src/main/files'
import { readProjectFile, writeProjectFile } from '../src/main/project-io'
import { createEmptyBundle } from '@core/model/factory'

async function sandbox(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tplan-files-'))
  await mkdir(join(dir, '期中'))
  await mkdir(join(dir, '.git'))
  await mkdir(join(dir, '$RECYCLE.BIN'))
  const b = createEmptyBundle()
  b.project.meta.title = '动态圆专题'
  await writeProjectFile(join(dir, '动态圆专题.tplan'), b, '0.1.0')
  await writeFile(join(dir, '磁场 讲义.docx'), 'x')
  await writeFile(join(dir, '~$磁场 讲义.docx'), 'x')
  await writeFile(join(dir, '笔记.txt'), 'x')
  await writeFile(join(dir, '坏的.tplan'), 'not a zip')
  return dir
}

describe('首页的本地文件', () => {
  it('文件类型：教学案、Word 文档；Word 的临时文件不算', () => {
    expect(kindOf('a.tplan')).toBe('project')
    expect(kindOf('a.DOCX')).toBe('docx')
    expect(kindOf('~$a.docx')).toBeNull()
    expect(kindOf('a.pdf')).toBeNull()
  })

  it('列出文件夹：文件夹在前，只列教学案与 Word 文档，跳过隐藏与系统文件夹；教学案带名称与题目数', async () => {
    const dir = await sandbox()
    const listing = await listFolder(dir)
    expect(listing.entries.map((e) => `${e.kind}:${e.name}`)).toEqual(['folder:期中', 'docx:磁场 讲义.docx', 'project:动态圆专题.tplan', 'project:坏的.tplan'])
    expect(listing.entries.find((e) => e.name === '动态圆专题.tplan')?.summary?.title).toBe('动态圆专题')
    expect(listing.entries.find((e) => e.name === '坏的.tplan')?.error).toBeDefined()
    expect(listing.parent).not.toBeNull()
  })

  it('重命名教学案：文件名与文件中的名称一起改', async () => {
    const dir = await sandbox()
    const to = await renameEntry(join(dir, '动态圆专题.tplan'), '动态圆专题（修改）', '0.1.0')
    expect(to).toBe(join(dir, '动态圆专题（修改）.tplan'))
    expect((await readProjectFile(to)).project.meta.title).toBe('动态圆专题（修改）')
    expect((await readdir(dir)).filter((n) => n.endsWith('.tplan')).sort()).toEqual(['动态圆专题（修改）.tplan', '坏的.tplan'])
  })

  it('重命名：同名文件已存在时报错，不覆盖；只改大小写可以', async () => {
    const dir = await sandbox()
    await writeFile(join(dir, '讲义.docx'), 'y')
    await expect(renameEntry(join(dir, '磁场 讲义.docx'), '讲义', '0.1.0')).rejects.toThrow(/已有/)
    const to = await renameEntry(join(dir, '磁场 讲义.docx'), '磁场 讲义 v2', '0.1.0')
    expect(to).toBe(join(dir, '磁场 讲义 v2.docx'))
    // 读不出内容的教学案只改文件名
    expect(await renameEntry(join(dir, '坏的.tplan'), '坏的2', '0.1.0')).toBe(join(dir, '坏的2.tplan'))
  })

  it('文件名检查', () => {
    expect(fileNameProblem('')).not.toBeNull()
    expect(fileNameProblem('a/b')).not.toBeNull()
    expect(fileNameProblem('结尾有句点.')).not.toBeNull()
    expect(fileNameProblem('CON')).not.toBeNull()
    expect(fileNameProblem('高二物理 第9讲')).toBeNull()
  })

  it('磁盘：非 Windows 为根目录', async () => {
    expect(await listDrives('linux')).toEqual(['/'])
  })
})
