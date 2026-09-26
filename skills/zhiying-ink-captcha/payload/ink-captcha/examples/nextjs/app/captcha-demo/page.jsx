"use client";

/**
 * Next.js App Router · 演示页
 *
 * 这里用「命令式挂载」而不是 data 属性自动挂载，因为 App Router 下
 * 需要在 useEffect 里拿 DOM 引用。如果你更喜欢自动挂载，把
 * <div ref={boxRef} /> 换成 <div data-ink-captcha /> 即可，
 * 但要确保组件脚本已经加载（放在 <Script> 或 layout 里）。
 */

import { useEffect, useRef, useState } from "react";
import { mount } from "ink-captcha/browser";

export default function CaptchaDemoPage() {
  const boxRef = useRef(null);
  const instRef = useRef(null);
  const [token, setToken] = useState(null);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!boxRef.current) return;
    const inst = mount(boxRef.current, {
      endpoint: "/api/captcha/points",
      verifyEndpoint: "/api/captcha/points/verify",
      onVerified: (passToken) => setToken(passToken),
      onStateChange: ({ verified }) => {
        if (!verified) setToken(null);
      },
    });
    instRef.current = inst;
    return () => inst.destroy();
  }, []);

  async function submit() {
    setSubmitting(true);
    setMsg("提交中…");
    setMsgType("");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "演示用户", passToken: token }),
      });
      const json = await res.json();
      if (json.success) {
        setMsg(json.data.message);
        setMsgType("ok");
      } else {
        setMsg(json.error || "提交失败");
        setMsgType("err");
      }
    } catch {
      setMsg("网络异常");
      setMsgType("err");
    } finally {
      setSubmitting(false);
      instRef.current?.reset();
      setToken(null);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 50% 15%, #1a2430, #0b0f14 72%)",
        padding: 24,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "rgba(20,28,36,.86)",
          border: "1px solid rgba(255,255,255,.09)",
          borderRadius: 18,
          padding: 26,
          color: "#e6edf3",
          boxShadow: "0 24px 60px rgba(0,0,0,.5)",
        }}
      >
        <h1 style={{ margin: "0 0 4px", fontSize: 19, fontWeight: 600 }}>注册（Next.js 示例）</h1>
        <p style={{ margin: "0 0 22px", fontSize: 12, color: "rgba(255,255,255,.42)", lineHeight: 1.65 }}>
          App Router + 服务端单例。验证通过后凭证用后即删。
        </p>

        <div ref={boxRef} style={{ marginBottom: 18 }} />

        <button
          type="button"
          onClick={submit}
          disabled={!token || submitting}
          style={{
            width: "100%",
            padding: 11,
            border: 0,
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            background: "linear-gradient(135deg, #c9a25a, #e8be6e)",
            color: "#221a0c",
            cursor: !token || submitting ? "not-allowed" : "pointer",
            opacity: !token || submitting ? 0.38 : 1,
            fontFamily: "inherit",
          }}
        >
          提交注册
        </button>

        <div
          style={{
            marginTop: 14,
            fontSize: 13,
            minHeight: 20,
            textAlign: "center",
            color: msgType === "ok" ? "#4ade80" : msgType === "err" ? "#f87171" : "inherit",
          }}
        >
          {msg}
        </div>
      </div>
    </main>
  );
}
