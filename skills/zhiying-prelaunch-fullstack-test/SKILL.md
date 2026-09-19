---
name: zhiying-prelaunch-fullstack-test
display_name: 上线前全端深度测试
display_name_en: Pre-launch Full-stack Test
description: "项目上线前最后一轮全端深度测试流程——并行子代理分端测试（UI 真实操作 + API 安全实测 + 代码审计）加主控基础设施巡检，汇总 P0-P3 分级报告与上线评估。适用于多端 SaaS 项目（客户端 / 管理端 / 企业端）。触发词：上线前测试、发版前检查、全端回归测试、prelaunch、发布前体检、上线评估、P0 缺陷排查、多端穷举测试、zhiying-prelaunch-fullstack-test。"
description_zh: "上线前最后一轮全端深度测试：并行子代理分端穷举 UI/API/代码三层，汇总 P0-P3 分级报告与上线结论。"
description_en: "Final pre-launch full-stack test: parallel sub-agents sweep UI, API and code layers across all clients, then produce a P0-P3 graded report and go/no-go recommendation."
category: 开发工具
version: 1.0.1
author: 宫帅（AI智库）
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AgentTool, SendMessage, WebFetch
---

# 上线前全端深度测试流程（并行子代理模式）

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

在真实多端 SaaS 项目（客户端 / 管理端 / 企业端三端，130+ API）实战验证：3 个并行子代理 + 主控基础设施巡检，约 90 分钟完成三端穷举（客户端 21+ 页 / 管理端 20 页 / 企业端 18 页），发现 P0×1、P1×8。

适用对象：任何「前端多端 + 后端 API + 服务器」形态的 SaaS 项目。下文以「三端」为例，端数与名称按实际项目调整。

---

## 前置铁律

1. **先读项目自身文档**：若项目有开发手册 / 架构文档 / 运维手册（飞书文档、本地 md 均可），测试前必须先读，获取账号、路径、服务器入口等真实信息。不要凭猜测构造测试参数。
2. **测试前侦察**：确认各端入口 URL、登录账号、代码路径、服务器 SSH 入口，写入测试目录备查。
3. **产出目录**：`{workspace}/prelaunch_test_{YYYYMMDD}/`，含 `screenshots/` 子目录。所有报告落此目录。
4. **生产环境只读优先**：所有测试数据使用 `pretest_` 前缀，测完自行清理并在报告中记录清理结果。

---

## 执行步骤

### 1. 前置侦察（主控亲自做，约 10 分钟）

- `curl -s -o /dev/null -w "%{http_code}" {各端URL}/api/health` 探测各端可用性
- `ls` 项目目录，确认前端页面清单、后端模块清单
- 从项目文档 / 记忆中提取：测试账号、服务器 SSH、DB 路径、systemd 服务名

### 2. 创建团队 + 并行派发测试子代理

为每一端派一个 `general-purpose` 子代理，`max_turns=90`，后台运行。**每个子代理的 prompt 必须自包含**：项目背景、端入口 / 账号 / 代码路径、三层测试要求、安全铁律、输出格式。子代理看不到主对话，任何省略都会导致测试失效。

**安全铁律（三端通用，必须原样写入每个子代理 prompt）**：

- 生产环境只读为主；测试数据一律 `pretest_` 前缀；测完自行清理并记录
- 严禁：删除或修改真实数据、发起真实支付 / 退款、群发通知或公告、封禁真实用户、修改服务器文件、重启服务
- GPU 生成类任务（视频合成、模型推理）严禁真实发起，只测参数校验与错误路径
- LLM / TTS 等计费接口轻量调用各 ≤3 次
- 网络错误重试一次后继续，不得因单点失败中断整体测试

**三个测试层面**：

| 层面 | 方法 | 关注点 |
|---|---|---|
| UI 真实操作 | 加载 playwright / 浏览器自动化能力，逐页逐按钮点击 + 截图 | 交互可用性、控制台报错、样式断点 |
| API 层 | `curl` 带 token 实测 | 越权（普通 token 调管理 API 应 403）、参数校验（负数 / 超长 / 非法枚举 / 999 天等边界）、分页边界、IDOR |
| 代码审计 | 读源码 | 见下方「分层专项视角」 |

**分层专项视角（按端分配）**：

- 管理端 → 管理支撑能力盲区清单（客户端有但管理端管不到的功能）
- 企业端 → 核心需求满足度星级表
- 客户端 → 代码级 UI 审计：CSS 陷阱（`min-width: 0`、省略号三件套、`flex-shrink: 0`）、`ObjectURL` / 事件监听器 / 轮询的泄漏、本地优先失败时的静默兜底

**输出要求**：报告写至 `{dir}/{端}_report.md`，包含覆盖清单（✅ / ❌ / ⚠️）+ P0-P3 分级。每条缺陷必须给出：描述 / 复现步骤 / 影响 / 证据 / 修复建议；**代码问题必须精确到 `文件:行号`**。完成后用 SendMessage 发 400 字摘要给主控。

### 3. 主控并行做基础设施巡检（不等子代理）

SSH 登录服务器执行只读巡检：

```bash
systemctl is-active {服务名}
journalctl -u {服务名} --since "24 hours ago" | grep -iE "error|traceback|exception" | tail -50
tail -100 /var/log/nginx/error.log
df -h && free -h
sqlite3 {db} "PRAGMA integrity_check;"
crontab -l | grep -E "backup|healthcheck"
```

重点确认：**自动备份 cron 是否存在**（这是最容易被忽略、后果最严重的一项）。结果写入 `infra_report.md`。

### 4. 汇总

- 子代理失败（网络 502 等）→ 检查产出目录，无产出则重派 fresh agent
- 读齐各端报告，写 `FINAL_REPORT.md`：
  1. 分端 P0-P3 统计表
  2. 总体上线结论（可上线 / 有条件上线 / 阻断）
  3. 优先修复清单（🔴 阻断 / 🟠 强烈建议 / 🟡 需产品决策）
  4. 盲区清单
  5. 覆盖度与证据索引
  6. 流程改进建议
- 用 present_files 一次性交付全部报告

### 5. 收尾

- 验证测试数据清理（子代理自报 + 抽查 DB）
- 逐个关闭子代理 → 删除团队
- 追加当日工作记录

---

## 经验沉淀：元问题清单（每次必查）

以下是在真实项目中反复出现的系统性问题，与具体业务无关，任何项目都值得对照检查：

1. **「已修复」≠「已上线」**：本地源码修了但生产没部署（用文件 md5 对比可查）。每次安全修复后必须部署验证 + 回归测试。
2. **同类修复漏端**：一个参数校验只在 A 端修了，B 端漏改。修复时用 `grep` 搜同 pattern 覆盖全部端点。
3. **上线前固定检查项**：弱口令、DB 自动备份 cron、版本管理中的「当前版本」已发布基线、lint / tsc 门禁。
4. **灰度环境全链路冒烟**：真实计费类调用（支付、GPU 生成）作为最后一步，由项目负责人决策是否执行。

---

## 参考

- `references/report-template.md` — 缺陷报告与最终报告模板
- `references/subagent-prompt-template.md` — 子代理 prompt 自包含模板
