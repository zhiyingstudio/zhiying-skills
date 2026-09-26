# QUICKSTART —— 3 分钟跑起来

> 人类用户看这里。想让 AI 帮你装 → 把整个包发给它，让它读 `AGENT-INSTALL.md`。

---

## 最快路径：先看它长什么样

```bash
cd ink-captcha
bash start.sh
```

这一条命令会自动：检查 Node 版本 → 跑 36 项自测 → 起一个真实示例 → 探活。
然后浏览器打开 **http://localhost:3737**，你会看到一个能真实点选验证的表单。

> 需要 **Node ≥ 18**。不需要 `npm install`（零依赖）。

---

## 我想装到我自己的网站上

### 第 1 步：判断你的项目

| 你的项目 | 怎么做 |
|---|---|
| **Next.js** | 直接对照 `examples/nextjs/` 抄，那是完整能跑的范例 |
| **Express** | 对照 `examples/express/` |
| **其他 Node 框架**（Fastify/Koa/Hono） | 逻辑照抄 `examples/node-http/`，只换框架写法 |
| **PHP / WordPress / 静态站** | 起一个独立 Node 小服务，nginx 反代 `/api/captcha/*` |
| **纯静态无后端** | ⚠️ 防护不成立，先看 `AGENT-INSTALL.md` §3.5 |

### 第 2 步：只拷 4 个文件

```bash
# 服务端（3 个）
src/core.js            → 你的服务端目录
src/ink-background.js  → 同目录
src/rate-limit.js      → 同目录

# 前端（1 个）
src/ink-captcha.js     → 你的静态资源目录
```

### 第 3 步：写 2 个接口

- `GET  /api/captcha/points` → 返回 `captcha.createChallenge()`
- `POST /api/captcha/points/verify` → `captcha.verify(token, picks)`

（完整代码在 `AGENT-INSTALL.md` §3.1，可直接复制）

### 第 4 步：❗ 在你的业务接口里消费凭证

```js
if (!captcha.consumePassToken(body.passToken)) {
  return res.status(400).json({ success: false, error: "人机验证已失效" });
}
```

**这步漏了等于没装。**

### 第 5 步：前端挂上

```html
<div id="captcha-box"></div>
<script src="/ink-captcha.js"></script>
<script>
  InkCaptcha.mount(document.getElementById("captcha-box"), {
    onVerified: function (passToken) { window.__passToken = passToken; },
  });
</script>
```

### 第 6 步：设密钥

```bash
# .env
CAPTCHA_SECRET=（跑下面命令生成一个）
```
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## 装完怎么确认真的生效了？

**别看接口返回 200 就以为好了。** 真实测这三件事：

1. 页面上**真能看到底图**（不是白块），点字有反馈
2. 点对 → 提交 → **业务真的成功了**
3. **同一个凭证再提交一次 → 必须失败**（重放防护）

---

## 它占多少空间？

| 项 | 数值 |
|---|---|
| 要拷进项目的文件 | 4–5 个，**57KB** |
| 用户实际下载（gzip） | **8.6KB** |
| 第三方依赖 | **0 个** |
| 数据库 | **不需要** |
| 服务器内存（5000 并发） | **0.10MB** |
| 完整仓库 | 608KB |

---

## 常见问题

**Q: 报 `Cannot find module 'crypto'`？**
A: Node 版本太低，升到 ≥ 18。

**Q: 验证通过后提交还是说失效？**
A: 99% 是服务端没做单例。看 `AGENT-INSTALL.md` §6.1。

**Q: 点了正确的字但判错？**
A: 坐标换算问题。如果你重写过点击处理，看 §6.2。

**Q: 能不用 Node 吗？**
A: 不能。校验逻辑必须有服务端（要保密钥）。看 §3.4 的替代方案。

**Q: 多台服务器部署会出问题吗？**
A: 会，`CAPTCHA_SECRET` 必须所有实例一致。看 §6.6。

---

## 更多文档

| 想知道什么 | 看哪 |
|---|---|
| 完整安装指令（含各框架） | `AGENT-INSTALL.md` |
| 安全模型、能防什么不能防什么 | `ink-captcha/docs/安全说明.md` |
| 改造清单、上线检查 | `ink-captcha/docs/接入指南.md` |
| 项目定位、为什么再造轮子 | `ink-captcha/README.md` |
| 常见问题 FAQ | `ink-captcha/docs/FAQ.md` |

---

*ink-captcha v1.0.0 ｜ MIT*
