// 通用：保存当前 Tab + 处理「段号刷新」三段式确认框
// 用法: node save_tab.js [tabName]
const {connect, synthClickJS, switchTabJS, CLEAN_JS, HANDLE_REFRESH_JS} = require('./cdp.js');
const URL_MARK = 'fmzlxg?dianzisqajbh';

const sleep = ms => new Promise(r=>setTimeout(r, ms));

(async ()=>{
  const tabName = process.argv[2];
  const c = await connect(URL_MARK);
  console.log('PAGE=' + c.page.url.slice(0,110));

  const reqs = [];
  c.on(m=>{
    if(m.method==='Network.requestWillBeSent'){
      const u = m.params.request.url;
      if(u.indexOf('cponline')>=0 && u.indexOf('resources.')<0)
        reqs.push(m.params.request.method+' '+u.replace(/^https:\/\/api\.cponline\.cnipa\.gov\.cn/,'').slice(0,110));
    }
    if(m.method==='Network.responseReceived' && m.params.response.url.indexOf('savewushupage')>=0)
      console.log('  RESP ' + m.params.response.status + ' ...' + m.params.response.url.slice(-45));
  });
  await c.send('Network.enable');

  // 1. 清理
  await c.ev(CLEAN_JS);
  await sleep(400);

  // 2. 可选切 Tab
  if(tabName){
    const r = await c.ev(switchTabJS(tabName));
    console.log('SWITCH=' + r);
    await sleep(3500);
    console.log('NOW_TAB=' + await c.ev(`(document.querySelector('.el-tabs__item.is-active')||{}).innerText`));
  }

  // 3. 点「保存」（顶部操作区，y<320 避免命中底部）
  const r1 = await c.ev(synthClickJS(
    `Array.from(document.querySelectorAll('button')).find(b=>{
       const t=(b.innerText||'').replace(/\\s/g,'');
       const r=b.getBoundingClientRect();
       return t==='保存' && r.width>0 && r.y<320;
     })`
  ));
  console.log('CLICK_SAVE=' + r1);
  await sleep(4000);

  // 4. 处理确认框（只认「保存并刷新」）
  for(let round=0; round<4; round++){
    const info = await c.ev(`(function(){
      const ds = Array.from(document.querySelectorAll('.el-dialog__wrapper')).filter(x=>getComputedStyle(x).display!=='none');
      if(!ds.length) return {none:true};
      ds.sort((a,b)=>(parseInt(getComputedStyle(b).zIndex)||0)-(parseInt(getComputedStyle(a).zIndex)||0));
      const dl = ds[0];
      return {txt:(dl.innerText||'').replace(/\\n/g,' ').slice(0,110),
              btns:Array.from(dl.querySelectorAll('button')).map(x=>(x.innerText||'').replace(/\\s/g,''))};
    })()`);
    console.log('DLG_R' + round + '=' + JSON.stringify(info));
    if(info.none) break;
    if(info.txt.indexOf('刷新')<0){ console.log('  -> 非刷新弹窗，停止（避免误删）'); break; }
    const act = await c.ev(HANDLE_REFRESH_JS);
    console.log('  ACTION=' + act);
    await sleep(4000);
  }

  await sleep(2000);
  console.log('MSGS=' + JSON.stringify(await c.ev(
    `Array.from(document.querySelectorAll('.el-message')).map(e=>(e.innerText||'').replace(/\\n/g,' ').slice(0,110))`
  )));
  console.log('REQS=' + JSON.stringify([...new Set(reqs)], null, 1));

  c.sock.close();
  process.exit(0);
})().catch(e=>{ console.log('FATAL', e.message); process.exit(1); });
