"""
auto-video-edit / silence_remover.py
智能静音检测与裁剪模块。

工作原理：
1. 使用 ffmpeg silencedetect 滤镜扫描音频，找出所有静音片段
2. 反转得到"有效声音片段"列表
3. 将有效片段提取并拼接为最终视频（重新编码，保证精度）

支持参数：
  --noise      噪声阈值 dB（默认 -30，越小越严格）
  --duration   最短静音时长秒（默认 0.5，短于此不裁）
  --pad        静音两端保留的缓冲秒（默认 0.2，避免削掉尾音）
  --copy       使用流拷贝（快但不精确，可能不在关键帧对齐）
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Optional

from utils import (
    FFMPEG_BIN,
    FFPROBE_BIN,
    ensure_tools,
    format_seconds,
    logger,
    probe_media,
    run_command,
    unique_output_path,
)


def detect_silence(
    video_path: str,
    noise_db: float = -30.0,
    min_duration: float = 0.5,
) -> list[tuple[float, float]]:
    """
    检测视频中的静音片段。

    Returns:
        [(silence_start, silence_end), ...] 每个静音段的起止秒数。
    """
    cmd = [
        FFMPEG_BIN,
        "-i", video_path,
        "-af", f"silencedetect=noise={noise_db}dB:d={min_duration}",
        "-f", "null", "-",
        "-vn",  # 不处理视频，加速
    ]
    # silencedetect 输出到 stderr
    result = run_command(cmd, capture=True, check=False)

    starts: list[float] = []
    ends: list[float] = []
    for line in result.stderr.splitlines():
        m = re.search(r"silence_start:\s*([\d.]+)", line)
        if m:
            starts.append(float(m.group(1)))
        m = re.search(r"silence_end:\s*([\d.]+)", line)
        if m:
            ends.append(float(m.group(1)))

    # 配对：正常情况下 start 和 end 交替出现
    silences: list[tuple[float, float]] = []
    if starts and ends:
        # 如果第一个 end 在第一个 start 之前，说明开头就是静音
        if ends[0] < starts[0]:
            silences.append((0.0, ends[0]))
            ends = ends[1:]
        for i, s in enumerate(starts):
            if i < len(ends):
                silences.append((s, ends[i]))
    elif ends and not starts:
        # 整个开头都是静音直到第一个 end
        silences.append((0.0, ends[0]))

    logger.info("检测到 %d 段静音:", len(silences))
    for s, e in silences:
        logger.info("  %s → %s (时长 %.2fs)", format_seconds(s), format_seconds(e), e - s)

    return silences


def silence_to_keep(
    silences: list[tuple[float, float]],
    total_duration: float,
    pad: float = 0.2,
) -> list[tuple[float, float]]:
    """
    将静音片段反转为"保留片段"列表。

    pad: 每段静音两端各保留 pad 秒，避免削掉尾音/呼吸。
    """
    keep: list[tuple[float, float]] = []
    cursor = 0.0

    for s, e in silences:
        # 保留静音前的声音片段
        seg_start = cursor
        seg_end = max(cursor, s - pad)
        if seg_end > seg_start:
            keep.append((seg_start, seg_end))
        cursor = e + pad  # 跳过静音（带缓冲）

    # 最后一段
    if cursor < total_duration:
        keep.append((cursor, total_duration))

    # 合并重叠（pad 可能导致相邻片段重叠）
    merged: list[tuple[float, float]] = []
    for s, e in keep:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))

    logger.info("保留 %d 段有效内容:", len(merged))
    for s, e in merged:
        logger.info("  %s → %s (时长 %.2fs)", format_seconds(s), format_seconds(e), e - s)

    return merged


def _build_reencode_filter(segments: list[tuple[float, float]]) -> str:
    """
    构建 filter_complex 字符串，用 select + between 提取片段并 concat。
    视频流：select='between(t,start,end)' + setpts
    音频流：aselect='between(t,start,end)' + asetpts
    """
    video_selects = "+".join(
        f"between(t,{s},{e})" for s, e in segments
    )
    audio_selects = video_selects  # 相同表达式

    parts = []
    parts.append(f"[0:v]select='{video_selects}',setpts=N/FRAME_RATE/TB[v]")
    parts.append(f"[0:a]aselect='{audio_selects}',asetpts=N/SR/TB[a]")
    return ";".join(parts)


def remove_silence(
    input_path: str,
    output_path: Optional[str] = None,
    *,
    noise_db: float = -30.0,
    min_duration: float = 0.5,
    pad: float = 0.2,
    stream_copy: bool = False,
    video_codec: str = "libx264",
    audio_codec: str = "aac",
    crf: int = 18,
    preset: str = "medium",
) -> str:
    """
    主入口：去除视频中的静音片段。

    Args:
        input_path: 输入视频路径
        output_path: 输出路径，None 时自动生成
        noise_db: 噪声阈值 dB
        min_duration: 最短静音时长
        pad: 静音两端保留的缓冲
        stream_copy: True 用流拷贝（快、不精确）；False 重新编码（慢、精确）
        video_codec / audio_codec / crf / preset: 重新编码参数

    Returns:
        输出文件路径
    """
    ensure_tools()

    if not Path(input_path).exists():
        raise FileNotFoundError(f"输入文件不存在: {input_path}")

    info = probe_media(input_path)
    logger.info("输入: %s (%s, 时长 %s)", input_path, info.resolution, info.duration_str)

    silences = detect_silence(input_path, noise_db, min_duration)

    if not silences:
        logger.info("未检测到静音，无需处理")
        return input_path

    segments = silence_to_keep(silences, info.duration, pad)

    if not segments:
        logger.warning("所有内容均为静音，不输出文件")
        return ""

    out = output_path or str(unique_output_path(input_path, "_nosilence.mp4"))

    if stream_copy:
        # 流拷贝模式：用 concat demuxer，需要先截取每段再合并
        # 注意：-ss/-to 流拷贝会跳到最近关键帧，精度较低
        _concat_copy(input_path, segments, out)
    else:
        # 重新编码：filter_complex 一次完成
        filter_complex = _build_reencode_filter(segments)
        cmd = [
            FFMPEG_BIN,
            "-i", input_path,
            "-filter_complex", filter_complex,
            "-map", "[v]",
            "-map", "[a]",
            "-c:v", video_codec,
            "-crf", str(crf),
            "-preset", preset,
            "-c:a", audio_codec,
            "-b:a", "192k",
            "-y", out,
        ]
        logger.info("开始重新编码去静音...")
        run_command(cmd)

    # 统计
    out_info = probe_media(out)
    saved = info.duration - out_info.duration
    logger.info(
        "完成: %s (原 %s → 现 %s，节省 %s)",
        out, info.duration_str, out_info.duration_str, format_seconds(saved),
    )
    return out


def _concat_copy(input_path: str, segments: list[tuple[float, float]], output: str) -> None:
    """流拷贝模式：先逐段截取到临时文件，再用 concat demuxer 合并。"""
    import tempfile
    tmp_dir = Path(tempfile.mkdtemp(prefix="silence_cut_"))
    seg_files: list[str] = []

    try:
        for i, (s, e) in enumerate(segments):
            seg_path = str(tmp_dir / f"seg_{i:04d}.mp4")
            duration = e - s
            cmd = [
                FFMPEG_BIN,
                "-ss", f"{s:.3f}",
                "-i", input_path,
                "-t", f"{duration:.3f}",
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                "-y", seg_path,
            ]
            run_command(cmd, check=False)  # 某段失败不致命
            seg_files.append(seg_path)

        # concat list
        list_path = tmp_dir / "concat.txt"
        list_path.write_text(
            "\n".join(f"file '{f}'" for f in seg_files), encoding="utf-8"
        )

        cmd = [
            FFMPEG_BIN,
            "-f", "concat", "-safe", "0",
            "-i", str(list_path),
            "-c", "copy",
            "-y", output,
        ]
        run_command(cmd)
        logger.info("流拷贝合并完成")
    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="去除视频静音片段")
    ap.add_argument("input", help="输入视频路径")
    ap.add_argument("-o", "--output", help="输出路径")
    ap.add_argument("--noise", type=float, default=-30.0, help="噪声阈值 dB (默认 -30)")
    ap.add_argument("--duration", type=float, default=0.5, help="最短静音时长秒 (默认 0.5)")
    ap.add_argument("--pad", type=float, default=0.2, help="静音两端保留缓冲秒 (默认 0.2)")
    ap.add_argument("--copy", action="store_true", help="流拷贝模式 (快但不精确)")
    ap.add_argument("--crf", type=int, default=18, help="视频质量 CRF (默认 18)")
    ap.add_argument("--preset", default="medium", help="x264 preset (默认 medium)")
    ap.add_argument("-v", "--verbose", action="store_true", help="详细日志")
    args = ap.parse_args()

    from utils import set_verbose
    set_verbose(args.verbose)
    remove_silence(
        args.input,
        args.output,
        noise_db=args.noise,
        min_duration=args.duration,
        pad=args.pad,
        stream_copy=args.copy,
        crf=args.crf,
        preset=args.preset,
    )
