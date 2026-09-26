#!/usr/bin/env node
/**
 * verify-install.mjs —— 安装后自检（给 Agent 用）
 *
 * 用法：
 *   node scripts/verify-install.mjs <目标项目根目录>
 *
 * 它会检查：
 *   1. 必需文件是否都拷过去了
 *   2. 目标项目里 createCaptcha 是否被正确初始化为单例
 *   3. 是否设置了 CAPTCHA_SECRET
 *   4. 是否在业务接口里调用了 consumePassToken
 *   5. 是否误把 secret 硬编码在前端
 *
 * 输出：一份 ✅/❌/⚠️ 报告 + 退出码（0=全过，1=有关键问题）
 */
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("用法: node scripts/verify-install.mjs <目标项目根目录>");
  process.exit(2);
}

const ROOT = path.resolve(target);
if (!fs.existsSync(ROOT)) {
  console.error(`❌ 目标目录不存在: ${ROOT}`);
  process.exit(2);
}

const results = [];
const record = (level, title, detail) => results.push({ level, title, detail });

/** 递归收集所有源码文件（跳过 node_modules/.git/dist/.next） */
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo"]);
function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const allFiles = walk(ROOT);
const readIfText = (f) => {
  const base = path.basename(f);
  if (!/\.(js|jsx|mjs|cjs|ts|tsx|json|html|env|sh|yml|yaml|conf|ini)$/.test(base) && !base.startsWith(".env")) return null;
  try {
    const st = fs.statSync(f);
    if (st.size > 2 * 1024 * 1024) return null;   // 跳过超大文件
    return fs.readFileSync(f, "utf8");
  } catch { return null; }
};

/**
 * 判断某个文件是不是「ink-captcha 官方源码本身」（拷进来的库文件），
 * 这些文件不参与业务逻辑检查（它们本来就包含 createCaptcha 定义、consumePassToken 定义等）。
 */
function isLibraryFile(f) {
  const rel = path.relative(ROOT, f);
  const base = path.basename(f);
  // 官方库文件固定名字
  if (/^(core|ink-background|rate-limit|ink-captcha|index)\.(js|cjs|mjs)$/.test(base)) {
    // 排除用户自己起的同名业务文件（放在明显的业务目录）
    return true;
  }
  if (base === "react.jsx" || base === "PointsCaptcha.jsx" || base === "PointsCaptcha.tsx") return true;
  // 已知的「内容特征」判定：包含官方 lib 的独有标识
  const src = readIfText(f);
  if (src) {
    const markers = [
      "ink-captcha:",              // 密钥前缀
      "P(8,4)",                    // 注释里的组合数
      "inSealZone",                // 印章避让
      "buildInkBackground",        // 底图函数名
      "createRateLimiter",         // 限流工厂
      "REASON_TEXT",
    ];
    const hits = markers.filter((m) => src.includes(m)).length;
    // 文件里出现 ≥3 个官方独有标识 → 判定为库文件
    if (hits >= 3 && /captcha|ink/i.test(rel)) return true;
  }
  // 路径在明确的库目录里
  if (/(^|\/)(lib|libs|vendor)\/captcha\/(core|ink-background|rate-limit)\.js$/.test(rel)) return true;
  return false;
}

