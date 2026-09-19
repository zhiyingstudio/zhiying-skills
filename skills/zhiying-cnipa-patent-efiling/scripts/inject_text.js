// CKEditor 正文注入（三书通用）
// 用法: node inject_text.js <tabName> <文本文件路径>
//   例: node inject_text.js 权利要求书 /tmp/claim_final.txt
const {connect, switchTabJS, CLEAN_JS} = require('./cdp.js');
const fs = require('fs');

const URL_MARK = 'fmzlxg?dianzisqajbh';
const sleep = ms => new Promise(r=>setTimeout(r, ms));

(async ()=>{
  const tabName = process.argv[2];
  const file = process.argv[3];
  if(!tabName || !file){ console.log('用法: node inject_text.js <tabName> <textFile>'); process.exit(1); }

  const txt = fs.readFileSync(file, 'utf8');
  const paras = txt.split(/\r?\n/).map(s=>s.trim()).filter(s=>s);
  console.log('PARAS=' + paras.length + ' CHARS=' + txt.length);

  const c = await connect(URL_MARK);
  console.log('PAGE=' + c.page.url.slice(0,110));

  await c.ev(CLEAN_JS);
  await sleep(400);

  // 切 Tab
  console.log('SWITCH=' + await c.ev(switchTabJS(tabName)));
  await sleep(3500);
  console.log('NOW_TAB=' + await c.ev(`(document.querySelector('.el-tabs__item.is-active')||{}).innerText`));

  // 聚焦编辑器
  const focus = await c.ev(`(function(){
    const ed = Array.from(document.querySelectorAll('.ck-editor__editable')).find(e=>e.offsetParent!==null);
    if(!ed) return 'noEditor';
    ed.focus();
    // 把光标放到末尾
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    sel.removeAllRanges(); sel.addRange(range);
    return 'focused:' + (ed.innerText||'').length;
  })()`);
  console.log('FOCUS=' + focus);

  // Cmd+A 全选（macOS modifier=4）
  await c.send('Input.dispatchKeyEvent', {type:'keyDown', key:'a', code:'KeyA', windowsVirtualKeyCode:65, nativeVirtualKeyCode:65, modifiers:4});
  await sleep(120);
  await c.send('Input.dispatchKeyEvent', {type:'keyUp', key:'a', code:'KeyA', windowsVirtualKeyCode:65, nativeVirtualKeyCode:65, modifiers:4});
  await sleep(250);

  // Backspace 清空
  await c.send('Input.dispatchKeyEvent', {type:'rawKeyDown', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8, nativeVirtualKeyCode:8});
  await sleep(120);
  await c.send('Input.dispatchKeyEvent', {type:'keyUp', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8, nativeVirtualKeyCode:8});
  await sleep(400);

  // 逐段插入
  for(let i=0; i<paras.length; i++){
    await c.send('Input.insertText', {text: paras[i]});
    await sleep(300);
    if(i < paras.length - 1){
      await c.send('Input.dispatchKeyEvent', {type:'rawKeyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13});
      await sleep(60);
      await c.send('Input.dispatchKeyEvent', {type:'char', key:'Enter', code:'Enter', text:'\r', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13});
      await sleep(60);
      await c.send('Input.dispatchKeyEvent', {type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13});
      await sleep(280);
    }
  }
  await sleep(2000);

  // 回读
  const after = await c.ev(`(function(){
    const ed = Array.from(document.querySelectorAll('.ck-editor__editable')).find(e=>e.offsetParent!==null);
    if(!ed) return null;
    const txt = ed.innerText||'';
    const ps = txt.split('\\n').map(s=>s.trim()).filter(s=>s);
    return {chars: txt.length, paras: ps.length, first: ps[0]||'', last: ps[ps.length-1]||''};
  })()`);
  console.log('AFTER=' + JSON.stringify(after, null, 1));

  c.sock.close();
  process.exit(0);
})().catch(e=>{ console.log('FATAL', e.message); process.exit(1); });
