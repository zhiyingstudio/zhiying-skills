# Next.js App Router 接入示例

本目录是一份**最小可运行**的 Next.js 接入示例，覆盖 4 个文件：

```
lib/captcha.ts                        服务端单例（关键：globalThis 缓存）
app/api/captcha/points/route.js       签发挑战
app/api/captcha/points/verify/route.js 校验
app/api/register/route.js             受保护的业务接口（消费一次性凭证）
app/captcha-demo/page.jsx             演示页
```

## 跑起来

```bash
# 1. 先在本仓库根目录把包链接过来
cd ../..            # 回到 ink-captcha 根目录
npm link            # 或直接靠 package.json 里的 file:../.. 引用

# 2. 装依赖并启动
cd examples/nextjs
npm install
echo "CAPTCHA_SECRET=$(node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))')" > .env.local
npm run dev
```

打开 http://localhost:3739/captcha-demo

## 两个必须注意的点

### ① 服务端实例必须单例

`lib/captcha.ts` 里用 `globalThis.__inkCaptcha` 缓存实例。**不要**在每个 route 里
各写一个 `createCaptcha()` —— 那样「签发挑战的实例」和「校验的实例」不是同一个，
已签发的一次性凭证在另一个实例的内存里查不到，用户会遇到「明明点对了却说验证失败」。

### ② client 组件必须动态导入原生脚本

`ink-captcha/browser` 是纯浏览器脚本（会访问 `document`）。在 App Router 里：

- ✅ 在 `"use client"` 组件里 `import { mount } from "ink-captcha/browser"` —— 可以
- ❌ 在 Server Component 里 import —— 会在服务端渲染时炸掉（`document is not defined`）

如果你要用 `<Script>` 标签加载 CDN 版本，那就在 `useEffect` 里等
`window.InkCaptcha` 存在后再挂载：

```jsx
useEffect(() => {
  let timer;
  const tryMount = () => {
    if (window.InkCaptcha) {
      instRef.current = window.InkCaptcha.mount(boxRef.current, { ... });
    } else {
      timer = setTimeout(tryMount, 50);
    }
  };
  tryMount();
  return () => clearTimeout(timer);
}, []);
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `CAPTCHA_SECRET` | ✅ | 用于 AES-256-GCM 加密答案。**换了它，所有在途挑战立即失效**。32 字节随机 hex 即可 |

> ⚠️ 多实例部署时，所有实例必须用**同一个** `CAPTCHA_SECRET`，
> 否则 A 实例签发的挑战在 B 实例校验会直接 `invalid_token`。
> （这是加密方案的固有特性，与业务逻辑无关。）
