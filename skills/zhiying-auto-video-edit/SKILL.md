---
name: zhiying-auto-video-edit
display_name: 视频自动剪辑
display_name_en: Auto Video Edit
description: "基于 ffmpeg 的视频自动剪辑流水线：智能去静音、批量剪切、场景抽片段、字幕烧录、片头片尾拼接、背景音乐混音。触发词：剪辑视频、去静音、截取片段、加字幕、背景音乐、视频包装、auto cut、video edit、zhiying-auto-video-edit。"
description_zh: "基于 ffmpeg 的视频自动剪辑流水线：智能去静音、批量剪切、场景抽片段、字幕烧录、片头片尾拼接、背景音乐混音。"
description_en: "FFmpeg-based auto video editing pipeline: silence removal, batch cutting, scene-based clip extraction, subtitle burn-in, intro/outro splicing and BGM mixing."
category: 内容创作
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-auto-video-edit
displayName: "视频自动剪辑"
summary: "基于 ffmpeg 的视频自动剪辑流水线：智能去静音、批量剪切、场景抽片段、字幕烧录、片头片尾拼接、背景音乐混音。"
license: MIT
---

# Auto Video Edit

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

视频自动剪辑工具集，基于 ffmpeg 提供从去冗余到成品包装的完整剪辑流水线。所有功能通过 `scripts/auto_cut.py` 统一调度，支持单步执行和多步流水线（pipeline）模式。

## 依赖与环境

- **ffmpeg + ffprobe**：必需。脚本自动检测路径（环境变量 `FFMPEG_BIN`/`FFPROBE_BIN` 优先，其次 PATH，最后常见安装路径）。macOS 安装：`brew install ffmpeg`
- **Python 3.10+**：必需。使用 dataclass、type hint 等特性。
- **openai-whisper**（可选）：仅 `whisper` 子命令需要。安装：`pip install openai-whisper`。首次使用会下载模型。

执行 `python auto_cut.py env` 验证环境。

## 快速开始

所有操作通过 `scripts/auto_cut.py` 的子命令完成。脚本位于 skill 目录的 `scripts/` 下。

```bash
cd <skill目录>/scripts

# 查看环境
python auto_cut.py env

# 查看视频信息
python auto_cut.py info /path/to/video.mp4

# 去静音
python auto_cut.py silence /path/to/video.mp4 -o output.mp4

# 时间戳剪切并合并
python auto_cut.py cut /path/to/video.mp4 --cuts "0:10,0:30" "1:00,1:45" --merge

# 长视频抽5个片段
python auto_cut.py extract /path/to/long.mp4 -n 5 --mode scene

# 加背景音乐
python auto_cut.py bgm /path/to/video.mp4 /path/to/music.mp3 -o final.mp4
```

**运行时注意**：执行前确认工作目录为 `scripts/`，或用绝对路径调用。脚本内部通过 `sys.path.insert` 自动加载同目录模块，无需额外配置 PYTHONPATH。

## 核心功能

### 1. silence — 智能去静音

检测视频中的静音片段并自动裁剪，保留有效声音内容。

```bash
python auto_cut.py silence input.mp4 [-o output.mp4] [选项]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--noise` | -30.0 | 噪声阈值 dB，越小越严格（-40 只裁极静，-20 连背景音也裁） |
| `--duration` | 0.5 | 最短静音时长秒，短于此不裁 |
| `--pad` | 0.2 | 静音两端保留缓冲秒，避免削掉尾音 |
| `--copy` | False | 流拷贝模式（快但不精确，跳关键帧） |
| `--crf` | 18 | 视频质量（18 视觉无损，23 默认，28 低质量） |
| `--preset` | medium | 编码速度（ultrafast→slow，越慢压缩率越高） |

**原理**：用 `silencedetect` 滤镜扫描静音段 → 反转为保留段 → `select`+`between(t)` 滤镜提取并拼接。重新编码模式精确到帧。

**调参建议**：录屏/教程 `--noise -35 --duration 0.6 --pad 0.3`；会议记录 `--noise -25 --duration 1.0`。

