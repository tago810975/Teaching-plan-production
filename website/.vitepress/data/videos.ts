/**
 * 视频教程配置文件（已绑定 Cloudflare R2 公开访问地址）
 *
 * 【后续上传视频后如何填入网页？】
 * 1. 打开 Cloudflare R2 存储桶（或通过绑定同一 R2 桶的 CloudFlare-ImgBed），上传录好的 .mp4 视频。
 * 2. 在下方对应的视频条目里，把文件名填入 `file`（例如 file: '01-getting-started.mp4'），
 *    也可以直接填完整的 https://... 外链地址；如需封面图可填 `poster`，时长可填 `duration`（如 '02:15'）。
 * 3. `file` 留空 '' 时，网页会自动显示“视频教程即将上线”占位卡片；填好后提交并 `git push`，双站自动更新。
 */

export const VIDEO_BASE_URL = 'https://pub-93dca24cfb2d4aa8bc524beb0c1454a0.r2.dev'

export interface TutorialVideoItem {
  /** 视频卡片标题 */
  title: string
  /** 一句话简介 */
  description: string
  /** R2 中的文件名（如 '01-getting-started.mp4'）或完整 https:// 直链；留空则显示占位 */
  file: string
  /** 可选封面图文件名或完整链接 */
  poster?: string
  /** 可选时长标记（如 '02:30'） */
  duration?: string
  /** 建议上传到 R2 时使用的文件名（仅作维护参考） */
  suggestedFile: string
}

export const TUTORIAL_VIDEOS = {
  'getting-started': {
    title: '快速上手：首页管理、新建工程与导出双版 Word',
    description: '演示教学案库分类、新建教学案、三栏界面与一键同时导出教案 (T) / 学案 (S)。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '01-getting-started.mp4'
  },
  'import-word': {
    title: '从 Word 文档与组卷网导入题目',
    description: '演示直接双击或导入 Word / 组卷网题集，自动识别题号、选项、综合题与公式。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '02-import-word.mp4'
  },
  'import-image': {
    title: '从图片导入：AI 识图与 WorkBuddy 一键识别',
    description: '演示粘贴截图、自动框选插图、复制给 AI 识别或连接 WorkBuddy 自动回填结果。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '03-import-image.mp4'
  },
  'import-moan': {
    title: '从墨案迁移教案与导入知识点',
    description: '演示内置墨案窗口单篇/整夹批量迁移教案，以及按知识点模式导入知识梳理。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '04-import-moan.mp4'
  },
  'editing-question': {
    title: '题目编辑、变式题、综合题与快捷排版',
    description: '演示难度、变式题、审题/重点题、综合题拆合、作业单插入、右键快捷版式与大纲拖拽。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '05-editing-question.mp4'
  },
  'editing-formula-table': {
    title: '知识点挖空重点、表格与可视化公式编辑',
    description: '演示重点标红挖空默写、表格合并与列宽拖拽、文字格式及可视化公式输入。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '06-editing-formula-table.mp4'
  },
  'images-layout': {
    title: '插图排版位置、预览双向定位与选项图片缩放',
    description: '演示题图/答案插图位置切换、自由拖动绕排以及选择题图片选项统一大小。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '07-images-layout.mp4'
  },
  'images-enhance': {
    title: '插图自动框选、变清晰、去白底与调色',
    description: '演示扫描件去灰底变清晰、去白底透明、一键加深、手动调色与批量处理插图。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '08-images-enhance.mp4'
  },
  'templates-custom': {
    title: '格式预设切换与自制/分享模板',
    description: '演示四套内置预设效果对比，以及复制修改 preset.json、重新载入与导出 zip 分享。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '09-templates-custom.mp4'
  },
  'themes-settings': {
    title: '软件设置、配色与风格主题切换',
    description: '演示教学案库设置、七套配色主题（含赤黑与月潮动效开关）及知识点汇总导出。',
    file: '',
    poster: '',
    duration: '',
    suggestedFile: '10-themes-settings.mp4'
  }
} as const satisfies Record<string, TutorialVideoItem>

export type TutorialVideoId = keyof typeof TUTORIAL_VIDEOS

export function resolveMediaUrl(file?: string): string {
  const trimmed = file?.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    return trimmed
  }
  const base = VIDEO_BASE_URL.replace(/\/+$/, '')
  return `${base}/${trimmed.replace(/^\/+/, '')}`
}
