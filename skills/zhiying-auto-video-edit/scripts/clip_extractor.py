"""
auto-video-edit / clip_extractor.py
长视频抽片段模块。

两种提取策略：
1. 场景驱动：用 ffmpeg scdet 检测场景切换点，按场景边界切分，提取指定数量的片段
2. 均匀驱动：按时长均匀切分，提取 N 个等长片段

AI 增强接口（可选）：
  - 通过 --ai-hook 指定外部脚本，接收候选片段 JSON，返回评分/筛选结果
  - 脚本需接受 stdin JSON，输出 stdout JSON
  - 格式见 references/workflow.md
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
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
from timestamp_cutter import cut_segment


@dataclass
class ClipCandidate:
    """候选片段。"""
    index: int
    start: float
    end: float
    score: float = 0.0       # AI 评分（0-1），无 AI 时用场景变化强度
    label: str = ""          # AI 标注的标签
    path: str = ""           # 提取后的文件路径


def detect_scenes(
    video_path: str,
    threshold: float = 0.4,
) -> list[tuple[float, float, float]]:
    """
    检测场景切换点。

    Args:
        threshold: 场景变化阈值 0-1，越大越严格（默认 0.4）

    Returns:
        [(start, end, score), ...] 每个场景的起止和变化强度
    """
    cmd = [
        FFMPEG_BIN,
        "-i", video_path,
        "-filter:v", f"scdet=threshold={threshold*100:.0f}",
        "-f", "null", "-",
    ]
    result = run_command(cmd, capture=True, check=False)

    # 解析 scdet 输出: "sc_time:12.345 sc_score:0.5678"
    change_points: list[tuple[float, float]] = []
    for line in result.stderr.splitlines():
        m = re.search(r"sc_time:\s*([\d.]+)\s+sc_score:\s*([\d.]+)", line)
        if m:
            t = float(m.group(1))
            score = float(m.group(2))
            change_points.append((t, score))

    if not change_points:
        logger.info("未检测到场景切换（阈值 %.2f）", threshold)
        return []

    info = probe_media(video_path)

    # 构建场景段：第0秒 → 第一个切换点 → ... → 结尾
    boundaries = [0.0] + [t for t, _ in change_points] + [info.duration]
    scenes: list[tuple[float, float, float]] = []
    for i in range(len(boundaries) - 1):
        s = boundaries[i]
        e = boundaries[i + 1]
        # 用该场景的切换强度作为评分（第一个场景用0）
        score = change_points[i][1] if i < len(change_points) else 0.0
        scenes.append((s, e, score))

    logger.info("检测到 %d 个场景:", len(scenes))
    for i, (s, e, sc) in enumerate(scenes):
        logger.info("  场景 %d: %s → %s (%.1fs, 强度 %.2f)",
                    i + 1, format_seconds(s), format_seconds(e), e - s, sc)

    return scenes


def extract_by_scenes(
    input_path: str,
    count: int = 5,
    *,
    min_duration: float = 3.0,
    max_duration: float = 60.0,
    scene_threshold: float = 0.4,
    output_dir: Optional[str] = None,
    stream_copy: bool = False,
    crf: int = 18,
    preset: str = "medium",
    ai_hook: Optional[str] = None,
) -> list[str]:
    """
    基于场景检测提取片段。

    Args:
        count: 要提取的片段数
        min_duration: 片段最短时长（秒），过滤过短场景
        max_duration: 片段最长时长（秒），过长场景截断
        scene_threshold: 场景检测阈值
        ai_hook: AI 评分脚本路径（可选）
    """
    ensure_tools()
    info = probe_media(input_path)
    logger.info("输入: %s (时长 %s)", input_path, info.duration_str)

    scenes = detect_scenes(input_path, scene_threshold)
    if not scenes:
        logger.warning("未检测到场景，回退到均匀切分")
        return extract_uniform(input_path, count, output_dir=output_dir,
                               stream_copy=stream_copy, crf=crf, preset=preset)

    # 过滤过短场景
    candidates: list[ClipCandidate] = []
    for i, (s, e, score) in enumerate(scenes):
        dur = e - s
        if dur < min_duration:
            logger.debug("跳过过短场景 %d (%.1fs)", i + 1, dur)
            continue
        # 截断过长场景
        if dur > max_duration:
            e = s + max_duration
        candidates.append(ClipCandidate(
            index=i, start=s, end=e, score=score / 100.0,
        ))

    if not candidates:
        logger.warning("所有场景都被过滤，回退到均匀切分")
        return extract_uniform(input_path, count, output_dir=output_dir,
                               stream_copy=stream_copy, crf=crf, preset=preset)

    # AI 评分（可选）
    if ai_hook:
        candidates = _apply_ai_hook(ai_hook, candidates, input_path, info)

    # 按评分排序，取前 count 个
    candidates.sort(key=lambda c: c.score, reverse=True)
    selected = candidates[:count]
    # 按时间顺序排列
    selected.sort(key=lambda c: c.start)

    logger.info("选中 %d 个片段:", len(selected))
    for c in selected:
        logger.info("  片段 %d: %s → %s (评分 %.2f%s)",
                    c.index + 1, format_seconds(c.start), format_seconds(c.end),
                    c.score, f" [{c.label}]" if c.label else "")

    # 提取
    in_path = Path(input_path)
    out_dir = Path(output_dir) if output_dir else in_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    results: list[str] = []
    for i, c in enumerate(selected):
        out_name = f"{in_path.stem}_clip_{i+1:02d}.mp4"
        out_path = str(out_dir / out_name)
        logger.info("提取片段 %d/%d → %s", i + 1, len(selected), out_path)
        cut_segment(input_path, c.start, c.end, out_path,
                    stream_copy=stream_copy, crf=crf, preset=preset)
        results.append(out_path)

    return results


def extract_uniform(
    input_path: str,
    count: int = 5,
    *,
    clip_duration: float = 10.0,
    output_dir: Optional[str] = None,
    stream_copy: bool = False,
    crf: int = 18,
    preset: str = "medium",
) -> list[str]:
    """
    均匀切分提取：在视频总时长内均匀取 count 个 clip_duration 秒的片段。
    """
    ensure_tools()
    info = probe_media(input_path)
    logger.info("输入: %s (时长 %s)", input_path, info.duration_str)

    if info.duration <= 0:
        raise RuntimeError("无法获取视频时长")

    # 计算每个片段的中心点，均匀分布
    total = info.duration
    if count == 1:
        centers = [total / 2]
    else:
        step = total / count
        centers = [step * (i + 0.5) for i in range(count)]

    in_path = Path(input_path)
    out_dir = Path(output_dir) if output_dir else in_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    results: list[str] = []
    for i, center in enumerate(centers):
        start = max(0, center - clip_duration / 2)
        end = min(total, start + clip_duration)
        if end - start < clip_duration:
            start = max(0, end - clip_duration)

        out_name = f"{in_path.stem}_clip_{i+1:02d}.mp4"
        out_path = str(out_dir / out_name)
        logger.info("提取片段 %d/%d: %s → %s → %s",
                    i + 1, count, format_seconds(start),
                    format_seconds(end), out_path)
        cut_segment(input_path, start, end, out_path,
                    stream_copy=stream_copy, crf=crf, preset=preset)
        results.append(out_path)

    return results


def _apply_ai_hook(
    hook_path: str,
    candidates: list[ClipCandidate],
    video_path: str,
    info,
) -> list[ClipCandidate]:
    """
    调用外部 AI 脚本对候选片段评分。

    输入 JSON:
      {"video": "...", "duration": 123.4, "clips": [
        {"index": 0, "start": 1.2, "end": 5.6, "score": 0.3}, ...
      ]}

    输出 JSON:
      {"clips": [{"index": 0, "score": 0.9, "label": "精彩对话"}, ...]}

    脚本示例见 references/workflow.md
    """
    logger.info("调用 AI 评分脚本: %s", hook_path)

    payload = {
        "video": video_path,
        "duration": info.duration,
        "resolution": info.resolution,
        "fps": info.fps,
        "clips": [
            {"index": c.index, "start": c.start, "end": c.end, "score": c.score}
            for c in candidates
        ],
    }

    try:
        proc = subprocess.run(
            [hook_path],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=300,
        )
        if proc.returncode != 0:
            logger.error("AI 脚本失败: %s", proc.stderr[-500:])
            return candidates

        result = json.loads(proc.stdout)
        scored: dict[int, tuple[float, str]] = {}
        for item in result.get("clips", []):
            idx = item["index"]
            scored[idx] = (float(item.get("score", 0)), item.get("label", ""))

        for c in candidates:
            if c.index in scored:
                c.score, c.label = scored[c.index]

        logger.info("AI 评分完成")
    except Exception as e:
        logger.error("AI 脚本异常: %s", e)

    return candidates


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="长视频抽片段")
    ap.add_argument("input", help="输入视频路径")
    ap.add_argument("-n", "--count", type=int, default=5, help="提取片段数 (默认 5)")
    ap.add_argument("--mode", choices=["scene", "uniform"], default="scene",
                    help="提取模式: scene(场景检测) / uniform(均匀切分)")
    ap.add_argument("--min-dur", type=float, default=3.0, help="片段最短时长秒")
    ap.add_argument("--max-dur", type=float, default=60.0, help="片段最长时长秒")
    ap.add_argument("--threshold", type=float, default=0.4, help="场景检测阈值 0-1")
    ap.add_argument("--clip-dur", type=float, default=10.0, help="均匀模式片段时长秒")
    ap.add_argument("-o", "--output-dir", help="输出目录")
    ap.add_argument("--copy", action="store_true", help="流拷贝")
    ap.add_argument("--crf", type=int, default=18)
    ap.add_argument("--preset", default="medium")
    ap.add_argument("--ai-hook", help="AI 评分脚本路径 (可选)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    from utils import set_verbose
    set_verbose(args.verbose)

    if args.mode == "scene":
        extract_by_scenes(
            args.input, args.count,
            min_duration=args.min_dur, max_duration=args.max_dur,
            scene_threshold=args.threshold,
            output_dir=args.output_dir, stream_copy=args.copy,
            crf=args.crf, preset=args.preset, ai_hook=args.ai_hook,
        )
    else:
        extract_uniform(
            args.input, args.count,
            clip_duration=args.clip_dur,
            output_dir=args.output_dir, stream_copy=args.copy,
            crf=args.crf, preset=args.preset,
        )
