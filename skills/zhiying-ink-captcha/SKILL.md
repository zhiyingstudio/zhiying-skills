---
name: zhiying-ink-captcha
display_name: 墨韵点选验证码
display_name_en: Ink CAPTCHA Self-Host
description: "为任意网站接入自研点选式人机验证（注册/发短信/领券等场景）。服务端零依赖、前端零框架、无第三方服务、无备案限制、无费用。含完整源码（可直接拷贝）、node-http/Express/Next.js 三套可运行示例、36 项自测、以及从示例到生产环境的改造清单。当需要加验证码、做人机验证、防批量注册、防薅羊毛、防短信轰炸，或要替换 reCAPTCHA/极验/滑块验证码时使用。触发词：加个验证码、人机验证、防批量注册、防薅羊毛、点选验证、代替 reCAPTCHA、替代极验、自研验证码、captcha、zhiying-ink-captcha。"
description_zh: "自研点选式人机验证：答案顺序 AES-256-GCM 加密下发，服务端零依赖、前端零框架、无备案无费用，含三套可跑示例与 36 项自测。"
description_en: "Self-hosted click-order CAPTCHA: answer sequence encrypted with AES-256-GCM, zero server deps, zero framework, no ICP filing and no fees, with 3 runnable examples and 36 self-tests."
category: 安全工具
version: 1.0.0
author: 宫帅（AI智库）
slug: zhiying-ink-captcha
displayName: "墨韵点选验证码"
summary: "自研点选式人机验证：答案顺序 AES-256-GCM 加密下发，服务端零依赖、前端零框架、无备案无费用，含三套可跑示例与 36 项自测。"
license: MIT
---

# 墨韵点选验证码 · 自研人机验证接入

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

给站点接入**自研**的人机验证，不依赖任何第三方服务（reCAPTCHA / 极验 / 某盾）。

## 为什么用这个而不是现成的

| 方案 | 问题 |
|---|---|
| Google reCAPTCHA | 国内不可达 |
| hCaptcha / Turnstile | 国内访问不稳定；有免费额度上限 |
| 国内商业验证 | 收费；需备案；被逆向得很彻底 |
| 常见开源滑块 | **答案明文下发 → 抓包即破** |

本方案的关键差异：**答案顺序用 AES-256-GCM 加密后下发，响应体只含字面与坐标。**

---

## 何时该用它

**适合**：注册、发送短信验证码、领优惠券/红包、密码重置 ——
低频、高价值、易被脚本滥用的入口。

**不适合**：每次提交表单（会让用户反感）、普通登录（高频，建议「失败 3 次后再出验证码」）。

> 经验值：**注册 + 发短信**两个点加上就够了，覆盖 90% 的滥用场景。

---

## 交付物位置

本 skill 自带完整源码，可直接拷贝进用户项目：

```
payload/ink-captcha/
├── AGENT-INSTALL.md       ★★ 给 AI Agent 的完整安装指令（分框架步骤 + BUG 注意事项 + 自检清单）
├── QUICKSTART.md          人类用户 3 分钟上手
├── MANIFEST.md            全文件清单 + 每个文件用途（脚本生成）
├── src/
│   ├── core.js            服务端核心（零依赖，只 import node:crypto）
│   ├── ink-background.js  底图生成（纯字符串拼接 SVG）
│   ├── rate-limit.js      内存限流 + IP 提取
│   ├── ink-captcha.js     前端组件（原生 JS，Shadow DOM 隔离）
│   ├── react.jsx          React 封装（可选）
│   ├── index.js           ESM 入口
│   └── index.cjs          CJS 入口（异步）
├── examples/
│   ├── node-http/         纯 node:http 示例（零依赖）
│   ├── express/           Express 示例
│   └── nextjs/            Next.js App Router 示例（含服务端单例）
├── scripts/
│   ├── selftest.mjs       36 项自测
│   ├── verify-install.mjs ★ 安装后自检（可检出 6 类常见安装错误）
│   ├── browser-e2e.mjs    Playwright 真实浏览器端到端
│   ├── preview-sheet.mjs  底图多 seed 对照页
│   └── make-manifest.mjs  清单生成器
├── docs/
│   ├── 接入指南.md        生产环境改造清单
│   ├── 安全说明.md        威胁模型 + 明确不防的攻击
│   └── FAQ.md
├── start.sh               一键跑起来（无需装依赖）
├── README.md
└── LICENSE                MIT
```

> **想省事**：直接把 `AGENT-INSTALL.md` 全文读进上下文，按它执行即可，无需再读其他文档。
> `AGENT-INSTALL.md` 是自解释的 —— 目标读者就是 Agent，已包含分框架步骤、必改点、BUG 注意事项、自检清单。

