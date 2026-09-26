# 核心 API 速查

给需要快速定位「哪个函数在哪、签名是什么」的场景。

源码位置（相对于 skill 的 `payload/ink-captcha/`）：
- `src/core.js` —— 服务端核心（`createChallenge` / `verify` / `consumePassToken`）
- `src/ink-background.js` —— `buildInkBackground`
- `src/rate-limit.js` —— `createRateLimiter` / `getClientIp`
- `src/ink-captcha.js` —— 前端 `InkCaptcha.mount` / `autoMount`
- `src/react.jsx` —— `PointsCaptcha`（React 封装）

---

## createCaptcha(config) → 实例

```js
import { createCaptcha } from "./core.js";

const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET });
```

### 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `secret` | **必填** | AES-256 密钥来源。空字符串/缺失会直接抛错 |
| `width` | `320` | 画布逻辑宽度 |
| `height` | `200` | 画布逻辑高度 |
| `targetCount` | `4` | 需按顺序点击的字数 |
| `distractorCount` | `4` | 干扰字数量 |
| `minCenterGap` | `50` | 字之间最小中心距（防视觉粘连） |
| `hitRadius` | `26` | 命中判定半径（逻辑坐标） |
| `challengeMaxAgeMs` | `300000` | 挑战时效（5 分钟） |
| `passMaxAgeMs` | `300000` | 凭证时效（5 分钟） |
| `maxAttempts` | `5` | 单挑战最多尝试次数 |
| `minHumanStepMs` | `60` | 时序判据阈值（全部间隔小于此值判脚本） |
| `charPool` | 40 个国风单字 | 题库，长度须 ≥ `targetCount + distractorCount` |

**构造时校验**：
- `secret` 非空 → 否则 `throw`
- `charPool.length >= targetCount + distractorCount` → 否则 `throw`

### 实例属性 / 方法

| 成员 | 类型 | 说明 |
|---|---|---|
| `createChallenge()` | `() => PointsChallenge` | 签发挑战 |
| `verify(token, picks)` | `(string, Pick[]) => VerifyPointsResult` | 校验 |
| `consumePassToken(passToken)` | `(string) => boolean` | 消费一次性凭证（用即删） |
| `hitRadius` | `number` | 命中半径（可直接下发给前端） |
| `width` / `height` | `number` | 画布尺寸 |
| `config` | `object` | 当前配置（`secret` 已替换为 `"***"`） |
| `_stats()` | `() => {pendingPassTokens, trackedChallenges}` | 调试用 |

### 类型

```ts
interface PointsChallenge {
  token: string;        // 加密后的答案，原样回传给 verify
  targets: string[];    // 顶部提示：按顺序要点的字（题目本身）
  chars: Array<{        // 画布上所有字（已剥离 _isTarget）
    id: string;
    char: string;
    x: number;          // 逻辑坐标，字中心
    y: number;
    rotate: number;     // 旋转角度（度），±18
    size: number;       // 字号，26~32
  }>;
  width: number;
  height: number;
}

interface Pick {
  id: string;           // ★ 点中的字形 id（来自 chars[].id）—— 必需
  ts?: number;          // 该次点击的时间戳（ms，绝对时间即可）—— 用于时序判据
}

// ⚠️ 高频坑：picks 里必须是 { id, ts }，不是 { x, y }！
//
// 命中判定（点击坐标 → 落在哪个字的 hitRadius 内）是在【客户端】做的。
// 组件算出用户点中了哪个字后，把那个字的 id 发上来；服务端只比字符串序列。
//
// 若你自己写前端却把 {x, y} 发上来 → 服务端取 picks[i].id 得到 undefined
// → 一直返回 reason: "mismatch"，看起来像验证逻辑坏了，其实是数据结构不对。
//
// 自己实现命中判定的写法：
//   const hit = chars.find(c => Math.hypot(lx - c.x, ly - c.y) <= hitRadius);
//   picks.push({ id: hit.id, ts: Date.now() });

interface VerifyPointsResult {
  ok: boolean;
  passToken?: string;   // ok=true 时存在
  reason?: string;      // ok=false 时存在
}
```

### `reason` 取值

| reason | 含义 | 建议处置 |
|---|---|---|
| `invalid_token` | token 无法解密（篡改/换密钥/格式错） | 提示刷新 |
| `invalid_payload` | 解密成功但结构不对 | 提示刷新 |
| `expired` | 挑战超时 | 提示刷新 |
| `invalid_picks` | 没提交点击记录 | 提示点选 |
| `too_fast` | 全部点击间隔过短 | 提示重新点选 |
| `too_many_attempts` | 尝试次数超限 | 提示刷新后重试 |
| `mismatch` | 顺序/数量不对，**或 `picks` 里没带 `id`** | 先确认 picks 格式，再提示顺序不对 |

配套文案见 `REASON_TEXT`（`core.js` 导出，可直接用）。

---

## buildInkBackground(input) → string

