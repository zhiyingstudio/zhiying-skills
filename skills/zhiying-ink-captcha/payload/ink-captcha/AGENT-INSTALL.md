# AGENT-INSTALL.md —— 给 AI Agent 的安装指令

> **你（Agent）现在的任务**：把这套「点选式人机验证」装到目标项目里。
> 读完本文档你应当能独立完成安装，**无需联网、无需询问用户任何代码细节**。
>
> 目标读者：AI Agent。人类用户可直接看 `README.md`。
>
> 版本：ink-captcha v1.0.0 ｜ 生成时间：2026-09-24

---

## 0. 30 秒认知（先读这段，避免走弯路）

| 事实 | 说明 |
|---|---|
| **零依赖** | `package.json` 的 `dependencies` 是 `{}`。**不要跑 `npm install`**，没有包要装 |
| **无数据库** | 状态全在进程内存 + 加密 token 里。**不要建表** |
| **只需拷 5 个文件** | 服务端 3 个 + 前端 1 个（+ React 项目多 1 个） |
| **总代码量** | 57KB 原始 / 19.6KB gzip |
| **框架无关** | 核心只 `import crypto`；前端可在任何浏览器跑 |
| **编译步骤** | 无。纯 JS，拷过去就能用 |

**安装的核心动作只有 3 件**：①拷文件 ②写 2 个 API 路由 ③在表单页挂载组件。

---

## 1. 开工前：先跑通验证包完整（强制第一步）

**不要跳过这一步。** 先证明这份代码本身是好的，再往项目里拷。

```bash
cd <本包解压目录>/ink-captcha

# 1) 跑 36 项自测（零依赖，秒出结果）
node scripts/selftest.mjs
# 期望输出最后一行：✅ 全部通过   通过 36 / 失败 0

# 2) 起一个真实示例，端到端验证
bash start.sh
# 它会自动：检查 Node 版本 → 跑自测 → 启动示例 → 探活
# 期望：探活输出 HTTP 200
```

**若自测不是「通过 36 / 失败 0」→ 停止安装，报告给用户。** 不要带着失败继续。

**Node 版本要求**：≥ 18（用到了 `crypto.randomInt` / `node:crypto` / `structuredClone` 级别的 API）。
检查：`node -v`。

---

## 2. 判断目标项目的框架

安装方式取决于目标项目类型。**先用 30 秒判断，别猜**：

| 判断依据（去目标项目根目录看） | 结论 | 走哪节 |
|---|---|---|
| 有 `next.config.js/ts` + `app/` 或 `pages/` | **Next.js** | §3.1 |
| 有 `express` 在 `package.json` deps 里 | **Express** | §3.2 |
| 有 `fastify` / `koa` / `hono` | **其他 Node 框架** | §3.3 |
| 有 `vite.config.*` / `webpack.config.*` + 独立后端 | **前端框架 + 独立后端** | §3.3 |
| 是 WordPress / PHP / 静态站 | **无 Node 后端** | §3.4 |
| 纯静态 HTML 无后端 | **⚠️ 架构不适用** | §3.5 |

> **重要**：本项目**必须有一个 Node 服务端**来跑校验。没有 Node 后端的话见 §3.4 / §3.5，不要强行硬塞。

---

## 3. 分框架安装

### 3.1 Next.js（App Router）

**参考实现**：`examples/nextjs/` —— 这是已在 Next.js 上跑通的完整范例，**直接对照抄**。

#### ① 拷文件

```bash
# 服务端核心 3 个
cp src/core.js          <目标>/src/lib/captcha/core.js
cp src/ink-background.js <目标>/src/lib/captcha/ink-background.js
cp src/rate-limit.js    <目标>/src/lib/captcha/rate-limit.js
```

> 若目标项目不用 `src/`，改成对应目录（如 `<目标>/lib/captcha/`）。保持三个文件**同目录**。

#### ② 建服务端单例（关键：必须单例）

照抄 `examples/nextjs/lib/captcha.ts`，改两处：

