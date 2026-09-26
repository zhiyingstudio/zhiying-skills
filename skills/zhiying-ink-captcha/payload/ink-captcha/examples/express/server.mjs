/**
 * 示例 ①：Express
 *
 * 运行：
 *   cd examples/express
 *   npm install express
 *   node server.mjs
 *   浏览器打开 http://localhost:3738
 *
 * 注意：本仓库的「包本体」零依赖，express 只是这个示例的依赖。
 */

import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCaptcha,
  buildInkBackground,
  createRateLimiter,
  getClientIp,
} from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3738;

app.use(express.json({ limit: "100kb" }));

// ── 初始化 ───────────────────────────────────────────────────
const captcha = createCaptcha({
  secret: process.env.CAPTCHA_SECRET || crypto.randomBytes(32).toString("hex"),
});
const limiter = createRateLimiter();

/** 把限流做成中间件，复用起来更顺手 */
function rateLimit(prefix, limit, windowMs) {
  return (req, res, next) => {
    const key = `${prefix}:${getClientIp(req)}`;
    const r = limiter.check(key, limit, windowMs);
    if (!r.allowed) {
      res.set("Retry-After", String(Math.ceil(r.retryAfterMs / 1000)));
      return res.status(429).json({ success: false, error: "请求过于频繁，请稍后再试" });
    }
    next();
  };
}

// ── 接口 1：签发挑战 ─────────────────────────────────────────
app.get("/api/captcha/points", rateLimit("captcha:challenge", 60, 60_000), (req, res) => {
  const ch = captcha.createChallenge();
  const bg = buildInkBackground({
    width: ch.width,
    height: ch.height,
    theme: req.query.theme === "dark" ? "dark" : "paper",
  });
  res.set("Cache-Control", "no-store");
  res.json({
    success: true,
    data: {
      token: ch.token,
      targets: ch.targets,
      chars: ch.chars,
      bg,
      width: ch.width,
      height: ch.height,
      hitRadius: captcha.hitRadius,
    },
  });
});

// ── 接口 2：校验 ─────────────────────────────────────────────
const REASON_TEXT = {
  invalid_token: "验证信息无效，请刷新重试",
  invalid_payload: "验证信息无效，请刷新重试",
  expired: "验证已过期，请刷新重试",
  invalid_picks: "请按顺序点选图中的文字",
  too_fast: "操作过快，请重新点选",
  too_many_attempts: "尝试次数过多，请刷新后重试",
  mismatch: "顺序不正确，请重新点选",
};

app.post("/api/captcha/points/verify", rateLimit("captcha:verify", 20, 60_000), (req, res) => {
  const { token, picks } = req.body || {};
  const result = captcha.verify(token, picks);
  if (!result.ok) {
    return res.status(400).json({
      success: false,
      error: REASON_TEXT[result.reason] || "验证失败",
      reason: result.reason,
    });
  }
  res.json({ success: true, data: { passToken: result.passToken } });
});

// ── 接口 3：受保护的业务接口 ─────────────────────────────────
app.post("/api/register", (req, res) => {
  const { account, passToken } = req.body || {};

  // ⬇⬇⬇ 没有这一步，前面所有验证都形同虚设
  if (!captcha.consumePassToken(passToken)) {
    return res.status(400).json({ success: false, error: "人机验证未通过或已失效，请重新验证" });
  }

  // ... 这里写你真实的注册逻辑
  res.json({ success: true, data: { message: `注册成功（示例）：${account || "匿名"}` } });
});

// ── 静态页 ───────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
// 组件本体（示例里直接读源码，真实项目请走 CDN 或打包）
app.get("/ink-captcha.js", (req, res) => {
  res.type("application/javascript");
  res.sendFile(path.resolve(__dirname, "../../src/ink-captcha.js"));
});

app.listen(PORT, () => {
  console.log(`\n  ✅ ink-captcha Express 示例已启动`);
  console.log(`     http://localhost:${PORT}\n`);
});