### 安装后必跑自检

拷完代码后，在用户项目根目录执行：

```bash
node payload/ink-captcha/scripts/verify-install.mjs <用户项目根目录>
```

它会静态检查 6 类最常见的安装错误（退出码 1 = 有关键问题）：
1. 服务端核心文件缺失 / 包解析不到
2. `createCaptcha()` 不是单例（写在函数体内）→ 用户验证通过后提交仍失败
3. 业务接口没调 `consumePassToken` → 防护等于装饰品
4. `secret` 被硬编码到前端目录 → 可被 DevTools 拿到
5. 抽题用了 `Math.random`（必须 `crypto.randomInt`）
6. `isTarget` 字段可能随响应下发

**注意**：该脚本只做静态检查，**不能替代真实点击的端到端验证**。

---

## 接入流程（按顺序执行）

### 第 0 步：先跑通，再改造

```bash
cd payload/ink-captcha
bash start.sh
# 打开 http://localhost:3737，亲手点一次验证码确认能过
```

`start.sh` 会先跑 36 项自测再启动服务。**自测不过就不要往下走。**

### 第 1 步：判断用户项目属于哪种框架

```bash
# 看 package.json 的 dependencies
grep -E '"(next|express|koa|fastify|hono)"' package.json
```

- 有 `next` → 抄 `examples/nextjs/`
- 有 `express` → 抄 `examples/express/`
- 其他 / 纯 Node → 抄 `examples/node-http/`

### 第 2 步：拷贝核心代码

```bash
# 服务端核心
mkdir -p <项目>/src/lib/captcha
cp payload/ink-captcha/src/core.js          <项目>/src/lib/captcha/
cp payload/ink-captcha/src/ink-background.js <项目>/src/lib/captcha/
cp payload/ink-captcha/src/rate-limit.js     <项目>/src/lib/captcha/

# 前端组件
cp payload/ink-captcha/src/ink-captcha.js    <项目>/public/
```

> 前端组件也可以走 CDN / 打包。放 `public/` 最省事，`<script src="/ink-captcha.js">` 即可。

### 第 3 步：改造三个必改点 ⚠️

这三条是**最容易漏、漏了就等于没接**的地方。

#### ① secret 必须来自环境变量

```js
// ❌ 示例写法（仅本地演示用）
const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET || crypto.randomBytes(32).toString("hex") });

// ✅ 生产写法
const secret = process.env.CAPTCHA_SECRET;
if (!secret) throw new Error("缺少 CAPTCHA_SECRET，进程不应启动");
const captcha = createCaptcha({ secret });
```

**为什么**：示例里的 `|| crypto.randomBytes(...)` 会导致**每次冷启动 secret 都变**，
所有在途挑战立即失效，用户会遇到「刚点完就提示验证过期」。

生成一个：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### ② 必须做服务端单例

```js
// ❌ 错误：每个 route 各建一个 —— 签发实例和校验实例内存不互通
export async function POST(req) {
  const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET });
  ...
}

// ✅ 正确：模块单例
// lib/captcha.js
export const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET });
```

Next.js 开发模式热重载会重建模块，再加一层 `globalThis` 缓存：

```js
const g = globalThis;
export const captcha = (g.__inkCaptcha ??= createCaptcha({ secret: process.env.CAPTCHA_SECRET })).captcha;
```

#### ③ 业务接口必须消费凭证

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

**这是最高频的漏点**。现象是「验证码明明能过，脚本还是能绕过」。

> 自查方法：全局搜 `consumePassToken`，确认它出现在**每一个**你希望被保护的接口里。

### 第 4 步：挂载前端

**原生 JS**（推荐给非 React 项目）：

```html
<div id="captcha"></div>
<script src="/ink-captcha.js"></script>
<script>
  const inst = InkCaptcha.mount(document.getElementById("captcha"), {
    endpoint: "/api/captcha/points",
    verifyEndpoint: "/api/captcha/points/verify",
    onVerified: (passToken) => {
      window.__captchaToken = passToken;
      document.getElementById("submitBtn").disabled = false;
    },
    onStateChange: ({ verified }) => {
      if (!verified) {
        window.__captchaToken = null;
        document.getElementById("submitBtn").disabled = true;
      }
    },
  });
</script>
```

**React**：

```jsx
import { PointsCaptcha } from "@/lib/ink-captcha/react";
// 或从 public 动态加载原生脚本后用 mount()
```

> ⚠️ App Router 下 `ink-captcha.js` 是纯浏览器脚本（访问 `document`），
> **不能**在 Server Component 里 import，必须放在 `"use client"` 组件或 `<Script>` 里。

---

