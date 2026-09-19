"""
auto-video-edit / timestamp_cutter.py
按时间戳批量剪切视频模块。

支持两种模式：
1. 批量截取：根据 [(start, end), ...] 列表，每段输出一个独立文件
2. 截取并合并：将所有截取片段合并为一个文件

时间戳来源：
  - 命令行参数：--cuts "00:00:10,00:00:30" "00:01:00,00:01:45"
  - JSON 文件：--cuts-file cuts.json  [{"start": "0:10", "end": "0:30"}, ...]
  - CSV 文件：--cuts-file cuts.csv   start,end（表头可选）

剪切精度：
  - 默认重新编码（精确到帧）
  - --copy 流拷贝（快，跳到最近关键帧）
"""

from __future__ import annotations

import csv
import json
import sys
import tempfile
from pathlib import Path
from typing import Optional

from utils import (
    FFMPEG_BIN,
    ensure_tools,
    format_seconds,
    logger,
    parse_time_to_seconds,
    probe_media,
    run_command,
    unique_output_path,
)


def parse_cuts(
    cli_cuts: Optional[list[str]] = None,
    cuts_file: Optional[str] = None,
) -> list[tuple[float, float]]:
    """
    解析时间戳列表为 [(start_sec, end_sec), ...]。

    CLI 格式：每个元素为 "start,end"
    文件格式：JSON 或 CSV
    """
    raw_pairs: list[tuple[str, str]] = []

    if cli_cuts:
        for item in cli_cuts:
            # 支持 "start,end" 或 "start end"
            parts = item.replace(" ", ",").split(",")
            if len(parts) != 2:
                raise ValueError(f"时间戳格式错误: {item}，应为 'start,end'")
            raw_pairs.append((parts[0].strip(), parts[1].strip()))

    if cuts_file:
        path = Path(cuts_file)
        if not path.exists():
            raise FileNotFoundError(f"时间戳文件不存在: {cuts_file}")

        suffix = path.suffix.lower()
        if suffix == ".json":
            data = json.loads(path.read_text(encoding="utf-8"))
            for item in data:
                if isinstance(item, dict):
                    raw_pairs.append((str(item["start"]), str(item["end"])))
                elif isinstance(item, (list, tuple)) and len(item) == 2:
                    raw_pairs.append((str(item[0]), str(item[1])))
        elif suffix in (".csv", ".txt"):
            with open(path, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                for row in reader:
                    if not row or len(row) < 2:
                        continue
                    # 跳过表头
                    if row[0].lower() in ("start", "开始", "in"):
                        continue
                    raw_pairs.append((row[0].strip(), row[1].strip()))
        else:
            raise ValueError(f"不支持的时间戳文件格式: {suffix}（支持 .json / .csv）")

    if not raw_pairs:
        raise ValueError("未提供任何时间戳")

    pairs = []
    for s, e in raw_pairs:
        start = parse_time_to_seconds(s)
        end = parse_time_to_seconds(e)
        if end <= start:
            logger.warning("跳过无效时间段: %s→%s (end<=start)", s, e)
            continue
        pairs.append((start, end))

    logger.info("解析到 %d 个时间段:", len(pairs))
    for s, e in pairs:
        logger.info("  %s → %s (%.2fs)", format_seconds(s), format_seconds(e), e - s)

    return pairs


def cut_segment(
    input_path: str,
    start: float,
    end: float,
    output_path: str,
    *,
    stream_copy: bool = False,
    video_codec: str = "libx264",
    audio_codec: str = "aac",
    crf: int = 18,
    preset: str = "medium",
) -> str:
    """
    截取单个片段。

    重新编码模式：-ss 放在 -i 后面（精确到帧）
    流拷贝模式：-ss 放在 -i 前面（快，跳关键帧）
    """
    duration = end - start

    if stream_copy:
        cmd = [
            FFMPEG_BIN,
            "-ss", f"{start:.3f}",
            "-i", input_path,
            "-t", f"{duration:.3f}",
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            "-y", output_path,
        ]
    else:
        cmd = [
            FFMPEG_BIN,
            "-i", input_path,
            "-ss", f"{start:.3f}",
            "-t", f"{duration:.3f}",
            "-c:v", video_codec,
            "-crf", str(crf),
            "-preset", preset,
            "-c:a", audio_codec,
            "-b:a", "192k",
            "-y", output_path,
        ]

    run_command(cmd)
    return output_path


def cut_batch(
    input_path: str,
    cuts: list[tuple[float, float]],
    output_dir: Optional[str] = None,
    *,
    stream_copy: bool = False,
    merge: bool = False,
    crf: int = 18,
    preset: str = "medium",
) -> list[str]:
    """
    批量截取。

    Args:
        cuts: [(start, end), ...]
        output_dir: 输出目录，None 时用输入文件所在目录
        stream_copy: 流拷贝
        merge: True 时将所有片段合并为一个文件

    Returns:
        输出文件路径列表
    """
    ensure_tools()

    if not Path(input_path).exists():
        raise FileNotFoundError(f"输入文件不存在: {input_path}")

    in_path = Path(input_path)
    out_dir = Path(output_dir) if output_dir else in_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    results: list[str] = []

    if merge:
        # 先截取各段到临时目录，再合并
        tmp_dir = Path(tempfile.mkdtemp(prefix="ts_cut_"))
        seg_files: list[str] = []
        try:
            for i, (s, e) in enumerate(cuts):
                seg = str(tmp_dir / f"seg_{i:04d}.mp4")
                logger.info("截取片段 %d/%d: %s → %s", i + 1, len(cuts),
                            format_seconds(s), format_seconds(e))
                cut_segment(input_path, s, e, seg,
                            stream_copy=stream_copy, crf=crf, preset=preset)
                seg_files.append(seg)

            merged_path = str(unique_output_path(in_path, "_merged.mp4", output_dir=out_dir))

            if stream_copy:
                # concat demuxer
                list_path = tmp_dir / "concat.txt"
                list_path.write_text(
                    "\n".join(f"file '{f}'" for f in seg_files), encoding="utf-8"
                )
                cmd = [
                    FFMPEG_BIN, "-f", "concat", "-safe", "0",
                    "-i", str(list_path), "-c", "copy", "-y", merged_path,
                ]
            else:
                # filter concat
                inputs = []
                for f in seg_files:
                    inputs.extend(["-i", f])
                filt = "".join(f"[{i}:v][{i}:a]" for i in range(len(seg_files)))
                filt += f"concat=n={len(seg_files)}:v=1:a=1[v][a]"
                cmd = [
                    FFMPEG_BIN, *inputs,
                    "-filter_complex", filt,
                    "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
                    "-c:a", "aac", "-b:a", "192k",
                    "-y", merged_path,
                ]
            run_command(cmd)
            results.append(merged_path)
            logger.info("合并完成: %s", merged_path)
        finally:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
    else:
        # 各段独立输出
        for i, (s, e) in enumerate(cuts):
            out_name = f"{in_path.stem}_cut_{i+1:03d}.mp4"
            out_path = str(out_dir / out_name)
            logger.info("截取片段 %d/%d → %s", i + 1, len(cuts), out_path)
            cut_segment(input_path, s, e, out_path,
                        stream_copy=stream_copy, crf=crf, preset=preset)
            results.append(out_path)

    return results


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="按时间戳批量剪切视频")
    ap.add_argument("input", help="输入视频路径")
    ap.add_argument("--cuts", nargs="+", help='时间段列表，格式 "start,end"')
    ap.add_argument("--cuts-file", help="时间戳文件 (.json/.csv)")
    ap.add_argument("-o", "--output-dir", help="输出目录")
    ap.add_argument("--copy", action="store_true", help="流拷贝 (快但不精确)")
    ap.add_argument("--merge", action="store_true", help="将各片段合并为一个文件")
    ap.add_argument("--crf", type=int, default=18)
    ap.add_argument("--preset", default="medium")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    from utils import set_verbose
    set_verbose(args.verbose)

    cuts = parse_cuts(args.cuts, args.cuts_file)
    cut_batch(
        args.input, cuts, args.output_dir,
        stream_copy=args.copy, merge=args.merge,
        crf=args.crf, preset=args.preset,
    )
