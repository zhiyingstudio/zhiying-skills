/**
 * ink-captcha 核心自测 —— 零依赖，node scripts/selftest.mjs 直接跑
 *
 * 覆盖：正常通过 / 顺序错 / 数量错 / 篡改 token / 过期 / 脚本时序 /
 *       爆破上限 / 凭证一次性 / 乱序布点 / 题库不足报错
 */

import assert from "node:assert/strict";
import { createCaptcha, buildInkBackground, createRateLimiter } from "../src/index.js";

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}

const SECRET = "test-secret-do-not-use-in-prod";
const captcha = createCaptcha({ secret: SECRET });

/** 根据 challenge 反解出「正确顺序」（模拟一个知道答案的客户端） */
function solve(ch) {
  const picks = [];
  let ts = 0;
  for (const target of ch.targets) {
    const hit = ch.chars.find((c) => c.char === target);
    if (!hit) throw new Error(`目标字 ${target} 不在画布上`);
    ts += 300 + Math.floor(Math.random() * 400); // 真人节奏
    picks.push({ id: hit.id, ts });
  }
  return picks;
}

console.log("\n【挑战签发】");

t("chars 数量 = targetCount + distractorCount", () => {
  const ch = captcha.createChallenge();
  assert.equal(ch.chars.length, 8);
  assert.equal(ch.targets.length, 4);
});

t("targets 无重复", () => {
  const ch = captcha.createChallenge();
  assert.equal(new Set(ch.targets).size, ch.targets.length);
});

t("chars 里不含 isTarget / _isTarget 字段（关键：不能泄漏）", () => {
  const ch = captcha.createChallenge();
  for (const c of ch.chars) {
    assert.equal(c.isTarget, undefined, "isTarget 泄漏了！");
    assert.equal(c._isTarget, undefined, "_isTarget 泄漏了！");
  }
  // 连字符串化的响应体里也不该出现
  const raw = JSON.stringify(ch);
  assert.ok(!raw.includes("isTarget"), "响应体里出现了 isTarget 字样");
});

t("token 不含明文答案（order 不出现于 token）", () => {
  const ch = captcha.createChallenge();
  const decoded = Buffer.from(ch.token.split(".")[1], "base64url").toString("utf8");
  assert.ok(!decoded.includes("order"));
});

t("targets 都能在 chars 里找到", () => {
  const ch = captcha.createChallenge();
  for (const target of ch.targets) {
    assert.ok(ch.chars.some((c) => c.char === target), `缺字 ${target}`);
  }
});

t("布点无重叠（两两中心距 ≥ 38）", () => {
  for (let n = 0; n < 40; n++) {
    const ch = captcha.createChallenge();
    for (let i = 0; i < ch.chars.length; i++) {
      for (let j = i + 1; j < ch.chars.length; j++) {
        const d = Math.hypot(ch.chars[i].x - ch.chars[j].x, ch.chars[i].y - ch.chars[j].y);
        assert.ok(d >= 37.9, `第 ${n} 次：${ch.chars[i].char}↔${ch.chars[j].char} 距离仅 ${d.toFixed(1)}`);
      }
    }
  }
});

t("所有字都在画布安全区内（不压边）", () => {
  for (let n = 0; n < 20; n++) {
    const ch = captcha.createChallenge();
    for (const c of ch.chars) {
      assert.ok(c.x >= 30 && c.x <= ch.width - 30, `x=${c.x} 越界`);
      assert.ok(c.y >= 20 && c.y <= ch.height - 20, `y=${c.y} 越界`);
    }
  }
});

t("目标字位置被打乱（不能永远在前排）", () => {
  let sawTargetInLastHalf = false;
  for (let n = 0; n < 30; n++) {
    const ch = captcha.createChallenge();
    // 找出目标字的索引分布
    const targetIdx = ch.targets.map((tg) => ch.chars.findIndex((c) => c.char === tg));
    if (targetIdx.some((i) => i >= 4)) sawTargetInLastHalf = true;
  }
  assert.ok(sawTargetInLastHalf, "30 次抽样中目标字从未出现在后半区 —— 布点没打乱");
});

t("目标字彼此分散（最小两两距离中位数 ≥ 70px）", () => {
  const mins = [];
  for (let n = 0; n < 200; n++) {
    const ch = captcha.createChallenge();
    const pts = ch.targets.map((tg) => {
      const c = ch.chars.find((x) => x.char === tg);
      return { x: c.x, y: c.y };
    });
    let m = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    mins.push(m);
  }
  mins.sort((a, b) => a - b);
  const median = mins[Math.floor(mins.length / 2)];
  const p10 = mins[Math.floor(mins.length * 0.1)];
  assert.ok(median >= 70, `中位数仅 ${median.toFixed(1)}px，目标字太集中`);
  assert.ok(p10 >= 45, `第 10 百分位仅 ${p10.toFixed(1)}px，存在高度集中样本`);
});