### 2. cut — 按时间戳批量剪切

根据时间戳列表截取多个片段，可独立输出或合并为一个文件。

```bash
# CLI 直接指定
python auto_cut.py cut input.mp4 --cuts "0:10,0:30" "1:00,1:45" [--merge]

# 从文件读取
python auto_cut.py cut input.mp4 --cuts-file cuts.json [--merge]
python auto_cut.py cut input.mp4 --cuts-file cuts.csv [--merge]
```

**时间戳文件格式**：

JSON：
```json
[{"start": "0:10", "end": "0:30"}, {"start": "1:00", "end": "00:01:45.500"}]
```

CSV（首行表头可选）：
```csv
start,end
0:10,0:30
1:00,1:45
```

时间格式支持：纯秒数 `90`、`MM:SS`、`HH:MM:SS`、`HH:MM:SS.mmm`。

**合并模式** (`--merge`)：先截取各段到临时文件，再用 `concat` 滤镜合并。默认重新编码保证格式一致。

### 3. extract — 长视频抽片段

从长视频中提取多个精彩片段，支持场景检测和均匀切分两种模式。

```bash
# 场景检测模式（默认）
python auto_cut.py extract long.mp4 -n 5 --mode scene [选项]

# 均匀切分模式
python auto_cut.py extract long.mp4 -n 5 --mode uniform --clip-dur 10
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-n/--count` | 5 | 提取片段数 |
| `--mode` | scene | scene（场景检测）/ uniform（均匀切分） |
| `--min-dur` | 3.0 | 片段最短时长秒（仅 scene 模式） |
| `--max-dur` | 60.0 | 片段最长时长秒，过长截断（仅 scene 模式） |
| `--threshold` | 0.4 | 场景检测阈值 0-1，越小越敏感 |
| `--clip-dur` | 10.0 | 均匀模式每段时长秒 |
| `--ai-hook` | — | AI 评分脚本路径（见下文） |

**场景检测原理**：用 `scdet` 滤镜找场景切换点 → 按边界分段 → 过滤过短段 → 按场景变化强度排序 → 取前 N 段。

**AI 评分**：`--ai-hook` 指定外部脚本，接收候选片段 JSON（stdin），返回评分（stdout）。格式见 `references/workflow.md`。可用于接入视觉模型评估片段精彩程度。

### 4. subtitle — 字幕烧录

将 SRT/ASS/VTT 字幕硬编码到视频。

```bash
python auto_cut.py subtitle video.mp4 subtitle.srt [-o output.mp4] [--style "..."]
```

`--style` 参数（仅 SRT/VTT 生效，ASS 文件自带样式）：
```
FontName=PingFang SC,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1
```

**中文字体**：macOS 用 `PingFang SC`，Windows 用 `Microsoft YaHei`，Linux 用 `Noto Sans CJK SC`。字体缺失会显示方块，用 `--fonts-dir` 指定字体目录。

ASS 样式模板见 `assets/subtitle_style.md`，含主字幕/标题/强调/旁白四种预设样式。

### 5. concat — 拼接片头片尾

将片头、主视频、片尾拼接，可选 xfade 转场。

```bash
python auto_cut.py concat main.mp4 [--intro intro.mp4] [--outro outro.mp4] [--transition 0.5]
```

`--transition > 0` 时用 `xfade` 淡入淡出（需重新编码）；为 0 时直接拼接（标准化后流拷贝）。

### 6. bgm — 背景音乐

添加背景音乐，支持自动 ducking（有人说话时压低音乐）。

```bash
python auto_cut.py bgm video.mp4 music.mp3 [-o output.mp4] [--music-vol 0.3] [--no-ducking]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--music-vol` | 0.3 | 音乐音量 0-1 |
| `--video-vol` | 1.0 | 原声音量 0-1 |
| `--no-ducking` | False | 禁用 ducking |
| `--fade-in` | 2.0 | 音乐淡入秒 |
| `--fade-out` | 3.0 | 音乐淡出秒 |

