/**
 * 浏览器端到端验证：真实打开页面 → 真实点击字 → 提交 → 截图
 *
 * 用法：node scripts/browser-e2e.mjs [baseUrl]
 * 默认 http://localhost:3737
 */

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.argv[2] || "http://localhost:3737";
const OUT = "/tmp/inkcaptcha-shots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 760 }, deviceScaleFactor: 2 });

const errors = [];
const httpFailures = [];
/** 是否处于「故意点错」阶段（此阶段的 400 属预期） */
let expectBadRequest = false;
/** 故意点错之前记录的失败数 */
let baselineFails = 0;

page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // 浏览器对 fetch 收到 4xx 会往控制台打一条 error —— 那是我们故意点错触发的，
  // 不是组件缺陷。这里按「预期内的 400」放行，其余仍是真错误。
  if (/Failed to load resource.*40[0-9]/.test(text) && expectBadRequest) return;
  errors.push(text);
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400) httpFailures.push(`${r.status()} ${r.url().replace(BASE, "")}`);
});

console.log(`\n打开 ${BASE} …`);
await page.goto(BASE, { waitUntil: "networkidle" });

// 等组件加载完成（画布上有字节点 = 底图与题目就绪）
await page.waitForFunction(
  () => {
    const host = document.querySelector("[data-ink-captcha]") || document.querySelector("#box");
    const sr = host && host.shadowRoot;
    return !!(sr && sr.querySelectorAll(".ch").length > 0);
  },
  { timeout: 10000 },
);
console.log("✅ 组件已加载");

await page.screenshot({ path: `${OUT}/01-loaded.png` });

// 读取组件内部状态：目标字 + 每个字的坐标
const info = await page.evaluate(() => {
  const host = document.querySelector("[data-ink-captcha]") || document.querySelector("#box");
  const sr = host.shadowRoot;
  const slots = [...sr.querySelectorAll(".slot")].map((s) => s.textContent.trim());
  const chars = [...sr.querySelectorAll(".ch")].map((n) => ({
    char: n.firstChild.textContent.trim(),
    left: parseFloat(n.style.left),
    top: parseFloat(n.style.top),
  }));
  const canvas = sr.querySelector(".canvas");
  const r = canvas.getBoundingClientRect();
  return { slots, chars, canvasRect: { x: r.x, y: r.y, w: r.width, h: r.height } };
});
console.log(`   提示顺序：${info.slots.join(" ")}   画布：${info.canvasRect.w}×${info.canvasRect.h}`);

// 依次点击目标字 —— 用真实鼠标事件，坐标必须从 DOM 实测换算（不能用逻辑坐标）
const logicalW = 320;
const ratio = info.canvasRect.w / logicalW;
console.log(`   缩放比：${ratio.toFixed(4)}`);

