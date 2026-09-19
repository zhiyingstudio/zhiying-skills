// y6_full.js —— 抓全部 12 条（第1页10条 + 第2页2条），输出结构化
const http = require('http');

function httpJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9333, path }, r => {
      let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { res(s); } });
    }).on('error', rej);
  });
}

(async () => {
  const list = await httpJson('/json/list');
  const page = list.find(t => t.type === 'page' && /cponline/.test(t.url));
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
  let msgId = 0; const pending = new Map();
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  function ev(expr) { return send('Runtime.evaluate', { expression: expr, returnByValue: true }); }
  await new Promise(r => ws.on('open', r));

  const grab = `(() => [...document.querySelectorAll('.el-table__body tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.innerText.trim().replace(/\\s+/g,' '))
  ).filter(a => a.length > 5))()`;

  let r = await ev(grab);
  const p1 = r.result.result.value || [];
  console.log('=== PAGE 1 (' + p1.length + ' rows) ===');
  p1.forEach((a, i) => console.log('P1-' + (i+1) + ': ' + a.join(' | ')));

  // 翻到第 2 页
  const clickP2 = `(() => {
    const lis = [...document.querySelectorAll('.el-pager li')];
    const t = lis.find(li => li.innerText.trim() === '2');
    if (!t) return 'P2_NF';
    const rr = t.getBoundingClientRect();
    const o = { bubbles:true, cancelable:true, view:window, button:0, buttons:1 };
    ['mousedown','mouseup','click'].forEach(ty => t.dispatchEvent(new MouseEvent(ty, Object.assign({clientX:rr.x+rr.width/2, clientY:rr.y+rr.height/2}, o))));
    try { t.click(); } catch(e) {}
    return 'P2_CLICKED';
  })()`;
  r = await ev(clickP2);
  console.log('P2 ACTION:', r.result.result.value);
  await new Promise(x => setTimeout(x, 4000));

  r = await ev(grab);
  const p2 = r.result.result.value || [];
  console.log('=== PAGE 2 (' + p2.length + ' rows) ===');
  p2.forEach((a, i) => console.log('P2-' + (i+1) + ': ' + a.join(' | ')));

  // 汇总
  const all = [...p1, ...p2];
  let sum = 0;
  const money = {};
  all.forEach(a => {
    const name = a[5]; const amt = parseFloat(a[6]);
    if (!isNaN(amt)) { sum += amt; money[name] = (money[name]||0) + amt; }
  });
  console.log('=== SUMMARY ===');
  console.log('TOTAL ROWS:', all.length);
  console.log('TOTAL AMOUNT:', sum);
  console.log('BY ITEM:', JSON.stringify(money));

  ws.close();
})();
