/**
 * 主进程与渲染进程之间的通信契约。
 *
 * 渲染进程不直接接触文件系统，所有磁盘操作经由这里定义的接口交给主进程。
 */
import type { ProjectBundle } from '@core/model/types'

export const IPC = {
  openProject: 'project:open',
  openProjectAt: 'project:open-at',
  saveProject: 'project:save',
  getStartupFile: 'app:get-startup-file',
  getAppInfo: 'app:get-info',
  setWindowState: 'window:set-state',
  confirmClose: 'window:confirm-close',
  /** 主进程 → 渲染进程：菜单命令 */
  menuCommand: 'menu:command',
  /** 主进程 → 渲染进程：用户在有未保存修改时关闭窗口，并选择了“保存” */
  saveBeforeClose: 'window:save-before-close',
  /** 主进程 → 渲染进程：系统要求打开某个工程文件（双击文件、拖到图标上） */
  openFileRequest: 'app:open-file-request'
} as const

export type MenuCommand = 'new' | 'open' | 'save' | 'save-as' | 'export-word'

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

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface AppInfo {
  version: string
  /** 'win32' | 'darwin' | 'linux' 等，与 Node 的 process.platform 一致 */
  platform: string
}

/** 预加载脚本暴露给渲染进程的 API：window.api */
export interface RendererApi {
  getAppInfo(): Promise<AppInfo>
  /** 弹出“打开”对话框；用户取消时返回 null */
  openProject(): Promise<Result<OpenedProject | null>>
  openProjectAt(filePath: string): Promise<Result<OpenedProject>>
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
