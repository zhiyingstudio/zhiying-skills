# 工作流与 AI 增强接口

本文档说明 auto-video-edit 各功能模块的完整工作流，以及 AI 增强（评分脚本、Whisper 字幕）的接入方式。

## 一、典型工作流

### 工作流 A：录屏/教程去冗余

适用场景：屏幕录制、教学视频、会议记录，需去除停顿和静音。

```
原始视频 → [silence 去静音] → [whisper 生成字幕] → [subtitle 烧录字幕] → 成品
```

```bash
python auto_cut.py silence input.mp4 -o step1.mp4
python auto_cut.py whisper step1.mp4 --model small --language zh
python auto_cut.py subtitle step1.mp4 step1.srt -o final.mp4
```

或用 pipeline 一次完成（见下文）。

### 工作流 B：长视频抽精彩片段

适用场景：直播回放、长访谈，提取精华做短视频分发。

```
原始视频 → [extract 场景检测] → 多个片段 → [按需筛选] → [各段加字幕/包装]
```

```bash
# 场景检测抽5段，每段3-60秒
python auto_cut.py extract input.mp4 -n 5 --mode scene --min-dur 3 --max-dur 60 -o clips/

# 可选：接入 AI 评分脚本
python auto_cut.py extract input.mp4 -n 5 --ai-hook ./score_clips.py -o clips/
```

### 工作流 C：完整包装流水线

适用场景：成品视频加片头、字幕、背景音乐。

```
主视频 → [去静音] → [字幕] → [拼接片头片尾] → [背景音乐] → 成品
```

## 二、Pipeline 配置

pipeline 命令按 JSON 配置顺序执行多个步骤，每步输出自动作为下一步输入。

### 配置文件格式

```json
{
  "steps": [
    {"action": "silence", "params": {"noise": -35, "duration": 0.6, "pad": 0.3}},
    {"action": "whisper", "params": {"model": "small", "language": "zh"}},
    {"action": "subtitle", "params": {"style": "FontName=PingFang SC,FontSize=22,Outline=2"}},
    {"action": "bgm", "params": {"music": "/path/to/bgm.mp3", "music_volume": 0.2}},
    {"action": "concat", "params": {"intro": "/path/to/intro.mp4", "transition": 0.5}}
  ],
  "output": "final.mp4"
}
```

### 支持的 action

| action | 必需参数 | 可选参数 |
|--------|----------|----------|
| `silence` | — | noise, duration, pad, copy, crf, preset |
| `cut` | cuts 或 cuts_file | merge, copy, crf, preset, output_dir |
| `extract` | — | count, mode, min_dur, max_dur, threshold, clip_dur, ai_hook |
| `whisper` | — | model, language, format |
| `subtitle` | — | subtitle(默认用上一步 whisper 结果), style, fonts_dir, crf, preset |
| `concat` | — | intro, outro, transition, crf, preset |
| `bgm` | music | music_volume, video_volume, ducking, fade_in, fade_out, crf, preset |

### pipeline 特殊行为

- `whisper` 步骤生成的字幕文件路径会被记住，后续 `subtitle` 步骤无需指定 `subtitle` 参数即可自动使用
- `extract` 步骤产出多个文件，pipeline 取第一个；如需全部使用，请单独运行 extract
- 最终输出若配置了 `output` 字段，会复制到指定路径

## 三、AI 增强接口

### 1. 场景评分脚本 (ai_hook)

extract 命令的 `--ai-hook` 参数可指定外部脚本，对候选片段评分。

**调用协议：**

脚本通过 stdin 接收 JSON，通过 stdout 返回 JSON。

**输入 JSON：**
```json
{
  "video": "/path/to/input.mp4",
  "duration": 3600.0,
  "resolution": "1920x1080",
  "fps": 30.0,
  "clips": [
    {"index": 0, "start": 0.0, "end": 15.2, "score": 0.45},
    {"index": 1, "start": 15.2, "end": 32.1, "score": 0.78}
  ]
}
```

**输出 JSON：**
```json
{
  "clips": [
    {"index": 0, "score": 0.9, "label": "精彩对话"},
    {"index": 1, "score": 0.3, "label": "过渡"}
  ]
}
```

