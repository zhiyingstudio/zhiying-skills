# ink-captcha · 墨韵点选验证码

> 自研点选式人机验证。**服务端零依赖、前端零框架、无第三方服务、无备案限制、无费用。**
> 国风水墨底图由程序实时生成，不占任何图片资产。
>
> 作者：**宫帅（AI智库 · 智影科技）** ｜ MIT License ｜ v1.0.0

```
提示：按顺序点击 [春] [风] [得] [意]
┌────────────────────────────────┐
│      春        云              │   ← 底图是程序化生成的水墨山水 SVG
│   月      得       山    竹    │      每次刷新都不一样
│      意     霜       风        │
│   ▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂  │
└────────────────────────────────┘
```

---

## 为什么再造一个验证码轮子

现成方案在实际项目里都会撞上这几面墙：

| 方案 | 问题 |
|---|---|
| Google reCAPTCHA | 国内不可达；依赖 Google 服务 |
| hCaptcha / Cloudflare Turnstile | 国内访问不稳定；有免费额度上限 |
| 国内某验/某盾 | 收费；需备案；被逆向得很彻底 |
| 开源滑块（多数） | 答案明文下发 → 抓包即破；前端写死 React/Vue |

**ink-captcha 的取舍**：不追求「不可破解」，而是让批量脚本的成本高于收益。
做到这一点只需要四件事，而它全部做到了 —— 见下方[安全模型](#安全模型)。

---

## 30 秒上手

### 0. 拿到代码

两种方式：

```bash
# 方式 A：克隆仓库
git clone https://github.com/<你的用户名>/ink-captcha.git
cd ink-captcha

# 方式 B：解压分发包
tar xzf ink-captcha-v1.0.0-src.tar.gz && cd ink-captcha
```

然后**先跑通再改造**：

```bash
bash start.sh     # 会先跑 36 项自测，再启动 demo（默认 3737 端口）
# 打开 http://localhost:3737，亲手点一次验证码
```

不需要 `npm install` —— 核心零依赖。

### 1. 服务端（任选一种框架）

**原生 Node**

```js
import http from "node:http";
import { createCaptcha, buildInkBackground, createRateLimiter, getClientIp } from "ink-captcha";

const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET });
const limiter = createRateLimiter();

http.createServer(async (req, res) => {
  const ip = getClientIp(req);

  if (req.url === "/api/captcha/points") {
    if (!limiter.check(`c:${ip}`, 60, 60_000).allowed)
      return res.writeHead(429).end();

    const ch = captcha.createChallenge();
    const bg = buildInkBackground({ width: ch.width, height: ch.height });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, data: { ...ch, bg } }));
  }

  if (req.url === "/api/captcha/points/verify") {
    let raw = "";
    for await (const c of req) raw += c;
    const { token, picks } = JSON.parse(raw);
    const r = captcha.verify(token, picks);
    res.writeHead(r.ok ? 200 : 400, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify(r.ok ? { success: true, data: { passToken: r.passToken } } : { success: false, error: "验证失败" }),
    );
  }
}).listen(3000);
```

**Express / Fastify / Koa / Next.js** —— 完全一样的调用，因为核心不依赖任何 Web 框架。
完整可运行示例见 [`examples/`](./examples)：

| 示例 | 说明 |
|---|---|
| [`examples/node-http`](./examples/node-http) | 零框架，只用 `node:http` |
| [`examples/express`](./examples/express) | Express 4 |
| [`examples/nextjs`](./examples/nextjs) | Next.js App Router（含服务端单例写法） |

### 2. 前端（任选一种）

**方式 A · 零依赖原生脚本**（推荐给非 React 项目）

```html
<div id="captcha"></div>
<script src="/ink-captcha.js"></script>
<script>
  const inst = InkCaptcha.mount(document.getElementById("captcha"), {
    endpoint: "/api/captcha/points",
    verifyEndpoint: "/api/captcha/points/verify",
    onVerified: (passToken) => { submitBtn.disabled = false; window.__captcha = passToken; },
  });
</script>
```

也可以纯声明式，不加一行 JS：

```html
<div data-ink-captcha data-callback="onCaptchaPassed"></div>
<script>
  function onCaptchaPassed(passToken) { /* ... */ }
</script>
```

**方式 B · React 组件**

```jsx
import { PointsCaptcha } from "ink-captcha/react";

const [token, setToken] = useState(null);

<PointsCaptcha onVerified={setToken} />
<button disabled={!token}>注册</button>
```

> 组件挂载在 **Shadow DOM** 里，样式用内联 + 作用域隔离。
> 不会污染你的全局 CSS，也不会被你的 reset 样式搞坏。**不需要 Tailwind。**

### 3. 业务接口消费凭证（最容易漏的一步）

```js
app.post("/api/register", (req, res) => {
  const { account, passToken } = req.body;

  // ⬇⬇⬇ 没有这一行，前面所有验证都是装饰品
  if (!captcha.consumePassToken(passToken)) {
    return res.status(400).json({ success: false, error: "人机验证未通过或已失效" });
  }

  // ... 真实注册逻辑
});
```

---

## 安全模型

### 核心原则：答案顺序**绝不明文下发**

```
① GET /api/captcha/points
   服务端：随机抽 4 个目标字 + 4 个干扰字 → 随机布点
          → 把「正确点击顺序」用 AES-256-GCM 加密成 token
   响应体：{ token, targets:["春","风","得","意"], chars:[{id,char,x,y,rotate,size}...], bg }
            ↑ 只有「字面 + 坐标」—— 这是题目本身，人类必须看见才能作答
            ↑ 没有任何字段标明「第 i 步该点哪个」

② 用户点 4 下 → POST /api/captcha/points/verify
   body：{ token, picks:[{id, ts}, ...] }   ← 只有点击序列 + 每步时间

③ 服务端：解密 token → 取出正确 id 顺序 → 逐项比对（timingSafeEqual）
   通过 → 签发一次性 passToken

④ 业务接口：consumePassToken() 校验并**立即删除**
```

### 「答案就在响应体里」为什么不算漏洞

底图上的字必须让用户看见，否则无法作答 —— 这与「把答案藏起来」天然冲突。
**守住安全的从来不是「藏字」，而是这四件套**：

| 防护 | 实现 | 挡住的攻击 |
|---|---|---|
| 必须走完整流程 | 不能跳过签发直接提交 | 直接构造请求 |
| 一次性凭证 | `passTokens.delete()` 先删后校验 | 重放已通过的凭证 |
| 单挑战尝试上限 | 默认 5 次，超限作废 | 暴力枚举顺序（4 个目标字从 8 个里选，有序组合 1680 种，5 次机会命中率 0.3%） |
| IP 限流 | 签发 60/分、校验 20/分 | 批量刷接口 |

再加一道辅助判据：**时序特征**。真人连点 4 个目标总耗时必然 >150ms；
脚本常一次性提交全部 id（每步间隔 0）→ 全间隔 <60ms 时判 `too_fast`。

> 我们**特意没有**为了让底图「更难 OCR」而牺牲字的可读性。
> 那会把真人挡在门外，而脚本照样用打码平台过 —— 得不偿失。

### 其他细节

- **目标字位置做了分散化**：仅靠 shuffle 会出现 4 个目标字全挤同一侧，
  这会显著缩小脚本的搜索空间。所以额外做了一轮爬山法，最大化目标字两两最小距离。
- **字段剥离**：服务端内部的 `_isTarget` 在响应前剥掉，`JSON.stringify` 后连字符串
  `"isTarget"` 都不会出现（自测里有断言）。
- **印章避让**：底图右下角有装饰性朱红印章，布点时会显式避开该区域，
  防止字与印章视觉打架。

---

## 配置项

```js
const captcha = createCaptcha({
  secret: process.env.CAPTCHA_SECRET,   // 必填

  width: 320,                // 画布逻辑宽度
  height: 200,               // 画布逻辑高度
  targetCount: 4,            // 要按顺序点击的字数
  distractorCount: 4,        // 干扰字数量
  minCenterGap: 50,          // 字之间最小中心距（防重叠）
  hitRadius: 26,             // 命中判定半径（逻辑坐标）
  challengeMaxAgeMs: 300000, // 挑战时效 5 分钟
  passMaxAgeMs: 300000,      // 凭证时效 5 分钟
  maxAttempts: 5,            // 单挑战最多尝试次数
  minHumanStepMs: 60,        // 时序判据阈值

  // 自定义题库（长度需 ≥ targetCount + distractorCount）
  charPool: ["春","风","得","意", /* ... */],
});
```

**改题库的选字原则**：
1. 字形差异要大 —— 避开「日/曰」「未/末」「己/已/巳」这类视觉混淆对
2. 用常用字 —— 别放生僻字，用户认不出等于把自己挡在外面
3. 长度至少 `targetCount + distractorCount`

---

## 底图主题

```js
buildInkBackground({ width: 320, height: 200 });                  // 宣纸（默认）
buildInkBackground({ width: 320, height: 200, theme: "dark" });   // 墨夜
buildInkBackground({ width: 320, height: 200, seed: 12345 });     // 固定 seed，可复现
```

底图是**程序化生成**的 SVG 字符串（纯拼接，不引任何 SVG 库），包含：
宣纸纤维质感、三层水墨远山（贝塞尔起伏）、横向云雾、墨点飞白、暗角收边、朱红印章。

好处：**零图片资产**（不增包体、不依赖 CDN）、**每次不重样**（防打码平台缓存图库）、
**可参数化**（能精确控制字压在什么纹理上，保证始终清晰可辨）。

---

## 部署注意事项

### 多实例部署 ⚠️

`passTokens` 和 `attempts` 存在**进程内存**里。多实例部署时：

- 所有实例必须用**同一个 `CAPTCHA_SECRET`**，否则 A 实例签发的挑战在 B 实例校验会直接失败
- 限流计数各实例独立，实际放行量 = 单实例限制 × 实例数

推荐做法：在前面加一层 nginx 的 `limit_req`，成本最低。
或者把限流换成 Redis 版（`createRateLimiter` 的 `check()` 签名保持不变，替换实现即可）。

如果你需要**跨实例共享凭证**，可以把 `passTokens` 换成 Redis：
在 `core.js` 里把 `passTokens.set/delete/get` 三处换成 Redis 命令即可，其余逻辑不动。

### HTTPS

必须上 HTTPS。否则 token 可被中间人截获重放。

---

## API 参考

### `createCaptcha(config)`

| 方法 | 返回 | 说明 |
|---|---|---|
| `createChallenge()` | `{token, targets, chars, width, height}` | 签发挑战 |
| `verify(token, picks)` | `{ok, passToken?, reason?}` | 校验，`picks` 是 `[{id, ts}]` |
| `consumePassToken(passToken)` | `boolean` | 消费一次性凭证（用即删） |
| `config` | `object` | 当前配置（`secret` 已打码） |

`verify` 的 `reason` 取值与对应文案见 [`REASON_TEXT`](./src/core.js)：

| reason | 含义 |
|---|---|
| `invalid_token` | token 无法解密（篡改 / 换密钥 / 格式错） |
| `invalid_payload` | 解密成功但结构不对 |
| `expired` | 挑战超时 |
| `invalid_picks` | 没提交点击记录 |
| `too_fast` | 全部点击间隔过短，判定为脚本 |
| `too_many_attempts` | 同一挑战尝试次数超限 |
| `mismatch` | 顺序或数量不对 |

### `buildInkBackground({ width, height, seed?, theme? })`

返回完整 `<svg>…</svg>` 字符串。

### `createRateLimiter({ maxKeys? })`

`check(key, limit, windowMs)` → `{allowed, remaining, retryAfterMs}`

### `getClientIp(req)`

兼容 Web 标准 `Request` 与 Node `IncomingMessage`。
读取顺序：`x-forwarded-for` → `x-real-ip` → `cf-connecting-ip` → `x-client-ip` → socket 地址。

---

## 常见问题

**Q：为什么不用 canvas 画字，而要服务端下发 SVG？**
A：用 canvas 意味着字体的渲染依赖客户端环境（有些系统没有宋体），
且字面本身也要从服务端来。既然字面必须下发，那底图顺手一起下发最省事，
也避免客户端多一次渲染开销。

**Q：token 能不能被离线暴力破解？**
A：token 是 AES-256-GCM 密文，密钥由 `sha256("ink-captcha:" + secret)` 派生。
不知道 secret 就无法解密。**secret 泄漏等于验证失效**，请当作密码管理。

**Q：用户点错 5 次之后怎么办？**
A：该挑战作废，前端会自动拉一个新的（组件里内置了 1.1 秒后自动刷新）。

**Q：能挡住专业打码平台吗？**
A：不能，也不打算。打码平台的成本是「每次几厘钱 + 人工/模型成本」，
我们的目标是让这个成本高于你业务的价值。如果你面对的是针对性攻击，
应该叠加风控策略（设备指纹、行为分析、短信二次验证），而不是指望验证码本身。

**Q：无障碍怎么办？**
A：点选式验证码对视觉障碍用户天然不友好。生产环境建议在验证失败 N 次后
提供**语音验证码**或**短信验证**作为替代通道。这是所有图形验证码的共性问题。

---

## 目录结构

```
src/
  core.js             服务端核心（零依赖，只用 node:crypto）
  ink-background.js   底图生成（纯字符串拼接）
  rate-limit.js       内存限流 + IP 提取
  ink-captcha.js      前端组件（原生 JS，Shadow DOM 隔离）
  react.jsx           React 封装（可选）
  index.js            包入口
examples/
  node-http/          纯 node:http 示例
  express/            Express 示例
  nextjs/             Next.js App Router 示例（含服务端单例）
scripts/
  selftest.mjs        36 项自测
  browser-e2e.mjs     Playwright 真实浏览器端到端测试
  preview-sheet.mjs   底图多 seed 对照页生成
```

---

## 测试

```bash
npm test                          # 核心逻辑，36 项，幂等
node scripts/preview-sheet.mjs    # 生成底图对照页
```

自测覆盖：布点不重叠 / 不压边 / 不侵印章 / 目标字分散度 / 字段不泄漏 /
正确顺序通过 / 顺序错 / 数量错 / 篡改 token / 换密钥 / 空 picks /
脚本时序 / 手速快放行 / 超时 / 爆破上限 / 凭证一次性 / 凭证超时 /
底图 SVG 合法性 / seed 可复现 / 多图 id 不冲突 / 限流独立计数 / 配置校验。

---

## License

MIT
