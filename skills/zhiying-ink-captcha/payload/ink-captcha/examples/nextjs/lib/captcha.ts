/**
 * Next.js App Router · 服务端单例
 *
 * 【为什么用 globalThis 缓存】
 * Next.js 开发模式下模块会被反复热重载。如果每次都 createCaptcha()，
 * 那么「签发挑战的实例」和「校验的实例」可能不是同一个 →
 * 已签发的一次性凭证在另一个实例里查不到 → 用户验证通过后提交却失败。
 * 用 globalThis 挂住实例，保证整个进程只有一个。
 */

import "server-only";
import crypto from "node:crypto";

import { createCaptcha, createRateLimiter } from "ink-captcha";

const g = globalThis;

function init() {
  const secret = process.env.CAPTCHA_SECRET;
  if (!secret) {
    throw new Error(
      "[ink-captcha] 缺少环境变量 CAPTCHA_SECRET。\n" +
        "请在 .env.local 里加一行：CAPTCHA_SECRET=" +
        crypto.randomBytes(32).toString("hex"),
    );
  }
  return {
    captcha: createCaptcha({
      secret,
      // 需要自定义时改这里，例如：
      // targetCount: 4,
      // distractorCount: 4,
      // charPool: ["山","水","风","月", ...],
    }),
    limiter: createRateLimiter(),
  };
}

export const captcha = (g.__inkCaptcha ??= init()).captcha;
export const limiter = (g.__inkCaptcha ??= init()).limiter;

/** 失败原因 → 用户可读文案 */
export const REASON_TEXT = {
  invalid_token: "验证信息无效，请刷新重试",
  invalid_payload: "验证信息无效，请刷新重试",
  expired: "验证已过期，请刷新重试",
  invalid_picks: "请按顺序点选图中的文字",
  too_fast: "操作过快，请重新点选",
  too_many_attempts: "尝试次数过多，请刷新后重试",
  mismatch: "顺序不正确，请重新点选",
};