## 安全模型（向用户解释时用这套说法）

### 核心：答案顺序绝不明文下发

```
① GET /api/captcha/points
   服务端：随机抽 4 目标字 + 4 干扰字 → 随机布点
          → 把「正确点击顺序」用 AES-256-GCM 加密成 token
   响应：{ token, targets:["春","风","得","意"], chars:[{id,char,x,y,rotate,size}], bg }
          ↑ 只有字面 + 坐标 —— 这是题目本身，人类必须看见才能作答

② 用户点 4 下 → POST verify
   body：{ token, picks:[{id, ts}] }

③ 服务端解密比对（timingSafeEqual）→ 通过则签发一次性 passToken

④ 业务接口 consumePassToken() 校验并立即删除
```

### 「答案就在响应体里」为什么不算漏洞

底图上的字必须让用户看见，否则无法作答 —— 这与「藏答案」天然冲突。

**真正拦住脚本的是四件套**：

| 防护 | 实现 | 效果 |
|---|---|---|
| 必须走完整流程 | 不能跳过签发直接提交 | 挡直接构造请求 |
| 一次性凭证 | `delete()` 先删后校验 | 挡重放 |
| 单挑战尝试上限 | 默认 5 次 | 8 选 4 有序组合 1680 种，命中率 0.3% |
| IP 限流 | 签发 60/分、校验 20/分 | 挡批量刷 |

外加**时序判据**（全部点击间隔 <60ms 判脚本，辅助信号）：

```js
canvas.addEventListener("touchend", ...)  // 触屏用 touchend 避免 300ms 延迟
```

> **不要让用户为了「藏字」牺牲可读性**。那会把真人挡在门外，脚本照样用打码平台过。

---

## 配置项速查

```js
const captcha = createCaptcha({
  secret: process.env.CAPTCHA_SECRET,   // 必填

  width: 320, height: 200,     // 画布逻辑尺寸
  targetCount: 4,              // 要按顺序点的字数
  distractorCount: 4,          // 干扰字数
  minCenterGap: 50,            // 字之间最小中心距（防重叠）
  hitRadius: 26,               // 命中判定半径
  challengeMaxAgeMs: 300000,   // 挑战时效 5 分钟
  passMaxAgeMs: 300000,        // 凭证时效 5 分钟
  maxAttempts: 5,              // 单挑战最多尝试次数
  minHumanStepMs: 60,          // 时序判据阈值

  charPool: ["春","风","得","意", /* ...至少 targetCount + distractorCount 个 */],
});
```

### 换题库的三条原则

1. **字形差异要大** —— 避开这些易混对：
   `日/曰` `未/末` `己/已/巳` `干/千` `天/夭` `戌/戍/戊` `拔/拨`
2. **用常用字** —— 生僻字让用户盯半天，体验差且不增加安全性
3. **长度留 3 倍冗余** —— 否则同一用户短时间反复见同样的字

### 底图主题

```js
buildInkBackground({ width: 320, height: 200 });                 // 宣纸
buildInkBackground({ width: 320, height: 200, theme: "dark" });  // 墨夜
buildInkBackground({ width: 320, height: 200, seed: 12345 });    // 固定 seed 可复现
```

---

## 必守规则（踩过的坑）

### 1. 坐标换算必须用实测渲染宽度

```js
// ✅ 必须这样
const rect = canvas.getBoundingClientRect();
const ratio = rect.width > 0 ? logicalWidth / rect.width : 1;
const lx = (e.clientX - rect.left) * ratio;

// ❌ 绝对不能这样 —— transform:scale 的实际渲染宽度受亚像素舍入影响，
//    推断值会带来系统偏差（曾在滑块版上恒定错位 15px）
const ratio = 1 / scaleState;
```

### 2. 加接口前先 grep 全站是否已有同名实现

如果站点已有验证码（比如滑块版），**先确认是「唯一公共组件」再动** ——
改一处等于改所有接入页。

### 3. 验证「生效」的唯一可靠手段 = 读线上实际表现

不看响应体有没有字段、不看 HTTP 200。要读：
- 浏览器里组件的实际 DOM 状态
- 数据库落库结果
- 余额/积分变化

### 4. 多实例部署必须共享 secret

否则用户在 A 实例拿的挑战，被负载均衡到 B 实例会直接 `invalid_token` —— **间歇性失败，极难排查**。

限流按进程计数，3 个实例 = 实际放行量 ×3。最省事的补法是前置 nginx：

```nginx
limit_req_zone $binary_remote_addr zone=captcha_issue:10m rate=1r/s;
limit_req_zone $binary_remote_addr zone=captcha_verify:10m rate=0.5r/s;

location = /api/captcha/points        { limit_req zone=captcha_issue burst=5 nodelay;  proxy_pass http://backend; }
location = /api/captcha/points/verify { limit_req zone=captcha_verify burst=10 nodelay; proxy_pass http://backend; }
```

