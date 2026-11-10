/**
 * 在墨案页面主环境中执行的脚本（webContents.executeJavaScript），用于“一键采集本教案”。
 *
 * 写成普通 JavaScript 字符串而不是 TypeScript 函数，避免打包工具改写后在页面里缺少辅助函数。
 * 每个脚本返回 JSON 字符串。依据的页面结构（2026-11 墨案编辑页 #/teach/edit_teachingPlan/<id>）：
 * - 页面是 Vue + iView；每道题旁有 <button class="ivu-btn"><span>详情</span></button>；
 * - “详情”打开标题为“题目信息”的 .ivu-modal，正文依次是题干、[解析]、[答案]；
 * - 顶部有“预览教案”按钮，打开标题含“预览”的对话框（就是导出 PDF 的那个页面）；
 * - 公式是 KaTeX，带 <annotation encoding="application/x-tex"> 源码。
 */

/** 公用的小工具（拼在各脚本开头） */
const HELPERS = String.raw`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const visibleModal = (title) => [...document.querySelectorAll('.ivu-modal')].find((m) => {
    if (!isVisible(m)) return false;
    const h = m.querySelector('.ivu-modal-header');
    return h !== null && h.textContent.includes(title);
  });
  const waitFor = async (fn, timeout) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(150); }
    return null;
  };
  // 等内容不再变化（接口返回、公式渲染完）
  const waitStable = async (el, timeout) => {
    const end = Date.now() + timeout;
    let last = -1, same = 0;
    while (Date.now() < end) {
      const len = el.innerHTML.length;
      const loading = el.querySelector('.ivu-spin-spinning, .ivu-icon-ios-loading.ivu-load-loop:not([style*="none"])') !== null && el.textContent.includes('加载中');
      if (len === last && !loading) { if (++same >= 3) return true; } else { same = 0; last = len; }
      await sleep(300);
    }
    return false;
  };
  const closeModal = async (m) => {
    const x = m.querySelector('.ivu-modal-close');
    if (x) x.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await waitFor(() => !isVisible(m), 3000);
    await sleep(200);
  };
  const buttonsWithText = (text) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === text && isVisible(b));
`

/** 读取页面 Vue 组件与 Vuex 中的数据。跳过 iView 自身的组件，函数、DOM、以 _ / $ 开头的内部字段不记录 */
export const DUMP_VUE_STATE = String.raw`(() => {
  const seen = new WeakSet();
  const ser = (v, depth) => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === 'function' || t === 'symbol') return undefined;
    if (t === 'bigint') return String(v);
    if (t !== 'object') return v;
    if (depth > 16) return '[层级过深]';
    if (typeof Node !== 'undefined' && v instanceof Node) return '[DOM]';
    if (v instanceof Date) return v.toISOString();
    if (seen.has(v)) return '[同上]';
    seen.add(v);
    if (Array.isArray(v)) return v.slice(0, 5000).map((x) => ser(x, depth + 1));
    const o = {};
    for (const k of Object.keys(v)) {
      if (k.startsWith('_') || k.startsWith('$')) continue;
      try { const s = ser(v[k], depth + 1); if (s !== undefined) o[k] = s; } catch (e) { o[k] = '[读取失败]'; }
    }
    return o;
  };
  const isLibrary = (el) => !!el && el.classList && [...el.classList].some((c) => c.startsWith('ivu-') || c.startsWith('i-layout') || c.startsWith('smooth-dnd'));
  const out = { vue: null, route: location.href, store: null, components: [] };
  // 根组件通常挂在 #app 上；挂载时被模板替换的话就在 body 的子元素上
  const candidates = [document.querySelector('#app'), ...document.body.children].filter(Boolean);
  const rootEl = candidates.find((el) => el.__vue__ || el.__vue_app__) || candidates[0];
  try {
    const root = rootEl && rootEl.__vue__ && rootEl.__vue__.$root;
    if (root) {
      out.vue = 2;
      if (root.$store) out.store = ser(root.$store.state, 0);
      if (root.$route) out.routeInfo = ser({ path: root.$route.path, params: root.$route.params, query: root.$route.query }, 0);
      const walk = (c, path) => {
        const name = c.$options.name || c.$options._componentTag || '';
        const keys = Object.keys(c.$data || {});
        if (keys.length > 0 && !isLibrary(c.$el)) out.components.push({ path, name, data: ser(c.$data, 0) });
        (c.$children || []).forEach((ch, i) => walk(ch, path + '/' + (ch.$options.name || ch.$options._componentTag || i)));
      };
      walk(root, 'root');
    } else if (rootEl && rootEl.__vue_app__) {
      out.vue = 3;
      const app = rootEl.__vue_app__;
      const gp = app.config && app.config.globalProperties;
      if (gp && gp.$store) out.store = ser(gp.$store.state, 0);
      if (gp && gp.$pinia) out.pinia = ser(gp.$pinia.state.value, 0);
      const visit = (inst, path) => {
        if (!inst) return;
        const name = (inst.type && (inst.type.name || inst.type.__name)) || '';
        const data = Object.assign({}, inst.data || {}, inst.setupState || {});
        if (Object.keys(data).length > 0 && !isLibrary(inst.subTree && inst.subTree.el)) out.components.push({ path, name, data: ser(data, 0) });
        const kids = [];
        const collect = (vn) => {
          if (!vn) return;
          if (vn.component) { kids.push(vn.component); return; }
          if (Array.isArray(vn.children)) vn.children.forEach(collect);
          if (vn.suspense && vn.suspense.activeBranch) collect(vn.suspense.activeBranch);
        };
        collect(inst.subTree);
        kids.forEach((k, i) => visit(k, path + '/' + ((k.type && (k.type.name || k.type.__name)) || i)));
      };
      visit(app._instance, 'root');
    }
  } catch (e) {
    out.error = String(e);
  }
  return JSON.stringify(out);
})()`

