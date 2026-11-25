/**
 * 多客户端 MCP 配置管理（纯逻辑，不依赖 Electron，便于单独测试）。
 *
 * 支持：
 * - WorkBuddy：~/.workbuddy/mcp.json
 * - Antigravity（反重力）：~/.gemini/config/mcp_config.json
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { McpClientId, McpClientStatus, WorkBuddyStatus } from '@shared/ipc'

export const SERVER_NAME = 'teaching-plan'

export interface McpClientOptions {
  homeDir: string
  scriptPath: string
  infoPath: string
}

interface ClientSpec {
  id: McpClientId
  name: string
  detectDirs: (homeDir: string) => string[]
  configPath: (homeDir: string) => string
  notFoundMessage: string
}

interface McpConfig {
  mcpServers?: Record<string, unknown>
  [k: string]: unknown
}

const CLIENT_SPECS: readonly ClientSpec[] = [
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    detectDirs: (home) => [join(home, '.workbuddy')],
    configPath: (home) => join(home, '.workbuddy', 'mcp.json'),
    notFoundMessage: '没有找到 WorkBuddy（用户目录下没有 .workbuddy 文件夹）。请先安装并打开一次 WorkBuddy。'
  },
  {
    id: 'antigravity',
    name: 'Antigravity（反重力）',
    detectDirs: (home) => [join(home, '.gemini', 'antigravity'), join(home, '.gemini', 'config')],
    configPath: (home) => join(home, '.gemini', 'config', 'mcp_config.json'),
    notFoundMessage: '没有找到 Antigravity（用户目录下没有 .gemini/antigravity 或 .gemini/config 文件夹）。请先安装并打开一次 Antigravity。'
  }
]

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

async function anyExists(paths: readonly string[]): Promise<boolean> {
  for (const p of paths) {
    if (await exists(p)) return true
  }
  return false
}

function specOf(id: McpClientId): ClientSpec {
  return CLIENT_SPECS.find((c) => c.id === id) ?? CLIENT_SPECS[0]!
}

export function isMcpClientId(value: unknown): value is McpClientId {
  return value === 'workbuddy' || value === 'antigravity'
}

async function readConfig(path: string): Promise<McpConfig | null> {
  try {
    const raw = await readFile(path, 'utf8')
    if (raw.trim() === '') return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as McpConfig
  } catch {
    return null
  }
}

function isServerConnected(config: McpConfig | null, scriptPath: string): boolean {
  const entry = config?.mcpServers?.[SERVER_NAME] as { args?: unknown } | undefined
  return Array.isArray(entry?.args) && entry.args.includes(scriptPath)
}

export async function getMcpClientsStatus(opts: McpClientOptions): Promise<WorkBuddyStatus> {
  const clients: McpClientStatus[] = await Promise.all(
    CLIENT_SPECS.map(async (spec) => {
      const configPath = spec.configPath(opts.homeDir)
      const found = await anyExists(spec.detectDirs(opts.homeDir))
      const config = await readConfig(configPath)
      return {
        id: spec.id,
        name: spec.name,
        found,
        connected: isServerConnected(config, opts.scriptPath),
        configPath
      }
    })
  )
  const primary = clients[0]!
  return {
    found: clients.some((c) => c.found),
    connected: clients.some((c) => c.connected),
    configPath: primary.configPath,
    clients
  }
}

export async function connectMcpClient(client: McpClientId, opts: McpClientOptions): Promise<WorkBuddyStatus> {
  const spec = specOf(client)
  if (!(await anyExists(spec.detectDirs(opts.homeDir)))) {
    throw new Error(spec.notFoundMessage)
  }
  const cfgPath = spec.configPath(opts.homeDir)
  await mkdir(dirname(cfgPath), { recursive: true })
  const original = await readFile(cfgPath, 'utf8').catch(() => null)
  let config: McpConfig = {}
  if (original !== null && original.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(original)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('顶层不是 JSON 对象')
      }
      config = parsed as McpConfig
    } catch {
      throw new Error(`${spec.name} 的配置文件格式不对，没有改动它：${cfgPath}`)
    }
    // 第一次修改非空配置前先留备份
    const backup = `${cfgPath}.teaching-plan.bak`
    if (!(await exists(backup))) await writeFile(backup, original, 'utf8')
  }
  const existingServers =
    typeof config.mcpServers === 'object' && config.mcpServers !== null && !Array.isArray(config.mcpServers)
      ? config.mcpServers
      : {}
  config.mcpServers = {
    ...existingServers,
    [SERVER_NAME]: { command: 'node', args: [opts.scriptPath], env: { TEACHING_PLAN_BRIDGE: opts.infoPath } }
  }
  await writeFile(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return getMcpClientsStatus(opts)
}

export async function disconnectMcpClient(client: McpClientId, opts: McpClientOptions): Promise<WorkBuddyStatus> {
  const spec = specOf(client)
  const cfgPath = spec.configPath(opts.homeDir)
  const config = await readConfig(cfgPath)
  if (config?.mcpServers?.[SERVER_NAME] !== undefined) {
    const { [SERVER_NAME]: _removed, ...rest } = config.mcpServers
    config.mcpServers = rest
    await writeFile(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  }
  return getMcpClientsStatus(opts)
}
