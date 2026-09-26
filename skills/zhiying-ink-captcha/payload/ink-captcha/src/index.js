/**
 * ink-captcha · 点选式人机验证
 *
 * 自研、零依赖、无备案限制、无第三方服务费用。
 * 服务端只依赖 Node 内置 crypto，前端不依赖任何框架。
 *
 * @example 服务端（任何框架）
 *   import { createCaptcha, buildInkBackground, createRateLimiter, getClientIp } from "ink-captcha";
 *
 *   const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET });
 *
 *   // 签发挑战
 *   const ch = captcha.createChallenge();
 *   res.json({ ...ch, bg: buildInkBackground({ width: ch.width, height: ch.height }) });
 *
 *   // 校验
 *   const r = captcha.verify(token, picks);
 *   if (r.ok) res.json({ passToken: r.passToken });
 *
 *   // 业务接口消费凭证
 *   if (!captcha.consumePassToken(passToken)) return res.status(400).end();
 */

export {
  createCaptcha,
  REASON_TEXT,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
} from "./core.js";

export { buildInkBackground } from "./ink-background.js";

export { createRateLimiter, getClientIp } from "./rate-limit.js";

export { default as createCaptchaDefault } from "./core.js";
export { default as buildInkBackgroundDefault } from "./ink-background.js";
