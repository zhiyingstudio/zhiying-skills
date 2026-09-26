/**
 * 底图对照页生成器 —— 一次并排看多张，避免「只看一张就下结论」
 *
 * 用法：node scripts/preview-sheet.mjs [输出路径]
 */

import fs from "node:fs";
import { buildInkBackground } from "../src/ink-background.js";
import { createCaptcha } from "../src/core.js";

const OUT = process.argv[2] || "/tmp/inkcaptcha-preview.html";

const captcha = createCaptcha({ secret: "preview-only" });

const SEEDS = [11, 202, 3003, 41004, 52005, 63006, 74007, 85008];

function card(seed, theme) {
  const ch = captcha.createChallenge();
  const bg = buildInkBackground({ width: ch.width, height: ch.height, seed, theme });

  const chars = ch.chars
    .map((c) => {
      const size = c.size;
      return `<div style="position:absolute;left:${c.x}px;top:${c.y}px;width:${size * 1.5}px;height:${size * 1.5}px;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-50%) rotate(${c.rotate}deg)">
      <span style="font-size:${size}px;line-height:1;font-weight:700;font-family:'Songti SC','STSong','SimSun','Noto Serif SC',serif;color:rgba(18,30,36,0.96);-webkit-text-stroke:0.6px rgba(255,255,255,0.88);text-shadow:0 1px 2px rgba(255,255,255,0.9),0 1px 3px rgba(0,0,0,0.16)">${c.char}</span>
    </div>`;
    })
    .join("");

  return `
  <figure>
    <figcaption>
      <span class="seed">seed ${seed}</span>
      <span class="targets">${ch.targets.join(" ")}</span>
    </figcaption>
    <div class="canvas">
      <div class="bg">${bg}</div>
      ${chars}
    </div>
  </figure>`;
}

const paperCards = SEEDS.map((s) => card(s, "paper")).join("");
const darkCards = SEEDS.slice(0, 4).map((s) => card(s, "dark")).join("");

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>ink-captcha 底图对照</title>
<style>
  body{margin:0;padding:32px;background:#0d1216;color:#dde5ea;
       font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;}
  h1{font-size:17px;font-weight:600;margin:0 0 6px;}
  h2{font-size:13px;font-weight:600;margin:34px 0 14px;color:rgba(255,255,255,.55);
     text-transform:uppercase;letter-spacing:.08em;}
  .note{font-size:12px;color:rgba(255,255,255,.38);margin:0 0 8px;line-height:1.6;}
  .grid{display:grid;grid-template-columns:repeat(4,320px);gap:22px;}
  figure{margin:0;}
  figcaption{display:flex;justify-content:space-between;align-items:center;
             font-size:11px;color:rgba(255,255,255,.42);margin-bottom:6px;padding:0 2px;}
  .seed{font-family:ui-monospace,monospace;}
  .targets{font-family:'Songti SC',serif;font-size:14px;font-weight:700;color:#e8be6e;letter-spacing:.06em;}
  .canvas{position:relative;width:320px;height:200px;border-radius:12px;overflow:hidden;
          border:1px solid rgba(255,255,255,.12);box-shadow:0 3px 14px rgba(0,0,0,.4);}
  .bg{position:absolute;inset:0;}
  .bg svg{display:block;width:100%;height:100%;}
</style></head>
<body>
  <h1>ink-captcha 底图对照</h1>
  <p class="note">检查点：① 8 个字两两不重叠 ② 字不压右下角印章 ③ 字与山脊对比度足够 ④ 目标字位置分散</p>

  <h2>宣纸主题（默认）· 8 个随机种子</h2>
  <div class="grid">${paperCards}</div>

  <h2>墨夜主题 · 4 个种子</h2>
  <div class="grid">${darkCards}</div>
</body></html>`;

fs.writeFileSync(OUT, html);
console.log(`已生成：${OUT}`);