for (let i = 0; i < info.slots.length; i++) {
  const target = info.slots[i];
  const c = info.chars.find((x) => x.char === target);
  if (!c) throw new Error(`找不到字「${target}」`);
  const cx = info.canvasRect.x + c.left * ratio;
  const cy = info.canvasRect.y + c.top * ratio;
  // 人为间隔 300ms，模拟真人节奏（否则会被 too_fast 拦住）
  await page.waitForTimeout(300);
  await page.mouse.click(cx, cy);
  console.log(`   点击 ${i + 1}/${info.slots.length}：「${target}」 @ (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
  if (i === 1) await page.screenshot({ path: `${OUT}/02-clicking.png` });
}

// 等待通过
await page.waitForFunction(
  () => {
    const host = document.querySelector("[data-ink-captcha]") || document.querySelector("#box");
    const sr = host && host.shadowRoot;
    return !!(sr && sr.querySelector(".mask.done"));
  },
  { timeout: 8000 },
);
console.log("✅ 验证通过");
await page.screenshot({ path: `${OUT}/03-passed.png` });

// 检查提交按钮已解锁
const btnDisabled = await page.locator("#submitBtn").isDisabled();
console.log(`   提交按钮 disabled = ${btnDisabled}（应为 false）`);

// 提交
await page.fill("#account", "宫帅");
await page.click("#submitBtn");
await page.waitForSelector("#msg.ok", { timeout: 8000 });
const msgText = await page.locator("#msg").textContent();
console.log(`✅ 提交成功：${msgText}`);
await page.screenshot({ path: `${OUT}/04-submitted.png` });

// 提交后应重置
await page.waitForTimeout(1500);
const afterReset = await page.evaluate(() => {
  const host = document.querySelector("[data-ink-captcha]") || document.querySelector("#box");
  const sr = host.shadowRoot;
  return {
    chCount: sr.querySelectorAll(".ch").length,
    slotFill: [...sr.querySelectorAll(".slot")].filter((s) => s.classList.contains("is-done")).length,
  };
});
console.log(`   提交后重置：画布 ${afterReset.chCount} 字，已完成槽位 ${afterReset.slotFill}（应均为 0 槽位）`);
await page.screenshot({ path: `${OUT}/05-reset.png` });

// 故意点错：验证失败态 + 自动刷新
baselineFails = httpFailures.length;
expectBadRequest = true; // 从这里开始的 4xx 都是预期的
console.log(`\n── 故意点错顺序 ──`);
const info2 = await page.evaluate(() => {
  const host = document.querySelector("[data-ink-captcha]") || document.querySelector("#box");
  const sr = host.shadowRoot;
  return {
    slots: [...sr.querySelectorAll(".slot")].map((s) => s.textContent.trim()),
    chars: [...sr.querySelectorAll(".ch")].map((n) => ({
      char: n.firstChild.textContent.trim(),
      left: parseFloat(n.style.left),
      top: parseFloat(n.style.top),
    })),
    rect: (() => {
      const r = sr.querySelector(".canvas").getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })(),
  };
});
const r2 = info2.rect.w / 320;
// 逆序点（几乎必然错）
const wrongOrder = [...info2.slots].reverse();
for (const target of wrongOrder) {
  const c = info2.chars.find((x) => x.char === target);
  await page.waitForTimeout(300);
  await page.mouse.click(info2.rect.x + c.left * r2, info2.rect.y + c.top * r2);
}
// 等 1.3 秒看是否出现失败提示
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/06-fail.png` });
const failState = await page.evaluate(() => {
  const host = document.querySelector("[data-ink-captcha]") || document.querySelector("#box");
  const sr = host.shadowRoot;
  return { bar: sr.querySelector(".bar").className, foot: sr.querySelector(".foot").textContent };
});
console.log(`   失败态：bar="${failState.bar}"  foot="${failState.foot}"`);

// 等自动刷新
await page.waitForTimeout(1600);
const refreshed = await page.evaluate(() => {
  const host = document.querySelector("[data-ink-captcha]") || document.querySelector("#box");
  const sr = host.shadowRoot;
  return sr.querySelectorAll(".ch").length;
});
console.log(`   自动刷新后画布字数：${refreshed}（应为 8）`);
await page.screenshot({ path: `${OUT}/07-auto-refresh.png` });

// 窄屏测试
console.log("\n── 窄屏（360px）──");
await page.setViewportSize({ width: 360, height: 760 });
await page.waitForTimeout(600);
const narrowInfo = await page.evaluate(() => {
  const host = document.querySelector("[data-ink-captcha]") || document.querySelector("#box");
  const sr = host.shadowRoot;
  const card = sr.querySelector(".card");
  const canvas = sr.querySelector(".canvas");
  const wrap = sr.querySelector(".wrap");
  return {
    cardScale: card.style.transform,
    canvasRenderedW: canvas.getBoundingClientRect().width,
    wrapH: wrap.style.height,
    cardH: card.offsetHeight,
    overflow: card.getBoundingClientRect().right <= window.innerWidth + 1,
  };
});
console.log(`   card transform: ${narrowInfo.cardScale}`);
console.log(`   画布实际渲染宽: ${narrowInfo.canvasRenderedW.toFixed(1)}px`);
console.log(`   wrap 高度: ${narrowInfo.wrapH}  card 原始高: ${narrowInfo.cardH}`);
console.log(`   是否溢出视口: ${!narrowInfo.overflow}`);
await page.screenshot({ path: `${OUT}/08-narrow.png` });

const unexpectedFails = httpFailures.slice(0, baselineFails);
console.log(`\n${"─".repeat(52)}`);
console.log(`  页面 JS 错误：${errors.length === 0 ? "无 ✅" : errors.length + " 个 ❌"}`);
if (errors.length) errors.forEach((e) => console.log(`     · ${e}`));
console.log(`  非预期 HTTP 4xx/5xx：${unexpectedFails.length === 0 ? "无 ✅" : unexpectedFails.join(", ") + " ❌"}`);
console.log(`  （故意点错产生的 400 共 ${httpFailures.length - baselineFails} 次，属预期）`);
console.log(`  截图目录：${OUT}`);
console.log(`${"─".repeat(52)}\n`);

await browser.close();
process.exit(errors.length === 0 && unexpectedFails.length === 0 ? 0 : 1);