t("字不侵占右下角印章区", () => {
  // 印章覆盖 x ≥ W-32、y ≥ H-30 的区域；字半宽按 size*0.75 算
  for (let n = 0; n < 60; n++) {
    const ch = captcha.createChallenge();
    for (const c of ch.chars) {
      const half = c.size * 0.75;
      const overlapsSeal = c.x + half > ch.width - 32 && c.y + half > ch.height - 30;
      assert.ok(!overlapsSeal, `第 ${n} 次：「${c.char}」压住印章 (x=${c.x}, y=${c.y})`);
    }
  }
});

console.log("\n【校验】");

t("正确顺序 → ok + 拿到 passToken", () => {
  const ch = captcha.createChallenge();
  const r = captcha.verify(ch.token, solve(ch));
  assert.equal(r.ok, true, `失败了：${r.reason}`);
  assert.ok(r.passToken);
});

t("顺序颠倒 → mismatch", () => {
  const ch = captcha.createChallenge();
  const picks = solve(ch).reverse();
  // 反转后 ts 也反了，重排成递增避免误判 too_fast
  picks.forEach((p, i) => (p.ts = i * 300));
  const r = captcha.verify(ch.token, picks);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "mismatch");
});

t("点错一个字 → mismatch", () => {
  const ch = captcha.createChallenge();
  const picks = solve(ch);
  const wrong = ch.chars.find((c) => !ch.targets.includes(c.char));
  picks[1] = { id: wrong.id, ts: picks[1].ts };
  const r = captcha.verify(ch.token, picks);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "mismatch");
});

t("数量不足 → mismatch", () => {
  const ch = captcha.createChallenge();
  const r = captcha.verify(ch.token, solve(ch).slice(0, 3));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "mismatch");
});

t("篡改 token → invalid_token", () => {
  const ch = captcha.createChallenge();
  const bad = ch.token.slice(0, -4) + "AAAA";
  const r = captcha.verify(bad, solve(ch));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_token");
});

