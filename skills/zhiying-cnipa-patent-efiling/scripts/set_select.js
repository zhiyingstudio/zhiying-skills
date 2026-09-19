// el-select 级联赋值（Vue 数据层，坐标点击会被面板关闭机制干扰）
// 用法: node set_select.js <selectIndex> <value> [label]
//   例: node set_select.js 2 210000 辽宁省
const {connect, CLEAN_JS} = require('./cdp.js');
const URL_MARK = 'fmzlxg?dianzisqajbh';
const sleep = ms => new Promise(r=>setTimeout(r, ms));

(async ()=>{
  const idx = parseInt(process.argv[2], 10);
  const value = process.argv[3];
  const label = process.argv[4] || '';
  if(Number.isNaN(idx) || !value){ console.log('用法: node set_select.js <index> <value> [label]'); process.exit(1); }

  const c = await connect(URL_MARK);
  await c.ev(CLEAN_JS);
  await sleep(300);

  // 先列出所有 el-select 现状，帮助确认索引
  const list = await c.ev(`(function(){
    function findVue(el){ let x=el; while(x){ if(x.__vue__) return x.__vue__; x=x.parentElement; } return null; }
    return Array.from(document.querySelectorAll('.el-select')).map((s,i)=>{
      const v = findVue(s);
      const inp = s.querySelector('input');
      const r = s.getBoundingClientRect();
      return {i, v: inp?inp.value:'', w:Math.round(r.width),
              optCount: v? (v.options||[]).length : -1};
    });
  })()`);
  console.log('SELECTS=' + JSON.stringify(list));

  const r = await c.ev(`(function(){
    function findVue(el){ let x=el; while(x){ if(x.__vue__) return x.__vue__; x=x.parentElement; } return null; }
    const s = Array.from(document.querySelectorAll('.el-select'))[${idx}];
    if(!s) return {ok:false, r:'noSelect'};
    const v = findVue(s);
    if(!v) return {ok:false, r:'noVue'};
    const found = (v.options||[]).find(o=>String(o.value)===${JSON.stringify(value)});
    if(!found) return {ok:false, r:'noOption', available:(v.options||[]).slice(0,50).map(o=>o.value+'='+o.label)};
    v.$emit('input', ${JSON.stringify(value)});
    v.$emit('change', ${JSON.stringify(value)});
    v.handleOptionSelect({value:${JSON.stringify(value)}, label: found.label, selected:false});
    return {ok:true, label: found.label};
  })()`);
  console.log('SET=' + JSON.stringify(r));
  await sleep(1200);

  const after = await c.ev(`(function(){
    return Array.from(document.querySelectorAll('.el-select')).map((s,i)=>{
      const inp = s.querySelector('input'); const r = s.getBoundingClientRect();
      return {i, v: inp?inp.value:'', w:Math.round(r.width)};
    }).filter(x=>x.w>0);
  })()`);
  console.log('AFTER=' + JSON.stringify(after));

  c.sock.close();
  process.exit(0);
})().catch(e=>{ console.log('FATAL', e.message); process.exit(1); });
