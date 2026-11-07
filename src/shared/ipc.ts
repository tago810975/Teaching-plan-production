/**
 * 主进程与渲染进程之间的通信契约。
 *
 * 渲染进程不直接接触文件系统，所有磁盘操作经由这里定义的接口交给主进程。
 */
import type { Asset, Block, ProjectBundle, Variant } from '@core/model/types'
import type { ProjectSummary } from '@core/project-file/codec'
import type { TemplateDefaults } from '@core/template/defaults'

export const IPC = {
  openProject: 'project:open',
  openProjectAt: 'project:open-at',
  saveProject: 'project:save',
  getStartupFile: 'app:get-startup-file',
  getAppInfo: 'app:get-info',
  getTemplateDefaults: 'template:get-defaults',
  listProjects: 'library:list',
  chooseLibraryDir: 'library:choose-dir',
  chooseFolder: 'dialog:choose-folder',
  createProject: 'project:create',
  removeRecent: 'library:remove-recent',
  revealInFolder: 'shell:reveal',
  importDocx: 'import:docx',
  createFromDocx: 'project:create-from-docx',
  exportCheck: 'export:check',
  exportWord: 'export:word',
  defaultExportDir: 'export:default-dir',
  openPath: 'shell:open-path',
  setWindowState: 'window:set-state',
  confirmClose: 'window:confirm-close',
  /** 主进程 → 渲染进程：菜单命令 */
  menuCommand: 'menu:command',
  /** 主进程 → 渲染进程：用户在有未保存修改时关闭窗口，并选择了“保存” */
  saveBeforeClose: 'window:save-before-close',
  /** 主进程 → 渲染进程：系统要求打开某个工程文件（双击文件、拖到图标上） */
  openFileRequest: 'app:open-file-request'
} as const

export type MenuCommand = 'new' | 'open' | 'save' | 'save-as' | 'export-word' | 'close'

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
export interface ImportReport {
  fileNames: string[]
  questionCount: number
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
  dir: string
  /** 文件名主体，如“动态圆专题”，实际文件名为“动态圆专题（教案）.docx” */
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

export interface LibraryListing {
  libraryDir: string
  items: ProjectListItem[]
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
  createProject(request: { title: string; dir: string | null; templateId: string }): Promise<Result<OpenedProject>>
  removeRecent(filePath: string): Promise<void>
  /** 选择一个或多个 Word 文档并识别其中的题目；用户取消时返回 null */
  importDocx(): Promise<Result<ImportedContent | null>>
  /** 选择一个 Word 文档，以其内容新建教学案；用户取消时返回 null */
  createFromDocx(templateId: string): Promise<Result<{ opened: OpenedProject; report: ImportReport } | null>>
  /** 导出的默认位置：工程文件所在文件夹，未保存时为教学案库 */
  defaultExportDir(projectPath: string | null): Promise<string>
  /** 目标位置已存在的同名文件 */
  exportCheck(dir: string, baseName: string, variants: Variant[]): Promise<string[]>
  exportWord(request: ExportRequest): Promise<Result<ExportResult>>
  /** 用系统默认程序打开文件（如 Word） */
  openPath(path: string): Promise<string | null>
  revealInFolder(filePath: string): void
  /** 保存；用户在“另存为”对话框中取消时返回 null，否则返回实际保存路径 */
  saveProject(request: SaveRequest): Promise<Result<string | null>>
  /** 启动时通过命令行（如双击 .tplan 文件）传入的工程路径 */
  getStartupFile(): Promise<string | null>
  setWindowState(state: { title: string; dirty: boolean }): void
  /** 渲染进程确认可以关闭窗口（已保存或用户放弃修改） */
  confirmClose(): void
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  onSaveBeforeClose(handler: () => void): () => void
  onOpenFileRequest(handler: (filePath: string) => void): () => void
}
