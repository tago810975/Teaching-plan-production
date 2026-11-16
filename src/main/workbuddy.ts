/**
 * WorkBuddy 自动识别（主进程）：本机服务、任务登记、写入 WorkBuddy 的连接配置。
 *
 * - 启动时开启本机服务（workbuddy-bridge.ts），连接信息写到用户数据目录的 workbuddy-bridge.json；
 *   MCP 脚本（resources/mcp/teaching-plan-mcp.cjs）复制到用户数据目录的 mcp/（每次启动都更新）。
 * - “连接 WorkBuddy”：在 ~/.workbuddy/mcp.json 的 mcpServers 中写入 teaching-plan 一项（command 为 WorkBuddy 自带的 node，
 *   参数为上面的脚本，环境变量 TEACHING_PLAN_BRIDGE 指向连接信息）；其他连接器原样保留，第一次修改前备份原文件。
 * - “从图片导入”窗口点“交给 WorkBuddy 识别”登记任务（同一时间一个）；收到提交的结果时发给那个窗口。
 */
import { app, ipcMain, webContents } from 'electron'
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { FORMAT_GUIDE, importText, type TextFigure } from '@core/import/text-import'
import { IPC, type WorkBuddyStatus, type WorkBuddyTaskInput } from '@shared/ipc'
import { resourcesDir } from './template-io'
import { startBridge, type BridgeTask } from './workbuddy-bridge'

/** WorkBuddy 配置中我们这一项的名字 */
export const SERVER_NAME = 'teaching-plan'

let task: (BridgeTask & { sender: number }) | null = null
let seq = 0

const userData = (): string => app.getPath('userData')
const infoPath = (): string => join(userData(), 'workbuddy-bridge.json')
const scriptPath = (): string => join(userData(), 'mcp', 'teaching-plan-mcp.cjs')
const workbuddyDir = (): string => join(homedir(), '.workbuddy')
const configPath = (): string => join(workbuddyDir(), 'mcp.json')

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

interface McpConfig {
  mcpServers?: Record<string, unknown>
  [k: string]: unknown
}

async function readConfig(): Promise<McpConfig | null> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8')) as McpConfig
  } catch {
    return null
  }
}

export async function workbuddyStatus(): Promise<WorkBuddyStatus> {
  const found = await exists(workbuddyDir())
  const config = await readConfig()
  const entry = config?.mcpServers?.[SERVER_NAME] as { args?: string[] } | undefined
  return { found, connected: entry !== undefined && (entry.args ?? []).includes(scriptPath()), configPath: configPath() }
}

export async function workbuddyConnect(): Promise<WorkBuddyStatus> {
  if (!(await exists(workbuddyDir()))) throw new Error('没有找到 WorkBuddy（用户目录下没有 .workbuddy 文件夹）。请先安装并打开一次 WorkBuddy。')
  await installScript()
  const original = await readFile(configPath(), 'utf8').catch(() => null)
  let config: McpConfig = {}
  if (original !== null) {
    try {
      config = JSON.parse(original) as McpConfig
    } catch {
      throw new Error(`WorkBuddy 的配置文件格式不对，没有改动它：${configPath()}`)
    }
    // 第一次修改前备份
    const backup = `${configPath()}.teaching-plan.bak`
    if (!(await exists(backup))) await writeFile(backup, original, 'utf8')
  }
  config.mcpServers = {
    ...(config.mcpServers ?? {}),
    [SERVER_NAME]: { command: 'node', args: [scriptPath()], env: { TEACHING_PLAN_BRIDGE: infoPath() } }
  }
  await writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8')
  return workbuddyStatus()
}

export async function workbuddyDisconnect(): Promise<WorkBuddyStatus> {
  const config = await readConfig()
  if (config?.mcpServers?.[SERVER_NAME] !== undefined) {
    const { [SERVER_NAME]: _removed, ...rest } = config.mcpServers
    config.mcpServers = rest
    await writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8')
  }
  return workbuddyStatus()
}

/** 把 MCP 脚本复制到用户数据目录（路径不随软件安装位置、版本变化） */
async function installScript(): Promise<void> {
  await mkdir(join(userData(), 'mcp'), { recursive: true })
  await copyFile(join(resourcesDir(), 'mcp', 'teaching-plan-mcp.cjs'), scriptPath())
}

export async function startWorkBuddy(): Promise<void> {
  await installScript().catch((e) => console.error('复制 WorkBuddy 连接脚本失败', e))
  await startBridge(
    {
      pending: () => task,
      guide: () => FORMAT_GUIDE,
      check: (text, t) => {
        const figures = new Map<number, TextFigure>(
          Array.from({ length: t?.figureCount ?? 0 }, (_, i) => [i + 1, { asset: { id: `f${i + 1}`, mime: 'image/png', data: new Uint8Array() }, widthEmu: 1, heightEmu: 1 }])
        )
        const r = importText(text, { ...(t?.presetId !== undefined ? { presetId: t.presetId } : {}), figures })
        return { questionCount: r.questionCount, issues: r.issues }
      },
      submit: (taskId, text) => {
        if (task === null || task.id !== taskId) return false
        const wc = webContents.fromId(task.sender)
        if (wc === undefined || wc.isDestroyed()) return false
        wc.send(IPC.workbuddyResult, { taskId, text })
        return true
      }
    },
    infoPath()
  )
}

export function registerWorkBuddyIpc(): void {
  ipcMain.handle(IPC.workbuddyStatus, () => workbuddyStatus())
  ipcMain.handle(IPC.workbuddyConnect, async () => {
    try {
      return { ok: true, value: await workbuddyConnect() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(IPC.workbuddyDisconnect, () => workbuddyDisconnect())
  ipcMain.handle(IPC.workbuddyStart, (event, input: WorkBuddyTaskInput) => {
    task = { id: `task-${Date.now()}-${++seq}`, images: input.images, figureCount: input.figureCount, ...(input.presetId !== undefined ? { presetId: input.presetId } : {}), sender: event.sender.id }
    return task.id
  })
  ipcMain.handle(IPC.workbuddyUpdate, (_event, taskId: string, figureCount: number) => {
    if (task !== null && task.id === taskId) task = { ...task, figureCount }
  })
  ipcMain.handle(IPC.workbuddyCancel, (_event, taskId: string) => {
    if (task !== null && task.id === taskId) task = null
  })
}
