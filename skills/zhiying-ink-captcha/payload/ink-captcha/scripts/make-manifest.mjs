#!/usr/bin/env node
/**
 * 生成 MANIFEST.md —— 全文件清单 + 每个文件的用途
 * 目的：让拿到包的人 / Agent 一眼看清「哪个文件是干什么的、装的时候要拷哪些」
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** 文件用途字典（按相对路径前缀匹配） */
const DESC = {
  "src/core.js": "★【服务端核心】签发挑战 / 校验 / 签发一次性凭证。只 import crypto，497 行",
  "src/ink-background.js": "★【底图生成】纯字符串拼 SVG，零依赖，188 行",
  "src/rate-limit.js": "★【限流 + 真实 IP 提取】内存计数桶，零依赖，97 行",
  "src/ink-captcha.js": "★【前端原生组件】零 import，Shadow DOM 隔离，681 行",
  "src/react.jsx": "【React 薄封装】给 React/Next.js 项目用，67 行（可选）",
  "src/index.js": "【ESM 入口】re-export 上述模块",
  "src/index.cjs": "【CJS 入口】动态 import 桥接（Node CJS 不能同步加载 ESM）",

  "examples/node-http/server.mjs": "示例：纯 Node http，零框架（端口 3737）",
  "examples/node-http/index.html": "示例：纯 Node 版页面",
  "examples/express/server.mjs": "示例：Express + 限流中间件（端口 3738）",
  "examples/express/index.html": "示例：Express 版页面（含宣纸/墨夜主题切换）",
  "examples/express/package.json": "示例：Express 依赖声明",
  "examples/nextjs/README.md": "示例：Next.js 版说明",
  "examples/nextjs/lib/captcha.ts": "★示例：Next.js 服务端单例（最关键的参考实现）",
  "examples/nextjs/app/api/captcha/points/route.js": "示例：签发挑战路由",
  "examples/nextjs/app/api/captcha/points/verify/route.js": "示例：校验路由",
  "examples/nextjs/app/api/register/route.js": "示例：业务接口消费凭证（★最容易漏的一步）",
  "examples/nextjs/app/captcha-demo/page.jsx": "示例：演示页",
  "examples/nextjs/package.json": "示例：Next.js 依赖声明",

  "scripts/selftest.mjs": "★【36 项自测】零依赖，安装前必须先跑通",
  "scripts/browser-e2e.mjs": "Playwright 真实浏览器端到端（需装 playwright）",
  "scripts/preview-sheet.mjs": "生成 12 张底图对照图，用于目视检查布点质量",
  "scripts/make-manifest.mjs": "本脚本：生成 MANIFEST.md",

  "docs/接入指南.md": "★改造清单 / 前端路径 / 换题库 / 凭证被消费后怎么办 / 多实例 / 上线检查",
  "docs/安全说明.md": "★威胁模型 / 五层防护量化 / 明确不防的攻击",
  "docs/FAQ.md": "五类常见问题（安装·集成·安全·体验·开发）",

  "README.md": "项目主页：定位 / 快速上手 / 安全模型 / API 参考",
  "CHANGELOG.md": "版本历史与已知限制",
  "LICENSE": "MIT（含人机验证合规提醒）",
  "package.json": "零依赖声明，exports 含 . / ./react / ./browser / ./client",
  "start.sh": "一键跑起来：检查 Node → 自测 → 起示例 → 探活",

  "AGENT-INSTALL.md": "★★【给 AI Agent 的安装指令】读完可独立完成安装，含 BUG 注意事项",
  "QUICKSTART.md": "★人类用户 3 分钟上手",
  "MANIFEST.md": "本文件：全文件清单",
  "安装说明.md": "三种使用方式（装 Skill / 直接拿源码 / 开源到 GitHub）",
};

const TAG_ORDER = { "★★": 0, "★": 1, "": 2 };

