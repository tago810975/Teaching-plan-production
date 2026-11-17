/**
 * 主进程与渲染进程之间的通信契约。
 *
 * 渲染进程不直接接触文件系统，所有磁盘操作经由这里定义的接口交给主进程。
 */
import type { ThemeEffectsOff, ThemeId } from './themes'
import type { Asset, Block, ProjectBundle, Variant } from '@core/model/types'
import type { OptionStopScheme } from '@core/model/option-stop-schemes'
import type { ProjectSummary } from '@core/project-file/codec'
import type { TemplateDefaults } from '@core/template/defaults'
import type { FormatPreset } from '@core/presets'

/** 墨案采集窗口的预加载脚本向主进程报告页面内记录到的请求（{ request } 或 { note }） */
export const MOAN_CAPTURE_CHANNEL = 'moan-capture:report'

export const IPC = {
  openProject: 'project:open',
  openProjectAt: 'project:open-at',
  saveProject: 'project:save',
  getStartupFile: 'app:get-startup-file',
  getAppInfo: 'app:get-info',
  /** 打开墨案窗口（从墨案导入） */
  openMoanImport: 'moan:open-import',
  getTemplateDefaults: 'template:get-defaults',
  listProjects: 'library:list',
  chooseLibraryDir: 'library:choose-dir',
  chooseFolder: 'dialog:choose-folder',
  createProject: 'project:create',
  removeRecent: 'library:remove-recent',
  revealInFolder: 'shell:reveal',
  importDocx: 'import:docx',
  createFromDocx: 'project:create-from-docx',
  getDefaultPreset: 'settings:get-default-preset',
  getOptionStopSchemes: 'settings:get-option-stop-schemes',
  getLocalPlaces: 'files:local-places',
  listFolder: 'files:list-folder',
  listSubfolders: 'files:list-subfolders',
  renameFile: 'files:rename',
  trashFile: 'files:trash',
  readProject: 'project:read',
  createFromDocxAt: 'project:create-from-docx-at',
  setOptionStopSchemes: 'settings:set-option-stop-schemes',
  setDefaultPreset: 'settings:set-default-preset',
  exportCheck: 'export:check',
  getExportPointsDefault: 'settings:get-export-points-default',
  getMathUpright: 'settings:get-math-upright',
  workbuddyStatus: 'workbuddy:status',
  workbuddyConnect: 'workbuddy:connect',
  workbuddyDisconnect: 'workbuddy:disconnect',
  workbuddyStart: 'workbuddy:start',
  workbuddyUpdate: 'workbuddy:update',
  workbuddyCancel: 'workbuddy:cancel',
  workbuddyResult: 'workbuddy:result',
  workbuddyRedrawStart: 'workbuddy:redraw-start',
  workbuddyRedrawCancel: 'workbuddy:redraw-cancel',
  workbuddyRedrawResult: 'workbuddy:redraw-result',
  setMathUpright: 'settings:set-math-upright',
  setExportPointsDefault: 'settings:set-export-points-default',
  getTheme: 'settings:get-theme',
  setTheme: 'settings:set-theme',
  getThemeEffectsOff: 'settings:get-theme-effects-off',
  setThemeEffectsOff: 'settings:set-theme-effects-off',
  exportWord: 'export:word',
  defaultExportDir: 'export:default-dir',
  openPath: 'shell:open-path',
  listTemplates: 'templates:list',
  reloadTemplates: 'templates:reload',
  importTemplate: 'templates:import',
  exportTemplate: 'templates:export',
  duplicateTemplate: 'templates:duplicate',
  deleteTemplate: 'templates:delete',
  setWindowState: 'window:set-state',
  confirmClose: 'window:confirm-close',
  askSaveChanges: 'window:ask-save-changes',
  /** 主进程 → 渲染进程：菜单命令 */
  menuCommand: 'menu:command',
  /** 主进程 → 渲染进程：用户在有未保存修改时关闭窗口，并选择了“保存” */
  saveBeforeClose: 'window:save-before-close',
  /** 主进程 → 渲染进程：系统要求打开某个工程文件（双击文件、拖到图标上） */
  openFileRequest: 'app:open-file-request'
} as const

