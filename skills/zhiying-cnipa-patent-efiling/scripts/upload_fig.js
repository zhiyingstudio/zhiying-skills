// 附图上传：规范化（300DPI JPEG，尺寸≤1772x2598）+ 合成事件点「插入图像」+ setFileInputFiles 注入
// 用法: node upload_fig.js <图片路径1> [图片路径2] ...
const {connect, synthClickJS, switchTabJS, CLEAN_JS} = require('./cdp.js');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const URL_MARK = 'fmzlxg?dianzisqajbh';
const sleep = ms => new Promise(r=>setTimeout(r, ms));

const MAX_W = 1772;   // 15cm @300dpi
const MAX_H = 2598;   // 22cm @300dpi

// 规范化：PNG→JPEG，缩放至合规尺寸，设 300 DPI
function normalize(src){
  const base = src.replace(/\.[^.]+$/, '');
  const dst = base + '_cnipa.jpg';
  if(!fs.existsSync(src)) throw new Error('图片不存在: ' + src);

  const info = execFileSync('sips', ['-g','pixelWidth','-g','pixelHeight', src], {encoding:'utf8'});
  const w = parseInt((info.match(/pixelWidth:\s*(\d+)/)||[])[1], 10);
  const h = parseInt((info.match(/pixelHeight:\s*(\d+)/)||[])[1], 10);
  if(!w || !h) throw new Error('无法读取尺寸: ' + src);

  fs.copyFileSync(src, dst);
  const scale = Math.min(MAX_W/w, MAX_H/h, 1.0);
  if(scale < 1.0){
    execFileSync('sips', ['--resampleWidth', String(Math.round(w*scale)), dst]);
  }
  execFileSync('sips', ['-s','format','jpeg','-s','formatOptions','95',
                        '-s','dpiWidth','300','-s','dpiHeight','300', dst]);

  const out = execFileSync('sips', ['-g','pixelWidth','-g','pixelHeight','-g','dpiWidth', dst], {encoding:'utf8'});
  console.log('[NORM] ' + path.basename(src) + ' ' + w + 'x' + h + ' -> ' + out.replace(/\s+/g,' ').trim());
  return dst;
}

(async ()=>{
  const srcs = process.argv.slice(2);
  if(!srcs.length){ console.log('用法: node upload_fig.js <图片1> [图片2] ...'); process.exit(1); }

  const files = srcs.map(normalize);

  const c = await connect(URL_MARK);
  await c.send('DOM.enable');
  await c.send('Page.enable');
  try{ await c.send('Page.setInterceptFileChooserDialog', {enabled:true}); }catch(e){}

  // 切到附图 Tab
  console.log('SWITCH=' + await c.ev(switchTabJS('说明书附图')));
  await sleep(3500);
  console.log('TAB=' + await c.ev(`(document.querySelector('.el-tabs__item.is-active')||{}).innerText`));

  await c.ev(CLEAN_JS);
  await sleep(300);

  for(let i=0; i<files.length; i++){
    console.log('--- UPLOAD ' + (i+1) + '/' + files.length + ': ' + path.basename(files[i]));

    // 1. 点「插入图像」（按 .ck-button__label 文本找）
    const r1 = await c.ev(synthClickJS(
      `Array.from(document.querySelectorAll('.ck-toolbar .ck-button'))
         .find(x=>{ const l=x.querySelector('.ck-button__label');
                    return l && l.textContent.trim()==='插入图像'; })`
    ));
    console.log('  CLICK_INSERT=' + r1);
    await sleep(3000);

    // 2. 定位 accept 含 image 的 file input
    const doc = await c.send('DOM.getDocument', {depth:-1});
    const q = await c.send('DOM.querySelectorAll', {nodeId: doc.root.nodeId, selector:'input[type=file]'});
    const idx = await c.ev(`(function(){
      const fs = Array.from(document.querySelectorAll('input[type=file]'));
      return fs.findIndex(f=>f.accept.indexOf('image')>=0);
    })()`);
    console.log('  imgInputIdx=' + idx + ' nodeIds=' + JSON.stringify(q.nodeIds));
    if(idx < 0 || !q.nodeIds[idx]){ console.log('  ERROR: 未找到 image file input'); continue; }

    // 3. 注入文件
    await c.send('DOM.setFileInputFiles', {files:[files[i]], nodeId: q.nodeIds[idx]});
    console.log('  SET_OK');
    await sleep(7000);

    const cnt = await c.ev(`(function(){ const ed=Array.from(document.querySelectorAll('.ck-editor__editable')).find(e=>e.offsetParent!==null); return ed? ed.querySelectorAll('img').length : null; })()`);
    console.log('  imgCount=' + cnt);
  }

  // 4. 校验结果
  const sum = await c.ev(`(function(){
    const ed = Array.from(document.querySelectorAll('.ck-editor__editable')).find(e=>e.offsetParent!==null);
    if(!ed) return null;
    return {
      imgs: ed.querySelectorAll('img').length,
      nums: Array.from(ed.querySelectorAll('span[class*="image"]')).map(s=>s.getAttribute('num')),
      titles: Array.from(ed.querySelectorAll('label')).map(l=>(l.innerText||'').trim())
    };
  })()`);
  console.log('RESULT=' + JSON.stringify(sum, null, 1));

  c.sock.close();
  process.exit(0);
})().catch(e=>{ console.log('FATAL', e.message); process.exit(1); });
