"""
auto-video-edit / utils.py
通用工具模块：ffmpeg/ffprobe 路径检测、视频信息探测、时间转换、命令执行、日志。
所有子模块统一依赖本文件，确保环境适配一致。
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# 日志配置
# ---------------------------------------------------------------------------

_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, stream=sys.stderr)
logger = logging.getLogger("auto_video_edit")


def set_verbose(verbose: bool = False) -> None:
    """切换日志级别：verbose=True 时输出 DEBUG 级别（含 ffmpeg 原始命令）。"""
    logging.getLogger().setLevel(logging.DEBUG if verbose else logging.INFO)


# ---------------------------------------------------------------------------
# ffmpeg / ffprobe 路径解析
# ---------------------------------------------------------------------------

# 优先级：环境变量 > PATH 自动查找 > 常见安装路径
_FFMPEG_CANDIDATES = [
    os.environ.get("FFMPEG_BIN"),
    shutil.which("ffmpeg"),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
]

_FFPORBE_CANDIDATES = [
    os.environ.get("FFPROBE_BIN"),
    shutil.which("ffprobe"),
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
]


def _resolve(candidates):
    for c in candidates:
        if c and Path(c).exists() and os.access(c, os.X_OK):
            return str(c)
    return None


FFMPEG_BIN: str = _resolve(_FFMPEG_CANDIDATES) or "ffmpeg"
FFPROBE_BIN: str = _resolve(_FFPORBE_CANDIDATES) or "ffprobe"


def ensure_tools() -> None:
    """检查 ffmpeg/ffprobe 是否可用，不可用则抛出 RuntimeError。"""
    missing = []
    if not shutil.which(FFMPEG_BIN) and not Path(FFMPEG_BIN).exists():
        missing.append("ffmpeg")
    if not shutil.which(FFPROBE_BIN) and not Path(FFPROBE_BIN).exists():
        missing.append("ffprobe")
    if missing:
        raise RuntimeError(
            f"未找到 {', '.join(missing)}，请安装后重试。"
            "macOS: brew install ffmpeg；Windows: 下载 https://ffmpeg.org/download.html"
        )


# ---------------------------------------------------------------------------
# 时间工具
# ---------------------------------------------------------------------------

def parse_time_to_seconds(time_str: str) -> float:
    """
    将时间字符串转为秒数。支持：
      - 纯秒数: "90", "90.5"
      - MM:SS: "1:30"
      - HH:MM:SS: "1:02:03"
      - HH:MM:SS.mmm: "1:02:03.500"
    """
    time_str = str(time_str).strip()
    if not time_str:
        raise ValueError("时间字符串为空")

    # 纯数字 → 秒
    if re.fullmatch(r"\d+(\.\d+)?", time_str):
        return float(time_str)

    parts = time_str.split(":")
    if len(parts) == 2:  # MM:SS
        h, m, s = 0, int(parts[0]), float(parts[1])
    elif len(parts) == 3:  # HH:MM:SS
        h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
    else:
        raise ValueError(f"无法解析时间字符串: {time_str}")

    return h * 3600 + m * 60 + s


def format_seconds(seconds: float, *, ms: bool = True) -> str:
    """秒数 → HH:MM:SS.mmm 字符串（ms=False 时不带毫秒）。"""
    seconds = max(0.0, float(seconds))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    if ms:
        return f"{h:02d}:{m:02d}:{s:06.3f}"
    return f"{h:02d}:{m:02d}:{int(s):02d}"


def format_timedelta_for_ffmpeg(seconds: float) -> str:
    """格式化为 ffmpeg -t 参数接受的格式（HH:MM:SS.mmm）。"""
    return format_seconds(seconds)


# ---------------------------------------------------------------------------
# 视频信息探测
# ---------------------------------------------------------------------------

@dataclass
class MediaInfo:
    """视频/音频文件的元信息。"""
    path: str
    duration: float = 0.0          # 秒
    width: int = 0
    height: int = 0
    fps: float = 0.0
    codec: str = ""
    audio_codec: str = ""
    sample_rate: int = 0
    bit_rate: int = 0               # 总码率 bps
    size_bytes: int = 0
    streams: list = field(default_factory=list)

    @property
    def resolution(self) -> str:
        return f"{self.width}x{self.height}" if self.width else "unknown"

    @property
    def duration_str(self) -> str:
        return format_seconds(self.duration)


def probe_media(path: str | Path) -> MediaInfo:
    """使用 ffprobe 获取媒体文件信息。"""
    path = str(path)
    if not Path(path).exists():
        raise FileNotFoundError(f"文件不存在: {path}")

    cmd = [
        FFPROBE_BIN,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        path,
    ]
    result = run_command(cmd, capture=True)
    data = json.loads(result.stdout)

    fmt = data.get("format", {})
    streams = data.get("streams", [])

    info = MediaInfo(path=path)
    info.duration = float(fmt.get("duration", 0))
    info.bit_rate = int(fmt.get("bit_rate", 0) or 0)
    info.size_bytes = int(fmt.get("size", 0) or 0)
    info.streams = streams

    for s in streams:
        if s.get("codec_type") == "video":
            info.codec = s.get("codec_name", "")
            info.width = int(s.get("width", 0) or 0)
            info.height = int(s.get("height", 0) or 0)
            # 帧率：avg_frame_rate 或 r_frame_rate
            fr = s.get("avg_frame_rate") or s.get("r_frame_rate", "0/1")
            info.fps = _eval_rate(fr)
        elif s.get("codec_type") == "audio":
            info.audio_codec = s.get("codec_name", "")
            info.sample_rate = int(s.get("sample_rate", 0) or 0)

    return info


def _eval_rate(rate_str: str) -> float:
    """解析 '30000/1001' 形式的帧率。"""
    try:
        if "/" in rate_str:
            num, den = rate_str.split("/")
            den = float(den)
            return float(num) / den if den else 0.0
        return float(rate_str)
    except (ValueError, ZeroDivisionError):
        return 0.0


# ---------------------------------------------------------------------------
# 命令执行
# ---------------------------------------------------------------------------

@dataclass
class CommandResult:
    """命令执行结果。"""
    returncode: int
    stdout: str = ""
    stderr: str = ""
    success: bool = True

    def __post_init__(self):
        self.success = self.returncode == 0


def run_command(
    cmd: list[str],
    *,
    capture: bool = False,
    timeout: int | None = None,
    check: bool = True,
) -> CommandResult:
    """
    执行外部命令。

    Args:
        cmd: 命令及参数列表
        capture: True 时捕获 stdout/stderr；False 时直接输出到终端（可看 ffmpeg 进度）
        timeout: 超时秒数
        check: True 时命令失败抛出 RuntimeError
    """
    logger.debug("执行命令: %s", " ".join(str(c) for c in cmd))

    try:
        if capture:
            r = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            result = CommandResult(
                returncode=r.returncode,
                stdout=r.stdout,
                stderr=r.stderr,
            )
        else:
            r = subprocess.run(cmd, timeout=timeout)
            result = CommandResult(returncode=r.returncode)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"命令超时: {' '.join(cmd)}")
    except FileNotFoundError:
        raise RuntimeError(f"命令不存在: {cmd[0]}")

    if check and not result.success:
        logger.error("命令失败 (code=%d): %s", result.returncode, " ".join(cmd))
        if result.stderr:
            logger.error("stderr: %s", result.stderr[-2000:])
        raise RuntimeError(f"命令执行失败，返回码 {result.returncode}")

    return result


# ---------------------------------------------------------------------------
# 输出路径工具
# ---------------------------------------------------------------------------

def ensure_output_dir(path: str | Path) -> Path:
    """确保输出目录存在。"""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def unique_output_path(base: str | Path, suffix: str = "", output_dir: str | Path | None = None) -> Path:
    """
    生成不冲突的输出路径。
    base: 基础文件名（可含路径）
    suffix: 文件后缀，如 "_cut.mp4"
    output_dir: 指定输出目录，None 时使用 base 所在目录
    """
    base_path = Path(base)
    stem = base_path.stem
    ext = suffix if suffix.startswith(".") else suffix  # suffix 已含扩展名

    if output_dir:
        out_dir = Path(output_dir)
        ensure_output_dir(out_dir)
    else:
        out_dir = base_path.parent

    name = f"{stem}{ext}"
    out_path = out_dir / name
    counter = 1
    while out_path.exists():
        name = f"{stem}_{counter}{ext}"
        out_path = out_dir / name
        counter += 1
    return out_path


# ---------------------------------------------------------------------------
# 自省
# ---------------------------------------------------------------------------

def print_env_info() -> None:
    """打印当前环境信息，用于调试。"""
    print(f"FFMPEG_BIN  = {FFMPEG_BIN}")
    print(f"FFPROBE_BIN = {FFPROBE_BIN}")
    print(f"Python      = {sys.version.split()[0]}")
    try:
        r = run_command([FFMPEG_BIN, "-version"], capture=True, check=False)
        print(r.stdout.split("\n")[0] if r.stdout else "(ffmpeg 无输出)")
    except Exception as e:
        print(f"ffmpeg 检测失败: {e}")


if __name__ == "__main__":
    print_env_info()
