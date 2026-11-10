/**
 * 墨案网页会话：从网页与服务器的 socket.io 往来中得到导入需要的信息。
 *
 * - 服务器地址：网页连接的 WebSocket 地址（wss://server.modijiaoyu.com/socket.io/?EIO=3&transport=websocket）；
 * - 登录令牌：网页每次请求都在参数里带 token。只保存在内存中，不写入任何文件；
 * - 当前文件夹：网页最近一次请求教案列表（moan-teaching-plan 的 list，参数 folder_id）的文件夹，
 *   以及文件夹列表回应里的文件夹名称，供“导入当前文件夹的全部教案”使用。
 */

export interface MoanSession {
  wsUrl?: string
  token?: string
  /** 最近一次查看的教案文件夹 */
  folderId?: number
  folderNames: Map<number, string>
}

export function createMoanSession(): MoanSession {
  return { folderNames: new Map() }
}

/** socket.io 事件帧：42/命名空间,确认号[...] 或 43/命名空间,确认号[...] */
export function parseSocketFrame(text: string): { type: string; namespace: string; ackId?: number; data: unknown[] } | null {
  const m = /^(4[23])(?:\/([^,]*),)?(\d*)(\[[\s\S]*\])$/.exec(text)
  if (m === null) return null
  try {
    const data = JSON.parse(m[4]!) as unknown
    if (!Array.isArray(data)) return null
    return { type: m[1]!, namespace: m[2] ?? '', ...(m[3] !== '' ? { ackId: Number(m[3]) } : {}), data }
  } catch {
    return null
  }
}

/** 网页发出或收到一帧 WebSocket 消息时调用 */
export function observeMoanFrame(session: MoanSession, direction: 'send' | 'receive', url: string, text: string): void {
  if (!/\/socket\.io\//.test(url)) return
  if (direction === 'send') {
    const f = parseSocketFrame(text)
    if (f === null) return
    session.wsUrl = url
    const params = f.data[1]
    if (params !== null && typeof params === 'object') {
      const p = params as Record<string, unknown>
      if (typeof p['token'] === 'string' && p['token'] !== '') session.token = p['token']
      if (f.namespace === 'moan-teaching-plan' && f.data[0] === 'list' && p['folder_id'] !== undefined) {
        const id = Number(p['folder_id'])
        if (Number.isInteger(id) && id > 0) session.folderId = id
      }
    }
    return
  }
  // 回应里的文件夹名称（folder-list / folder-sub-list）
  if (!text.includes('"folders"')) return
  const f = parseSocketFrame(text)
  const content = (f?.data[0] as { content?: { folders?: unknown } } | undefined)?.content
  if (content === undefined || !Array.isArray(content.folders)) return
  for (const folder of content.folders as Array<{ id?: unknown; name?: unknown }>) {
    if (typeof folder.id === 'number' && typeof folder.name === 'string') session.folderNames.set(folder.id, folder.name)
  }
}

export function isMoanSessionReady(s: MoanSession): s is MoanSession & { wsUrl: string; token: string } {
  return s.wsUrl !== undefined && s.token !== undefined
}

/** 当前教案编辑页的教案 id（#/teach/edit_teachingPlan/3829?…） */
export function teachingPlanIdFromUrl(url: string): number | null {
  const m = /#\/teach\/edit_teachingPlan\/(\d+)/.exec(url)
  return m === null ? null : Number(m[1])
}
