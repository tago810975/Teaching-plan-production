/**
 * 导出文件名：版本标记放在最前面——(T) 教师版（教案）、(S) 学生版（学案），如“(T)动态圆专题.docx”。
 * 主进程写文件与导出对话框中的文件名预览共用。
 */
import type { Variant } from '@core/model/types'

export const VARIANT_PREFIX: Readonly<Record<Variant, string>> = { teacher: '(T)', student: '(S)' }

/** 去掉文件名中不允许的字符；为空时用“未命名教学案” */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '').trim()
  return cleaned === '' ? '未命名教学案' : cleaned
}

export function exportFileName(baseName: string, variant: Variant): string {
  return `${VARIANT_PREFIX[variant]}${sanitizeFileName(baseName)}.docx`
}

/** 知识点重点难点汇总的文件名，与样张一致：“(T)名称(知识点重点难点).docx” */
export function pointsFileName(baseName: string): string {
  return `${VARIANT_PREFIX.teacher}${sanitizeFileName(baseName)}(知识点重点难点).docx`
}
