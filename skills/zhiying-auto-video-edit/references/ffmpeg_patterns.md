# ffmpeg 视频剪辑命令模式参考

本文档记录 auto-video-edit skill 中使用的核心 ffmpeg 命令模式，便于调试和自定义。

## 1. 视频信息探测 (ffprobe)

```bash
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4
```

关键字段：
- `format.duration` — 总时长（秒）
- `streams[codec_type=video].width/height` — 分辨率
- `streams[codec_type=video].avg_frame_rate` — 帧率（格式 "30000/1001"）
- `streams[codec_type=video].codec_name` — 视频编码
- `streams[codec_type=audio].codec_name` — 音频编码
- `format.bit_rate` — 总码率

## 2. 静音检测 (silencedetect)

```bash
ffmpeg -i input.mp4 \
  -af "silencedetect=noise=-30dB:d=0.5" \
  -f null - -vn
```

输出在 stderr，格式：
```
[silencedetect @ ...] silence_start: 3.000
[silencedetect @ ...] silence_end: 5.000 | silence_duration: 2.000
```

参数调节：
- `noise=-30dB` — 阈值，越小越严格（-40dB 只裁极静，-20dB 连背景音也裁）
- `d=0.5` — 最短静音时长，短于此值不触发

## 3. 静音裁剪 (filter_complex)

```bash
ffmpeg -i input.mp4 \
  -filter_complex "[0:v]select='between(t,0,2.8)+between(t,5.2,8)',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='between(t,0,2.8)+between(t,5.2,8)',asetpts=N/SR/TB[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k \
  output.mp4
```

原理：`select` 滤镜用 `between(t,start,end)` 表达式选取时间段，多个区间用 `+` 连接。
`setpts=N/FRAME_RATE/TB` 重置时间戳，避免拼接后时间不连续。

## 4. 时间戳截取

### 精确模式（重新编码，-ss 在 -i 后）
```bash
ffmpeg -i input.mp4 -ss 10.0 -t 20.0 \
  -c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k \
  output.mp4
```

### 快速模式（流拷贝，-ss 在 -i 前）
```bash
ffmpeg -ss 10.0 -i input.mp4 -t 20.0 \
  -c copy -avoid_negative_ts make_zero \
  output.mp4
```

区别：流拷贝跳到最近关键帧，可能有几秒偏差；重新编码精确到帧。

## 5. 片段合并

### concat demuxer（同格式，流拷贝）
```bash
# concat.txt 内容:
# file 'seg1.mp4'
# file 'seg2.mp4'
ffmpeg -f concat -safe 0 -i concat.txt -c copy output.mp4
```

### filter concat（不同格式，重编码）
```bash
ffmpeg -i seg1.mp4 -i seg2.mp4 \
  -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -crf 18 -c:a aac \
  output.mp4
```

## 6. 场景检测 (scdet)

```bash
ffmpeg -i input.mp4 -filter:v "scdet=threshold=40" -f null -
```

输出格式：
```
[scdet @ ...] sc_time:12.345 sc_score:56.78
```

`threshold` 范围 0-100，越大越严格。默认 40 对应 skill 中的 0.4。

## 7. 字幕烧录

### SRT/VTT（subtitles 滤镜，可覆盖样式）
```bash
ffmpeg -i input.mp4 \
  -vf "subtitles='input.srt':force_style='FontName=PingFang SC,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1'" \
  -c:v libx264 -crf 18 -c:a aac \
  output.mp4
```

### ASS（ass 滤镜，文件自带样式）
```bash
ffmpeg -i input.mp4 -vf "ass='input.ass'" -c:v libx264 -crf 18 output.mp4
```

注意：路径中的 `:` 和 `\` 需转义。中文字体需指定 `fonts_dir` 或确保系统已安装。

## 8. 转场 (xfade)

```bash
ffmpeg -i seg1.mp4 -i seg2.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=9.5[v];[0:a][1:a]acrossfade=d=0.5[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -crf 18 -c:a aac \
  output.mp4
```

`offset` = seg1时长 - transition时长。transition 类型：fade/wipeleft/wiperight/slideup/circleopen 等。

## 9. 背景音乐 (ducking)

```bash
ffmpeg -i video.mp4 -stream_loop -1 -i music.mp3 \
  -filter_complex "[1:a]afade=t=in:st=0:d=2,afade=t=out:st=6:d=3,volume=0.3,apad[music];[0:a][music]sidechaincompress=threshold=0.05:ratio=8:attack=200:release=1000[bgm];[0:a]volume=1.0[voice];[voice][bgm]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" \
  -c:v libx264 -crf 18 -c:a aac -t 8 \
  output.mp4
```

原理：`sidechaincompress` 用原视频音频作为侧链控制，有人说话时自动压低音乐。

## 10. 常用编码参数

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| `-crf` | 质量因子，越小质量越高 | 18（视觉无损）/ 23（默认）/ 28（低质量） |
| `-preset` | 编码速度 | ultrafast → medium → slow（越慢压缩率越高） |
| `-b:a` | 音频码率 | 192k（标准）/ 128k（语音）|
| `-r` | 帧率 | 30（标准）/ 60（流畅）|
| `-ar` | 音频采样率 | 44100（标准）/ 48000（专业）|

## 11. 路径处理注意

ffmpeg 滤镜中的文件路径需要特殊处理：
- Windows 反斜杠 `\` → 正斜杠 `/`
- 盘符冒号 `C:` → 转义为 `C\:`
- 路径中的单引号需转义

Python 中处理：
```python
sub_filter_path = str(Path(path).absolute()).replace("\\", "/").replace(":", r"\:")
```
