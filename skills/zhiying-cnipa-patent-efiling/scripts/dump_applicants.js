// v10: 聚焦申请人表格行的 DOM 细节 + 检查是否有隐藏的「是否代表人」勾选
const http = require('http');
const WS_PORT = 9333;
// 可移植加载 ws：优先环境变量 NODE_PATH，其次全局 node_modules，最后本地相对路径
let WS = 'ws';
try { require.resolve('ws'); } catch (e) {
  const cand = [
    process.env.WS_MODULE,
    process.env.HOME + '/.workbuddy/binaries/node/workspace/node_modules/ws',
    '/usr/local/lib/node_modules/ws',
  ].filter(Boolean);
  for (const c of cand) { try { require.resolve(c); WS = c; break; } catch (e2) {} }
}
function httpGet(path){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:WS_PORT,path},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}

(async () => {
  const list = JSON.parse(await httpGet('/json/list'));
  const target = list.filter(t => t.type === 'page').find(p => p.url.includes('cponline'));
  const WebSocket = require(WS);
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate:false, maxPayload: 200*1024*1024 });
  let id=0; const pend=new Map();
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  ws.on('message',m=>{const d=JSON.parse(m);if(d.id&&pend.has(d.id)){pend.get(d.id)(d);pend.delete(d.id);}});
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue:true, awaitPromise:true });
    if (r.result && r.result.exceptionDetails) return { ERR: String(JSON.stringify(r.result.exceptionDetails)).slice(0,300) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  const out = await ev(`(() => {
    const res = {};
    // 找到含「申请人」的 section，取其表格
    const tables = [...document.querySelectorAll('table')];
    const appTable = tables.find(t => /是否/.test(t.innerText) && /费减/.test(t.innerText));
    if (appTable) {
      res.found = true;
      const trs = [...appTable.querySelectorAll('tr')];
      res.rows = trs.map((tr, ti) => {
        const tds = [...tr.querySelectorAll('td,th')].map((td, ci) => {
          const html = td.innerHTML.slice(0, 400);
          const txt = td.innerText.trim().replace(/\\s+/g,' ');
          const cb = td.querySelector('.el-checkbox');
          const inp = td.querySelector('input');
          return { ci, txt, hasCb: !!cb, cbChecked: cb ? cb.classList.contains('is-checked') : null,
                  inpV: inp ? inp.value : null, html: (cb||inp) ? html : '' };
        });
        return { ti, tds };
      });
    }
    // 页面上所有 el-checkbox 及 label + 状态
    res.allCbs = [...document.querySelectorAll('.el-checkbox')].map((c,i)=>{
      const lb = c.querySelector('.el-checkbox__label');
      const r = c.getBoundingClientRect();
      return { i, label: lb?lb.innerText.trim():'', checked: c.classList.contains('is-checked'),
               cy: Math.round(r.y), cx: Math.round(r.x), vis: c.offsetParent!==null, w: Math.round(r.width) };
    }).filter(c => c.vis || c.label);
    // 所有 el-radio
    res.allRads = [...document.querySelectorAll('.el-radio')].map((c,i)=>{
      const lb = c.querySelector('.el-radio__label');
      const r = c.getBoundingClientRect();
      return { i, label: lb?lb.innerText.trim():'', checked: c.classList.contains('is-checked'),
               cy: Math.round(r.y), vis: c.offsetParent!==null };
    }).filter(c => c.vis || c.label);
    return res;
  })()`);
  console.log(JSON.stringify(out, null, 1).slice(0, 13000));
  ws.close(); process.exit(0);
})();
