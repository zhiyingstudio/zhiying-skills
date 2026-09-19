---
name: zhiying-node-self-healing
display_name: 节点自愈运维
display_name_en: AI Node Self-Healing Ops
description: "AI 推理服务节点（Gradio/Windows 常驻服务）的稳定性加固与自愈运维：预防性任务计数回收 + 秒级崩溃恢复 + 孤儿进程清理。当服务出现连续调用后崩溃、无 traceback 戛然而止、显存被孤儿进程占满、节点起不来、看门狗恢复太慢，或需要压测/回收/自愈 AI 服务节点时使用。触发词：节点崩溃、服务自愈、Gradio 运维、看门狗、节点回收、显存泄漏、服务起不来、AI 服务稳定性、zhiying-node-self-healing。"
description_zh: "AI 推理节点稳定性加固：任务计数预防性回收 + 秒级崩溃自愈 + 孤儿进程树清理，含常驻监督脚本模板与全部参数陷阱。"
description_en: "Self-healing ops for AI inference nodes: preventive task-count recycling, second-level crash recovery, orphan process cleanup, with a resident supervisor script template."
category: 系统运维
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-node-self-healing
displayName: "节点自愈运维"
summary: "AI 推理节点稳定性加固：任务计数预防性回收 + 秒级崩溃自愈 + 孤儿进程树清理，含常驻监督脚本模板与全部参数陷阱。"
license: MIT
---

# AI 服务节点自愈运维

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

适用于 Windows/Linux 上常驻运行的 AI 推理服务（Gradio、Flask、FastAPI 包装的本体模型）。实战案例来自 HeyGem（开源数字人推理服务）长视频克隆场景：连续推理数次后进程原生崩溃、无 Python traceback、日志戛然而止。以下方法论与脚本已在线上验证：300 秒音频 15 段连续生成 15/15 通过，崩溃后 16 秒自动恢复。

## 什么时候需要这套方案

| 症状 | 根因方向 |
|---|---|
| 连续调用 N 次后必崩，无任何报错 | 推理库进程内状态累积（如某个 `.pyd`/native 模块不释放） |
| 崩溃后服务永远起不来 | 主进程死了，孤儿子进程存活占满显存/内存 |
| `schtasks /run` 或 supervisor 重启静默无效 | 旧进程树残留 + `MultipleInstancesPolicy=IgnoreNew` |
| 分钟级看门狗恢复太慢，客户任务被拖死 | 恢复空窗最长 60s，需要秒级常驻监督 |

**核心结论：改不了上游推理代码，就只能在崩溃前主动回收 + 崩溃后秒级恢复。**

## 四条硬事实（每条都是踩坑换来的）

### 1. 状态累积型崩溃无法根治，只能预防性回收

- 典型铁证：Windows 事件查看器报 `异常代码 0xc0000005（访问违例）`，故障模块是推理库的 native 模块而非你的代码
- 清工作目录、降并发都只是延后崩溃，不根治
- **正确做法：每完成 MAX_TASKS 个任务主动重启节点**，把回收点放在崩溃阈值之前（崩溃阈值 3~4 次 → MAX_TASKS 取 2）

### 2. 回收必须杀干净进程树，否则等于没回收

- AI 服务崩溃形态：主进程死 → N 个 spawn 孤儿子进程存活并占满显存 → 新主进程抢不到显存永远起不来
- 进程匹配要精确（如 `*你的服务目录名*`），**不要笼统杀 `python.exe`**——同机可能有其他 Python 服务
- 若用计划任务拉起服务且策略是 IgnoreNew：任何残留都会让下一次 `schtasks /run` **静默跳过**（不报错、不启动）

### 3. 任务计数信号只能用「每任务必重写」的 marker 文件

- ✅ 正确信号：每个任务完成必然重写的产物文件，用其 `LastWriteTime` 变化计数
- ❌ 错误信号：临时子目录数量（复用素材时不增长）、端口监听状态、日志行数——都不与「任务完成」一一对应
- 先观察一次完整任务生命周期，确认哪个文件「每任务必写」，再把它当 marker

