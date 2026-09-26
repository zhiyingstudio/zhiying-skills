# MANIFEST —— 全文件清单

> 本文件由 `scripts/make-manifest.mjs` 自动生成。
> 标记说明：★★ = 安装必备的指令文件 ｜ ★ = 关键文件 ｜ 无标记 = 参考/示例/文档

生成时间：2026-09-24 03:14

## 一、概要

| 项 | 值 |
|---|---|
| 文件总数 | 37 |
| 第三方依赖 | **0 个**（不需要 npm install） |
| 数据库 | **不需要** |
| 编译步骤 | **无**（纯 JS） |
| 全部文件体积 | 239 KB |
| **运行时需拷进项目的文件体积** | **59 KB** |

## 二、安装时到底要拷哪些文件

```
服务端（必备 3 个）
  src/core.js              → 你的服务端目录
  src/ink-background.js    → 同目录
  src/rate-limit.js        → 同目录

前端（必备 1 个）
  src/ink-captcha.js       → 你的静态资源目录

React/Next.js 项目额外 1 个（可选）
  src/react.jsx            → 你的组件目录
```

**其余所有文件（examples / scripts / docs）都不需要拷进项目**，它们是参考与验证用的。

## 三、全部文件清单

### 根目录

| 文件 | 大小 | 用途 |
|---|---|---|
| `AGENT-INSTALL.md` | 29.2 KB | ★★【给 AI Agent 的安装指令】读完可独立完成安装，含 BUG 注意事项 |
| `QUICKSTART.md` | 3.8 KB | ★人类用户 3 分钟上手 |
| `.github/workflows/ci.yml` | 3.4 KB | — |
| `.gitignore` | 277 B | — |
| `CHANGELOG.md` | 2.8 KB | 版本历史与已知限制 |
| `LICENSE` | 1.5 KB | MIT（含人机验证合规提醒） |
| `MANIFEST.md` | 5.7 KB | 本文件：全文件清单 |
| `package.json` | 1.1 KB | 零依赖声明，exports 含 . / ./react / ./browser / ./client |
| `README.md` | 13.6 KB | 项目主页：定位 / 快速上手 / 安全模型 / API 参考 |
| `start.sh` | 2.7 KB | 一键跑起来：检查 Node → 自测 → 起示例 → 探活 |

### src/

| 文件 | 大小 | 用途 |
|---|---|---|
| `core.js` | 18.9 KB | ★【服务端核心】签发挑战 / 校验 / 签发一次性凭证。只 import crypto，497 行 |
| `ink-background.js` | 8.2 KB | ★【底图生成】纯字符串拼 SVG，零依赖，188 行 |
| `ink-captcha.js` | 26.7 KB | ★【前端原生组件】零 import，Shadow DOM 隔离，681 行 |
| `rate-limit.js` | 2.9 KB | ★【限流 + 真实 IP 提取】内存计数桶，零依赖，97 行 |
| `index.cjs` | 1.9 KB | 【CJS 入口】动态 import 桥接（Node CJS 不能同步加载 ESM） |
| `index.js` | 1.1 KB | 【ESM 入口】re-export 上述模块 |
| `react.jsx` | 1.9 KB | 【React 薄封装】给 React/Next.js 项目用，67 行（可选） |

### examples/

| 文件 | 大小 | 用途 |
|---|---|---|
| `nextjs/lib/captcha.ts` | 1.7 KB | ★示例：Next.js 服务端单例（最关键的参考实现） |
| `express/index.html` | 5.9 KB | 示例：Express 版页面（含宣纸/墨夜主题切换） |
| `express/package.json` | 241 B | 示例：Express 依赖声明 |
| `express/server.mjs` | 4.3 KB | 示例：Express + 限流中间件（端口 3738） |
| `nextjs/app/api/captcha/points/route.js` | 1.2 KB | 示例：签发挑战路由 |
| `nextjs/app/api/captcha/points/verify/route.js` | 1.1 KB | 示例：校验路由 |
| `nextjs/app/api/register/route.js` | 1001 B | 示例：业务接口消费凭证（★最容易漏的一步） |
| `nextjs/app/captcha-demo/page.jsx` | 3.8 KB | 示例：演示页 |
| `nextjs/package.json` | 452 B | 示例：Next.js 依赖声明 |
| `nextjs/README.md` | 2.4 KB | 示例：Next.js 版说明 |
| `node-http/index.html` | 4.6 KB | 示例：纯 Node 版页面 |
| `node-http/server.mjs` | 6.3 KB | 示例：纯 Node http，零框架（端口 3737） |

### scripts/

| 文件 | 大小 | 用途 |
|---|---|---|
| `selftest.mjs` | 12.5 KB | ★【36 项自测】零依赖，安装前必须先跑通 |
| `browser-e2e.mjs` | 8.5 KB | Playwright 真实浏览器端到端（需装 playwright） |
| `make-manifest.mjs` | 9.3 KB | 本脚本：生成 MANIFEST.md |
| `preview-sheet.mjs` | 3.3 KB | 生成 12 张底图对照图，用于目视检查布点质量 |
| `verify-install.mjs` | 18.1 KB | — |

### docs/

| 文件 | 大小 | 用途 |
|---|---|---|
| `安全说明.md` | 10.0 KB | ★威胁模型 / 五层防护量化 / 明确不防的攻击 |
| `接入指南.md` | 10.0 KB | ★改造清单 / 前端路径 / 换题库 / 凭证被消费后怎么办 / 多实例 / 上线检查 |
| `FAQ.md` | 8.6 KB | 五类常见问题（安装·集成·安全·体验·开发） |

## 四、按用途快速索引

| 我想…… | 看这个文件 |
|---|---|
| 让 AI 帮我装到项目里 | `AGENT-INSTALL.md` |
| 自己 3 分钟跑起来看看 | `QUICKSTART.md` → `bash ink-captcha/start.sh` |
| 抄 Next.js 的实现 | `ink-captcha/examples/nextjs/lib/captcha.ts` |
| 抄业务接口怎么消费凭证 | `ink-captcha/examples/nextjs/app/api/register/route.js` |
| 知道改哪里才能接进我项目 | `ink-captcha/docs/接入指南.md` |
| 了解安全性、能防什么 | `ink-captcha/docs/安全说明.md` |
| 遇到报错 | `AGENT-INSTALL.md` §6 或 `docs/FAQ.md` |
| 装成 WorkBuddy Skill | `skill/` 目录（或看 `安装说明.md` 的方式 A） |
| 开源到 GitHub | `安装说明.md` 的方式 C |

## 五、验证链（本包已实测通过）

| 环节 | 结果 |
|---|---|
| 语法检查 | 11 个 JS 文件 `node --check` 全过 |
| 核心自测 | **36 项全绿** |
| 零依赖核验 | 服务端只 `import crypto`；前端 import 数 = 0 |
| 字段剥离 | 响应体不含 `isTarget` / `_isTarget` |
| 纯 Node 示例 | 挑战 200 → 校验 200 → 注册首次 200、重放 400、伪造 400 |
| Express 示例 | 同上全链路通过 |
| 浏览器端到端 | 真实点击通过 / 故意点错触发失败态 / 窄屏 360px 不溢出。**JS 错误 0** |
| 底图对照 | 12 张（8 宣纸 + 4 墨夜）目标字分散、无重叠、不压印章 |

---

*ink-captcha v1.0.0 ｜ MIT License*
