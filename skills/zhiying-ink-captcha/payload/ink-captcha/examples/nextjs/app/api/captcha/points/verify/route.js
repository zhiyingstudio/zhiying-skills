/**
 * Next.js App Router · 校验
 * POST /api/captcha/points/verify
 */

import { NextResponse } from "next/server";
import { getClientIp } from "ink-captcha";
import { captcha, limiter, REASON_TEXT } from "@/lib/captcha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const ip = getClientIp(request);
  const rl = limiter.check(`captcha:verify:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "操作过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式错误" }, { status: 400 });
  }

  const result = captcha.verify(body?.token, body?.picks);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: REASON_TEXT[result.reason] || "验证失败", reason: result.reason },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, data: { passToken: result.passToken } });
}
