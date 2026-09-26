<div align="center">

# 智影技能库 · Zhiying Skills

**宫帅（AI智库 · 智影科技）开源的 Agent 技能与专家包合集**
每一个技能都来自真实项目的实战沉淀，不是玩具 Demo。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Skills](https://img.shields.io/badge/免费技能-20-brightgreen)](#-免费技能20-个)
[![Experts](https://img.shields.io/badge/专家包-5-orange)](#-专家包5-个)
[![Standard](https://img.shields.io/badge/标准-Agent%20Skills-blueviolet)](https://agentskills.io)

</div>

---

## 🌐 兼容性：其他 Agent 工具也能用

本仓库技能采用 **[Agent Skills](https://agentskills.io) 开放标准**（SKILL.md：YAML frontmatter + Markdown 指令）——该标准由 Anthropic 发起、现由 Linux 基金会托管，**不是 WorkBuddy 私有格式**。同一目录，复制到对应位置即可在各家工具中使用：

| 工具 | 安装位置 |
| --- | --- |
| **WorkBuddy** | 推荐市场一键安装，或 `~/.workbuddy/skills/` |
| **Claude Code** | 项目级 `.claude/skills/` · 用户级 `~/.claude/skills/` |
| **GitHub Copilot / VS Code** | `.github/skills/`（兼容 `.claude/skills/`） |
| **OpenAI Codex CLI** | `.agents/skills/` · 用户级 `~/.agents/skills/` |
| **Cursor (2.4+)** | `.cursor/skills/` |
| **Gemini CLI / Windsurf / Cline / Roo Code / Goose / Trae…** | 各自的 `skills/` 目录 |

> 即使你的工具尚未原生支持该标准，SKILL.md 本质就是一份结构化 prompt 文档——直接引用或粘贴给任何 Agent 都能用。
>
> 专家包（experts/）为 WorkBuddy 原生格式，但 `agents/` 下的角色 prompt 是通用 Markdown，可当作 system prompt 用于任何工具。

## 📦 免费技能（20 个）

| 技能 | 说明 |
| --- | --- |
| [zhiying-ai-daily-brief](skills/zhiying-ai-daily-brief) | AI 行业每日动态速览：大模型发布、产品更新、融资并购、政策监管、开源项目五条线 |
| [zhiying-auto-video-edit](skills/zhiying-auto-video-edit) | 基于 ffmpeg 的视频自动剪辑流水线：去静音、批量剪切、字幕烧录、BGM 混音 |
| [zhiying-cnipa-patent-efiling](skills/zhiying-cnipa-patent-efiling) | 中国专利电子申请系统全流程自动填报：三书填写、费减勾选、附图上传、缴费核账 |
| [zhiying-data-honesty-audit](skills/zhiying-data-honesty-audit) | 数据诚实审查：揪出假回退、编造因果、自证循环三类数据造假反模式 |
| [zhiying-electron-builder-mac-package](skills/zhiying-electron-builder-mac-package) | macOS 沙箱环境下 Electron 应用打包避坑指南（dmg/exe/zip） |
| [zhiying-feishu-wiki-collect](skills/zhiying-feishu-wiki-collect) | 飞书知识库跨库采编：抓取、清洗去水印、图片内联迁移、自动设封面 |
| [zhiying-feishu-wiki-structure-audit](skills/zhiying-feishu-wiki-structure-audit) | 飞书知识库结构审查：节点树盘点、死链校验、重复与空板块识别 |
| [zhiying-frontend-jank-diagnosis](skills/zhiying-frontend-jank-diagnosis) | 前端卡顿诊断：渲染管线、事件监听、布局抖动、内存泄漏逐层定位 |
| [zhiying-fullstack-security-audit](skills/zhiying-fullstack-security-audit) | 已上线 Web 项目全栈安全与质量审查：并行子代理深挖 + 主代理独立复现 |
| [zhiying-ink-captcha](skills/zhiying-ink-captcha) | 自研点选式人机验证：答案 AES-256-GCM 加密下发，零依赖无备案无费用 |
| [zhiying-mutation-test-verification](skills/zhiying-mutation-test-verification) | 变异测试：验证测试用例是否真的能抓住缺陷，不做永远绿的摆设 |
| [zhiying-node-self-healing](skills/zhiying-node-self-healing) | AI 推理服务节点（Gradio/Windows 常驻）稳定性加固与自愈运维 |
| [zhiying-official-document-writer](skills/zhiying-official-document-writer) | 公文写作：通知、报告、请示、批复、纪要、讲话稿，自动匹配文种格式 |
| [zhiying-partial-coverage-consistency](skills/zhiying-partial-coverage-consistency) | 排查部分可用状态在多处消费点不一致的缺陷 |
| [zhiying-prd-assistant](skills/zhiying-prd-assistant) | PRD 辅助写作与需求评审：一句话需求展开成结构完整的 PRD |
| [zhiying-prelaunch-fullstack-test](skills/zhiying-prelaunch-fullstack-test) | 上线前最后一轮全端深度测试：UI 真实操作 + API 安全实测 + 代码审计 |
| [zhiying-qushuiyin](skills/zhiying-qushuiyin) | 免费通道产出无水印图片：无需 API Key、无需登录、零成本 |
| [zhiying-resume-optimizer](skills/zhiying-resume-optimizer) | 简历优化：「动作+方法+结果」重构经历，岗位匹配度分析与关键词优化 |
| [zhiying-weekly-report](skills/zhiying-weekly-report) | 周报自动生成：从 git 提交、任务清单、聊天纪要里捞证据，事实驱动 |
| [ppt-content-designer](skills/ppt-content-designer) | PPT 内容生成：提炼主线、组织页面逻辑、撰写标题要点与讲稿备注 |

## 👥 专家包（5 个）

| 专家 | 说明 |
| --- | --- |
| [content-pipeline-team](experts/content-pipeline-team) | 内容生产四角色团队：选题侦察 → 长文写作 → 平台适配 → 视觉包装 |
| [digital-human-director](experts/digital-human-director) | 数字人口播短视频导演 |
| [fullstack-delivery-team](experts/fullstack-delivery-team) | 软件交付五角色团队：需求拆解、前后端、测试、部署全覆盖 |
| [newmedia-growth-operator](experts/newmedia-growth-operator) | 新媒体增长操盘手：逆向拆解爆款逻辑 |
| [security-audit-team](experts/security-audit-team) | 安全审计四角色团队：后端、前端、基础设施分域审查 |

## 🚀 快速开始

```bash
git clone https://github.com/zhiyingstudio/zhiying-skills.git

# 例：把「周报生成」装进 Claude Code（用户级）
cp -R zhiying-skills/skills/zhiying-weekly-report ~/.claude/skills/

# 例：把「简历优化」装进 Codex CLI
cp -R zhiying-skills/skills/zhiying-resume-optimizer ~/.agents/skills/

# WorkBuddy：推荐市场搜索技能名一键安装
```

## 💼 商业合作

这些技能都是真实项目的沉淀。如果你需要**针对自己业务的定制开发**，或者希望**系统学习 AI Agent 落地**：

| 服务 | 说明 |
| --- | --- |
| 🛠 **企业 Agent 定制** | 把团队里最耗时的重复工作做成可复用技能，含部署与培训 |
| 🚀 **AI 应用开发** | 从 0 到 1 交付 AI 产品（桌面端 / Web / 小程序） |
| 🎓 **企业内训** | AI 工具落地工作坊，按团队业务定制 |
| 💬 **一对一咨询** | Agent 选型、方案评审、产品化路径 |

**详细服务说明与合作方式 → [CONTACT.md](CONTACT.md)**

📮 联系：个人官网 [gongshuai.me](https://gongshuai.me) · 邮箱 411575@qq.com

## 💎 付费技能

另有 7 个付费技能在 SkillHub 市场上架（高情商回复、塔罗解读、小红书文案、旅行规划、紫微解读、视频脚本、起名大师），源码即商品本体，不在本仓库。欢迎到 [skillhub.cn](https://skillhub.cn) 搜索「zhiying」支持。

## 🔗 相关链接

- 作者主页：[github.com/zhiyingstudio](https://github.com/zhiyingstudio)
- 个人官网：https://gongshuai.me
- AI智库官网：https://ai-zhiku.com

## 📄 License

[MIT](LICENSE) © 2026 宫帅（AI智库 · 智影科技）

免费可商用，保留署名即可。如果这些技能帮你省了时间，点个 Star 就是最大的支持。