```ts
// <目标>/lib/captcha.ts
import "server-only";
import { createCaptcha } from "./captcha/core.js";
import { createRateLimiter } from "./captcha/rate-limit.js";

const g = globalThis as any;

function init() {
  const secret = process.env.CAPTCHA_SECRET;
  if (!secret) {
    // ❗ 必须 throw，不许 fallback 到其他 secret
    throw new Error("[ink-captcha] 缺少环境变量 CAPTCHA_SECRET，请在 .env 中设置一个随机字符串");
  }
  return { captcha: createCaptcha({ secret }), limiter: createRateLimiter() };
}

// ❗ 用 globalThis 缓存 = 模块单例。Next.js dev 热重载 / 多路由 import 都会重复执行模块顶层代码
export const captcha = (g.__inkCaptcha ??= init()).captcha;
export const limiter  = (g.__inkCaptcha ??= init()).limiter;
```

> **为什么必须单例**：`createCaptcha()` 内部有内存 Map 存凭证。如果每次 `new` 一个实例，A 路由签发的 passToken B 路由就查不到 → 用户永远验证失败。
> **这是本包最常见的安装事故，务必确认 `??=` 这行在。**

#### ③ 写 2 个 API 路由

**签发挑战** → `<目标>/app/api/captcha/points/route.js`

```js
import { captcha, limiter, REASON_TEXT } from "@/lib/captcha";
import { getClientIp } from "@/lib/captcha/rate-limit.js";

export async function GET(req) {
  const ip = getClientIp(req);
  const gate = limiter.check(`challenge:${ip}`, 60, 60_000);   // 60 次/分
  if (!gate.allowed) {
    return Response.json({ success: false, error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }
  return Response.json({ success: true, data: captcha.createChallenge() });
}
```

**校验并签发凭证** → `<目标>/app/api/captcha/points/verify/route.js`

```js
import { captcha, limiter, REASON_TEXT } from "@/lib/captcha";
import { getClientIp } from "@/lib/captcha/rate-limit.js";

export async function POST(req) {
  const ip = getClientIp(req);
  const gate = limiter.check(`verify:${ip}`, 20, 60_000);      // 20 次/分
  if (!gate.allowed) {
    return Response.json({ success: false, error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }
  let body;
  try { body = await req.json(); } catch { 
    return Response.json({ success: false, error: "请求格式错误" }, { status: 400 });
  }
  const result = captcha.verify(body.token, body.picks);
  if (!result.ok) {
    return Response.json(
      { success: false, error: REASON_TEXT[result.reason] ?? "验证失败", reason: result.reason },
      { status: 400 }
    );
  }
  return Response.json({ success: true, data: { passToken: result.passToken } });
}
```

> `getClientIp` 的签名要按你项目实际情况微调：Next.js App Router 传的是 Web `Request`；若用 Pages Router 或 Express，传的是 Node `IncomingMessage`。函数已做了双兼容。

#### ④ 在业务接口消费凭证（**这步最容易漏，漏了等于没防护**）

以注册接口为例：

```js
import { captcha } from "@/lib/captcha";

export async function POST(req) {
  const body = await req.json();

  // ❗ 先消费凭证，失败直接拒
  const ok = captcha.consumePassToken(body.passToken);
  if (!ok) {
    return Response.json({ success: false, error: "人机验证已失效，请重新验证" }, { status: 400 });
  }

  // ... 你的真实业务逻辑
}
```

> **必须挂在所有「值得保护的写接口」上**：注册、登录取码、发短信、领券、提交订单、找回密码。
> 只发 `passToken` 不消费 = 攻击者拿到一个凭证能无限用。

#### ⑤ 前端挂载

**方案 A（React 项目，推荐）** —— 用 React 封装：

```bash
cp src/react.jsx       <目标>/components/PointsCaptcha.jsx
cp src/ink-captcha.js  <目标>/public/ink-captcha.js   # 原生组件，React 封装会 import 它
```

