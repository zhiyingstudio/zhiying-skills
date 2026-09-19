// v32: 修正申请人名称为营业执照全称（含（个体工商户））
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
const TYPE=`function setVal(inp, val){
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(inp, val);
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  inp.dispatchEvent(new Event('blur',{bubbles:true}));
  return inp.value;
}`;

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
  await send('Page.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue:true, awaitPromise:true });
    if (r.result && r.result.exceptionDetails) return { ERR: String(JSON.stringify(r.result.exceptionDetails)).slice(0,400) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  // 回案卷页
  const CASE_NO = process.argv[2] || process.env.CNIPA_CASE_NO || '';
  if (!CASE_NO) { console.error('用法: node fix_applicant_name.js <案卷号>'); process.exit(1); }
  const url = 'https://interactive.cponline.cnipa.gov.cn/public-app-zxsq-guojia/gjsq/fmzlsq/fmzlxg?dianzisqajbh=' + CASE_NO;
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 12000));
  console.log('URL:', await ev('location.href'));

  await ev(`document.querySelectorAll('.el-message').forEach(x=>x.remove()); 'ok'`);

  // 打开申请人「修改」弹窗
  const c = await ev(`(() => {${SYNTH}
    const bs=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='修改'&&b.offsetParent!==null);
    if(!bs.length) return 'NF:'+JSON.stringify([...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>b.innerText.trim()).slice(0,20));
    const t=bs[bs.length-1];  // 最后一个「修改」= 申请人行
    synth(t); return 'OK y='+Math.round(t.getBoundingClientRect().y);
  })()`);
  console.log('OPEN_MOD:', c);
  await new Promise(r => setTimeout(r, 2500));

  // 修改名称
  const s = await ev(`(() => {${TYPE}
    const w=[...document.querySelectorAll('.el-dialog__wrapper')].filter(x=>x.style.display!=='none')
      .find(x=>x.innerText.includes('修改申请人'));
    if(!w) return 'NO_DLG';
    const dlg=w.querySelector('.el-dialog');
    // 找 label 为「姓名或名称」的 form-item
    const items=[...dlg.querySelectorAll('.el-form-item')];
    let target=null;
    for(const it of items){
      const lab=it.querySelector('.el-form-item__label');
      if(lab && lab.innerText.trim()==='姓名或名称'){ target=it; break; }
    }
    if(!target) return 'NO_ITEM';
    const inp=target.querySelector('input.el-input__inner');
    if(!inp) return 'NO_INPUT';
    const before=inp.value;
    const v=setVal(inp, '大连市甘井子区智影数字科技工作室（个体工商户）');
    return { before, after:v };
  })()`);
  console.log('SET_NAME:', JSON.stringify(s));
  await new Promise(r => setTimeout(r, 1000));

  // 保存弹窗
  const sv = await ev(`(() => {${SYNTH}
    const w=[...document.querySelectorAll('.el-dialog__wrapper')].filter(x=>x.style.display!=='none').find(x=>x.innerText.includes('修改申请人'));
    if(!w) return 'NO_DLG';
    const b=[...w.querySelectorAll('button')].find(x=>x.innerText.trim().replace(/\\s+/g,'')==='保存');
    if(!b) return 'NF';
    synth(b); return 'SAVED';
  })()`);
  console.log('DLG_SAVE:', sv);
  await new Promise(r => setTimeout(r, 4000));
  console.log('MSGS:', JSON.stringify(await ev(`[...document.querySelectorAll('.el-message')].map(m=>m.innerText.trim())`)));

  // 检查表格
  const t = await ev(`(() => {
    const tb=[...document.querySelectorAll('.el-table')].find(x=>/费减/.test(x.innerText)&&/代表人/.test(x.innerText));
    if(!tb) return 'NO_TABLE';
    return [...tb.querySelectorAll('tr')].map(r=>[...r.querySelectorAll('td,th')].map(c=>c.innerText.trim().replace(/\\s+/g,' ')).join(' | ')).filter(x=>x.replace(/[\\s|]/g,''));
  })()`);
  console.log('APP_TABLE:', JSON.stringify(t, null, 1));
  ws.close(); process.exit(0);
})();
