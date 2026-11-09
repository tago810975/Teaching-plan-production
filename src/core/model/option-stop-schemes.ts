/**
 * 选项间距方案：一组命名的选项列位置（OptionStops）。
 * 内置“默认”（四列等宽铺满整栏）与“模板原位置”；用户可另存自己的方案（保存在本机设置中，所有教学案通用）。
 */
import { A4_PAGE, contentWidthTwip } from '../document/units'
import { DEFAULT_OPTION_STOPS, LEGACY_OPTION_STOPS } from './factory'
import type { OptionStops } from './types'

export interface OptionStopScheme {
  name: string
  stops: OptionStops
}

export const BUILTIN_OPTION_STOP_SCHEMES: readonly OptionStopScheme[] = [
  { name: '默认', stops: DEFAULT_OPTION_STOPS },
  { name: '模板原位置（较窄）', stops: LEGACY_OPTION_STOPS }
]

/** 选项样式的左缩进（A 列起点），与 STYLE_SPECS.option.indentLeftTwip 一致 */
const FIRST = 480
const CHAR = 210

/** 列位置是否可用：从小到大，每列至少 2 个字宽，最后一列不超出栏宽 */
export function validStops(stops: readonly number[]): boolean {
  const edges = [FIRST, ...stops, contentWidthTwip(A4_PAGE)]
  return edges.every((e, i) => i === 0 || e - edges[i - 1]! >= 2 * CHAR)
}

export function sameStops(a: OptionStops, b: OptionStops): boolean {
  return a.two[0] === b.two[0] && a.four.every((x, i) => x === b.four[i])
}

/** 与当前列位置相同的方案（先找内置，再找用户的） */
export function matchScheme(stops: OptionStops, user: readonly OptionStopScheme[]): OptionStopScheme | undefined {
  return [...BUILTIN_OPTION_STOP_SCHEMES, ...user].find((s) => sameStops(s.stops, stops))
}

/** 方案名称的问题；没有问题时返回 null。同名的用户方案视为覆盖，不算问题 */
export function schemeNameProblem(name: string): string | null {
  const n = name.trim()
  if (n === '') return '请输入方案名称'
  if (n.length > 20) return '名称请不超过 20 个字'
  if (BUILTIN_OPTION_STOP_SCHEMES.some((s) => s.name === n)) return '不能与内置方案同名'
  return null
}

/** 校验并整理从设置文件读到的方案（文件可能被手工修改） */
export function sanitizeSchemes(raw: unknown): OptionStopScheme[] {
  if (!Array.isArray(raw)) return []
  const out: OptionStopScheme[] = []
  for (const r of raw) {
    const s = r as { name?: unknown; stops?: { two?: unknown; four?: unknown } }
    const two = s?.stops?.two
    const four = s?.stops?.four
    if (typeof s?.name !== 'string' || schemeNameProblem(s.name) !== null) continue
    if (!Array.isArray(two) || two.length !== 1 || !Array.isArray(four) || four.length !== 3) continue
    if (![...two, ...four].every((x) => typeof x === 'number' && Number.isFinite(x))) continue
    const stops: OptionStops = { two: [two[0] as number], four: [four[0] as number, four[1] as number, four[2] as number] }
    if (!validStops(stops.two) || !validStops(stops.four)) continue
    if (out.some((o) => o.name === s.name)) continue
    out.push({ name: (s.name as string).trim(), stops })
  }
  return out
}
