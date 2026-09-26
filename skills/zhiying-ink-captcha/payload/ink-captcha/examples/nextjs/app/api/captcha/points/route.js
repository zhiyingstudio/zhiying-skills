/**
 * Next.js App Router · 签发挑战
 * GET /api/captcha/points
 */

import { NextResponse } from "next/server";
import { buildInkBackground } from "ink-captcha";
import { captcha, limiter } from "@/lib/captcha";
import { getClientIp } from "ink-captcha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const ip = getClientIp(request);
  const rl = limiter.check(`captcha:challenge:${ip}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const theme = new URL(request.url).searchParams.get("theme") === "dark" ? "dark" : "paper";
  const ch = captcha.createChallenge();
  const bg = buildInkBackground({ width: ch.width, height: ch.height, theme });

  return NextResponse.json(
    {
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
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
