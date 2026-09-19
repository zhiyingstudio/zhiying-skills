# 安全审查专家团 · security-audit-team

> 四角色分域并行审查后端、前端与基础设施，主理人独立复现每条 P0，产出可直接当工单的分级整改清单。

`WorkBuddy 专家包` `v1.0.1` `MIT`

## 📥 安装

| 工具 | 方式 |
| --- | --- |
| **WorkBuddy** | 专家市场搜索「安全审查专家团」一键启用，或把本目录放入 WorkBuddy 插件目录 |
| **其他 Agent 工具** | 专家包是 WorkBuddy 原生格式；其中 `agents/` 下的角色 prompt 是通用 Markdown，可直接当作 system prompt 用于任何 Agent 工具 |

## 👤 团队成员

- **backend-auditor** — Backend security auditor - reviews authentication, injection, logic boundaries, 
- **frontend-auditor** — Frontend security auditor - reviews component safety, build artifacts, compatibi
- **infra-auditor** — Infrastructure security auditor - reviews configuration drift, credentials and s
- **security-audit-lead** — Security audit team lead - orchestrates parallel backend/frontend/infrastructure

---

**作者：宫帅（AI智库 · 智影科技）** · [智影技能库](https://github.com/zhiyingstudio/zhiying-skills) · [AI智库官网](https://ai-zhiku.com) · MIT License
