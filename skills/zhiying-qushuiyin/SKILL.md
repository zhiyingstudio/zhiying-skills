---
name: zhiying-qushuiyin
display_name: 无水印生图
display_name_en: Watermark-Free Image Generator
description: 通过免费图片生成通道产出无水印图片，无需 API Key、无需登录、零成本。支持 flux（高质量）与 turbo（极速）双模型，可指定尺寸、种子与风格，同 prompt + seed 可复现同图。触发词：生图、画一张、配图、出个图、无水印、免费出图、帮我画、生成图片、做张图、插画、封面图、banner 图、占位图、zhiying-qushuiyin。
description_zh: 通过免费通道生成无水印图片，无需 API Key，支持 flux/turbo 双模型，可指定尺寸与种子，画质可商用。
description_en: Generate watermark-free images via a free public channel - no API key required, supports flux (HQ) and turbo (fast) models, seed-reproducible.
category: 内容创作
version: 1.0.1
author: 宫帅（AI智库）
allowed-tools: Read, Write, Bash
---

# 无水印生图

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

通过 [Pollinations.ai](https://pollinations.ai) 免费图片生成通道，按需产出**无任何水印**的图片。
零依赖：无需 API Key、无需登录、无需付费、即开即用。

---

## 能力概览

| 维度 | 说明 |
|------|------|
| **水印状态** | ✅ 默认 `nologo=true`，输出图片**零水印**，四角干净 |
| **API Key** | ❌ 不需要 |
| **登录/注册** | ❌ 不需要 |
| **费用** | 🆓 完全免费 |
| **模型** | `flux`（高质量，默认）/ `turbo`（极速备选） |
| **尺寸** | 自定义（推荐 256~1536，长宽比自由） |
| **种子** | 可指定 → 同一 prompt+seed 可复现同一张图 |
| **风格** | 文生图，prompt 自由描述，天然支持写实/插画/动漫/3D 等 |
| **格式** | JPEG（默认）/ PNG（`transparent=true` 仅部分模型） |
| **响应时长** | flux 约 5-30s、turbo 约 2-8s（视 Pollinations 队列负载） |
| **商用** | ✅ Pollinations 输出可用于个人/商用项目 |

---

## 何时使用本 skill

触发场景（满足任一即用）：

- 用户说「**生图 / 画一张 / 配图 / 出个图**」，且不需要内嵌可灵/Kling 这种高门槛模型
- 用户明确要求「**无水印**」「**免费**」「**不要 API Key**」「**随便画一下**」
- 营销文案、公众号封面、博客插图、PPT 配图、UI 占位图等轻量出图场景
- 需要快速产出多张候选图（同一 prompt 不同 seed）做 A/B 选择

不适合的场景（用其他工具）：

- 需要**专业级电影质感/角色一致性** → 用可灵 AI / Midjourney
- 需要**图生图 / 局部编辑 / 扩图** → 用 kling-ai connector
- 需要**人物写真级还原** → 用妙影的形象克隆

---

## 核心调用方式（curl 一行流）

### 1. 最简调用（flux 模型）

```bash
curl -sL --max-time 90 \
  "https://image.pollinations.ai/prompt/{URL编码的prompt}?width=1024&height=768&nologo=true&model=flux&seed=42" \
  -o /tmp/output.jpg
```

**prompt URL 编码规则**：空格 → `%20`，逗号 → `%2C`，中文 → UTF-8 后逐字 `%XX` 编码。
例：「a cute cat, sitting on grass」→ `a%20cute%20cat%2C%20sitting%20on%20grass`

### 2. 备选模型（turbo，速度优先）

```bash
curl -sL --max-time 60 \
  "https://image.pollinations.ai/prompt/{prompt编码}?width=768&height=768&nologo=true&model=turbo&seed=7" \
  -o /tmp/output.jpg
```

### 3. 完整参数示例（带风格引导）

```bash
curl -sL --max-time 120 \
  "https://image.pollinations.ai/prompt/a%20futuristic%20cyberpunk%20city%20at%20night%2C%20neon%20lights%2C%20rain%2C%20cinematic%20lighting%2C%20photorealistic%2C%208k?width=1280&height=720&nologo=true&model=flux&seed=2026&enhance=true" \
  -o /Users/gongshuai/Desktop/cyberpunk.jpg
```

---

## API 参数速查

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `width` | int | 1024 | 宽度（像素），范围 256~2048 |
| `height` | int | 1024 | 高度（像素），范围 256~2048 |
| `model` | str | `flux` | 模型选择：`flux`（推荐，质量高）/ `turbo`（快，质量略低） |
| `seed` | int | 随机 | 种子，固定后同 prompt 出同图，用于复现/A/B |
| `nologo` | bool | `false` | **设为 `true` 关闭水印** ← 关键 |
| `enhance` | bool | `false` | 是否先用 LLM 润色 prompt（牺牲速度，效果更稳） |
| `private` | bool | `false` | `true` 不进 Pollinations 公共 feed（不影响水印） |
| `transparent` | bool | `false` | 背景透明（仅部分模型支持，需配合 PNG） |
| `nofeed` | bool | `false` | 同 private |

> ⚠️ **`nologo=true` 是无水印的硬开关**，忘了加就会有右下角小 logo。skill 已默认带上，调用方无需操心。

---

## 辅助脚本（推荐批量出图用）

`scripts/generate.py` 已附带在本 skill 目录，支持：

- 中文 prompt 自动 URL 编码
- 同时跑多张不同 seed 的图
- 自动落盘 + 输出尺寸/字节报告
- 失败自动 fallback 到 turbo 模型

```bash
python3 "$SKILL_PATH/scripts/generate.py" \
  --prompt "夕阳下的海边灯塔，写实风格，电影感光影" \
  --width 1280 --height 720 --model flux --seed 100 \
  --output /Users/gongshuai/Desktop/lighthouse.jpg

# 批量 4 张（A/B 候选）
for seed in 1 2 3 4; do
  python3 "$SKILL_PATH/scripts/generate.py" \
    --prompt "可爱的橙色小猫坐在草地上" \
    --seed $seed --output ~/Desktop/cat_${seed}.jpg
done
```

> `$SKILL_PATH` 由宿主自动注入为当前 skill 目录绝对路径。

---

## 输出验证（防止错觉）

生图后请用 Read 工具直接打开图片**目视确认**：

1. 四角及边缘**无任何** logo/水印/文字
2. 图片内容与 prompt 描述一致
3. 尺寸与请求匹配（注意：flux 有时会按模型原生比例自动 round，如请求 1024×768 可能返回 896×672——属正常行为，不影响使用）

如发现水印残留：

- 检查 URL 是否漏写 `nologo=true`
- 检查 prompt 中是否包含 `watermark` 关键词（会让模型主动加水印！请避免在 prompt 里出现 watermark/logo/text 等词）

---

## 常见坑 & 避坑指南

| 症状 | 原因 | 解决 |
|------|------|------|
| 图片右下角有小 logo | URL 漏 `nologo=true` | 加上 |
| 提示词里有 watermark / logo / signature 反而被画上去 | 模型把描述当真 | prompt 改写，去掉所有「画 logo / 画水印」类描述 |
| 一直没返回 / 超时 | Pollinations 队列拥挤 | 加 `--max-time 120`，或换 `model=turbo`，或换 seed 重试 |
| 同一尺寸两次返回不同分辨率 | flux 模型按原生长宽比 round | 加 `&width=896&height=672` 或换 1:1 比例（768×768） |
| 中文 prompt 出图失败 | 编码错误 | 用辅助脚本（自动编码），或手动 UTF-8 percent-encoding |
| 想要更大图（>1536） | Pollinations 单次上限 | 多次生成后用 Pillow 拼接，或换可灵 |

---

## 实战示例（覆盖典型需求）

### 公众号配图（横版 1280×720）

```bash
PROMPT='读书的青年男子剪影，窗外有光，温暖色调，电影感'
python3 "$SKILL_PATH/scripts/generate.py" \
  --prompt "$PROMPT" --width 1280 --height 720 --model flux --seed 88 \
  --output ~/Desktop/cover.jpg
```

### 营销海报（竖版 768×1280）

```bash
python3 "$SKILL_PATH/scripts/generate.py" \
  --prompt "黑金质感的高端护肤品海报，瓶子在中央，光晕，4K 商业摄影" \
  --width 768 --height 1280 --seed 21 --output ~/Desktop/poster.jpg
```

### UI 占位图（方形 512×512）

```bash
python3 "$SKILL_PATH/scripts/generate.py" \
  --prompt "抽象几何渐变背景，蓝紫色，简洁，适合做 banner" \
  --width 512 --height 512 --model turbo --seed 5 \
  --output ~/Desktop/bg.jpg
```

### 表情包/插画（512×512）

```bash
python3 "$SKILL_PATH/scripts/generate.py" \
  --prompt "一只愤怒的小鸟，卡通插画，夸张表情，白色背景" \
  --width 512 --height 512 --seed 33 --output ~/Desktop/meme.jpg
```

---

## 配套建议

- **批量场景**：写循环，每个 seed 出 4 张，让用户挑最满意的一张
- **复现场景**：固定 prompt + seed 永远出同图（适合做版本控制/AB 测试）
- **多分辨率尝试**：flux 推荐 1024×768 / 1280×720 / 896×1152 等原生接近的比例
- **下载到桌面**：默认输出 `~/Desktop/`，方便用户直接 Finder 查看
- **不要把图片发给用户的私域账号**（飞书/微信/邮件）：先生成在本地，问用户要不要发

---

## 失败兜底

若 Pollinations 持续不可用（极少见），按以下顺序降级：

1. 换 `model=turbo` 重试
2. 换 seed 重试
3. 调小尺寸（如 512×512）重试
4. 提示用户：本 skill 暂时不可用，可改用可灵 connector（kling-ai-generate-image）但**会有水印**

---

_本 skill 由助理编写并维护，已实测验证 flux + turbo 双模型零水印。问题反馈可写入 ~/.workbuddy/skills/qushuiyin/NOTES.md。_

---

## 效果预览

![效果预览](https://raw.githubusercontent.com/zhiyingstudio/zhiying-skills/main/skills/zhiying-qushuiyin/preview.jpg)

*上图为本技能的效果预览：真实界面演示或能力概览卡。安装后按 SKILL.md 指引即可复现同等效果。*
