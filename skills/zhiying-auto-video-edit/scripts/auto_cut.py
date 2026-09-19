#!/usr/bin/env python3
"""
auto-video-edit / auto_cut.py
视频自动剪辑主入口。

统一调度所有剪辑功能，支持子命令模式和 pipeline 流水线模式。

子命令:
  silence   去除静音片段
  cut       按时间戳批量剪切
  extract   长视频抽片段
  subtitle  烧录字幕
  concat    拼接片头片尾
  bgm       添加背景音乐
  whisper   Whisper 生成字幕
  pipeline  按配置文件执行多步流水线
  info      查看视频信息
  env       查看环境信息

用法示例:
  # 去静音
  python auto_cut.py silence input.mp4 -o output.mp4

  # 时间戳剪切（截取两段并合并）
  python auto_cut.py cut input.mp4 --cuts "0:10,0:30" "1:00,1:45" --merge

  # 长视频抽5个片段（场景检测）
  python auto_cut.py extract input.mp4 -n 5 --mode scene

  # 流水线：去静音 → 生成字幕 → 烧录字幕 → 加背景音乐
  python auto_cut.py pipeline input.mp4 --config pipeline.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

# 确保能 import 同目录下的模块
sys.path.insert(0, str(Path(__file__).parent))

from utils import (
    ensure_tools,
    set_verbose,
    logger,
    probe_media,
    print_env_info,
    FFMPEG_BIN,
)
from silence_remover import remove_silence
from timestamp_cutter import cut_batch, parse_cuts
from clip_extractor import extract_by_scenes, extract_uniform
from subtitle_styler import (
    burn_subtitle,
    concat_intro_outro,
    add_bgm,
    generate_subtitle_whisper,
)


def cmd_silence(args):
    return remove_silence(
        args.input, args.output,
        noise_db=args.noise,
        min_duration=args.duration,
        pad=args.pad,
        stream_copy=args.copy,
        crf=args.crf, preset=args.preset,
    )


def cmd_cut(args):
    cuts = parse_cuts(args.cuts, args.cuts_file)
    return cut_batch(
        args.input, cuts, args.output_dir,
        stream_copy=args.copy, merge=args.merge,
        crf=args.crf, preset=args.preset,
    )


def cmd_extract(args):
    if args.mode == "scene":
        return extract_by_scenes(
            args.input, args.count,
            min_duration=args.min_dur, max_duration=args.max_dur,
            scene_threshold=args.threshold,
            output_dir=args.output_dir, stream_copy=args.copy,
            crf=args.crf, preset=args.preset, ai_hook=args.ai_hook,
        )
    else:
        return extract_uniform(
            args.input, args.count,
            clip_duration=args.clip_dur,
            output_dir=args.output_dir, stream_copy=args.copy,
            crf=args.crf, preset=args.preset,
        )


def cmd_subtitle(args):
    return burn_subtitle(
        args.video, args.subtitle, args.output,
        style=args.style, fonts_dir=args.fonts_dir,
        crf=args.crf, preset=args.preset,
    )


def cmd_concat(args):
    return concat_intro_outro(
        args.main, args.output,
        intro=args.intro, outro=args.outro,
        transition=args.transition, crf=args.crf, preset=args.preset,
    )


def cmd_bgm(args):
    return add_bgm(
        args.video, args.music, args.output,
        music_volume=args.music_vol, video_volume=args.video_vol,
        ducking=not args.no_ducking,
        fade_in=args.fade_in, fade_out=args.fade_out,
        crf=args.crf, preset=args.preset,
    )


def cmd_whisper(args):
    return generate_subtitle_whisper(
        args.video, model_name=args.model,
        language=args.language, output_format=args.format,
        output_dir=args.output_dir,
    )


def cmd_info(args):
    """查看视频信息。"""
    info = probe_media(args.input)
    print(f"文件:       {info.path}")
    print(f"时长:       {info.duration_str} ({info.duration:.3f}s)")
    print(f"分辨率:     {info.resolution}")
    print(f"帧率:       {info.fps:.2f} fps")
    print(f"视频编码:   {info.codec}")
    print(f"音频编码:   {info.audio_codec}")
    print(f"采样率:     {info.sample_rate} Hz")
    print(f"总码率:     {info.bit_rate / 1000:.0f} kbps")
    print(f"文件大小:   {info.size_bytes / 1024 / 1024:.2f} MB")


def cmd_env(args):
    """查看环境信息。"""
    print_env_info()


# ---------------------------------------------------------------------------
# Pipeline 流水线
# ---------------------------------------------------------------------------

def cmd_pipeline(args):
    """
    按配置文件执行多步流水线。

    配置文件格式 (JSON):
    {
      "steps": [
        {"action": "silence", "params": {"noise": -35, "duration": 0.6}},
        {"action": "whisper", "params": {"model": "small", "language": "zh"}},
        {"action": "subtitle", "params": {"style": "..."}},
        {"action": "bgm", "params": {"music": "/path/to/bgm.mp3", "music_volume": 0.2}},
        {"action": "concat", "params": {"intro": "/path/to/intro.mp4"}}
      ],
      "output": "final.mp4"
    }

    每步的输出自动作为下一步的输入。
    whisper 步骤生成字幕文件，subtitle 步骤自动使用上一步生成的字幕。
    """
    config_path = Path(args.config)
    if not config_path.exists():
        raise FileNotFoundError(f"配置文件不存在: {args.config}")

    config = json.loads(config_path.read_text(encoding="utf-8"))
    steps = config.get("steps", [])
    if not steps:
        logger.warning("无步骤可执行")
        return

    current_input = args.input
    subtitle_path: Optional[str] = None  # whisper 生成的字幕路径

    for i, step in enumerate(steps):
        action = step["action"]
        params = step.get("params", {})
        logger.info("=" * 60)
        logger.info("步骤 %d/%d: %s", i + 1, len(steps), action)
        logger.info("=" * 60)

        if action == "silence":
            current_input = remove_silence(current_input, **params)

        elif action == "cut":
            cuts = parse_cuts(params.get("cuts"), params.get("cuts_file"))
            results = cut_batch(current_input, cuts,
                                params.get("output_dir"),
                                merge=params.get("merge", True),
                                stream_copy=params.get("copy", False),
                                crf=params.get("crf", 18),
                                preset=params.get("preset", "medium"))
            current_input = results[0] if results else current_input

        elif action == "extract":
            mode = params.get("mode", "scene")
            if mode == "scene":
                results = extract_by_scenes(current_input,
                                            params.get("count", 5),
                                            min_duration=params.get("min_dur", 3.0),
                                            max_duration=params.get("max_dur", 60.0),
                                            scene_threshold=params.get("threshold", 0.4),
                                            ai_hook=params.get("ai_hook"))
            else:
                results = extract_uniform(current_input,
                                          params.get("count", 5),
                                          clip_duration=params.get("clip_dur", 10.0))
            # extract 产出多个文件，pipeline 取第一个或合并
            if results:
                current_input = results[0]
                logger.info("extract 产出 %d 个片段，pipeline 使用第一个", len(results))

        elif action == "whisper":
            subtitle_path = generate_subtitle_whisper(
                current_input,
                model_name=params.get("model", "base"),
                language=params.get("language"),
                output_format=params.get("format", "srt"),
            )

        elif action == "subtitle":
            sub = params.get("subtitle") or subtitle_path
            if not sub:
                raise RuntimeError("subtitle 步骤缺少字幕文件（前置 whisper 步骤或 params.subtitle）")
            current_input = burn_subtitle(
                current_input, sub,
                style=params.get("style"),
                fonts_dir=params.get("fonts_dir"),
                crf=params.get("crf", 18),
                preset=params.get("preset", "medium"),
            )

        elif action == "concat":
            current_input = concat_intro_outro(
                current_input,
                intro=params.get("intro"),
                outro=params.get("outro"),
                transition=params.get("transition", 0.0),
                crf=params.get("crf", 18),
                preset=params.get("preset", "medium"),
            )

        elif action == "bgm":
            music = params.get("music")
            if not music:
                raise RuntimeError("bgm 步骤缺少 music 参数")
            current_input = add_bgm(
                current_input, music,
                music_volume=params.get("music_volume", 0.3),
                video_volume=params.get("video_volume", 1.0),
                ducking=params.get("ducking", True),
                fade_in=params.get("fade_in", 2.0),
                fade_out=params.get("fade_out", 3.0),
                crf=params.get("crf", 18),
                preset=params.get("preset", "medium"),
            )

        else:
            raise ValueError(f"未知 action: {action}")

    # 最终输出重命名
    final_output = config.get("output")
    if final_output and final_output != current_input:
        import shutil
        shutil.copy2(current_input, final_output)
        current_input = final_output

    logger.info("=" * 60)
    logger.info("流水线完成，最终输出: %s", current_input)
    logger.info("=" * 60)
    return current_input


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser():
    import argparse
    ap = argparse.ArgumentParser(
        prog="auto_cut",
        description="视频自动剪辑工具 (去静音 / 时间戳剪切 / 抽片段 / 字幕包装 / 流水线)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("-v", "--verbose", action="store_true", help="详细日志")
    sub = ap.add_subparsers(dest="cmd", required=True)

    # --- silence ---
    p = sub.add_parser("silence", help="去除静音片段")
    p.add_argument("input")
    p.add_argument("-o", "--output")
    p.add_argument("--noise", type=float, default=-30.0, help="噪声阈值 dB")
    p.add_argument("--duration", type=float, default=0.5, help="最短静音时长秒")
    p.add_argument("--pad", type=float, default=0.2, help="静音两端缓冲秒")
    p.add_argument("--copy", action="store_true", help="流拷贝(快不精确)")
    p.add_argument("--crf", type=int, default=18)
    p.add_argument("--preset", default="medium")
    p.set_defaults(func=cmd_silence)

    # --- cut ---
    p = sub.add_parser("cut", help="按时间戳批量剪切")
    p.add_argument("input")
    p.add_argument("--cuts", nargs="+", help='时间段 "start,end"')
    p.add_argument("--cuts-file", help="时间戳文件 (.json/.csv)")
    p.add_argument("-o", "--output-dir")
    p.add_argument("--copy", action="store_true")
    p.add_argument("--merge", action="store_true", help="合并为一个文件")
    p.add_argument("--crf", type=int, default=18)
    p.add_argument("--preset", default="medium")
    p.set_defaults(func=cmd_cut)

    # --- extract ---
    p = sub.add_parser("extract", help="长视频抽片段")
    p.add_argument("input")
    p.add_argument("-n", "--count", type=int, default=5)
    p.add_argument("--mode", choices=["scene", "uniform"], default="scene")
    p.add_argument("--min-dur", type=float, default=3.0)
    p.add_argument("--max-dur", type=float, default=60.0)
    p.add_argument("--threshold", type=float, default=0.4)
    p.add_argument("--clip-dur", type=float, default=10.0)
    p.add_argument("-o", "--output-dir")
    p.add_argument("--copy", action="store_true")
    p.add_argument("--crf", type=int, default=18)
    p.add_argument("--preset", default="medium")
    p.add_argument("--ai-hook", help="AI 评分脚本")
    p.set_defaults(func=cmd_extract)

    # --- subtitle ---
    p = sub.add_parser("subtitle", help="烧录字幕")
    p.add_argument("video")
    p.add_argument("subtitle")
    p.add_argument("-o", "--output")
    p.add_argument("--style", help="force_style 字符串")
    p.add_argument("--fonts-dir")
    p.add_argument("--crf", type=int, default=18)
    p.add_argument("--preset", default="medium")
    p.set_defaults(func=cmd_subtitle)

    # --- concat ---
    p = sub.add_parser("concat", help="拼接片头片尾")
    p.add_argument("main")
    p.add_argument("--intro")
    p.add_argument("--outro")
    p.add_argument("-o", "--output")
    p.add_argument("--transition", type=float, default=0.0)
    p.add_argument("--crf", type=int, default=18)
    p.add_argument("--preset", default="medium")
    p.set_defaults(func=cmd_concat)

    # --- bgm ---
    p = sub.add_parser("bgm", help="添加背景音乐")
    p.add_argument("video")
    p.add_argument("music")
    p.add_argument("-o", "--output")
    p.add_argument("--music-vol", type=float, default=0.3)
    p.add_argument("--video-vol", type=float, default=1.0)
    p.add_argument("--no-ducking", action="store_true")
    p.add_argument("--fade-in", type=float, default=2.0)
    p.add_argument("--fade-out", type=float, default=3.0)
    p.add_argument("--crf", type=int, default=18)
    p.add_argument("--preset", default="medium")
    p.set_defaults(func=cmd_bgm)

    # --- whisper ---
    p = sub.add_parser("whisper", help="Whisper 生成字幕")
    p.add_argument("video")
    p.add_argument("--model", default="base")
    p.add_argument("--language")
    p.add_argument("--format", default="srt", choices=["srt", "vtt", "txt", "json"])
    p.add_argument("-o", "--output-dir")
    p.set_defaults(func=cmd_whisper)

    # --- pipeline ---
    p = sub.add_parser("pipeline", help="按配置文件执行多步流水线")
    p.add_argument("input", help="输入视频")
    p.add_argument("--config", required=True, help="流水线配置 JSON")
    p.set_defaults(func=cmd_pipeline)

    # --- info ---
    p = sub.add_parser("info", help="查看视频信息")
    p.add_argument("input")
    p.set_defaults(func=cmd_info)

    # --- env ---
    p = sub.add_parser("env", help="查看环境信息")
    p.set_defaults(func=cmd_env)

    return ap


def main():
    parser = build_parser()
    args = parser.parse_args()

    set_verbose(getattr(args, "verbose", False))

    # 非 env/info 命令需要检查工具
    if args.cmd not in ("env", "info"):
        ensure_tools()

    try:
        result = args.func(args)
        if result:
            if isinstance(result, list):
                logger.info("输出文件:")
                for r in result:
                    print(f"  {r}")
            elif isinstance(result, str):
                logger.info("输出: %s", result)
    except RuntimeError as e:
        logger.error("执行失败: %s", e)
        sys.exit(1)
    except KeyboardInterrupt:
        logger.info("用户中断")
        sys.exit(130)


if __name__ == "__main__":
    main()