export type MenuCommand = 'new' | 'open' | 'save' | 'save-as' | 'export-word' | 'close' | 'undo' | 'redo'

export interface OpenedProject {
  filePath: string
  bundle: ProjectBundle
}

export interface SaveRequest {
  /** 为 null 或 saveAs 为 true 时弹出“另存为”对话框 */
  filePath: string | null
  saveAs: boolean
  bundle: ProjectBundle
  /** 另存为对话框中的默认文件名（不含扩展名） */
  suggestedName: string
}

/** 导入 Word 的结果说明 */
/** WorkBuddy 连接的状态 */
export interface WorkBuddyStatus {
  /** 找到了 WorkBuddy（用户目录下有 .workbuddy） */
  found: boolean
  /** WorkBuddy 的 mcp.json 中已有教学案制作的连接 */
  connected: boolean
  configPath: string
}

/** 交给 WorkBuddy 识别的一批图片 */
export interface WorkBuddyTaskInput {
  images: Array<{ name: string; mime: string; data: string }>
  figureCount: number
  presetId?: string
  /** 导入知识点（格式说明与检查按知识点） */
  kind?: 'questions' | 'knowledge'
}

export interface ImportReport {
  fileNames: string[]
  questionCount: number
  /** 导入知识点时：知识点的个数（提示中显示“导入 N 个知识点”） */
  knowledgeCount?: number
  warnings: string[]
}

export interface ImportedContent {
  blocks: Block[]
  assets: Record<string, Asset>
  report: ImportReport
}

export interface ExportRequest {
  bundle: ProjectBundle
  variants: Variant[]
  /** 同时导出知识点重点难点汇总（“(T)名称(知识点重点难点).docx”） */
  points?: boolean
  dir: string
  /** 文件名主体，如“动态圆专题”，实际文件名为“(T)动态圆专题.docx”“(S)动态圆专题.docx” */
  baseName: string
  /** Word 不支持的图片（SVG、WebP）在界面中转成的 PNG，按原资源 ID 替换 */
  replacementAssets: Record<string, Asset>
}

export interface ExportResult {
  files: string[]
}

/** 首页列表中的一项 */
export interface ProjectListItem {
  filePath: string
  /** 是否位于教学案库目录内 */
  inLibrary: boolean
  /** ok：正常；missing：最近打开过但文件已不存在；error：文件无法读取 */
  status: 'ok' | 'missing' | 'error'
  summary?: ProjectSummary
  /** 文件修改时间 */
  modifiedAt?: string
  /** 最近一次在本软件中打开的时间 */
  openedAt?: string
  sizeBytes?: number
  error?: string
}

/** 首页左侧栏“本地”中的位置 */
export interface LocalPlace {
  label: string
  path: string
  kind: 'desktop' | 'documents' | 'downloads' | 'drive'
}

/** 文件夹中的一项：子文件夹、教学案或 Word 文档 */
export interface FolderEntry {
  name: string
  path: string
  kind: 'folder' | 'project' | 'docx'
  modifiedAt?: string
  sizeBytes?: number
  /** 教学案的名称、题目数等 */
  summary?: ProjectSummary
  /** 教学案无法读取时的原因 */
  error?: string
}

export interface FolderListing {
  dir: string
  /** 上一级文件夹；已是磁盘根目录时为 null */
  parent: string | null
  entries: FolderEntry[]
}

export interface LibraryListing {
  libraryDir: string
  items: ProjectListItem[]
}

/** 用户模板文件夹中有问题、没能载入的模板 */
export interface TemplateProblem {
  /** 模板文件夹名 */
  folder: string
  message: string
}