---

## 排障速查

| 现象 | 原因 | 解法 |
|---|---|---|
| 点对了但提交说「验证未通过」 | 没调 `consumePassToken()` | 第 3 步-③ |
| 点对了但提交说「验证未通过」 | `createCaptcha` 不是单例 | 第 3 步-② |
| 频繁「验证已过期」 | secret 每次重启都变 | 第 3 步-① |
| 间歇性验证失败 | 多实例 secret 不一致 | 见上方铁律 4 |
| **一直报 `mismatch`，点对了也没用（自写前端时）** | **`picks` 发的是 `{x,y}` 坐标，服务端要的是 `{id,ts}`** | 见 `references/core-api.md` 的 `Pick` 类型说明 —— 命中判定必须在客户端做，取字形 `id` 发上来 |
| 「操作过快」 | 点击间隔全 <60ms | 真人不会；测试脚本加 `waitForTimeout(300)` |
| 组件不显示 | 脚本没加载 / 容器不存在 | 查控制台 + 确认 `<div id>` 存在 |
| 验证码和别处元素重叠 | 缩放后容器高度没撑开 | 给挂载容器独立一行，别放固定高 flex 里 |
| 用户老点错 | 题库有易混字 / 字号小 | 见「换题库三原则」 |
| 多验证码同页互相覆盖 | （已解决）渐变 id 已用 seed 加前缀 | — |

---

## 上线检查清单

- [ ] `CAPTCHA_SECRET` 来自环境变量，启动时校验非空
- [ ] secret 已加入密钥管理，**没提交进 git**
- [ ] `createCaptcha()` 是模块单例
- [ ] 每个受保护接口都调了 `consumePassToken()`
- [ ] 全站 HTTPS
- [ ] 挑战接口发了 `Cache-Control: no-store`
- [ ] 限流已生效（`for i in {1..30}; do curl ...; done` 看是否出 429）
- [ ] 验证失败后前端能自动重置（手动点错试一次）
- [ ] 多实例时 secret 一致（`kubectl exec` 进去 `echo $CAPTCHA_SECRET` 比对）
- [ ] 移动端实测：iOS Safari / 微信内置浏览器 / 安卓 Chrome
- [ ] 窄屏（320px）实测无溢出
- [ ] 想清楚「验证码接口挂了要不要放行」（见下）

### 「验证码接口挂了要不要放行」怎么选

- **放行**：可用性优先。注册不中断，但短暂裸奔
- **拦截**：安全优先。宁可暂停注册

**推荐折中**：接口连续失败 N 次后自动降级放行 + 打日志告警。既不挡死用户，你也能第一时间知道出事。

---

## 明确不防的攻击（要跟用户讲清楚，别过度承诺）

| 攻击 | 说明 | 应对 |
|---|---|---|
| 打码平台 | 模型/人工识别，所有图形验证码都防不住 | 把成本转嫁给攻击者（已做到）+ 业务风控 |
| 真人众包 | 打码农场 | 只能靠设备指纹、注册速度异常告警 |
| 分布式低频 | 1000 IP 各试 1 次绕过限流 | 账号维度限制、设备指纹 |
| secret 泄漏 | 可离线伪造任意 token | 密钥管理、定期轮换（注意轮换会让在途挑战全失效） |
| 无 HTTPS | token 可被截获重放 | **必须上 HTTPS** |
| 无障碍 | 视觉障碍用户无法点选 | 提供替代通道（语音验证码/短信），这是产品缺陷不是安全漏洞 |

---

## 参考文档

| 文档 | 内容 |
|---|---|
| `payload/ink-captcha/README.md` | 30 秒上手 + API 参考 |
| `payload/ink-captcha/docs/接入指南.md` | 生产改造清单、多实例部署、用户改错名字怎么办 |
| `payload/ink-captcha/docs/安全说明.md` | 威胁模型、五层防护强度量化、明确不防的攻击 |
| `payload/ink-captcha/docs/FAQ.md` | 集成/安全/体验/开发四类问题 |
| `references/core-api.md` | 本 skill 附的核心 API 速查 |

`LICENSE` 是 MIT，可商用。交付给用户时**保留 LICENSE 文件**。


---

## 效果预览

![效果预览](https://raw.githubusercontent.com/zhiyingstudio/zhiying-skills/main/skills/zhiying-ink-captcha/preview.jpg)

*上图为本技能的效果预览：真实界面演示或能力概览卡。安装后按 SKILL.md 指引即可复现同等效果。*
