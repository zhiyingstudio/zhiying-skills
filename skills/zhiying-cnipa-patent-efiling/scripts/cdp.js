// CDP 通用库：连接 + send/ev + 合成 DOM 点击
// 用法: const {connect, synthClickJS} = require('./cdp.js');
const http = require('http');
const WebSocket = require('ws');

const PORT = 9333;

function httpGet(path){
  return new Promise((res,rej)=>{
    http.get({host:'127.0.0.1', port:PORT, path}, r=>{
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d)));
    }).on('error', rej);
  });
}

async function connect(urlMark){
  const list = await httpGet('/json/list');
  const page = list.find(t=>t.type==='page' && t.url.indexOf(urlMark)>=0);
  if(!page) throw new Error('NO_PAGE matching ' + urlMark);

  const sock = new WebSocket(page.webSocketDebuggerUrl, {maxPayload: 256*1024*1024});
  await new Promise(r=>sock.on('open', r));

  let id = 0;
  const pending = new Map();
  const listeners = [];

  sock.on('message', raw=>{
    const m = JSON.parse(raw.toString());
    if(m.id && pending.has(m.id)){
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result||{});
    }
    if(m.method){ listeners.forEach(fn=>{ try{ fn(m); }catch(e){} }); }
  });

  function send(method, params){
    return new Promise((res,rej)=>{
      const mid = ++id;
      pending.set(mid, {res, rej});
      sock.send(JSON.stringify({id:mid, method, params: params||{}}));
    });
  }

  async function ev(expr){
    const r = await send('Runtime.evaluate', {expression:expr, returnByValue:true, awaitPromise:true});
    if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,700));
    return r.result.value;
  }

  await send('Runtime.enable');
  return {sock, send, ev, on: fn=>listeners.push(fn), page, httpGet};
}

// 生成「合成 DOM 三连击」表达式 —— 唯一可靠的点击方式
function synthClickJS(selectorExpr){
  return `(function(){
    const el = ${selectorExpr};
    if(!el) return 'notfound';
    const o = {bubbles:true, cancelable:true, view:window, button:0, buttons:1};
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width/2, cy = r.y + r.height/2;
    ['mousedown','mouseup','click'].forEach(ty =>
      el.dispatchEvent(new MouseEvent(ty, Object.assign({clientX:cx, clientY:cy}, o))));
    if(el.click) el.click();
    return 'clicked';
  })()`;
}

// 清理残留 message + 归零所有滚动容器
const CLEAN_JS = `(function(){
  document.querySelectorAll('.el-message').forEach(e=>e.remove());
  document.querySelectorAll('*').forEach(e=>{ if(e.scrollTop>0) e.scrollTop=0; });
  return 1;
})()`;

// 切 Tab（合成事件）
function switchTabJS(tabText){
  return `(function(){
    const t = Array.from(document.querySelectorAll('.el-tabs__item'))
      .find(x=>x.innerText.trim()===${JSON.stringify(tabText)});
    if(!t) return 'notfound';
    const o = {bubbles:true,cancelable:true,view:window,button:0,buttons:1};
    const r = t.getBoundingClientRect();
    ['mousedown','mouseup','click'].forEach(ty =>
      t.dispatchEvent(new MouseEvent(ty, Object.assign({clientX:r.x+10, clientY:r.y+10}, o))));
    return 'ok';
  })()`;
}

// 处理「段号刷新」确认框（必须是"保存并刷新"）
const HANDLE_REFRESH_JS = `(function(){
  const ds = Array.from(document.querySelectorAll('.el-dialog__wrapper'))
    .filter(x=>getComputedStyle(x).display!=='none');
  if(!ds.length) return 'nodlg';
  ds.sort((a,b)=>(parseInt(getComputedStyle(b).zIndex)||0)-(parseInt(getComputedStyle(a).zIndex)||0));
  const dl = ds[0];
  const txt = (dl.innerText||'').replace(/\\n/g,' ');
  if(txt.indexOf('刷新')<0) return 'notRefresh|' + txt.slice(0,80);
  const b = Array.from(dl.querySelectorAll('button'))
    .find(x=>(x.innerText||'').replace(/\\s/g,'')==='保存并刷新');
  if(!b) return 'noBtn';
  const o = {bubbles:true,cancelable:true,view:window,button:0,buttons:1};
  const r = b.getBoundingClientRect();
  ['mousedown','mouseup','click'].forEach(ty =>
    b.dispatchEvent(new MouseEvent(ty, Object.assign({clientX:r.x+r.width/2, clientY:r.y+r.height/2}, o))));
  b.click();
  return 'clicked:保存并刷新';
})()`;

module.exports = {connect, synthClickJS, switchTabJS, CLEAN_JS, HANDLE_REFRESH_JS, PORT};
