/**
 * 示例 ③：纯 Node http（零框架、零依赖）
 *
 * 这个示例的意义：证明核心完全框架无关。
 * 不需要 Express / Next.js / Koa，只要 Node 18+ 就能跑。
 *
 * 运行（注意：端口用 3737，避免撞上常见的 3000）：
 *   node examples/node-http/server.mjs
 *   浏览器打开 http://localhost:3737
 *
 * 这里手写了 3 个路由 + 一个极简静态服务，全部用 node 内置模块。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import {
  createCaptcha,
  buildInkBackground,
  createRateLimiter,
  getClientIp,
} from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3737;

/** 组件本体路径（示例里直接读源码当静态资源，真实项目请走 CDN 或打包） */
const COMPONENT_JS = path.resolve(__dirname, "../../src/ink-captcha.js");

// ── 初始化验证码 ─────────────────────────────────────────────
// 生产环境请从环境变量读，不要硬编码
const captcha = createCaptcha({
  secret: process.env.CAPTCHA_SECRET || crypto.randomBytes(32).toString("hex"),
});

const limiter = createRateLimiter();

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function sendJson(res, status, payload) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

// ── 路由 ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const ip = getClientIp(req);

  // 【接口 1】签发挑战
  if (req.method === "GET" && url.pathname === "/api/captcha/points") {
    const rl = limiter.check(`challenge:${ip}`, 60, 60 * 1000);
    if (!rl.allowed) {
      res.setHeader("Retry-After", Math.ceil(rl.retryAfterMs / 1000));
      return sendJson(res, 429, { success: false, error: "请求过于频繁，请稍后再试" });
    }

    const ch = captcha.createChallenge();
    // 底图与挑战同一次请求生成，保证尺寸一致
    const bg = buildInkBackground({
      width: ch.width,
      height: ch.height,
      theme: url.searchParams.get("theme") === "dark" ? "dark" : "paper",
    });

    return sendJson(res, 200, {
      success: true,
      data: {
        token: ch.token,
        targets: ch.targets,
        chars: ch.chars,
        bg,
        width: ch.width,
        height: ch.height,
        // 前端可直接用，避免两端写死同一个数字
        hitRadius: captcha.config.hitRadius,
      },
    });
  }

  // 【接口 2】校验
  if (req.method === "POST" && url.pathname === "/api/captcha/points/verify") {
    const rl = limiter.check(`verify:${ip}`, 20, 60 * 1000);
    if (!rl.allowed) {
      return sendJson(res, 429, { success: false, error: "操作过于频繁，请稍后再试" });
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { success: false, error: "请求格式错误" });
    }

    const result = captcha.verify(body.token, body.picks);
    if (!result.ok) {
      const map = {
        too_many_attempts: "尝试次数过多，请刷新后重试",
        expired: "验证已过期，请刷新重试",
        too_fast: "操作过快，请重新点选",
        invalid_token: "验证信息无效，请刷新重试",
        invalid_payload: "验证信息无效，请刷新重试",
        invalid_picks: "请按顺序点选图中的文字",
        mismatch: "顺序不正确，请重新点选",
      };
      return sendJson(res, 400, {
        success: false,
        error: map[result.reason] || "验证失败",
        reason: result.reason,
      });
    }

    return sendJson(res, 200, {
      success: true,
      data: { passToken: result.passToken },
    });
  }

  // 【接口 3】受保护的业务接口 —— 必须消费一次性凭证
  if (req.method === "POST" && url.pathname === "/api/register") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { success: false, error: "请求格式错误" });
    }

    // ⬇⬇⬇ 关键一行：没有它，前面所有验证都是装饰
    if (!captcha.consumePassToken(body.passToken)) {
      return sendJson(res, 400, {
        success: false,
        error: "人机验证未通过或已失效，请重新验证",
      });
    }

    // ... 这里写你真实的注册逻辑（写库、发短信等）
    return sendJson(res, 200, {
      success: true,
      data: { message: `注册成功（示例）：${body.account || "匿名"}` },
    });
  }

  // ── 静态页面 ──────────────────────────────────────────────
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  // 组件本体（模拟 CDN 引入）
  if (req.method === "GET" && url.pathname === "/ink-captcha.js") {
    const js = fs.readFileSync(COMPONENT_JS, "utf8");
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    return res.end(js);
  }

  sendJson(res, 404, { success: false, error: "Not Found" });
});

server.listen(PORT, () => {
  console.log(`\n  ✅ ink-captcha 纯 Node 示例已启动`);
  console.log(`     http://localhost:${PORT}\n`);
});