```jsx
"use client";
import { useState } from "react";
import { PointsCaptcha } from "@/components/PointsCaptcha";

export default function RegisterForm() {
  const [passToken, setPassToken] = useState(null);
  return (
    <form onSubmit={/* 提交时带上 passToken */}>
      {/* ...其他字段... */}
      <PointsCaptcha
        endpoint="/api/captcha/points"
        verifyEndpoint="/api/captcha/points/verify"
        onVerified={(token) => setPassToken(token)}
      />
      <button disabled={!passToken}>提交</button>
    </form>
  );
}
```

**方案 B（非 React 页面）** —— 直接用原生组件：

```html
<div id="captcha-box"></div>
<script src="/ink-captcha.js"></script>
<script>
  var cap = InkCaptcha.mount(document.getElementById("captcha-box"), {
    endpoint: "/api/captcha/points",
    verifyEndpoint: "/api/captcha/points/verify",
    onVerified: function (passToken) { window.__passToken = passToken; },
  });
</script>
```

#### ⑥ 配置环境变量

```bash
# .env / .env.local
CAPTCHA_SECRET=<随机字符串，见下方生成命令>
```

生成密钥：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> ⚠️ **多实例部署（pm2 cluster / 多台机器）时，所有实例的 `CAPTCHA_SECRET` 必须完全一致**，否则 A 实例签发的 token B 实例解不开，用户会随机失败。

---

### 3.2 Express

**参考实现**：`examples/express/` —— 已跑通，含主题切换示例。

#### ① 拷文件

```bash
cp src/core.js src/ink-background.js src/rate-limit.js <目标>/lib/captcha/
```

#### ② 建服务端模块

```js
// <目标>/lib/captcha.js
const { createCaptcha } = await import("./captcha/core.js");        // 注意 core.js 是 ESM
const { createRateLimiter, getClientIp } = await import("./captcha/rate-limit.js");

// ❗ 单例：模块顶层只执行一次
const secret = process.env.CAPTCHA_SECRET;
if (!secret) throw new Error("[ink-captcha] 缺少环境变量 CAPTCHA_SECRET");
const captcha = createCaptcha({ secret });
const limiter = createRateLimiter();
module.exports = { captcha, limiter, REASON_TEXT: createCaptcha.REASON_TEXT };
```

> **ESM/CJS 注意**：`core.js` 是 ESM（用了 `export`）。若你的 Express 项目是 CJS，用 `await import()` 动态导入（如上）。
> **不要**把 `core.js` 改成 CJS —— 会导致与 `src/index.cjs` 的桥接不一致。用动态 import 最省事。

#### ③ 挂路由

```js
// 限流中间件
function rateLimit(prefix, limit, windowMs) {
  return (req, res, next) => {
    const gate = limiter.check(`${prefix}:${getClientIp(req)}`, limit, windowMs);
    if (!gate.allowed) return res.status(429).json({ success: false, error: "请求过于频繁，请稍后再试" });
    next();
  };
}

app.get("/api/captcha/points", rateLimit("challenge", 60, 60_000), (req, res) => {
  res.json({ success: true, data: captcha.createChallenge() });
});

app.post("/api/captcha/points/verify", rateLimit("verify", 20, 60_000), express.json(), (req, res) => {
  const result = captcha.verify(req.body.token, req.body.picks);
  if (!result.ok) {
    return res.status(400).json({
      success: false, error: REASON_TEXT[result.reason] ?? "验证失败", reason: result.reason,
    });
  }
  res.json({ success: true, data: { passToken: result.passToken } });
});

// ❗ 业务接口必须消费凭证
app.post("/api/register", express.json(), (req, res) => {
  if (!captcha.consumePassToken(req.body.passToken)) {
    return res.status(400).json({ success: false, error: "人机验证已失效，请重新验证" });
  }
  // ...真实业务
});
```

#### ④ 前端

把 `src/ink-captcha.js` 拷到 `public/`（或直接用 express.static 指到 `src/`），然后照 §3.1 的「方案 B」挂载。

---

### 3.3 其他 Node 框架（Fastify / Koa / Hono / 自建）

**原则**：本项目与框架**零耦合**，你只需要一个能拿到 `Request` 或 `IncomingMessage` 的地方。

