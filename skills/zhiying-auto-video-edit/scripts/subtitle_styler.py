"""
auto-video-edit / subtitle_styler.py
字幕与包装模块。

功能：
1. 字幕烧录：将 .srt/.ass/.vtt 字幕硬编码到视频
2. 字幕样式：从 .ass 模板加载或命令行参数定制
3. 片头片尾：拼接 intro/outro 视频
4. 转场：xfade 淡入淡出
5. 背景音乐：混音 + 自动音量对齐（ducking）

字幕生成 AI 接口（可选）：
  --whisper-model  用 OpenAI Whisper 本地模型从视频中提取字幕
  需要 whisper 包: pip install openai-whisper
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path
from typing import Optional

from utils import (
    FFMPEG_BIN,
    ensure_tools,
    format_seconds,
    logger,
    probe_media,
    run_command,
    unique_output_path,
)


# ---------------------------------------------------------------------------
# 字幕烧录
# ---------------------------------------------------------------------------

def burn_subtitle(
    video_path: str,
    subtitle_path: str,
    output_path: Optional[str] = None,
    *,
    style: Optional[str] = None,
    fonts_dir: Optional[str] = None,
    video_codec: str = "libx264",
    audio_codec: str = "aac",
    crf: int = 18,
    preset: str = "medium",
) -> str:
    """
    将字幕烧录（硬编码）到视频。

    Args:
        subtitle_path: .srt / .ass / .vtt 字幕文件
        style: subtitles 滤镜的 force_style 参数
            示例: "FontName=PingFang SC,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1"
            仅对 .srt/.vtt 生效；.ass 文件自带样式
        fonts_dir: 字体目录（含中文字体时需要）
    """
    ensure_tools()
    sub_path = Path(subtitle_path)
    if not sub_path.exists():
        raise FileNotFoundError(f"字幕文件不存在: {subtitle_path}")

    out = output_path or str(unique_output_path(video_path, "_sub.mp4"))

    # 构建 subtitles 滤镜
    # Windows 路径需要转义反斜杠；ffmpeg 滤镜中路径用正斜杠
    sub_filter_path = str(sub_path.absolute()).replace("\\", "/").replace(":", r"\:")

    if sub_path.suffix.lower() == ".ass":
        # ASS 文件自带样式，直接用 ass 滤镜
        vf = f"ass='{sub_filter_path}'"
    else:
        # SRT/VTT 用 subtitles 滤镜，可覆盖样式
        vf = f"subtitles='{sub_filter_path}'"
        if style:
            vf += f":force_style='{style}'"

    cmd = [
        FFMPEG_BIN,
        "-i", video_path,
        "-vf", vf,
        "-c:v", video_codec,
        "-crf", str(crf),
        "-preset", preset,
        "-c:a", audio_codec,
        "-b:a", "192k",
    ]

    if fonts_dir:
        cmd.extend(["-fonts_dir", fonts_dir])

    # 字幕相关环境变量
    env = None
    if fonts_dir:
        import os
        env = {**os.environ, "FONTCONFIG_PATH": fonts_dir}

    cmd.extend(["-y", out])
    logger.info("烧录字幕: %s", sub_path.name)
    run_command(cmd)
    logger.info("完成: %s", out)
    return out


# ---------------------------------------------------------------------------
# 片头片尾拼接
# ---------------------------------------------------------------------------

def concat_intro_outro(
    main_video: str,
    output_path: Optional[str] = None,
    *,
    intro: Optional[str] = None,
    outro: Optional[str] = None,
    transition: float = 0.0,
    crf: int = 18,
    preset: str = "medium",
) -> str:
    """
    拼接片头、主视频、片尾。

    Args:
        transition: 转场时长秒（0 = 无转场，直接拼接）
            有转场时使用 xfade，需要重新编码
    """
    ensure_tools()
    parts: list[str] = []
    if intro:
        if not Path(intro).exists():
            raise FileNotFoundError(f"片头文件不存在: {intro}")
        parts.append(intro)
    if not Path(main_video).exists():
        raise FileNotFoundError(f"主视频不存在: {main_video}")
    parts.append(main_video)
    if outro:
        if not Path(outro).exists():
            raise FileNotFoundError(f"片尾文件不存在: {outro}")
        parts.append(outro)

    if len(parts) == 1:
        logger.info("无需拼接（只有主视频）")
        return main_video

    out = output_path or str(unique_output_path(main_video, "_final.mp4"))

    if transition > 0:
        _concat_with_transition(parts, out, transition, crf, preset)
    else:
        _concat_simple(parts, out, crf, preset)

    logger.info("拼接完成: %s", out)
    return out


def _concat_simple(parts: list[str], output: str, crf: int, preset: str) -> None:
    """简单拼接：concat demuxer（流拷贝）或 filter concat（重编码）。"""
    tmp_dir = Path(tempfile.mkdtemp(prefix="concat_"))
    try:
        # 先将各段统一为相同编码格式（重编码到临时文件）
        norm_files: list[str] = []
        for i, p in enumerate(parts):
            norm = str(tmp_dir / f"norm_{i:02d}.mp4")
            logger.info("标准化片段 %d/%d: %s", i + 1, len(parts), p)
            cmd = [
                FFMPEG_BIN, "-i", p,
                "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
                "-c:a", "aac", "-b:a", "192k",
                "-r", "30",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",  # 确保偶数尺寸
                "-ar", "44100", "-ac", "2",
                "-y", norm,
            ]
            run_command(cmd)
            norm_files.append(norm)

        list_path = tmp_dir / "concat.txt"
        list_path.write_text(
            "\n".join(f"file '{f}'" for f in norm_files), encoding="utf-8"
        )
        cmd = [
            FFMPEG_BIN, "-f", "concat", "-safe", "0",
            "-i", str(list_path), "-c", "copy", "-y", output,
        ]
        run_command(cmd)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _concat_with_transition(
    parts: list[str], output: str, transition: float, crf: int, preset: str
) -> None:
    """带 xfade 转场的拼接。"""
    # 探测各段时长
    durations = []
    for p in parts:
        info = probe_media(p)
        durations.append(info.duration)

    # 构建 filter_complex
    # [0:v][1:v]xfade=transition=fade:duration=T:offset=D0-T[v01]
    # [v01][2:v]xfade=transition=fade:duration=T:offset=D0+D1-T[v012]
    filter_parts = []
    inputs = []
    for p in parts:
        inputs.extend(["-i", p])

    prev_label = "0:v"
    prev_audio = "0:a"
    offset = 0.0

    for i in range(1, len(parts)):
        offset += durations[i - 1] - transition
        v_label = f"v{i:02d}"
        a_label = f"a{i:02d}"
        filter_parts.append(
            f"[{prev_label}][{i}:v]xfade=transition=fade:duration={transition}:offset={offset:.3f}[{v_label}]"
        )
        filter_parts.append(
            f"[{prev_audio}][{i}:a]acrossfade=d={transition}[{a_label}]"
        )
        prev_label = v_label
        prev_audio = a_label

    filter_complex = ";".join(filter_parts)

    cmd = [
        FFMPEG_BIN, *inputs,
        "-filter_complex", filter_complex,
        "-map", f"[{prev_label}]", "-map", f"[{prev_audio}]",
        "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
        "-c:a", "aac", "-b:a", "192k",
        "-y", output,
    ]
    run_command(cmd)


# ---------------------------------------------------------------------------
# 背景音乐
# ---------------------------------------------------------------------------

def add_bgm(
    video_path: str,
    music_path: str,
    output_path: Optional[str] = None,
    *,
    music_volume: float = 0.3,
    video_volume: float = 1.0,
    ducking: bool = True,
    fade_in: float = 2.0,
    fade_out: float = 3.0,
    crf: int = 18,
    preset: str = "medium",
) -> str:
    """
    添加背景音乐。

    Args:
        music_volume: 音乐音量 (0-1)
        video_volume: 原声音量 (0-1)
        ducking: True 时自动降低音乐音量到 music_volume*0.3（当有原声说话时）
            需要原视频有音频轨；用 sidechaincompress 实现
        fade_in / fade_out: 音乐淡入淡出秒数
    """
    ensure_tools()
    if not Path(music_path).exists():
        raise FileNotFoundError(f"音乐文件不存在: {music_path}")

    out = output_path or str(unique_output_path(video_path, "_bgm.mp4"))
    info = probe_media(video_path)

    # 音乐淡入淡出 + 循环到视频时长 + 音量
    music_af = []
    if fade_in > 0:
        music_af.append(f"afade=t=in:st=0:d={fade_in}")
    if fade_out > 0:
        music_af.append(f"afade=t=out:st={max(0, info.duration - fade_out):.3f}:d={fade_out}")
    music_af.append(f"volume={music_volume}")

    # 循环音乐到视频时长
    # -stream_loop -1 配合 -t 实现循环
    music_filter = ",".join(music_af)

    if ducking:
        # sidechaincompress: 用原视频音频作为侧链，降低音乐音量
        filter_complex = (
            f"[1:a]{music_filter},apad[music];"
            f"[0:a][music]sidechaincompress=threshold=0.05:ratio=8:attack=200:release=1000[bgm];"
            f"[0:a]volume={video_volume}[voice];"
            f"[voice][bgm]amix=inputs=2:duration=first:dropout_transition=0[a]"
        )
        cmd = [
            FFMPEG_BIN,
            "-i", video_path,
            "-stream_loop", "-1", "-i", music_path,
            "-filter_complex", filter_complex,
            "-map", "0:v",
            "-map", "[a]",
            "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
            "-c:a", "aac", "-b:a", "192k",
            "-t", f"{info.duration:.3f}",
            "-y", out,
        ]
    else:
        filter_complex = (
            f"[1:a]{music_filter},apad[music];"
            f"[0:a]volume={video_volume}[voice];"
            f"[voice][music]amix=inputs=2:duration=first:dropout_transition=0[a]"
        )
        cmd = [
            FFMPEG_BIN,
            "-i", video_path,
            "-stream_loop", "-1", "-i", music_path,
            "-filter_complex", filter_complex,
            "-map", "0:v",
            "-map", "[a]",
            "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
            "-c:a", "aac", "-b:a", "192k",
            "-t", f"{info.duration:.3f}",
            "-y", out,
        ]

    logger.info("添加背景音乐 (ducking=%s, 音乐音量=%.1f)", ducking, music_volume)
    run_command(cmd)
    logger.info("完成: %s", out)
    return out


# ---------------------------------------------------------------------------
# AI 字幕生成（Whisper）
# ---------------------------------------------------------------------------

def generate_subtitle_whisper(
    video_path: str,
    *,
    model_name: str = "base",
    language: Optional[str] = None,
    output_format: str = "srt",
    output_dir: Optional[str] = None,
) -> str:
    """
    使用 OpenAI Whisper 从视频中提取字幕。

    需要: pip install openai-whisper
    依赖 ffmpeg（已有）。

    Args:
        model_name: tiny / base / small / medium / large
            tiny 最快精度低；medium 中文效果不错；large 最好但慢
        language: 强制语言代码如 "zh"/"en"，None 自动检测
        output_format: srt / vtt / txt / json
    """
    try:
        import whisper
    except ImportError:
        raise RuntimeError(
            "未安装 openai-whisper。安装: pip install openai-whisper"
            "（首次使用会下载模型，请确保网络通畅）"
        )

    logger.info("加载 Whisper 模型: %s (首次需下载)", model_name)
    model = whisper.load_model(model_name)

    logger.info("开始识别: %s", video_path)
    options = {}
    if language:
        options["language"] = language

    result = model.transcribe(video_path, **options)

    in_path = Path(video_path)
    out_dir = Path(output_dir) if output_dir else in_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{in_path.stem}.{output_format}"

    if output_format == "srt":
        _write_srt(result["segments"], out_path)
    elif output_format == "vtt":
        _write_vtt(result["segments"], out_path)
    elif output_format == "txt":
        out_path.write_text(result["text"], encoding="utf-8")
    elif output_format == "json":
        import json
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2),
                            encoding="utf-8")

    logger.info("字幕生成完成: %s", out_path)
    return str(out_path)


def _format_srt_time(seconds: float) -> str:
    """SRT 时间格式: HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _write_srt(segments: list, path: Path) -> None:
    lines = []
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{_format_srt_time(seg['start'])} --> {_format_srt_time(seg['end'])}")
        lines.append(seg["text"].strip())
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def _write_vtt(segments: list, path: Path) -> None:
    lines = ["WEBVTT", ""]
    for seg in segments:
        start = _format_srt_time(seg["start"]).replace(",", ".")
        end = _format_srt_time(seg["end"]).replace(",", ".")
        lines.append(f"{start} --> {end}")
        lines.append(seg["text"].strip())
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="字幕与包装")
    sub = ap.add_subparsers(dest="cmd", required=True)

    # 烧录字幕
    p1 = sub.add_parser("burn", help="烧录字幕")
    p1.add_argument("video")
    p1.add_argument("subtitle")
    p1.add_argument("-o", "--output")
    p1.add_argument("--style", help="字幕样式 force_style 字符串")
    p1.add_argument("--fonts-dir", help="字体目录")
    p1.add_argument("--crf", type=int, default=18)
    p1.add_argument("--preset", default="medium")

    # 拼接片头片尾
    p2 = sub.add_parser("concat", help="拼接片头片尾")
    p2.add_argument("main", help="主视频")
    p2.add_argument("--intro")
    p2.add_argument("--outro")
    p2.add_argument("-o", "--output")
    p2.add_argument("--transition", type=float, default=0.0, help="转场时长秒")
    p2.add_argument("--crf", type=int, default=18)
    p2.add_argument("--preset", default="medium")

    # 背景音乐
    p3 = sub.add_parser("bgm", help="添加背景音乐")
    p3.add_argument("video")
    p3.add_argument("music")
    p3.add_argument("-o", "--output")
    p3.add_argument("--music-vol", type=float, default=0.3)
    p3.add_argument("--video-vol", type=float, default=1.0)
    p3.add_argument("--no-ducking", action="store_true", help="禁用 ducking")
    p3.add_argument("--fade-in", type=float, default=2.0)
    p3.add_argument("--fade-out", type=float, default=3.0)
    p3.add_argument("--crf", type=int, default=18)
    p3.add_argument("--preset", default="medium")

    # Whisper 字幕生成
    p4 = sub.add_parser("whisper", help="Whisper 生成字幕")
    p4.add_argument("video")
    p4.add_argument("--model", default="base", help="tiny/base/small/medium/large")
    p4.add_argument("--language", help="语言代码 zh/en")
    p4.add_argument("--format", default="srt", choices=["srt", "vtt", "txt", "json"])
    p4.add_argument("-o", "--output-dir")

    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    from utils import set_verbose
    set_verbose(args.verbose)

    if args.cmd == "burn":
        burn_subtitle(args.video, args.subtitle, args.output,
                      style=args.style, fonts_dir=args.fonts_dir,
                      crf=args.crf, preset=args.preset)
    elif args.cmd == "concat":
        concat_intro_outro(args.main, args.output,
                           intro=args.intro, outro=args.outro,
                           transition=args.transition, crf=args.crf, preset=args.preset)
    elif args.cmd == "bgm":
        add_bgm(args.video, args.music, args.output,
                music_volume=args.music_vol, video_volume=args.video_vol,
                ducking=not args.no_ducking,
                fade_in=args.fade_in, fade_out=args.fade_out,
                crf=args.crf, preset=args.preset)
    elif args.cmd == "whisper":
        generate_subtitle_whisper(args.video, model_name=args.model,
                                  language=args.language,
                                  output_format=args.format,
                                  output_dir=args.output_dir)
