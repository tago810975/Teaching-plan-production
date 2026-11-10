/**
 * 题图 / 插图的设置规则：位置选项、切换位置时补的字段、排序。
 * 属性面板（FigureList）与右键图片的快捷窗口（FigureQuickMenu）共用。
 */
import { A4_PAGE, contentWidthTwip } from '@core/document/units'
import { plainText } from '@core/model/factory'
import type { FigurePlacement, QuestionFigure, RichText } from '@core/model/types'

export const EMU_PER_CM = 360000
/** EMU / twip */
const EMU_PER_TWIP = 635

export const QUESTION_PLACEMENTS: ReadonlyArray<readonly [FigurePlacement, string]> = [
  ['below', '题干下方'],
  ['right', '题干右侧（文字环绕）'],
  ['right-items', '题干下方，位于选项或小问右侧'],
  ['below-item', '某个小问下方'],
  ['below-all', '全部题目文字下方'],
  ['free', '自由位置（文字环绕，可拖动）']
]

export const KNOWLEDGE_PLACEMENTS: ReadonlyArray<readonly [FigurePlacement, string]> = [
  ['below', '某段之后'],
  ['right', '某段右侧（文字环绕）'],
  ['free', '自由位置（文字环绕，可拖动）']
]

export function toCm(emu: number): number {
  return Math.round((emu / EMU_PER_CM) * 10) / 10
}

/** 该位置是否需要选择“第几段” */
export function needsParagraph(kind: 'question' | 'knowledge', placement: FigurePlacement): boolean {
  if (kind === 'knowledge') return true
  return placement === 'right' || placement === 'free'
}

export function excerpt(p: RichText[number]): string {
  const t = plainText(p).replace(/\$[^$]*\$/g, '…').replace(/\s+/g, ' ')
  return t.length > 14 ? `${t.slice(0, 14)}…` : t || '（空）'
}

/** 切换位置时补上需要的字段：自由位置默认放在栏的右上角 */
export function placementPatch(f: QuestionFigure, placement: FigurePlacement): Partial<QuestionFigure> {
  if (placement !== 'free' || f.offsetXEmu !== undefined) return { placement }
  const columnEmu = contentWidthTwip(A4_PAGE) * EMU_PER_TWIP
  return { placement, offsetXEmu: Math.max(0, columnEmu - f.widthEmu), offsetYEmu: 0 }
}

/** 等比例改宽度 */
export function widthPatch(f: QuestionFigure, cm: number): Partial<QuestionFigure> {
  const widthEmu = Math.round(cm * EMU_PER_CM)
  return { widthEmu, heightEmu: Math.round((f.heightEmu * widthEmu) / f.widthEmu) }
}

export function swap<T>(arr: T[], a: number, b: number): T[] {
  const out = arr.slice()
  ;[out[a], out[b]] = [out[b]!, out[a]!]
  return out
}
