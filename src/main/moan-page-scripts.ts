/**
 * 在墨案页面主环境中执行的脚本（webContents.executeJavaScript）。
 *
 * 写成普通 JavaScript 字符串而不是 TypeScript 函数，避免打包工具改写后在页面里缺少辅助函数。
 * （第一版“一键采集”曾用脚本依次点开每道题的“详情”读取页面；找到墨案的数据接口后改为直接请求，见下。）
 */

/**
 * 在墨案页面里向墨案服务器发一次 socket.io 请求并等待回应（墨案的数据接口全部走 socket.io v2，EIO=3）。
 * 在页面中执行，所以连接带着墨案网站自己的来源，与网页发出的请求一样。
 * 协议：服务器先发 0{…}（握手）与 40；客户端发 40/命名空间, 连接命名空间，再发
 * 42/命名空间,1["事件",参数]，服务器以 43/命名空间,1[回应] 确认。
 * 返回 JSON 字符串：{ ok: true, data } 或 { error }。
 */
export function socketCallScript(wsUrl: string, namespace: string, event: string, payload: unknown, timeoutMs = 30000): string {
  return String.raw`(() => new Promise((resolve) => {
  const wsUrl = ${JSON.stringify(wsUrl)}, ns = ${JSON.stringify(namespace)}, event = ${JSON.stringify(event)};
  const payload = ${JSON.stringify(payload)};
  let done = false, ping = null, ws = null;
  const finish = (v) => {
    if (done) return; done = true;
    clearTimeout(timer); if (ping) clearInterval(ping);
    try { ws && ws.close(); } catch (e) {}
    resolve(JSON.stringify(v));
  };
  const timer = setTimeout(() => finish({ error: '墨案服务器 ' + Math.round(${timeoutMs} / 1000) + ' 秒内没有回应' }), ${timeoutMs});
  try { ws = new WebSocket(wsUrl); } catch (e) { finish({ error: '无法连接墨案服务器：' + e }); return; }
  const ack = '43/' + ns + ',1';
  ws.onmessage = (e) => {
    const d = typeof e.data === 'string' ? e.data : '';
    if (d.charAt(0) === '0') {
      try { const o = JSON.parse(d.slice(1)); ping = setInterval(() => { try { ws.send('2'); } catch (x) {} }, Math.max(5000, (o.pingInterval || 25000) - 1000)); } catch (x) {}
      ws.send('40/' + ns + ',');
    } else if (d.indexOf('40/' + ns) === 0) {
      ws.send('42/' + ns + ',1' + JSON.stringify([event, payload]));
    } else if (d.indexOf(ack) === 0 && (d.charAt(ack.length) === '[')) {
      try { const arr = JSON.parse(d.slice(ack.length)); finish({ ok: true, data: arr[0] }); } catch (err) { finish({ error: '墨案的回应无法解析：' + err }); }
    } else if (d.indexOf('44/' + ns) === 0) {
      finish({ error: '墨案拒绝了请求：' + d.slice(0, 200) });
    }
  };
  ws.onerror = () => finish({ error: '无法连接墨案服务器' });
  ws.onclose = () => finish({ error: '与墨案服务器的连接已断开' });
}))()`
}