/** 业务文件 = 非库文件、非文档、非测试脚本 */
function isBusinessFile(f) {
  const rel = path.relative(ROOT, f);
  if (/\.md$/.test(rel)) return false;
  if (/(^|\/)(scripts|tests?|__tests__|spec)\//.test(rel)) return false;
  if (/(^|\/)ink-captcha\/(src|examples|docs|scripts)\//.test(rel)) return false;
  if (/(^|\/)node_modules\//.test(rel)) return false;
  return true;
}

console.log("");
console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║         ink-captcha 安装后自检（verify-install.mjs）         ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log(`目标项目: ${ROOT}`);
console.log(`扫描文件: ${allFiles.length} 个`);
console.log("");

// ── 1. 必需文件是否可用 ─────────────────────────────────
// 两种合法情况：
//   A) 文件已拷进目标项目
//   B) 通过包引用（import ... from "ink-captcha"）—— 依赖 node_modules 或 workspace 链接
console.log("【1】服务端核心 / 前端组件可用性");
const required = [
  { name: "core.js",            desc: "服务端核心",   aliases: ["core.js", "captcha-core.js"] },
  { name: "ink-background.js",  desc: "底图生成",     aliases: ["ink-background.js", "inkBackground.js"] },
  { name: "rate-limit.js",      desc: "限流",         aliases: ["rate-limit.js", "rateLimit.js"] },
  { name: "ink-captcha.js",     desc: "前端原生组件", aliases: ["ink-captcha.js"] },
];

// 先判断是否通过包引用（import from "ink-captcha" / require("ink-captcha")）
const pkgRefRegex = /(?:from\s*["']ink-captcha(?:\/[\w.-]+)?["']|require\(\s*["']ink-captcha(?:\/[\w.-]+)?["']\s*\))/;
let usesPackageRef = false;
for (const f of allFiles) {
  const src = readIfText(f);
  if (src && pkgRefRegex.test(src)) { usesPackageRef = true; break; }
}
// 包是否真的能解析到
const hasNodeModulesPkg = fs.existsSync(path.join(ROOT, "node_modules", "ink-captcha"));
// workspace / 同级目录（本仓库自己的 examples 就靠这个解析）
const hasSiblingSrc = fs.existsSync(path.resolve(ROOT, "../../src/core.js"))
  || fs.existsSync(path.resolve(ROOT, "../src/core.js"))
  || fs.existsSync(path.resolve(ROOT, "packages/ink-captcha/src/core.js"));
const pkgResolvable = hasNodeModulesPkg || hasSiblingSrc;

let missingCore = 0;
for (const req of required) {
  const found = allFiles.filter((f) => req.aliases.includes(path.basename(f)));
  if (found.length) {
    record("ok", `${req.desc} (${req.name})`, `找到 ${found.length} 处: ${found.slice(0,3).map(f=>path.relative(ROOT,f)).join(", ")}${found.length>3?" …":""}`);
  } else if (usesPackageRef && hasNodeModulesPkg) {
    record("ok", `${req.desc} (${req.name})`, "通过包引用（node_modules/ink-captcha）");
  } else if (usesPackageRef && hasSiblingSrc) {
    record("ok", `${req.desc} (${req.name})`, "通过包引用（workspace 同级 src/）");
  } else if (usesPackageRef) {
    // 代码引用了包，但包解析不到 —— 这是真问题，启动就会报 Cannot find package
    missingCore++;
    record("fail", `${req.desc} (${req.name})`,
      "代码里 import 了 ink-captcha，但包解析不到（无 node_modules/ink-captcha，也无同级 src/）—— 运行时会报 Cannot find package");
  } else {
    missingCore++;
    record("fail", `${req.desc} (${req.name})`, "未找到，代码里也没有包引用 —— 是否忘了拷贝或安装？");
  }
}

// 检查 react.jsx（可选）
const reactFiles = allFiles.filter((f) => /PointsCaptcha\.(jsx|tsx|js|ts)$|react\.jsx$/.test(path.basename(f)));
record(reactFiles.length ? "ok" : "info",
  "React 封装（可选）",
  reactFiles.length ? `找到: ${reactFiles.map(f=>path.relative(ROOT,f)).join(", ")}` : "未找到（非 React 项目可忽略）");

// ── 2. 单例检查 ───────────────────────────────────────────
console.log("\n【2】服务端单例检查（最常见的安装事故）");
let singletonOk = 0, createCalls = [];
for (const f of allFiles) {
  if (!isBusinessFile(f)) continue;        // 排除官方源码 / 文档 / 测试
  if (isLibraryFile(f)) continue;          // 排除拷进来的库文件本身
  const src = readIfText(f);
  if (!src) continue;
  if (!/createCaptcha\s*\(/.test(src)) continue;
  const rel = path.relative(ROOT, f);
  createCalls.push(rel);
  // 单例写法（任一即算通过）：
  //   ① globalThis.__x ??= init()   —— 直接写
  //   ② const g = globalThis; g.__x ??= init()  —— 别名写法
  //   ③ globalThis["__x"] ??=
  //   ④ 模块顶层 const x = createCaptcha(...)  —— 顶层只跑一次，也算单例
  const hasGlobalCache =
    /\?\?=/.test(src) ||
    (/globalThis\s*[.\[]/.test(src) && /(captcha|init|singleton)/i.test(src));
  // ❗ 关键：必须限定「行首零缩进」，否则函数体内缩进的 const 也会被误判为模块顶层
  const isModuleTop = /^(?:export\s+)?const\s+\w+\s*=\s*createCaptcha\s*\(/m.test(src);
  // 反向排除：createCaptcha 出现在函数体内（前面有缩进或 function 关键字包裹）
  const insideFunction = /^[ \t]+(?:const|let|var)\s+\w+\s*=\s*createCaptcha\s*\(/m.test(src);
  if ((hasGlobalCache || isModuleTop) && !insideFunction) singletonOk++;
  else record("fail", `❌ 非单例：${rel}`,
    "createCaptcha() 写在函数体内且无 globalThis 缓存 → 每次调用都新建实例 → 签发的凭证查不到 → 用户验证通过后提交仍失败");
}
if (createCalls.length === 0) {
  record("fail", "createCaptcha 调用", "在目标项目里没找到任何 createCaptcha() 调用 —— 服务端还没接上");
} else if (singletonOk === createCalls.length) {
  record("ok", "createCaptcha 单例", `${createCalls.length} 处调用全部符合单例写法`);
} else {
  record("fail", `createCaptcha 单例（${singletonOk}/${createCalls.length}）`,
    `非单例调用点: ${createCalls.join(", ")} —— 见 AGENT-INSTALL.md §6.1 A`);
}

// ── 3. 环境变量 ───────────────────────────────────────────
console.log("\n【3】CAPTCHA_SECRET 配置");
const envFiles = allFiles.filter((f) => /(^|\/)\.env(\..+)?$/.test(f));
let secretFound = false;
for (const f of envFiles) {
  const src = readIfText(f);
  if (src && /^CAPTCHA_SECRET\s*=/m.test(src)) {
    secretFound = true;
    const val = (src.match(/^CAPTCHA_SECRET\s*=\s*(.+)$/m) || [])[1]?.trim() ?? "";
    const weak = /^(test|123456|secret|changeme|xxx|your.?secret|pass|admin)/i.test(val) || val.length < 16;
    record(weak ? "warn" : "ok", `CAPTCHA_SECRET（${path.relative(ROOT, f)}）`,
      weak ? "已设置，但看起来太弱（建议 32 字节随机串）" : `已设置，长度 ${val.length} 字符`);
  }
}
if (!secretFound) {
  const inCode = allFiles.some((f) => {
    const src = readIfText(f);
    return src && /CAPTCHA_SECRET/.test(src) && !/\.md$/.test(f);
  });
  if (inCode) {
    record("ok", "CAPTCHA_SECRET", "未在 .env 里找到，但代码中引用了该变量（可能由部署环境注入）");
  } else {
    record("fail", "CAPTCHA_SECRET", "既没在 .env 找到，代码里也没有引用 —— 服务端会启动就抛错");
  }
}

// ── 4. 业务接口是否消费凭证 ────────────────────────────────
console.log("\n【4】凭证消费检查（漏了等于没防护）");
let consumed = [];
for (const f of allFiles) {
  if (!isBusinessFile(f)) continue;
  if (isLibraryFile(f)) continue;          // ← 关键：排除 core.js 里的函数定义
  const src = readIfText(f);
  if (!src) continue;
  // 只看「调用」而不是「定义」：排除 function 声明 / export function
  if (!/consumePassToken\s*\(|consumeCaptchaToken\s*\(/.test(src)) continue;
  if (/(export\s+)?function\s+consume(PassToken|CaptchaToken)/.test(src)) continue;  // 定义行，跳过
  consumed.push(path.relative(ROOT, f));
}
if (consumed.length === 0) {
  record("fail", "consumePassToken 调用",
    "没找到任何消费凭证的调用 —— passToken 拿了不校验，防护等于装饰品（见 AGENT-INSTALL.md §3.1 ④）");
} else {
  record("ok", "consumePassToken 调用", `${consumed.length} 处: ${consumed.slice(0, 5).join(", ")}${consumed.length > 5 ? " …" : ""}`);
}

// 4b. 反向检查：找到了「签发/校验」端点，但业务接口没消费 → 强烈警告
const hasVerifyEndpoint = allFiles.some((f) => {
  if (!isBusinessFile(f)) return false;
  const src = readIfText(f);
  return src && /captcha\.verify\s*\(/.test(src) && !isLibraryFile(f);
});
const hasChallengeEndpoint = allFiles.some((f) => {
  if (!isBusinessFile(f)) return false;
  const src = readIfText(f);
  return src && /createChallenge\s*\(/.test(src) && !isLibraryFile(f);
});
if ((hasVerifyEndpoint || hasChallengeEndpoint) && consumed.length === 0) {
  record("fail", "端到端闭环",
    "已接上签发/校验端点，但没有任何业务接口消费凭证 —— 攻击者拿到 passToken 可无限复用。务必在注册/发短信/下单等写接口里调 consumePassToken");
}

// ── 5. 安全红线 ───────────────────────────────────────────
console.log("\n【5】安全红线检查");
// 5.1 secret 硬编码在前端
let frontendSecret = [];
for (const f of allFiles) {
  const rel = path.relative(ROOT, f);
  // 前端可被用户下载的目录
  if (!/(^|\/)(public|static|assets|client|browser|dist)\//.test(rel)) continue;
  const src = readIfText(f);
  if (!src) continue;
  if (/createCaptcha\s*\(\s*\{[^}]*secret\s*:\s*["'`]/.test(src)) frontendSecret.push(rel);
}
record(frontendSecret.length ? "fail" : "ok", "secret 未被硬编码到前端",
  frontendSecret.length ? `❌ 这些前端文件里硬编码了 secret: ${frontendSecret.join(", ")} —— 用户打开 DevTools 就能拿到，可自己签发凭证绕过验证` : "未发现前端硬编码 secret");

// 5.2 Math.random 抽题
let mathRandomRisk = [];
// 危险模式：Math.random 参与「排序/洗牌/索引/取整选元素」→ 几乎一定是抽题
const DANGEROUS_RANDOM = [
  /sort\s*\(\s*\([^)]*\)\s*=>\s*Math\.random/,            // sort(() => Math.random() - .5)
  /Math\.random\s*\(\s*\)[^;\n]{0,40}sort\s*\(/,           // Math.random() ... sort(
  /Math\.floor\s*\(\s*Math\.random\s*\(\s*\)\s*\*/,         // Math.floor(Math.random() * n) 取索引
  /\[\s*Math\.floor\s*\(\s*Math\.random/,                   // arr[Math.floor(Math.random()...
  /(?:target|distractor|answer|order|position|shuffle|pick)[\w$]*\s*=[^;\n]{0,60}Math\.random/i,
];
for (const f of allFiles) {
  if (!isBusinessFile(f)) continue;
  if (isLibraryFile(f)) continue;
  const src = readIfText(f);
  if (!src) continue;
  // ❗ 不按文件名过滤：Math.random 参与抽题在任何文件里都是危险信号
  if (DANGEROUS_RANDOM.some((re) => re.test(src))) mathRandomRisk.push(path.relative(ROOT, f));
}
record(mathRandomRisk.length ? "fail" : "ok", "抽题未使用 Math.random",
  mathRandomRisk.length
    ? `❌ 抽题/布点必须用 crypto.randomInt，这些文件用了 Math.random: ${mathRandomRisk.join(", ")}`
    : "OK（Math.random 仅允许用于底图视觉随机）");

// 5.3 picks 格式检查：自写前端时是否误把 {x,y} 当作 picks 发给服务端
let picksFormatRisk = [];
for (const f of allFiles) {
  if (!isBusinessFile(f)) continue;
  if (isLibraryFile(f)) continue;
  const src = readIfText(f);
  if (!src) continue;
  // 只在「提交给 verify」的上下文里找 { x, y } 形状
  const nearVerify = /verify\s*\(/.test(src) || /captcha\/points\/verify/.test(src);
  if (!nearVerify) continue;
  // 形如 picks.push({ x: ..., y: ... }) 或 body: JSON.stringify({ token, picks: [{x,y}] })
  if (/\{\s*x\s*:[^}]{0,40},\s*y\s*:/.test(src)) {
    // 但如果同时有 id 字段，就不算问题
    if (!/\{\s*id\s*:/.test(src)) picksFormatRisk.push(path.relative(ROOT, f));
  }
}
record(picksFormatRisk.length ? "fail" : "ok", "verify 的 picks 格式",
  picksFormatRisk.length
    ? `❌ 这些文件往 verify 提交了 {x,y} 坐标，但服务端要的是 {id,ts} —— 会一直返回 mismatch: ${picksFormatRisk.join(", ")}`
    : "OK（picks 使用 {id, ts} 格式）");

// 5.4 isTarget 是否泄漏到下发数据
let leakRisk = [];
for (const f of allFiles) {
  if (!isBusinessFile(f)) continue;
  if (isLibraryFile(f)) continue;
  const src = readIfText(f);
  if (!src) continue;
  // 只看「响应下发」的上下文里是否显式带 isTarget
  if (!/(isTarget|_isTarget)/.test(src)) continue;
  if (!/(json\s*\(|send\s*\(|Response\.json|NextResponse\.json|res\.json)/.test(src)) continue;
  // 若该文件同时有明确的「剥离/删除」动作，则不算风险
  if (/(delete|omit|strip|pick)\s*[\(\[]?[^;\n]{0,40}isTarget/.test(src)) continue;
  leakRisk.push(path.relative(ROOT, f));
}
record(leakRisk.length ? "warn" : "ok", "字形字段未随响应下发",
  leakRisk.length ? `⚠️ 需人工确认这些文件是否把 isTarget 下发了: ${leakRisk.join(", ")}` : "OK");

// ── 输出报告 ─────────────────────────────────────────────
console.log("\n" + "─".repeat(64));
console.log("  检查结果");
console.log("─".repeat(64));
const icon = { ok: "✅", fail: "❌", warn: "⚠️ ", info: "ℹ️ " };
let fails = 0, warns = 0;
for (const r of results) {
  if (r.level === "fail") fails++;
  if (r.level === "warn") warns++;
  console.log(`${icon[r.level] || "  "} ${r.title}`);
  if (r.detail) console.log(`     ${r.detail}`);
}
console.log("─".repeat(64));
console.log(`统计：✅ ${results.filter(r=>r.level==="ok").length}  ❌ ${fails}  ⚠️ ${warns}`);
console.log("");

if (fails > 0) {
  console.log("❌ 存在关键问题，安装未完成。请对照 AGENT-INSTALL.md §6 修复后重跑。");
  console.log("");
  process.exit(1);
} else if (warns > 0) {
  console.log("⚠️  有警告项需要人工确认。若无问题可继续，但请逐条核对上面内容。");
  console.log("");
  console.log("提醒：本脚本只做静态检查。真正的生效验证请手工走一遍：");
  console.log("  1) 点对 4 个字 → 拿到 passToken");
  console.log("  2) 提交业务 → 成功");
  console.log("  3) 同一 passToken 再提交一次 → 必须失败（重放防护）");
  console.log("");
  process.exit(0);
} else {
  console.log("✅ 静态检查全部通过。请继续手工走一遍真实点击的端到端验证。");
  console.log("");
  process.exit(0);
}