**ducking 原理**：用 `sidechaincompress` 以原视频音频为侧链，检测到说话时自动压低音乐音量。

### 7. whisper — AI 字幕生成

用 OpenAI Whisper 从视频音频生成字幕（需安装 `openai-whisper`）。

```bash
python auto_cut.py whisper video.mp4 [--model small] [--language zh] [--format srt]
```

| 模型 | 中文效果 | 速度 | 适用 |
|------|----------|------|------|
| tiny/base | 一般 | 快 | 快速预览 |
| small | 不错 | 中 | 日常使用（推荐） |
| medium | 好 | 慢 | 高质量字幕 |
| large | 最好 | 最慢 | 专业场景 |

中文视频推荐 `small` 或 `medium`。首次使用自动下载模型到 `~/.cache/whisper/`。

## Pipeline 流水线

按 JSON 配置顺序执行多个步骤，每步输出自动作为下一步输入。

```bash
python auto_cut.py pipeline input.mp4 --config pipeline.json
```

**配置示例**（去静音 → 生成字幕 → 烧录字幕 → 加背景音乐）：

```json
{
  "steps": [
    {"action": "silence", "params": {"noise": -35, "duration": 0.6}},
    {"action": "whisper", "params": {"model": "small", "language": "zh"}},
    {"action": "subtitle", "params": {"style": "FontName=PingFang SC,FontSize=22,Outline=2"}},
    {"action": "bgm", "params": {"music": "/path/to/bgm.mp3", "music_volume": 0.2}}
  ],
  "output": "final.mp4"
}
```

**pipeline 特殊行为**：
- `whisper` 步骤生成的字幕路径自动传递给后续 `subtitle` 步骤，无需手动指定
- `extract` 产出多个文件，pipeline 取第一个
- 配置 `output` 字段会将最终结果复制到指定路径

完整 action 参数表见 `references/workflow.md`。

## AI 增强接口

### 场景评分脚本

`extract --ai-hook <script>` 调用外部脚本对候选片段评分。脚本通过 stdin/stdout 交换 JSON：

输入：`{"video": "...", "clips": [{"index": 0, "start": 1.2, "end": 5.6, "score": 0.3}]}`
输出：`{"clips": [{"index": 0, "score": 0.9, "label": "精彩对话"}]}`

示例脚本和完整协议见 `references/workflow.md`。

### Whisper 字幕

`whisper` 子命令使用本地 Whisper 模型，不依赖外部 API。生成的 SRT/VTT 可直接用 `subtitle` 子命令烧录。

## 参考资源

| 文件 | 用途 |
|------|------|
| `references/ffmpeg_patterns.md` | ffmpeg 剪辑命令模式速查（静音检测、截取、合并、转场、混音等） |
| `references/workflow.md` | 完整工作流说明、AI hook 脚本示例、pipeline 配置、常见问题排查 |
| `assets/subtitle_style.md` | ASS 字幕样式模板（含主字幕/标题/强调/旁白四种预设） |

调试 ffmpeg 命令时参考 `references/ffmpeg_patterns.md`；设计工作流或接入 AI 时参考 `references/workflow.md`。

## 注意事项

- **路径处理**：ffmpeg 滤镜中文件路径的 `:` 和 `\` 需转义，脚本已自动处理。手动拼接 ffmpeg 命令时注意此问题。
- **重新编码 vs 流拷贝**：默认重新编码（`--crf 18 --preset medium`），精确但慢。加 `--copy` 用流拷贝，快但不精确（跳关键帧，可能有几秒偏差）。合并场景流拷贝要求各段编码完全一致。
- **临时文件**：cut/concat 合并时在系统临时目录创建中间文件，完成后自动清理。
- **输出命名**：未指定 `-o` 时自动生成，规则为 `{原名}_{后缀}.mp4`，如 `input_nosilence.mp4`、`input_cut_001.mp4`。
- **长视频性能**：场景检测和 Whisper 对长视频（>1小时）耗时较长。建议先截取片段再处理。preset 用 `fast` 或 `ultrafast` 加速编码。