**示例脚本 `score_clips.py`：**

```python
#!/usr/bin/env python3
"""示例：用 ffmpeg 提取每段缩略图，调用视觉 API 评分。"""
import sys
import json
import subprocess
import tempfile
import os

def main():
    payload = json.loads(sys.stdin.read())
    video = payload["video"]
    clips = payload["clips"]
    results = []

    for clip in clips:
        # 取片段中间帧作为缩略图
        mid = (clip["start"] + clip["end"]) / 2
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            thumb_path = f.name

        subprocess.run([
            "ffmpeg", "-ss", str(mid), "-i", video,
            "-frames:v", "1", "-q:v", "2", "-y", thumb_path
        ], capture_output=True)

        # TODO: 在此处调用你的 AI 模型对 thumb_path 评分
        # 示例：调 OpenAI Vision API
        # score = call_vision_api(thumb_path)
        score = clip["score"]  # 默认沿用场景检测分数
        label = ""

        os.unlink(thumb_path)
        results.append({"index": clip["index"], "score": score, "label": label})

    print(json.dumps({"clips": results}))

if __name__ == "__main__":
    main()
```

### 2. Whisper 字幕生成

`whisper` 子命令使用 OpenAI Whisper 本地模型从视频音频生成字幕。

**安装：**
```bash
pip install openai-whisper
```

**模型选择：**

| 模型 | 参数量 | 显存 | 中文效果 | 速度 |
|------|--------|------|----------|------|
| tiny | 39M | ~1GB | 差 | 最快 |
| base | 74M | ~1GB | 一般 | 快 |
| small | 244M | ~2GB | 不错 | 中 |
| medium | 769M | ~5GB | 好 | 慢 |
| large | 1550M | ~10GB | 最好 | 最慢 |

中文视频推荐 `small` 或 `medium`。首次使用会自动下载模型到 `~/.cache/whisper/`。

**与字幕烧录配合：**
```bash
# 1. 生成 srt 字幕
python auto_cut.py whisper input.mp4 --model small --language zh

# 2. 烧录到视频
python auto_cut.py subtitle input.mp4 input.srt -o output.mp4
```

## 四、时间戳文件格式

### JSON 格式
```json
[
  {"start": "0:10", "end": "0:30"},
  {"start": "1:00", "end": "00:01:45.500"}
]
```

### CSV 格式
```csv
start,end
0:10,0:30
1:00,1:45
```
首行若是 `start`/`开始` 表头则自动跳过。

时间格式支持：纯秒数 `90`、`MM:SS`、`HH:MM:SS`、`HH:MM:SS.mmm`。

## 五、常见问题排查

### Q: 去静音后音画不同步
A: 检查 `--pad` 参数，过小的 pad 可能削掉音频尾部导致不同步。建议 `--pad 0.3`。若仍不同步，用重新编码模式（不加 `--copy`）。

### Q: 中文字幕显示方块/乱码
A: 系统缺少中文字体。解决：
1. 指定 `--fonts-dir` 指向含中文字体的目录
2. 或在 force_style 中用系统已安装字体：`FontName=PingFang SC`（macOS）/ `FontName=Microsoft YaHei`（Windows）/ `FontName=Noto Sans CJK SC`（Linux）

### Q: 流拷贝模式合并后播放异常
A: 各段编码参数不一致。concat demuxer 要求完全相同的编码格式。建议合并时用重编码模式（不加 `--copy`），或先用 `_concat_simple` 中的标准化步骤统一格式。

### Q: 场景检测找不到切换点
A: 降低 `--threshold`（默认 0.4）。阈值越小检测越敏感。纯色/缓慢变化的视频场景切换不明显，可改用 `--mode uniform` 均匀切分。

### Q: Whisper 运行缓慢/报错
A: 1) 确认安装了 `openai-whisper`；2) 首次运行需下载模型，确保网络通畅；3) CPU 模式较慢，若有 GPU 需安装 CUDA 版 PyTorch；4) 长视频先用 `cut` 截取片段再识别。
