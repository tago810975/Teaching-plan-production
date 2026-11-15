#!/usr/bin/env node
/**
 * 教学案制作 —— WorkBuddy MCP 能力探针（只用于测试，不改动任何文件，只写一个日志）
 *
 * WorkBuddy 连接它时，记录：
 *   1. WorkBuddy 声明支持哪些 MCP 能力（重点：是否支持“采样 sampling”）
 *   2. 发一条纯文字的采样请求，能否拿到模型回复
 *   3. 发一条带图片的采样请求，模型能否识图
 *   4. 工具返回的图片，WorkBuddy 的模型能否看到（工具 probe_image）
 * 结果写到：用户目录下的 teaching-plan-mcp-probe.log
 *
 * 不依赖任何第三方库，用 Node.js 直接运行。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')

const LOG = path.join(os.homedir(), 'teaching-plan-mcp-probe.log')
const log = (title, data) => {
  const line = `[${new Date().toLocaleString('zh-CN')}] ${title}${data === undefined ? '' : '\n' + JSON.stringify(data, null, 2)}\n\n`
  fs.appendFileSync(LOG, line, 'utf8')
}
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')

// 一张 8×8 的纯红色 PNG：问模型“这是什么颜色”，用来判断能否识图
const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGO8w4AdMOEQH6QSALIMAOxjSSTlAAAAAElFTkSuQmCC'

let clientCaps = null
let clientInfo = null
let protocolVersion = null
const samplingResults = []
const toolCalls = []
const pending = new Map()
let nextId = 1
function request(method, params, label) {
  const id = `probe-${nextId++}`
  pending.set(id, label)
  log(`→ 发出请求：${label}`, { method, params: method === 'sampling/createMessage' ? '（内容略）' : params })
  send({ id, method, params })
  // 60 秒没有回应就记一笔
  setTimeout(() => {
    if (pending.has(id)) {
      pending.delete(id)
      log(`× ${label}：60 秒内没有回应（可能 WorkBuddy 不支持，或在等待你确认）`)
    }
  }, 60000)
}

function startSamplingTests() {
  if (clientCaps === null || clientCaps.sampling === undefined) {
    log('结论：WorkBuddy 没有声明支持“采样（sampling）”。软件无法主动请它的模型识图，只能由 AI 调用我们的工具。')
    return
  }
  log('WorkBuddy 声明支持“采样（sampling）”，开始实测……')
  request(
    'sampling/createMessage',
    {
      messages: [{ role: 'user', content: { type: 'text', text: '这是“教学案制作”软件的连接测试，请只回复四个字：连接成功' } }],
      maxTokens: 50
    },
    '纯文字采样'
  )
  request(
    'sampling/createMessage',
    {
      messages: [
        { role: 'user', content: { type: 'image', data: RED_PNG, mimeType: 'image/png' } },
        { role: 'user', content: { type: 'text', text: '这张图片是什么颜色？只回答颜色名称。' } }
      ],
      maxTokens: 50
    },
    '带图片采样'
  )
}

/** 本进程所在的环境：正式方案要靠它决定工具进程如何把题目交给教学案软件 */
async function environmentReport() {
  const tryWrite = (dir) => {
    try {
      const f = path.join(dir, `.teaching-plan-probe-${process.pid}.tmp`)
      fs.writeFileSync(f, 'ok')
      fs.unlinkSync(f)
      return '可以读写'
    } catch (e) {
      return '不能写：' + e.code
    }
  }
  // 能否连接本机端口：自己开一个临时端口再连过去
  const loopback = await new Promise((resolve) => {
    try {
      const net = require('net')
      const server = net.createServer((sock) => sock.end('ok'))
      server.on('error', (e) => resolve('不能监听本机端口：' + e.code))
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        const c = net.connect(port, '127.0.0.1')
        c.on('data', () => {
          c.destroy()
          server.close()
          resolve('可以（本机端口连接正常）')
        })
        c.on('error', (e) => {
          server.close()
          resolve('不能连接本机端口：' + e.code)
        })
      })
      setTimeout(() => resolve('超时'), 3000)
    } catch (e) {
      resolve('出错：' + e.message)
    }
  })
  const env = process.env
  const report = {
    '日志实际写入的位置': LOG,
    '用户目录(os.homedir)': os.homedir(),
    'USERPROFILE': env.USERPROFILE ?? null,
    'HOME': env.HOME ?? null,
    'APPDATA': env.APPDATA ?? null,
    '当前目录(cwd)': process.cwd(),
    '系统': `${os.platform()} ${os.release()}`,
    '用户名': (() => {
      try {
        return os.userInfo().username
      } catch {
        return '（取不到）'
      }
    })(),
    'Node 版本': process.version,
    '程序路径': process.execPath,
    '脚本路径': __filename,
    '用户目录读写': tryWrite(os.homedir()),
    '临时目录': os.tmpdir(),
    '临时目录读写': tryWrite(os.tmpdir()),
    '本机网络': loopback,
    'WorkBuddy 的 clientInfo': clientInfo,
    'MCP 协议版本': protocolVersion,
    'WorkBuddy 声明的能力': clientCaps,
    '是否声明支持采样': clientCaps !== null && clientCaps.sampling !== undefined,
    '采样实测': samplingResults,
    '本次会话中被调用的工具': toolCalls,
    '带 WORKBUDDY / SANDBOX 字样的环境变量': Object.keys(env).filter((k) => /workbuddy|sandbox|codebuddy/i.test(k))
  }
  const text = JSON.stringify(report, null, 2)
  log('环境报告', report)
  return text
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line.trim() === '') return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    log('收到无法解析的内容', line.slice(0, 500))
    return
  }

  // 我们发出的采样请求的回应
  if (msg.id !== undefined && pending.has(msg.id) && msg.method === undefined) {
    const label = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error !== undefined) log(`× ${label}：失败`, msg.error)
    else log(`✓ ${label}：成功`, msg.result)
    samplingResults.push({ label, ok: msg.error === undefined, detail: msg.error ?? msg.result })
    return
  }

  switch (msg.method) {
    case 'initialize':
      clientCaps = msg.params?.capabilities ?? {}
      clientInfo = msg.params?.clientInfo ?? null
      protocolVersion = msg.params?.protocolVersion ?? null
      log(`WorkBuddy 发来的连接信息（clientInfo 与 capabilities）${/probe/i.test(msg.params?.clientInfo?.name ?? '') ? '——这是保存配置时的连通性检查' : '——这是对话中的真实连接'}`, {
        protocolVersion: msg.params?.protocolVersion,
        clientInfo: msg.params?.clientInfo,
        capabilities: clientCaps
      })
      send({
        id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'teaching-plan-probe', version: '0.1.0' }
        }
      })
      break
    case 'notifications/initialized':
      log('连接已建立')
      setTimeout(startSamplingTests, 500)
      break
    case 'ping':
      send({ id: msg.id, result: {} })
      break
    case 'tools/list':
      send({
        id: msg.id,
        result: {
          tools: [
            {
              name: 'probe_report',
              description: '教学案制作的连接测试：返回探针记录的测试结果',
              inputSchema: { type: 'object', properties: {} }
            },
            {
              name: 'probe_image',
              description: '教学案制作的连接测试：返回一张测试图片。请看图后告诉用户图片是什么颜色。',
              inputSchema: { type: 'object', properties: {} }
            },
            {
              name: 'probe_answer',
              description: '教学案制作的连接测试：看过 probe_image 返回的图片后，调用本工具报告你看到的颜色',
              inputSchema: { type: 'object', properties: { color: { type: 'string', description: '图片的颜色' } }, required: ['color'] }
            }
          ]
        }
      })
      break
    case 'tools/call': {
      const name = msg.params?.name
      toolCalls.push({ name, at: new Date().toLocaleTimeString('zh-CN') })
      if (name === 'probe_image') {
        log('WorkBuddy 调用了工具 probe_image：返回一张红色测试图（请看 AI 在对话里说的是什么颜色）')
        send({
          id: msg.id,
          result: {
            content: [
              { type: 'image', data: RED_PNG, mimeType: 'image/png' },
              { type: 'text', text: '这是一张测试图片。请告诉用户它是什么颜色，然后调用 probe_answer 报告这个颜色。' }
            ]
          }
        })
      } else if (name === 'probe_answer') {
        const color = String(msg.params?.arguments?.color ?? '')
        log(`WorkBuddy 调用了工具 probe_answer，报告的颜色：「${color}」——${/红/.test(color) ? '✓ 模型能看到工具返回的图片' : '× 回答不是红色，模型可能没看到图片'}`)
        send({ id: msg.id, result: { content: [{ type: 'text', text: '已记录，谢谢。' }] } })
      } else {
        log('WorkBuddy 调用了工具 probe_report')
        environmentReport().then((report) => {
          send({ id: msg.id, result: { content: [{ type: 'text', text: '请把下面的内容原样（不要改写、不要省略）贴给用户：\n\n' + report }] } })
        })
      }
      break
    }
    default:
      if (msg.id !== undefined && msg.method !== undefined) {
        send({ id: msg.id, error: { code: -32601, message: `探针不支持：${msg.method}` } })
      }
  }
})

log('===== 探针启动 =====')
