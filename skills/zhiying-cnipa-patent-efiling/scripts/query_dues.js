// y23_query2.js —— 在应缴费查询页分别输入两个申请号，读权威应缴金额
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

  // 找输入框
  let r = await ev(`JSON.stringify([...document.querySelectorAll('input')].map((e,i)=>({i, ph:e.placeholder, type:e.type, w:Math.round(e.getBoundingClientRect().width), vis:e.offsetParent!==null})), null, 1)`);
  console.log('INPUTS:', r.result.result.value);

  async function query(sqh) {
    // 填值
    let rr = await ev(`(() => {
      const inp = [...document.querySelectorAll('input')].filter(e=>e.offsetParent!==null && (e.placeholder||'').includes('申请号'))[0]
                || [...document.querySelectorAll('input')].filter(e=>e.offsetParent!==null && e.type==='text')[0];
      if (!inp) return 'INP_NF';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      setter.call(inp, '${sqh}');
      inp.dispatchEvent(new Event('input',{bubbles:true}));
      inp.dispatchEvent(new Event('change',{bubbles:true}));
      inp.dispatchEvent(new Event('blur',{bubbles:true}));
      return 'SET:' + inp.value;
    })()`);
    console.log('  SET:', rr.result.result.value);
    await new Promise(x => setTimeout(x, 800));

    // 点查询
    rr = await ev(`(() => {
      const b = [...document.querySelectorAll('button')].filter(e=>e.offsetParent!==null && /^\\s*查\\s*询\\s*$/.test(e.innerText))[0];
      if (!b) return 'BTN_NF';
      const r2 = b.getBoundingClientRect();
      const o = { bubbles:true, cancelable:true, view:window, button:0, buttons:1 };
      ['mousedown','mouseup','click'].forEach(ty => b.dispatchEvent(new MouseEvent(ty, Object.assign({clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}, o))));
      try { b.click(); } catch(e) {}
      return 'QUERIED';
    })()`);
    console.log('  Q:', rr.result.result.value);
    await new Promise(x => setTimeout(x, 5000));

    rr = await ev(`JSON.stringify({
      total: (document.querySelector('.el-pagination__total')||{}).innerText||null,
      heads: [...document.querySelectorAll('.el-table__header th')].map(th=>th.innerText.trim().replace(/\\s+/g,' ')).filter(Boolean),
      rows: [...document.querySelectorAll('.el-table__body tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>td.innerText.trim().replace(/\\s+/g,' ')).join(' | ')).slice(0,20),
      empty: (document.querySelector('.el-table__empty-text')||{}).innerText||null
    }, null, 1)`);
    console.log('  RESULT:', rr.result.result.value);
  }

  const targets = process.argv.slice(2);
  if (!targets.length) { console.error('用法: node query_dues.js <申请号1> [申请号2...]'); process.exit(1); }
  for (const no of targets) { console.log('=== ' + no + ' ==='); await query(no); }
  console.log('=== 创课 2026114260670 ===');
  await query('2026114260670');

  ws.close();
})();
