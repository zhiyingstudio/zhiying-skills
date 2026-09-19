// y10_dump.js —— 完整 dump 缴费单页面结构（量出删除按钮坐标、费用明细）
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

  // 用页面里的 el-table 逐个分析
  const dump = `(() => {
    const out = { containers: [], delButtons: [], feeRows: [] };

    // 找出「序号：1」那个费用块
    const allTables = [...document.querySelectorAll('.el-table')];
    out.tableCount = allTables.length;
    allTables.forEach((t, i) => {
      const rect = t.getBoundingClientRect();
      out.containers.push({
        idx: i,
        headers: [...t.querySelectorAll('.el-table__header th')].map(th => th.innerText.trim().replace(/\\s+/g,' ')),
        rowCount: t.querySelectorAll('.el-table__body tbody tr').length,
        visible: t.offsetParent !== null,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
      });
    });

    // 所有「删除」按钮（缴费单内）
    [...document.querySelectorAll('button')].filter(b => /^删除$/.test(b.innerText.trim()) && b.offsetParent !== null).forEach(b => {
      const rr = b.getBoundingClientRect();
      // 找它所在行的费用名
      let rowText = '';
      let p = b;
      for (let k = 0; k < 8 && p; k++) {
        p = p.parentElement;
        if (p && p.tagName === 'TR') { rowText = p.innerText.trim().replace(/\\s+/g,' '); break; }
      }
      out.delButtons.push({ text: rowText, x: Math.round(rr.x + rr.width/2), y: Math.round(rr.y + rr.height/2) });
    });

    // 费用明细行
    [...document.querySelectorAll('tr')].forEach(tr => {
      const t = tr.innerText.trim().replace(/\\s+/g,' ');
      if (/权利要求附加费|公布印刷费|发明专利申请费|实质审查费/.test(t) && t.length < 120) {
        const cells = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
        out.feeRows.push(cells);
      }
    });

    // 总额
    const bodyT = document.body.innerText.replace(/\\s+/g,' ');
    const m = bodyT.match(/总额：￥[\\d.]+总笔数：\\d+/);
    out.total = m ? m[0] : null;
    const m2 = bodyT.match(/序号：\\d+ 申请号\\/专利号：\\d+ [^]{0,80}/);
    out.section = m2 ? m2[0] : null;

    return JSON.stringify(out, null, 1);
  })()`;
  const r = await ev(dump);
  console.log(r.result.result.value);
  ws.close();
})();
