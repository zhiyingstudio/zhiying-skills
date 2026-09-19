// v33: 保存主表 → 预览提交 → 抓校验结果
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
const SYNTH=`function synth(el){ if(!el) return false;
  const o={bubbles:true,cancelable:true,view:window,button:0,buttons:1};
  const r=el.getBoundingClientRect();
  ['mousedown','mouseup','click'].forEach(ty=>el.dispatchEvent(new MouseEvent(ty,Object.assign({clientX:r.x+r.width/2,clientY:r.y+r.height/2},o))));
  if(el.click) try{el.click()}catch(e){} return true; } `;

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
    if (r.result && r.result.exceptionDetails) return { ERR: String(JSON.stringify(r.result.exceptionDetails)).slice(0,400) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await ev(`document.querySelectorAll('.el-message').forEach(x=>x.remove()); 'ok'`);
  // 保存主表
  const s = await ev(`(() => {${SYNTH}
    const bs=[...document.querySelectorAll('button')].filter(x=>x.innerText.trim().replace(/\\s+/g,'')==='保存'&&x.offsetParent!==null);
    if(!bs.length) return 'NF';
    synth(bs[bs.length-1]); return 'SAVED';
  })()`);
  console.log('MAIN_SAVE:', s);
  await new Promise(r => setTimeout(r, 4000));

  // 刷新确认框
  const dlg = await ev(`(() => {
    const d=[...document.querySelectorAll('.el-message-box__wrapper')].filter(x=>x.style.display!=='none');
    return d.map(x=>({txt:x.innerText.replace(/\\n+/g,' | ').slice(0,250),btns:[...x.querySelectorAll('button')].map(b=>b.innerText.trim().replace(/\\s+/g,''))}));
  })()`);
  console.log('REFRESH_DLG:', JSON.stringify(dlg));
  if (JSON.stringify(dlg).includes('刷新')) {
    await ev(`(() => {${SYNTH}
      const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim().replace(/\\s+/g,'')==='保存并刷新');
      if(b) synth(b); return !!b; })()`);
    await new Promise(r => setTimeout(r, 5000));
    await ev(`(() => {${SYNTH}
      const bs=[...document.querySelectorAll('button')].filter(x=>x.innerText.trim().replace(/\\s+/g,'')==='确定'&&x.offsetParent!==null);
      if(bs.length) synth(bs[bs.length-1]); return bs.length; })()`);
    await new Promise(r => setTimeout(r, 3500));
  }
  console.log('MSGS:', JSON.stringify(await ev(`[...document.querySelectorAll('.el-message')].map(m=>m.innerText.trim())`)));

  // 预览/提交
  await ev(`document.querySelectorAll('.el-message').forEach(x=>x.remove()); 'ok'`);
  const c = await ev(`(() => {${SYNTH}
    const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim().replace(/\\s+/g,'')==='预览/提交'&&x.offsetParent!==null);
    if(!b) return 'NF';
    synth(b); return 'CLICKED';
  })()`);
  console.log('PREVIEW:', c);
  await new Promise(r => setTimeout(r, 7000));

  console.log('URL:', await ev('location.href'));
  const r = await ev(`(() => ({
    tables: [...document.querySelectorAll('table')].filter(x=>/JY0|校验/.test(x.innerText)).map(x=>[...x.querySelectorAll('tr')].map(r=>[...r.querySelectorAll('td,th')].map(c=>c.innerText.trim().replace(/\\s+/g,' ')).join(' | ')).filter(Boolean)),
    btns: [...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null&&b.innerText.trim()).map(b=>b.innerText.trim().replace(/\\s+/g,'')),
    tail: document.body.innerText.replace(/\\n{2,}/g,'\\n').slice(-500)
  }))()`);
  console.log(JSON.stringify(r, null, 1).slice(0, 4000));
  ws.close(); process.exit(0);
})();
