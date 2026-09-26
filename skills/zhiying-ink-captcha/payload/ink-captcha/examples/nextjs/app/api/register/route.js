/**
 * Next.js App Router · 受保护的业务接口
 * POST /api/register
 */

import { NextResponse } from "next/server";
import { captcha } from "@/lib/captcha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式错误" }, { status: 400 });
  }

  const { account, passToken } = body || {};

  // ⬇⬇⬇ 关键一步：消费一次性凭证。没有它，前面所有验证都是装饰。
  if (!captcha.consumePassToken(passToken)) {
    return NextResponse.json(
      { success: false, error: "人机验证未通过或已失效，请重新验证" },
      { status: 400 },
    );
  }

  // ... 这里写你真实的注册逻辑（写库、发短信、发券等）
  return NextResponse.json({
    success: true,
    data: { message: `注册成功（示例）：${account || "匿名"}` },
  });
}