```js
// 1. 初始化（单例！放在模块顶层）
import { createCaptcha } from "./captcha/core.js";
import { createRateLimiter, getClientIp } from "./captcha/rate-limit.js";
const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET });
const limiter = createRateLimiter();

// 2. 两个端点：参考 §3.2 的逻辑，只是换框架的写法
//    - GET  → captcha.createChallenge()
//    - POST → captcha.verify(token, picks)
// 3. 业务接口 → captcha.consumePassToken(passToken)
```

**`getClientIp` 的输入兼容性**：
- Web `Request`（Hono / Next.js / Remix / Bun）→ 直接传
- Node `IncomingMessage`（Express / Koa / Fastify / 原生 http）→ 直接传
- 函数内部按 `x-forwarded-for → x-real-ip → cf-connecting-ip → x-client-ip → socket` 顺序取 IP

**如果框架给的不是上述两种对象**（比如 Koa 的 `ctx`）→ 传 `ctx.req`（Node 原生对象）。

---

### 3.4 无 Node 后端（WordPress / PHP / 静态站）

**不要试图把 Node 代码塞进 PHP。** 三个正确选项：

| 方案 | 做法 | 适用 |
|---|---|---|
| **A. 起一个独立 Node 微服务** | 单独跑一个 Node 进程（甚至就是本包 `examples/node-http/server.mjs`），nginx 把 `/api/captcha/*` 反代过去 | 服务器上能跑 Node |
| **B. 用 Cloudflare Workers / Vercel Serverless** | 把 §3.1 的路由逻辑搬到 Worker，前端 `endpoint` 指向 Worker 域名（注意跨域要开 CORS） | 主站不在 Node 上但想要验证 |
| **C. 降级为纯前端形态** | ⚠️ 只在「防的是本机脚本」时可用 | 见 §3.5 |