### 4. 回收触发的三个参数陷阱

| 坑 | 症状 | 正确做法 |
|---|---|---|
| 轮询周期太长 | 1 分钟轮询漏计任务（27 秒/任务时一分钟完成 2 个）→ 漏回收 → 走进崩溃区 | 常驻进程 + `POLL_SEC=4` |
| 空闲窗口太大 | 任务刚结束目录必然刚写入，`IDLE_SEC=30` 永远不满足 → 计数到了却零回收 | `IDLE_SEC=8`，只用于确认任务真结束 |
| 恢复后计数基线归零 | 把崩溃前已计数的任务重复计数 → 误回收 → 打断客户刚发起的任务 | **重新读取当前 marker 时间戳做基线**，不是清零 |

## 标准方案：常驻监督进程

模板脚本：`scripts/node-recyclerd.ps1`（Windows 版，一进程两职责）。

**职责一 · 预防**：每 `MAX_TASKS` 个任务回收节点（避开崩溃阈值）
**职责二 · 恢复**：监听端口停止响应满 15 秒即回收，实测 16 秒恢复（分钟级看门狗最长 60 秒空窗）

部署（Windows 计划任务，SYSTEM 账户开机自启）：

```powershell
# 停用旧的分钟级看门狗（会被本监督进程取代）
schtasks /change /tn <旧看门狗任务名> /disable
# 注册开机自启
schtasks /create /tn node-recyclerd /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\ops\node-recyclerd.ps1" /sc onstart /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn node-recyclerd
```

**调参速查**：

| 参数 | 建议值 | 调错后果 |
|---|---|---|
| `MAX_TASKS` | 崩溃阈值 - 1 | 调大省重启开销，调大过了就进崩溃区 |
| `IDLE_SEC` | 8 | **调大 → 门控永不满足，回收静默失效** |
| `POLL_SEC` | 4 | **调大 → 漏计任务，漏回收** |

## 能力基线怎么测（回答「最长支持多久/并发支持几人」）

1. **分段压测**：按时长梯度（30s/60s/120s/300s）各跑 N 段，段间留间隔，记录成功率与总耗时
2. **单条耗时公式**：用多组数据拟合 `≈ 固定开销 + 系数 × 输入时长`（案例：`9.5 + 0.8 × 音频秒数`）
3. **吞吐上限**：分清「框架层串行限制」（如 Gradio `default_concurrency_limit=1`，非故障）与「真实瓶颈」
4. **回收开销摊薄**：每 MAX_TASKS 个任务多一次重启（案例：16 秒 ÷ 2 任务 ≈ +8 秒/任务），写进 SLA
5. 答案要给出「真正的限制在哪」：往往是上游等待钳制或框架并发参数，而不是推理本身

## PowerShell 远程执行铁律

1. **脚本必须纯 ASCII**：PowerShell 5.1 把无 BOM 的 UTF-8 按 GBK 解析，**中文注释会破坏语法导致脚本静默不执行**。写完用 `LC_ALL=C grep -n '[^ -~]' file.ps1` 检查
2. **传输方式**：本地写 `.ps1` → `scp` 到目标机 → `ssh ... "powershell -ExecutionPolicy Bypass -File C:\ops\x.ps1"`，避开 SSH+cmd+PowerShell 三层引号转义地狱
3. **不要在 `-File x.ps1` 后面接 `; echo done`**：会被并入文件名，报「文件不具有 '.ps1' 扩展名」

## 验收测试方法

写一个「分段提交 + 每段前检查服务健康」的压测脚本：

- 每段提交前先探测服务端口/健康接口，不在就等待恢复（验证自愈回路真的工作）
- 记录每段耗时与成功率，产出基线表
- 至少覆盖：短输入稳态、长输入分段、连续 N 段跨回收点（验证回收不打断任务）

## 交付话术

- 先给一句话结论：节点现在能扛多久、崩溃后多久自愈、瓶颈在哪
- 基线表 + 参数表 + 部署命令，让运维能独立复现
- 明确标注「改不了上游」的边界：哪些限制是推理库的，哪些是自己架构的
