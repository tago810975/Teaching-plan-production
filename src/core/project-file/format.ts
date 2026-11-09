/**
 * 教学案工程文件（.tplan）格式定义。
 *
 * 工程文件是一个 ZIP 容器，结构如下：
 *
 *   mimetype        固定字符串，不压缩且位于首位，便于识别文件类型
 *   manifest.json   格式版本号、保存软件版本、保存时间
 *   project.json    工程数据（Project）
 *   assets/         图片等资源，以内容 SHA-256 命名，自动去重
 *
 * 把扩展名改为 .zip 即可直接解压查看。
 */

export const PROJECT_FILE_EXTENSION = 'tplan'
export const PROJECT_FILE_MIMETYPE = 'application/x-teaching-plan+zip'

/**
 * 当前格式版本。修改 project.json 结构时递增，
 * 并在 codec.ts 的 migrate() 中补充旧版本的迁移逻辑。
 */
export const CURRENT_FORMAT_VERSION = 9

/*
 * 版本记录：
 * 1 —— 初始版本
 * 2 —— 新增 project.layout（整题同页的默认设置）；题目 layout.keepTogether 由布尔值改为 auto/always/never
 * 3 —— 新增知识点块（knowledge）、段落格式（format）、题图锚定段落；project.layout 增加 keepKnowledgeTogether
 * 4 —— 图片位置新增 right-items / below-item / below-all / free；段落格式新增段后空行与段前换页
 *      （只增加取值与可选字段，旧数据无需迁移；升级版本号是为了让旧版软件拒绝打开新文件）
 * 5 —— 新增综合题块（composite）；图片可上下偏移（right / right-items 的 offsetYEmu）。无需迁移
 * 6 —— 字体大类（文字格式 marks.font、段落格式 format.font）；project.layout 增加选项列位置 optionStops，
 *      题目 layout 可选 optionStops。旧工程迁移时 optionStops 取模板原有制表位，排版不变
 * 7 —— 格式预设 project.presetId；作业单块（worksheet）；题目星级难度 stars。旧工程迁移为物理教学案 V1.0
 * 8 —— 难度显示开关 project.layout.difficultyDisplay；公式可加粗、加下划线（math.bold / math.underline）；
 *      选项列位置的默认值加宽：工程的列位置仍是旧默认值或模板原值（未改过）时换成新的默认值
 * 9 —— 公式颜色 math.color（只增加可选字段，无需迁移）
 */

export interface Manifest {
  format: 'teaching-plan'
  formatVersion: number
  /** 保存该文件的软件版本 */
  appVersion: string
  savedAt: string
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/x-emf': 'emf',
  'image/x-wmf': 'wmf'
}

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])
)

export function extForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? 'bin'
}

export function mimeForExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}
