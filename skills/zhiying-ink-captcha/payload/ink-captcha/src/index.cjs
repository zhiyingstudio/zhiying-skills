/**
 * ink-captcha · CommonJS 入口
 *
 * 本包整体是 ESM（"type": "module"）。如果你在 CJS 项目里 `require("ink-captcha")`，
 * 会走到这个文件 —— 它用动态 import 把 ESM 版本桥接过来。
 *
 * ⚠️ 注意：Node 的 CJS 环境**不能同步**加载 ESM。
 * 所以这里导出的 `createCaptcha` 是**异步**的，用法：
 *
 *   const { createCaptcha } = require("ink-captcha");
 *   const captcha = await createCaptcha({ secret: process.env.CAPTCHA_SECRET });
 *
 * 如果你想要同步写法，两条路：
 *   1. 把项目切到 ESM（推荐，加 "type": "module"）
 *   2. 直接把 src/core.js 的代码拷进你的 CJS 项目，把 `import crypto from "node:crypto"`
 *      改成 `const crypto = require("node:crypto")` —— 核心代码只依赖这一个模块，改起来很快
 */

"use strict";

let _modPromise = null;
function load() {
  if (!_modPromise) {
    _modPromise = import("./index.js");
  }
  return _modPromise;
}

/** 异步创建实例 */
async function createCaptcha(config) {
  const m = await load();
  return m.createCaptcha(config);
}

/** 同步版的底图生成（ink-background.js 本身不依赖任何 ESM-only 特性） */
async function buildInkBackground(input) {
  const m = await load();
  return m.buildInkBackground(input);
}

async function createRateLimiter(opts) {
  const m = await load();
  return m.createRateLimiter(opts);
}

async function getClientIp(req) {
  const m = await load();
  return m.getClientIp(req);
}

/** 失败原因文案是纯数据，可以同步取 —— 但仍然要 await 一次加载 */
let _reasonText = null;
async function getReasonText() {
  if (!_reasonText) {
    const m = await load();
    _reasonText = m.REASON_TEXT;
  }
  return _reasonText;
}

module.exports = {
  createCaptcha,
  buildInkBackground,
  createRateLimiter,
  getClientIp,
  getReasonText,
  DEFAULT_WIDTH: 320,
  DEFAULT_HEIGHT: 200,
};