t("伪造 token（随机串）→ invalid_token", () => {
  const r = captcha.verify("aaaa.bbbb.cccc", [{ id: "x", ts: 0 }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_token");
});

t("换密钥后旧 token 失效 → invalid_token", () => {
  const ch = captcha.createChallenge();
  const other = createCaptcha({ secret: "another-secret" });
  const r = other.verify(ch.token, solve(ch));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_token");
});

t("空 picks → invalid_picks", () => {
  const ch = captcha.createChallenge();
  const r = captcha.verify(ch.token, []);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_picks");
});

t("脚本时序（全部间隔 0ms）→ too_fast", () => {
  const ch = captcha.createChallenge();
  const picks = solve(ch).map((p) => ({ id: p.id, ts: 0 }));
  const r = captcha.verify(ch.token, picks);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too_fast");
});

t("手速快但不是脚本（有一处 ≥60ms）→ 放行", () => {
  const ch = captcha.createChallenge();
  const pts = ch.targets.map((tg) => ({ id: ch.chars.find((c) => c.char === tg).id, ts: 0 }));
  pts[2].ts = 70;
  pts[3].ts = 100;
  const r = captcha.verify(ch.token, pts);
  assert.equal(r.ok, true, `被误判了：${r.reason}`);
});

t("超时挑战 → expired", () => {
  const fast = createCaptcha({ secret: SECRET, challengeMaxAgeMs: 1 });
  const ch = fast.createChallenge();
  const start = Date.now();
  while (Date.now() - start < 5) {}
  const r = fast.verify(ch.token, solve(ch));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
});

t("单挑战尝试超限 → too_many_attempts", () => {
  const c = createCaptcha({ secret: SECRET, maxAttempts: 3 });
  const ch = c.createChallenge();
  const bad = solve(ch);
  bad[0] = { id: bad[0].id === "z" ? "y" : "z", ts: 100 };
  for (let i = 0; i < 3; i++) c.verify(ch.token, bad);
  const r = c.verify(ch.token, bad);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too_many_attempts");
});

console.log("\n【一次性凭证】");

t("passToken 只能用一次", () => {
  const ch = captcha.createChallenge();
  const { passToken } = captcha.verify(ch.token, solve(ch));
  assert.equal(captcha.consumePassToken(passToken), true, "第一次应该成功");
  assert.equal(captcha.consumePassToken(passToken), false, "第二次必须失败（重放！）");
});

t("伪造 passToken 无效", () => {
  assert.equal(captcha.consumePassToken("i-am-fake"), false);
  assert.equal(captcha.consumePassToken(""), false);
  assert.equal(captcha.consumePassToken(null), false);
  assert.equal(captcha.consumePassToken(undefined), false);
});

t("passToken 超时失效", async () => {
  // 同步测试里用 0ms 时效模拟
  const c = createCaptcha({ secret: SECRET, passMaxAgeMs: -1 });
  const ch = c.createChallenge();
  const { passToken } = c.verify(ch.token, solve(ch));
  assert.equal(c.consumePassToken(passToken), false, "过期的凭证不该被接受");
});

console.log("\n【底图】");

t("buildInkBackground 返回合法 SVG", () => {
  const svg = buildInkBackground({ width: 320, height: 200 });
  assert.ok(svg.startsWith("<svg"), "不是 SVG 开头");
  assert.ok(svg.trimEnd().endsWith("</svg>"), "不是 SVG 结尾");
  assert.ok(svg.includes('viewBox="0 0 320 200"'));
});

t("同 seed → 同一张图（可复现）", () => {
  const a = buildInkBackground({ width: 320, height: 200, seed: 12345 });
  const b = buildInkBackground({ width: 320, height: 200, seed: 12345 });
  assert.equal(a, b);
});

t("不同 seed → 不同图", () => {
  const a = buildInkBackground({ width: 320, height: 200, seed: 1 });
  const b = buildInkBackground({ width: 320, height: 200, seed: 2 });
  assert.notEqual(a, b);
});

t("dark 主题底色不同", () => {
  const p = buildInkBackground({ width: 320, height: 200, seed: 7 });
  const d = buildInkBackground({ width: 320, height: 200, seed: 7, theme: "dark" });
  assert.notEqual(p, d);
  assert.ok(d.includes("#1b2226"), "dark 底色不对");
});

t("多次生成 gradId 不冲突（同页面可叠多张）", () => {
  const svgs = [1, 2, 3].map((s) => buildInkBackground({ width: 320, height: 200, seed: s * 999999 }));
  // 每个 svg 内部的 id 前缀不同 → 不会互相覆盖
  const ids = svgs.map((s) => s.match(/id="(ik[a-z0-9]+)paper"/)[1]);
  assert.equal(new Set(ids).size, 3, "id 前缀重复了");
});

console.log("\n【限流】");

t("限流按 key 独立计数", () => {
  const rl = createRateLimiter();
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check("ip-a", 5, 60000).allowed, true, `第 ${i + 1} 次应放行`);
  }
  assert.equal(rl.check("ip-a", 5, 60000).allowed, false, "第 6 次应拦住");
  assert.equal(rl.check("ip-b", 5, 60000).allowed, true, "另一个 IP 不该被连坐");
});

t("超过窗口后重新放行", async () => {
  const rl = createRateLimiter();
  rl.check("k", 1, 1);
  assert.equal(rl.check("k", 1, 1).allowed, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(rl.check("k", 1, 1).allowed, true);
});

console.log("\n【配置校验】");

t("缺 secret → 抛错", () => {
  assert.throws(() => createCaptcha({}), /必须提供 secret/);
  assert.throws(() => createCaptcha({ secret: "" }), /必须提供 secret/);
});

t("题库不足 → 抛错", () => {
  assert.throws(
    () => createCaptcha({ secret: "s", charPool: ["一", "二"], targetCount: 4, distractorCount: 4 }),
    /charPool 长度不足/,
  );
});

t("自定义题库 / 字数生效", () => {
  const c = createCaptcha({
    secret: "s",
    charPool: ["A", "B", "C", "D", "E", "F"],
    targetCount: 3,
    distractorCount: 3,
  });
  const ch = c.createChallenge();
  assert.equal(ch.targets.length, 3);
  assert.equal(ch.chars.length, 6);
  const r = c.verify(ch.token, solve(ch));
  assert.equal(r.ok, true);
});

t("自定义画布尺寸生效", () => {
  const c = createCaptcha({ secret: "s", width: 400, height: 240 });
  const ch = c.createChallenge();
  assert.equal(ch.width, 400);
  assert.equal(ch.height, 240);
  assert.ok(ch.chars.every((x) => x.x < 400 && x.y < 240));
});

console.log(`\n${"─".repeat(50)}`);
console.log(`  ${fail === 0 ? "✅ 全部通过" : "❌ 有失败"}   通过 ${pass} / 失败 ${fail}`);
console.log(`${"─".repeat(50)}\n`);

process.exit(fail === 0 ? 0 : 1);
