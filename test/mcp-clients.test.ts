import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { connectMcpClient, disconnectMcpClient, getMcpClientsStatus, SERVER_NAME } from '../src/main/mcp-clients'

describe('多客户端 MCP 配置管理（WorkBuddy / Antigravity）', () => {
  const dirs: string[] = []
  const makeHome = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'tp-mcp-'))
    dirs.push(d)
    return d
  }

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('Antigravity 的 mcp_config.json 为空文件时可正常连接，并识别为已连接', async () => {
    const homeDir = makeHome()
    const cfgDir = join(homeDir, '.gemini', 'config')
    const cfgPath = join(cfgDir, 'mcp_config.json')
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(cfgPath, '', 'utf8')

    const opts = {
      homeDir,
      scriptPath: join(homeDir, 'app', 'teaching-plan-mcp.cjs'),
      infoPath: join(homeDir, 'app', 'workbuddy-bridge.json')
    }

    const before = await getMcpClientsStatus(opts)
    expect(before.found).toBe(true)
    expect(before.connected).toBe(false)
    expect(before.clients.find((c) => c.id === 'antigravity')).toMatchObject({ found: true, connected: false })
    expect(before.clients.find((c) => c.id === 'workbuddy')).toMatchObject({ found: false, connected: false })

    const after = await connectMcpClient('antigravity', opts)
    expect(after.found).toBe(true)
    expect(after.connected).toBe(true)
    expect(after.clients.find((c) => c.id === 'antigravity')?.connected).toBe(true)

    const written = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
    }
    expect(written.mcpServers[SERVER_NAME]).toEqual({
      command: 'node',
      args: [opts.scriptPath],
      env: { TEACHING_PLAN_BRIDGE: opts.infoPath }
    })
  })

  it('已有其他 MCP 服务时保留原配置并生成备份；断开只移除 teaching-plan', async () => {
    const homeDir = makeHome()
    const cfgDir = join(homeDir, '.gemini', 'config')
    const cfgPath = join(cfgDir, 'mcp_config.json')
    mkdirSync(cfgDir, { recursive: true })
    const original = JSON.stringify({ mcpServers: { other: { command: 'python3', args: ['a.py'] } }, customKey: 42 }, null, 2)
    writeFileSync(cfgPath, original, 'utf8')

    const opts = {
      homeDir,
      scriptPath: 'C:\\Users\\测试\\AppData\\Roaming\\TeachingPlan\\mcp\\teaching-plan-mcp.cjs',
      infoPath: 'C:\\Users\\测试\\AppData\\Roaming\\TeachingPlan\\workbuddy-bridge.json'
    }

    await connectMcpClient('antigravity', opts)
    expect(readFileSync(`${cfgPath}.teaching-plan.bak`, 'utf8')).toBe(original)

    const connected = JSON.parse(readFileSync(cfgPath, 'utf8')) as { mcpServers: Record<string, unknown>; customKey: number }
    expect(connected.customKey).toBe(42)
    expect(connected.mcpServers['other']).toEqual({ command: 'python3', args: ['a.py'] })
    expect(connected.mcpServers[SERVER_NAME]).toBeDefined()

    const afterDisconnect = await disconnectMcpClient('antigravity', opts)
    expect(afterDisconnect.connected).toBe(false)
    const afterJson = JSON.parse(readFileSync(cfgPath, 'utf8')) as { mcpServers: Record<string, unknown>; customKey: number }
    expect(afterJson.customKey).toBe(42)
    expect(afterJson.mcpServers['other']).toEqual({ command: 'python3', args: ['a.py'] })
    expect(afterJson.mcpServers[SERVER_NAME]).toBeUndefined()
  })

  it('配置文件 JSON 损坏时报错且不修改原文件', async () => {
    const homeDir = makeHome()
    const wbDir = join(homeDir, '.workbuddy')
    const cfgPath = join(wbDir, 'mcp.json')
    mkdirSync(wbDir, { recursive: true })
    writeFileSync(cfgPath, '{ invalid json', 'utf8')

    const opts = {
      homeDir,
      scriptPath: '/mcp/teaching-plan-mcp.cjs',
      infoPath: '/bridge.json'
    }

    await expect(connectMcpClient('workbuddy', opts)).rejects.toThrow('格式不对')
    expect(readFileSync(cfgPath, 'utf8')).toBe('{ invalid json')
  })
})
