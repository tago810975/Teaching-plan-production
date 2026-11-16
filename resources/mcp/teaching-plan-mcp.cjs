#!/usr/bin/env node
/**
 * 教学案制作 —— WorkBuddy 连接器（MCP 服务，stdio；不依赖任何第三方库，由 WorkBuddy 自带的 Node 运行）。
 *
 * 由教学案制作的“设置 → 连接 WorkBuddy”写入 ~/.workbuddy/mcp.json，并复制到用户数据目录（本文件）。
 * 它把 3 个工具的调用转给正在运行的教学案制作（本机 HTTP 服务，连接信息在环境变量 TEACHING_PLAN_BRIDGE 指向的文件中）：
 *   get_pending_images —— 取老师在“从图片导入”中交出的题目图片与转写格式说明
 *   check_questions    —— 检查转写结果（题数、无法转换的公式、插图编号对不上等），AI 据此修正
 *   submit_questions   —— 提交，结果出现在教学案制作的“从图片导入”窗口中，由老师确认后导入
 */
'use strict'
const fs = require('fs')
const http = require('http')
const readline = require('readline')

const INFO = process.env.TEACHING_PLAN_BRIDGE || process.argv[2] || ''
const VERSION = '1.0.0'

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')

/** 调用教学案制作的本机服务 */
function call(path, body) {
  return new Promise((resolve, reject) => {
    let info
    try {
      info = JSON.parse(fs.readFileSync(INFO, 'utf8'))
    } catch {
      reject(new Error('not-running'))
      return
    }
    const data = Buffer.from(JSON.stringify(body || {}), 'utf8')
    const req = http.request(
      { host: '127.0.0.1', port: info.port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'x-teaching-plan-token': info.token }, timeout: 20000 },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', () => reject(new Error('not-running')))
    req.on('timeout', () => req.destroy(new Error('not-running')))
    req.end(data)
  })
}

const NOT_RUNNING = '教学案制作没有在运行。请让用户先打开“教学案制作”，在“导入题目 → 图片”窗口中放入图片并点“交给 WorkBuddy 识别”，再说“导入题目”。'
const NO_TASK = '教学案制作里现在没有等待识别的图片。请让用户在教学案制作的“导入题目 → 图片”窗口中放入图片，点“交给 WorkBuddy 识别”，然后再说“导入题目”。'

const textContent = (text) => ({ content: [{ type: 'text', text }] })

function describeCheck(r) {
  const head = r.questionCount > 0 ? `识别到 ${r.questionCount} 道题` : '没有识别到题目（题目要以“1．”这样的题号开头）'
  return r.issues && r.issues.length > 0 ? `${head}。需要修正的问题：\n${r.issues.map((i) => `- ${i}`).join('\n')}` : `${head}，没有发现问题。`
}

const TOOLS = [
  {
    name: 'get_pending_images',
    description:
      '取出“教学案制作”软件中老师交给你识别的题目图片，以及转写格式说明。当用户说“导入题目”“识别题目图片”“教学案导入”等时先调用本工具，' +
      '然后按格式说明逐字转写图片，再调用 check_questions 检查、submit_questions 提交。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'check_questions',
    description: '检查题目图片的转写结果：返回识别到几道题，以及无法转换的公式、插图编号对不上、格式不对等问题。有问题就修正后再检查，没有问题再提交。',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: '完整的转写文字（按格式说明，不要用代码块包起来）' } }, required: ['text'] }
  },
  {
    name: 'submit_questions',
    description: '把检查无误的转写结果交给“教学案制作”软件。提交后告诉用户回到教学案制作检查并导入。',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: '完整的转写文字（不要用代码块包起来）' } }, required: ['text'] }
  }
]

async function runTool(name, args) {
  try {
    if (name === 'get_pending_images') {
      const r = await call('/pending', {})
      if (!r.task) return textContent(NO_TASK)
      const t = r.task
      const steps =
        `\n\n【本次任务】共 ${t.images.length} 张图片（按下面的顺序转写，接着编号）。` +
        (t.figureCount > 0 ? `软件已在图片中框出 ${t.figureCount} 张插图，请按阅读顺序（图片顺序，同一张图先上后下、先左后右）写 [图1]～[图${t.figureCount}]。` : '') +
        '\n【完成后】通过工具提交时不要用代码块包起来。先调用 check_questions 检查，按返回的问题修正后再检查；没有问题时调用 submit_questions 提交。' +
        '转写全文不必在对话中显示，提交后简短告诉用户识别了几道题、请回到教学案制作检查后导入。'
      return {
        content: [{ type: 'text', text: r.guide + steps }, ...t.images.map((img) => ({ type: 'image', data: img.data, mimeType: img.mime }))]
      }
    }
    if (name === 'check_questions') {
      const r = await call('/check', { text: String((args && args.text) || '') })
      return textContent(describeCheck(r))
    }
    if (name === 'submit_questions') {
      const r = await call('/submit', { text: String((args && args.text) || '') })
      if (!r.ok) return textContent(NO_TASK)
      return textContent(`已交给教学案制作：${describeCheck(r)}\n请告诉用户回到教学案制作的“从图片导入”窗口检查结果和插图，然后点“导入”。`)
    }
    return { content: [{ type: 'text', text: `没有这个工具：${name}` }], isError: true }
  } catch (e) {
    return textContent(e && e.message === 'not-running' ? NOT_RUNNING : `出错：${e && e.message ? e.message : e}`)
  }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line.trim() === '') return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  switch (msg.method) {
    case 'initialize':
      send({
        id: msg.id,
        result: {
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'teaching-plan', version: VERSION }
        }
      })
      break
    case 'ping':
      send({ id: msg.id, result: {} })
      break
    case 'tools/list':
      send({ id: msg.id, result: { tools: TOOLS } })
      break
    case 'tools/call':
      void runTool(msg.params && msg.params.name, msg.params && msg.params.arguments).then((result) => send({ id: msg.id, result }))
      break
    default:
      if (msg.id !== undefined && msg.method !== undefined) send({ id: msg.id, error: { code: -32601, message: `不支持：${msg.method}` } })
  }
})