**方案 A 的 nginx 片段**：
```nginx
location /api/captcha/ {
    proxy_pass http://127.0.0.1:3737;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # ❗ 必须带，否则拿不到真实 IP，限流全部算到 nginx 头上
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

### 3.5 纯静态站 / 客户端本地（**架构警告**）

**如果没有服务端，这套方案的核心防护不存在。**

原因：`secret` 必须在服务端才能保证「攻击者无法自己签发 passToken」。secret 一旦在客户端，任何人打开 DevTools 就能拿到。

**只有一种情况可以用**：你防的是「本机自动化脚本」（如按键精灵刷界面），**不是**远程攻击者。

此时的做法（不推荐，仅说明可行性）：
```js
// ⚠️ 仅在「防护目标 = 本机脚本」时使用
// secret 写死在客户端 = 公开秘密，只能防不懂技术的人
const captcha = createCaptcha({ secret: "本机固定的一个字符串" });
```

**正确姿势**：客户端只做展示，校验请求发回你的服务器。
```js
InkCaptcha.mount(el, {
  endpoint: "https://你的服务器/api/captcha/points",        // ❗ 指向远程
  verifyEndpoint: "https://你的服务器/api/captcha/points/verify",
  onVerified: (passToken) => { /* 本地先存着，提交时带给服务器 */ },
});
```
**注意跨域**：远程端点要返回 `Access-Control-Allow-Origin`，且 `credentials` 相关头要配对。

---

## 3.6 🔴 API 数据契约（接入前必读，最容易踩坑的地方）

> 这一节是从「实际调试端到端时差点误判成产品缺陷」中总结的。**数据格式搞错会一直报 `mismatch`，但看起来像是验证逻辑坏了。**

### 签发挑战的返回

`createCaptcha().createChallenge()` 返回：

```js
{
  token: "zTQ24XE0Le2nk4_M.T4vUMwpeMw8-...",   // 加密后的挑战（含正确顺序）
  targets: ["风", "月", "莲", "黄"],            // 要按此顺序点选的字（字面，供提示用户）
  chars: [                                      // 图中所有字（含干扰字）
    { id: "MkyuUkU", char: "雨", x: 113, y: 151, rotate: -12, size: 30 },
    { id: "aB3xY9z", char: "月", x: 54,  y: 130, rotate: 8,  size: 28 },
    // ...
  ],
  bg: "<svg ...>",                             // 底图 SVG 字符串
  width: 320,
  height: 200,
  hitRadius: 26,
}
```

**注意**：`chars[]` 里**没有** `isTarget` 字段（已被剥离）。`targets` 给了字面顺序，用户据此作答。

### 校验接口的入参（⚠️ 高频踩坑点）

```js
POST /api/captcha/points/verify
{
  token: "<签发时拿到的 token>",
  picks: [
    { id: "aB3xY9z", ts: 1790219512669 },      // ✅ 正确：字形 id + 时间戳
    { id: "MkyuUkU", ts: 1790219512969 },
    // ...
  ]
}
```

**🔴 `picks[]` 里必须是 `{ id, ts }`，不是 `{ x, y }`！**

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | ✅ | 被点击字形的 `id`（来自 `chars[].id`）。服务端按此序列与 `token` 里的正确顺序逐项比对 |
| `ts` | 建议 | 该次点击的时间戳（ms）。用于识别脚本化操作（相邻间隔全 <60ms → `too_fast`） |

**为什么是 `id` 而不是坐标**：
命中判定（点击坐标 → 落在哪个字的 `hitRadius` 内）是**在客户端组件里做的**。组件算出用户点中了哪个字后，把那个字的 `id` 发上来。
这样设计的好处：服务端逻辑极简（只比字符串序列），且坐标精度问题不会影响判定。

**常见错误**：自己写前端、把 `{x, y}` 发给后端 → 服务端拿不到 `id` → 一直返回 `reason: "mismatch"`，看起来像验证逻辑坏了，其实是数据结构不对。

> 如果你要自己写前端（不用本包组件），必须**自己实现命中判定**：遍历 `chars`，找出与点击点距离 < `hitRadius` 的那个字，取它的 `id`。

### 各失败 reason 的含义

| reason | 触发条件 | 前端该怎么做 |
|---|---|---|
| `invalid_token` | token 被篡改 / 格式错 / secret 不匹配 | 重置，重新拉题 |
| `invalid_payload` | token 解开了但结构不对 | 重置 |
| `expired` | 挑战超 5 分钟 | 重置 |
| `invalid_picks` | `picks` 空或不是数组 | 提示用户点选 |
| `too_fast` | 所有相邻点击间隔 < 60ms | 重置 |
| `too_many_attempts` | 同一挑战点错 5 次 | 重置（组件会自动刷新） |
| `mismatch` | 顺序不对 / 点错字 / **`picks` 里没有 `id`** | 重置 |

---

## 4. 配置项速查（都可选，有默认值）
```js
createCaptcha({
  secret: "...",              // ❗ 必填，缺失抛错
  width: 320, height: 200,    // 画布
  targetCount: 4,             // 目标字数
  distractorCount: 4,         // 干扰字数
  minCenterGap: 50,           // 字最小中心距（下限 38）
  hitRadius: 26,              // 点击命中半径（逻辑坐标）
  challengeMaxAgeMs: 300000,  // 挑战有效期 5 分钟
  passMaxAgeMs: 300000,       // 凭证有效期 5 分钟
  maxAttempts: 5,             // 单挑战最多尝试次数
  minHumanStepMs: 60,         // 时序阈值：相邻点击全 <60ms → 判定脚本
  charPool: [...],            // 题库，默认 40 个国风单字
});
```

**改题库三原则**（详见 `docs/接入指南.md`）：
1. 数量 ≥ `targetCount + distractorCount`
2. 字形差异要大（别同时放「日/曰」，用户分不清）
3. 别用生僻到没人认识的字（可用性垮掉）

---

## 5. 前端组件配置（`InkCaptcha.mount(el, cfg)`）

```js
InkCaptcha.mount(document.getElementById("box"), {
  endpoint: "/api/captcha/points",              // 选填，默认也是这个
  verifyEndpoint: "/api/captcha/points/verify",
  theme: "paper",                               // "paper" 宣纸 | "dark" 墨夜
  maxScale: 1,                                  // 窄屏缩放上限
  headers: {},                                  // 额外请求头（如 CSRF token）
  texts: { /* 覆盖任意文案 */ },
  responseKeys: { /* 适配非标准响应结构，见下 */ },
  onVerified: (passToken) => {},
  onStateChange: (state) => {},
});
```

**实例方法**：
| 方法 | 作用 |
|---|---|
| `inst.getToken()` | 取当前 passToken（未通过返回 `null`） |
| `inst.reset()` / `inst.refresh()` | 重置并重新拉题 |
| `inst.destroy()` | 销毁实例（主题切换时用） |

### 适配非标准响应结构

若你的 API 返回的不是 `{ success, data }` 形状，用 `responseKeys` 适配：

```js
InkCaptcha.mount(el, {
  responseKeys: {
    challengeData: (json) => json?.result?.challenge ?? null,
    passToken:     (json) => json?.result?.ticket ?? null,
    errorText:     (json) => json?.msg ?? null,
  },
});
```

---

## 6. 🔴 BUG 注意事项（安装时必须逐条确认）

> 这些都是本项目**开发过程中真实踩到并修掉**的坑。你安装时若遇到同样现象，直接对照。

### 6.1 安装期最容易犯的 3 个错

| # | 症状 | 原因 | 修法 |
|---|---|---|---|
| **A** | 验证通过后提交仍报「验证已失效」 | **服务端没做单例** —— 每次请求 `new` 一个 `createCaptcha()`，Map 不共享 | 用 `globalThis.__inkCaptcha ??= init()` 缓存（§3.1 ②） |
| **B** | 用户第一次通过，第二次必失败 | 业务接口**忘了消费凭证**，或消费了但没在成功后删除 | 确保 `consumePassToken` 被调用；它是**先删后判**，天然防重放 |
| **C** | 用户填完表单提交时提示验证失效 | passToken 已被消费（或超 5 分钟） | 见 §6.5 |
| **D** | **自己写前端时一直报 `mismatch`，点对了也没用** | `picks` 发的是 `{x, y}` 坐标，**服务端要的是 `{id, ts}`** | 见 §3.6 —— 必须在客户端做命中判定，取字形的 `id` 发上来 |

### 6.2 坐标错位（点击位置偏了）

**症状**：明明点对了字，却判 `mismatch`；窄屏 / 缩放下错位更明显。

**原因**：组件用 `transform: scale()` 适配窄屏，若用 scale 变量反推坐标会错位。
`getBoundingClientRect().width` 是**实测渲染宽度**（含亚像素舍入），与 `W / scale` 有微小差异，累积后偏 10px 以上。

**修法**：组件内部已处理（用 `rect.width` 算 ratio）。**你不需要改**。但如果你**自己重写了点击处理**，必须照此原则：
```js
var rect = canvas.getBoundingClientRect();
var ratio = rect.width > 0 ? W / rect.width : 1;    // ✅ 用实测宽度
var lx = (e.clientX - rect.left) * ratio;
// ❌ 不要用 (e.clientX - rect.left) / scaleState
```

### 6.3 组件挂载崩溃：`NotSupportedError`

**症状**：控制台报 `Failed to execute 'attachShadow' on 'Element': Shadow root cannot be created on a host which already hosts a shadow tree`。

**触发场景**：React 严格模式双挂载 / HMR 热更新 / 手动 `mount` 两次到同一元素。

**修法**：组件内部已修（复用已有 `shadowRoot` + `host.__inkCaptcha` 哨兵先销毁旧实例）。
**你需要注意**：
- **主题切换时**，先 `inst.destroy()` 再重新 `mount`，或直接改 `inst` 的 theme 配置后 `reset()`
- 若你把组件挂在一个**会重建的容器**里（如 React key 变化），确保旧实例被 destroy

### 6.4 开发环境 Turbopack / webpack 报错

若 Next.js 项目用 Turbopack，拷进来的 `.js` 文件（含 JSX 的 `react.jsx`）注意扩展名。
- `react.jsx` 保持 `.jsx` 后缀，别改成 `.js`
- 三个服务端文件是纯 JS（无 JSX），`.js` 即可

### 6.5 凭证被消费后表单提交失败（业务设计问题）

**场景**：用户验证通过拿到 passToken → 填表单 → 填写过程中因为校验失败重新提交 → 但第一次提交已消费掉 passToken → 第二次报「验证已失效」。

**三个处理方案**：

| 方案 | 做法 | 评价 |
|---|---|---|
| **A. 失败即重置**（推荐） | 业务失败时前端调 `inst.reset()` 重新拉题 | 最稳，用户体验损失小 |
| **B. 前置轻量校验** | 先做「不消费凭证」的字段格式校验，全过了再消费 + 业务 | 体验最好，但要改造业务逻辑 |
| **C. 延长凭证有效期** | `passMaxAgeMs` 调大 | ❌ 不推荐，增大重放窗口 |

### 6.6 多实例部署随机失败

**症状**：pm2 cluster 模式下，用户验证时好时坏。

**原因**：每个 worker 进程是独立的 Node 进程，内存 Map 不共享。且若 `CAPTCHA_SECRET` 不一致，token 根本解不开。

**修法**：
1. `CAPTCHA_SECRET` 用**同一个**环境变量注入所有实例
2. 限流换成 Redis 或 nginx `limit_req`（内存 Map 只在单进程内有效）
3. 若必须跨实例共享 passToken，需要把存储层换成 Redis（本包未内置，属扩展项）

### 6.7 安全红线（不许为了让功能跑通而破坏）

| 红线 | 说明 |
|---|---|
| ❌ 不要把 `secret` 写死在客户端并当作「安全」 | 见 §3.5 |
| ❌ 不要把 `isTarget` / `_isTarget` 字段下发给前端 | 组件已剥离，若你自己改了下发逻辑，务必保持剥离 |
| ❌ 不要用 `Math.random` 抽题/布点 | 必须 `crypto.randomInt`（`Math.random` 只允许用于底图视觉随机） |
| ❌ 不要删掉 `consumePassToken` 的「先删后判」 | 这是防并发重放的关键 |
| ❌ 不要把「尝试次数上限」去掉 | 8 选 4 有序组合 1680 种，5 次机会命中率 0.3%；去掉就只剩 5 次暴力机会 |
| ❌ 不要只挂前端不消费凭证 | 等于装了个装饰品 |

---

## 7. 安装完成后的自检清单

逐条确认，**全 ✅ 才算装完**：

- [ ] `node scripts/selftest.mjs` 在**你的目标项目环境**下也是 36/36
- [ ] 环境变量 `CAPTCHA_SECRET` 已设置，且是随机串（非 `test`/`123456`）
- [ ] `createCaptcha()` 在服务端是**单例**（`??=` 或模块顶层）
- [ ] `GET /api/captcha/points` 返回 `{ success: true, data: { token, targets, chars, bg, ... } }`
- [ ] `POST /api/captcha/points/verify` 用**正确顺序**点击 → 返回 `passToken`
- [ ] 同上接口用**错误顺序** → 返回 400 且 `reason: "mismatch"`
- [ ] **篡改 token** → 返回 400 且 `reason: "invalid_token"`
- [ ] 业务接口：带合法 passToken → 成功；**同一 passToken 再用一次 → 400**（重放防护生效）
- [ ] 业务接口：不带 / 带伪造 passToken → 400
- [ ] 前端页面上**真的能看到底图**（不是白块），点字有反馈
- [ ] 浏览器控制台**无 JS 报错**
- [ ] 窄屏（360px）下不溢出、点击位置准
- [ ] 生产环境 `.env` 里的 `CAPTCHA_SECRET` 与 dev 不同

### 判定「生效」的唯一可靠手段

**不要**以「接口返回 200」「响应体里有字段」判断装好了。必须：
1. 真实点完 4 个字 → 看 `passToken` 是否真拿到
2. 真实提交一次 → 看业务是否真的成功了
3. 同一凭证再提交一次 → 必须失败

---

## 8. 遇到问题的排查顺序

```
用户点字没反应
  → 打开控制台看报错
  → 看 /api/captcha/points 是否 200，返回体结构是否 { success, data }
  → 若不是标准结构 → 配 responseKeys（§5）