/** 依次点开每道题的“详情”，读取对话框正文后关闭 */
export const COLLECT_DETAILS = String.raw`(async () => {
  ${HELPERS}
  const results = [];
  const buttons = buttonsWithText('详情');
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    // 这道题的文字：向上找只含这一个“详情”按钮的最大容器
    let box = btn;
    while (box.parentElement && box.parentElement.querySelectorAll('button').length > 0
      && [...box.parentElement.querySelectorAll('button')].filter((b) => b.textContent.trim() === '详情').length === 1) box = box.parentElement;
    const label = box.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    try {
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      const modal = await waitFor(() => visibleModal('题目信息'), 6000);
      if (!modal) { results.push({ index: i, label, html: '', note: '没有打开“题目信息”对话框' }); continue; }
      const body = modal.querySelector('.ivu-modal-body') || modal;
      const stable = await waitStable(body, 8000);
      results.push(stable ? { index: i, label, html: body.innerHTML } : { index: i, label, html: body.innerHTML, note: '等待内容超时，可能不完整' });
      await closeModal(modal);
    } catch (e) {
      results.push({ index: i, label, html: '', note: '出错：' + String(e) });
    }
  }
  return JSON.stringify(results);
})()`

/** 打开“预览教案”，读取预览内容后关闭 */
export const COLLECT_PREVIEW = String.raw`(async () => {
  ${HELPERS}
  const btn = buttonsWithText('预览教案')[0];
  if (!btn) return JSON.stringify({ html: null, note: '没有找到“预览教案”按钮' });
  btn.click();
  const modal = await waitFor(() => visibleModal('预览'), 8000);
  if (!modal) return JSON.stringify({ html: null, note: '预览对话框没有打开' });
  const body = modal.querySelector('.ivu-modal-body') || modal;
  const stable = await waitStable(body, 20000);
  const html = body.innerHTML;
  await closeModal(modal);
  return JSON.stringify({ html, note: stable ? undefined : '等待预览内容超时，可能不完整' });
})()`

/** 当前页面是否为教案编辑页 */
export function isTeachingPlanEditUrl(url: string): boolean {
  return /#\/teach\/edit_teachingPlan\/\d+/.test(url)
}