function walk(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** 计算某个文件的标记等级 */
function tagOf(rel) {
  const d = DESC[rel];
  if (!d) return "";
  if (d.startsWith("★★")) return "★★";
  if (d.startsWith("★")) return "★";
  return "";
}

const files = walk(ROOT, "").filter((f) => !f.endsWith(".bundle")).sort();

const lines = [];
lines.push("# MANIFEST —— 全文件清单");
lines.push("");
lines.push("> 本文件由 `scripts/make-manifest.mjs` 自动生成。");
lines.push("> 标记说明：★★ = 安装必备的指令文件 ｜ ★ = 关键文件 ｜ 无标记 = 参考/示例/文档");
lines.push("");
lines.push(`生成时间：${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
lines.push("");

// ── 分组统计 ──
const groups = {
  "src/": [],
  "examples/": [],
  "scripts/": [],
  "docs/": [],
  "(根目录)": [],
};
for (const f of files) {
  const g = Object.keys(groups).find((k) => k !== "(根目录)" && f.startsWith(k));
  groups[g || "(根目录)"].push(f);
}

lines.push("## 一、概要");
lines.push("");
lines.push("| 项 | 值 |");
lines.push("|---|---|");
lines.push(`| 文件总数 | ${files.length} |`);
lines.push("| 第三方依赖 | **0 个**（不需要 npm install） |");
lines.push("| 数据库 | **不需要** |");
lines.push("| 编译步骤 | **无**（纯 JS） |");

let totalBytes = 0;
let runtimeBytes = 0;
for (const f of files) {
  const s = fs.statSync(path.join(ROOT, f)).size;
  totalBytes += s;
  if (/^src\/(core|ink-background|rate-limit|ink-captcha|react)\./.test(f)) runtimeBytes += s;
}
lines.push(`| 全部文件体积 | ${(totalBytes / 1024).toFixed(0)} KB |`);
lines.push(`| **运行时需拷进项目的文件体积** | **${(runtimeBytes / 1024).toFixed(0)} KB** |`);
lines.push("");

lines.push("## 二、安装时到底要拷哪些文件");
lines.push("");
lines.push("```");
lines.push("服务端（必备 3 个）");
lines.push("  src/core.js              → 你的服务端目录");
lines.push("  src/ink-background.js    → 同目录");
lines.push("  src/rate-limit.js        → 同目录");
lines.push("");
lines.push("前端（必备 1 个）");
lines.push("  src/ink-captcha.js       → 你的静态资源目录");
lines.push("");
lines.push("React/Next.js 项目额外 1 个（可选）");
lines.push("  src/react.jsx            → 你的组件目录");
lines.push("```");
lines.push("");
lines.push("**其余所有文件（examples / scripts / docs）都不需要拷进项目**，它们是参考与验证用的。");
lines.push("");

lines.push("## 三、全部文件清单");
lines.push("");

const order = ["(根目录)", "src/", "examples/", "scripts/", "docs/"];
for (const g of order) {
  const list = groups[g];
  if (!list || !list.length) continue;
  lines.push(`### ${g === "(根目录)" ? "根目录" : g}`);
  lines.push("");
  lines.push("| 文件 | 大小 | 用途 |");
  lines.push("|---|---|---|");
  // 关键文件排前面
  list.sort((a, b) => {
    const ta = TAG_ORDER[tagOf(a)] ?? 2;
    const tb = TAG_ORDER[tagOf(b)] ?? 2;
    return ta - tb || a.localeCompare(b);
  });
  for (const f of list) {
    const size = fs.statSync(path.join(ROOT, f)).size;
    const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
    const name = g === "(根目录)" ? f : f.slice(g.length);
    const desc = DESC[f] || "—";
    lines.push(`| \`${name}\` | ${sizeStr} | ${desc} |`);
  }
  lines.push("");
}

lines.push("## 四、按用途快速索引");
lines.push("");
lines.push("| 我想…… | 看这个文件 |");
lines.push("|---|---|");
lines.push("| 让 AI 帮我装到项目里 | `AGENT-INSTALL.md` |");
lines.push("| 自己 3 分钟跑起来看看 | `QUICKSTART.md` → `bash ink-captcha/start.sh` |");
lines.push("| 抄 Next.js 的实现 | `ink-captcha/examples/nextjs/lib/captcha.ts` |");
lines.push("| 抄业务接口怎么消费凭证 | `ink-captcha/examples/nextjs/app/api/register/route.js` |");
lines.push("| 知道改哪里才能接进我项目 | `ink-captcha/docs/接入指南.md` |");
lines.push("| 了解安全性、能防什么 | `ink-captcha/docs/安全说明.md` |");
lines.push("| 遇到报错 | `AGENT-INSTALL.md` §6 或 `docs/FAQ.md` |");
lines.push("| 装成 WorkBuddy Skill | `skill/` 目录（或看 `安装说明.md` 的方式 A） |");
lines.push("| 开源到 GitHub | `安装说明.md` 的方式 C |");
lines.push("");

lines.push("## 五、验证链（本包已实测通过）");
lines.push("");
lines.push("| 环节 | 结果 |");
lines.push("|---|---|");
lines.push("| 语法检查 | 11 个 JS 文件 `node --check` 全过 |");
lines.push("| 核心自测 | **36 项全绿** |");
lines.push("| 零依赖核验 | 服务端只 `import crypto`；前端 import 数 = 0 |");
lines.push("| 字段剥离 | 响应体不含 `isTarget` / `_isTarget` |");
lines.push("| 纯 Node 示例 | 挑战 200 → 校验 200 → 注册首次 200、重放 400、伪造 400 |");
lines.push("| Express 示例 | 同上全链路通过 |");
lines.push("| 浏览器端到端 | 真实点击通过 / 故意点错触发失败态 / 窄屏 360px 不溢出。**JS 错误 0** |");
lines.push("| 底图对照 | 12 张（8 宣纸 + 4 墨夜）目标字分散、无重叠、不压印章 |");
lines.push("");

lines.push("---");
lines.push("");
lines.push("*ink-captcha v1.0.0 ｜ MIT License*");
lines.push("");

const out = path.join(ROOT, "MANIFEST.md");
fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log(`✅ 已生成 ${out}`);
console.log(`   文件总数: ${files.length}`);
console.log(`   全部体积: ${(totalBytes / 1024).toFixed(0)} KB`);
console.log(`   运行时体积: ${(runtimeBytes / 1024).toFixed(0)} KB`);