点了正确的字但判错
  → 99% 是坐标换算问题 → 确认组件未被自己重写（§6.2）
  → 检查是否有 CSS transform 影响了 canvas

验证通过但提交失败
  → 是否服务端单例（§6.1 A）
  → 业务接口是否消费了凭证（§6.1 B）
  → 凭证是否已超时 / 已被消费（§6.5）

随机失败（时好时坏）
  → 多实例？secret 是否一致？（§6.6）
  → 限流是否太紧？（默认挑战 60/分、校验 20/分）

报 too_fast
  → 用户在脚本化操作，或鼠标/触控板异常连点
  → 阈值 60ms 刻意宽松，正常人手速不会触发

报 too_many_attempts
  → 同一个挑战点错 5 次了，前端会自动刷新（1.1s）
```

---

## 9. 本包完整内容清单

```
ink-captcha-agent-kit/
├── AGENT-INSTALL.md              ← 你正在读的（Agent 安装指令）
├── QUICKSTART.md                 ← 人类用户版 3 分钟上手
├── MANIFEST.md                   ← 全文件清单 + 每个文件的用途
├── 安装说明.md                    ← 三种使用方式（装 Skill / 拿源码 / 开源）
│
├── ink-captcha/                  ← 完整源码仓库（可独立跑）
│   ├── src/
│   │   ├── core.js               【服务端核心】497 行，只 import crypto
│   │   ├── ink-background.js     【底图生成】188 行，零依赖 SVG
│   │   ├── rate-limit.js         【限流 + IP 提取】97 行，零依赖
│   │   ├── ink-captcha.js        【前端原生组件】681 行，零 import，Shadow DOM
│   │   ├── react.jsx             【React 薄封装】67 行（可选）
│   │   ├── index.js              ESM 入口
│   │   └── index.cjs             CJS 入口（异步桥接）
│   ├── examples/
│   │   ├── node-http/            纯 Node http 示例（端口 3737）
│   │   ├── express/              Express 示例（端口 3738）
│   │   └── nextjs/               Next.js 示例（端口 3739）★ 最接近生产
│   ├── scripts/
│   │   ├── selftest.mjs          36 项自测（零依赖）
│   │   ├── browser-e2e.mjs       Playwright 真实浏览器端到端
│   │   └── preview-sheet.mjs     12 张底图对照图生成
│   ├── docs/
│   │   ├── 接入指南.md            改造清单 / 多实例 / 上线检查
│   │   ├── 安全说明.md            威胁模型 / 五层防护 / 明确不防的攻击
│   │   └── FAQ.md                五类常见问题
│   ├── README.md                 项目主页
│   ├── CHANGELOG.md              版本历史
│   ├── LICENSE                   MIT
│   ├── package.json              零依赖
│   └── start.sh                  一键跑起来
│
└── skill/                        ← WorkBuddy Skill 包（可选）
    └── ink-captcha-selfhost/
        ├── SKILL.md
        ├── references/core-api.md
        └── payload/ink-captcha/   （源码副本，供 Skill 自动分发）
```

---

## 10. Agent 执行摘要（TL;DR）

```
1. cd ink-captcha && node scripts/selftest.mjs     → 必须 36/36
2. 判断目标框架（§2 表格）
3. 拷 src 里的文件到目标项目
   - 服务端必备：core.js / ink-background.js / rate-limit.js
   - 前端必备：  ink-captcha.js（+ react.jsx 若为 React）
4. 建服务端单例（必须用 globalThis 缓存！）
5. 写 2 个 API 路由：签发 + 校验
6. ❗ 在所有受保护的写接口加 consumePassToken 校验
7. 前端挂载组件，onVerified 存下 passToken
8. 设 CAPTCHA_SECRET 环境变量（随机 32 字节）
9. 走 §7 自检清单，全 ✅ 才算完成
10. 遇到问题查 §6 BUG 注意事项
```

**零依赖、无数据库、无编译、59KB 代码。** 如果安装过程中你觉得需要 `npm install` 或建表，说明方向错了 —— 回头看 §0。

---

*ink-captcha v1.0.0 ｜ MIT License ｜ 生成于 2026-09-24*