```js
import { buildInkBackground } from "./ink-background.js";

const svg = buildInkBackground({ width: 320, height: 200 });
// → "<svg xmlns=...>...</svg>"
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `width` | — | **必填**，须与挑战的 `width` 一致 |
| `height` | — | **必填**，须与挑战的 `height` 一致 |
| `seed` | `Math.floor(Math.random()*1e9)` | 固定后同一 seed 出同一张图（便于排查） |
| `theme` | `"paper"` | `"paper"`（宣纸）\| `"dark"`（墨夜） |

**注意**：这里的随机**只用于视觉**（山形起伏、噪点位置），与安全答案无关，
所以用的是 `Math.random` 而非 `crypto`。

**返回的 SVG** 渐变 id 带 seed 前缀（`ik{seed36}paper` 等），
所以同一页面叠多张不会互相覆盖。

---

## createRateLimiter(opts) → 限流器

```js
import { createRateLimiter } from "./rate-limit.js";

const limiter = createRateLimiter();
limiter.check("verify:1.2.3.4", 20, 60_000);
// → { allowed: boolean, remaining: number, retryAfterMs: number }
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `maxKeys` | `20000` | 最多追踪多少 key，超了整体清空（防内存泄漏） |

**适用范围**：单进程。多实例时各进程独立计数，实际放行量 = 单实例限制 × 实例数。

---

## getClientIp(req) → string

兼容 Web 标准 `Request`（Next.js/Deno/Bun）与 Node `IncomingMessage`。

读取顺序：`x-forwarded-for`（取第一个）→ `x-real-ip` → `cf-connecting-ip`
→ `x-client-ip` → `req.socket.remoteAddress` → `"unknown"`

**安全提醒**：只有部署在**可信反向代理之后**时，信任 `x-forwarded-for` 才安全。
裸奔公网时客户端可伪造该头绕过 IP 限流（但绕不过单挑战尝试上限）。

---

## 前端：InkCaptcha.mount(host, config) → 实例

```js
const inst = InkCaptcha.mount(document.getElementById("box"), {
  endpoint: "/api/captcha/points",
  verifyEndpoint: "/api/captcha/points/verify",
  theme: "paper",
  onVerified: (passToken) => { /* ... */ },
  onStateChange: ({ verified, loading }) => { /* ... */ },
});
```

| 配置项 | 默认 | 说明 |
|---|---|---|
| `endpoint` | `/api/captcha/points` | 挑战接口 |
| `verifyEndpoint` | `/api/captcha/points/verify` | 校验接口 |
| `theme` | `"paper"` | `paper` / `dark` / `auto`（跟随宿主容器亮度） |
| `maxScale` | `1` | 缩放上限 |
| `headers` | `{}` | 请求额外头（如 CSRF token） |
| `texts` | 内置中文 | 覆盖任意文案 |
| `responseKeys` | 见下 | 适配不同的响应结构 |
| `onVerified` | — | `(passToken) => void` |
| `onStateChange` | — | `({verified, loading}) => void` |

### `responseKeys` 适配非标准响应

```js
responseKeys: {
  // 默认：json.success && json.data
  challengeData: (json) => (json.code === 0 ? json.result : null),
  // 默认：json.data.passToken || json.data.captchaToken
  passToken: (json) => (json.code === 0 ? json.result.ticket : null),
  // 默认：json.error
  errorText: (json) => json.message || null,
}
```

### 实例方法

| 方法 | 说明 |
|---|---|
| `reset()` | 重置并拉新挑战 |
| `refresh()` | 同 `reset()` |
| `getToken()` | 取当前凭证（未通过返回 `null`） |
| `destroy()` | 卸载，清理事件监听与定时器 |

### 声明式自动挂载

```html
<div data-ink-captcha
     data-endpoint="/api/captcha/points"
     data-verify-endpoint="/api/captcha/points/verify"
     data-theme="paper"
     data-callback="onCaptchaPassed"></div>
```

`data-callback` 是 `window` 上的函数名（不是表达式）。
脚本在 `DOMContentLoaded` 时自动扫描 `[data-ink-captcha]`。

---

## React：PointsCaptcha

```jsx
import { PointsCaptcha } from "./react.jsx";

<PointsCaptcha
  endpoint="/api/captcha/points"
  verifyEndpoint="/api/captcha/points/verify"
  onVerified={(passToken) => setToken(passToken)}
  onStateChange={({ verified }) => setReady(verified)}
/>
```

底层只是 `mount()` 的一层薄封装。回调通过 `ref` 传递，
所以父组件每次 render 都**不会**重建实例。

通过 `boxRef.current.__inkCaptchaInstance` 可取到原生实例
（用于调 `reset()`）。

---

## 响应契约（示例服务器采用）

```jsonc
// GET /api/captcha/points  → 200
{
  "success": true,
  "data": { "token": "...", "targets": ["春","风","得","意"],
            "chars": [...], "bg": "<svg...>", "width": 320, "height": 200, "hitRadius": 26 }
}

// POST /api/captcha/points/verify → 200 成功
{ "success": true, "data": { "passToken": "..." } }

// 失败 → 400
{ "success": false, "error": "顺序不正确，请重新点选", "reason": "mismatch" }

// 限流 → 429
{ "success": false, "error": "请求过于频繁，请稍后再试" }
```

> 这个契约**不是强制的** —— 前端组件通过 `responseKeys` 可适配任意结构。
> 但三个示例服务器都遵循它，保持一致可以少踩坑。