/** 模板列表：内置模板与用户模板（“教学案库\模板”） */
export interface TemplateCatalog {
  /** 用户模板文件夹 */
  dir: string
  builtin: Array<{ id: string; name: string; description: string }>
  user: Array<{ id: string; name: string; description: string; dir: string; hasWordTemplate: boolean }>
  problems: TemplateProblem[]
  /** 用户模板的预设（界面据此登记，见 core/presets 的 setUserPresets） */
  presets: FormatPreset[]
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface AppInfo {
  version: string
  /** 'win32' | 'darwin' | 'linux' 等，与 Node 的 process.platform 一致 */
  platform: string
}

/** 预加载脚本暴露给渲染进程的 API：window.api */
export interface RendererApi {
  getAppInfo(): Promise<AppInfo>
  /** 打开墨案窗口，登录后导入老教学案系统中的教案 */
  openMoanImport(): void
  /** 读取模板的默认页眉（Logo、电话、水印等） */
  getTemplateDefaults(templateId: string): Promise<Result<TemplateDefaults>>
  /** 弹出“打开”对话框；用户取消时返回 null */
  openProject(): Promise<Result<OpenedProject | null>>
  openProjectAt(filePath: string): Promise<Result<OpenedProject>>
  /** 首页：列出教学案库与最近打开的教学案 */
  listProjects(): Promise<Result<LibraryListing>>
  /** 更换教学案库目录；用户取消时返回 null */
  chooseLibraryDir(): Promise<Result<string | null>>
  /** 选择一个文件夹（新建教学案时更改保存位置）；用户取消时返回 null */
  chooseFolder(defaultPath: string): Promise<string | null>
  /** 新建教学案并立即保存为文件；dir 为 null 时保存到教学案库 */
  createProject(request: { title: string; dir: string | null; templateId: string; presetId: string }): Promise<Result<OpenedProject>>
  removeRecent(filePath: string): Promise<void>
  /** 选择一个或多个 Word 文档并识别其中的题目；用户取消时返回 null */
  /** 导入 Word：asKnowledge 时按知识点导入 */
  importDocx(presetId: string, asKnowledge?: boolean): Promise<Result<ImportedContent | null>>
  /** 选择一个 Word 文档，以其内容新建教学案；用户取消时返回 null */
  createFromDocx(templateId: string, presetId: string): Promise<Result<{ opened: OpenedProject; report: ImportReport } | null>>
  /** 设置：导入（从 Word 新建）时默认使用的格式预设 */
  getDefaultPreset(): Promise<string>
  setDefaultPreset(presetId: string): Promise<void>
  /** 首页：本地位置（桌面、文档、下载与各磁盘） */
  getLocalPlaces(): Promise<LocalPlace[]>
  listFolder(dir: string): Promise<Result<FolderListing>>
  listSubfolders(dir: string): Promise<Array<{ name: string; path: string }>>
  /** 重命名（不含扩展名）；教学案同时改文件中的名称。返回新路径 */
  renameFile(filePath: string, newStem: string): Promise<Result<string>>
  /** 删除：移到回收站 */
  trashFile(filePath: string): Promise<Result<null>>
  /** 只读取教学案（如在首页导出），不打开、不记入最近打开 */
  readProject(filePath: string): Promise<Result<ProjectBundle>>
  /** 以指定的 Word 文档新建教学案 */
  createFromDocxAt(filePath: string, templateId: string, presetId: string): Promise<Result<{ opened: OpenedProject; report: ImportReport }>>
  /** 设置：用户保存的选项间距方案（所有教学案通用） */
  getOptionStopSchemes(): Promise<OptionStopScheme[]>
  setOptionStopSchemes(schemes: OptionStopScheme[]): Promise<OptionStopScheme[]>
  /** 导出的默认位置：工程文件所在文件夹，未保存时为教学案库 */
  defaultExportDir(projectPath: string | null): Promise<string>
  /** 目标位置已存在的同名文件 */
  exportCheck(dir: string, baseName: string, variants: Variant[], points?: boolean): Promise<string[]>
  /** 设置：导出 Word 时是否默认勾选“知识点重点难点汇总”（默认不勾） */
  getExportPointsDefault(): Promise<boolean>
  setExportPointsDefault(on: boolean): Promise<void>
  /** 设置：公式中的字母用正体（不倾斜），预览与导出都按它；默认是 */
  getMathUpright(): Promise<boolean>
  /** WorkBuddy 自动识别：连接状态、写入 / 移除连接配置 */
  workbuddyStatus(): Promise<WorkBuddyStatus>
  workbuddyConnect(): Promise<Result<WorkBuddyStatus>>
  workbuddyDisconnect(): Promise<WorkBuddyStatus>
  /** 登记待识别的图片（同一时间一批），返回任务 ID；结果由 onWorkbuddyResult 送回 */
  workbuddyStart(input: WorkBuddyTaskInput): Promise<string>
  workbuddyUpdate(taskId: string, figureCount: number): Promise<void>
  workbuddyCancel(taskId: string): Promise<void>
  onWorkbuddyResult(handler: (result: { taskId: string; text: string }) => void): () => void
  /** 让 WorkBuddy 把插图重绘为 SVG：登记插图（图号、图片），每收到一张由 onWorkbuddyRedrawResult 送回（已检查、净化） */
  workbuddyRedrawStart(figures: Array<{ n: number; mime: string; data: string; width: number; height: number; fontSize?: number; stroke?: number; thin?: number }>): Promise<string>
  workbuddyRedrawCancel(taskId: string): Promise<void>
  onWorkbuddyRedrawResult(handler: (result: { taskId: string; figure: number; svg: string }) => void): () => void
  setMathUpright(on: boolean): Promise<void>
  /** 设置：界面配色主题 */
  getTheme(): Promise<ThemeId>
  setTheme(id: ThemeId): Promise<void>
  /** 设置：风格主题中关掉的动效 */
  getThemeEffectsOff(): Promise<ThemeEffectsOff>
  setThemeEffectsOff(value: ThemeEffectsOff): Promise<void>
  exportWord(request: ExportRequest): Promise<Result<ExportResult>>
  /** 用系统默认程序打开文件（如 Word） */
  openPath(path: string): Promise<string | null>
  revealInFolder(filePath: string): void
  /** 保存；用户在“另存为”对话框中取消时返回 null，否则返回实际保存路径 */
  saveProject(request: SaveRequest): Promise<Result<string | null>>
  /** 启动时通过命令行（如双击 .tplan 文件）传入的工程路径 */
  getStartupFile(): Promise<string | null>
  /** title / dirty：当前标签页（标题栏）；dirtyTitles：所有未保存的教学案（关闭窗口时提示） */
  setWindowState(state: { title: string; dirty: boolean; dirtyTitles: string[] }): void
  /** 关闭有未保存修改的标签页时询问：保存、不保存、取消 */
  askSaveChanges(title: string): Promise<'save' | 'discard' | 'cancel'>
  /** 渲染进程确认可以关闭窗口（已保存或用户放弃修改） */
  confirmClose(): void
  /** 模板：列出内置与用户模板（启动时主进程已读取用户模板） */
  listTemplates(): Promise<TemplateCatalog>
  /** 重新读取用户模板文件夹（老师改了 preset.json 之后） */
  reloadTemplates(): Promise<TemplateCatalog>
  /** 选择模板压缩包导入；取消时返回 null */
  importTemplate(): Promise<Result<TemplateCatalog | null>>
  /** 把一个模板（内置或自制）导出为压缩包；取消时返回 null */
  exportTemplate(presetId: string): Promise<Result<string | null>>
  /** 复制为新的自制模板，返回更新后的列表 */
  duplicateTemplate(presetId: string): Promise<Result<TemplateCatalog>>
  /** 删除自制模板（文件夹移到回收站） */
  deleteTemplate(presetId: string): Promise<Result<TemplateCatalog>>
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  onSaveBeforeClose(handler: () => void): () => void
  onOpenFileRequest(handler: (filePath: string) => void): () => void
}
