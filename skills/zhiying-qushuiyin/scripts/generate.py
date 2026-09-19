#!/usr/bin/env python3
"""
无水印生图辅助脚本 — Pollinations.ai 调用封装

Usage:
    python3 generate.py --prompt "..." [--width 1024] [--height 768]
                        [--model flux] [--seed 42] [--output /tmp/x.jpg]
                        [--max-time 120] [--fallback-turbo]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

API_BASE = "https://image.pollinations.ai/prompt/"

# Pollinations 推荐长宽比（flux 模型原生支持较好的尺寸）
SUPPORTED_MODELS = ("flux", "turbo")


def build_url(prompt: str, width: int, height: int, model: str, seed: int,
              enhance: bool = False, private: bool = True) -> str:
    """构造无水印生图 URL。"""
    encoded = urllib.parse.quote(prompt, safe="")
    params = {
        "width": str(width),
        "height": str(height),
        "nologo": "true",        # ⭐ 关键：去水印
        "model": model,
        "seed": str(seed),
    }
    if enhance:
        params["enhance"] = "true"
    if private:
        params["private"] = "true"
    return f"{API_BASE}{encoded}?{urllib.parse.urlencode(params)}"


def download(url: str, dest: Path, max_time: int = 120) -> tuple[bool, str]:
    """下载图片到本地。返回 (success, info)。"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "qushuiyin/1.0"})
        with urllib.request.urlopen(req, timeout=max_time) as resp:
            data = resp.read()
            if resp.status != 200:
                return False, f"HTTP {resp.status}"
            if len(data) < 1024:
                return False, f"内容过小 ({len(data)}B)，疑似错误响应"
            dest.write_bytes(data)
            return True, f"OK · {len(data)/1024:.1f}KB"
    except urllib.error.HTTPError as e:
        return False, f"HTTPError {e.code} · {e.reason}"
    except urllib.error.URLError as e:
        return False, f"URLError · {e.reason}"
    except TimeoutError:
        return False, "Timeout"
    except Exception as e:
        return False, f"{type(e).__name__} · {e}"


def generate(prompt: str, width: int, height: int, model: str, seed: int,
             output: Path, max_time: int, fallback_turbo: bool) -> bool:
    """生图主流程：flux 失败 → 自动 fallback turbo。"""
    print(f"  prompt  : {prompt}")
    print(f"  model   : {model}  size: {width}x{height}  seed: {seed}")
    print(f"  output  : {output}")

    output.parent.mkdir(parents=True, exist_ok=True)

    url = build_url(prompt, width, height, model, seed)
    print(f"  url     : {url[:120]}{'...' if len(url)>120 else ''}")
    t0 = time.time()
    ok, info = download(url, output, max_time)
    dt = time.time() - t0
    print(f"  [{model:5s}] {info}  ({dt:.1f}s)")

    if not ok and fallback_turbo and model != "turbo":
        print(f"  ↳ flux 失败，自动 fallback 到 turbo ...")
        url = build_url(prompt, width, height, "turbo", seed)
        t0 = time.time()
        ok, info = download(url, output, max_time)
        dt = time.time() - t0
        print(f"  [turbo]  {info}  ({dt:.1f}s)")

    if ok:
        print(f"  ✅ 保存成功：{output}")
    else:
        print(f"  ❌ 生成失败：{info}")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(
        description="无水印生图（Pollinations.ai）— 零 Key、零水印、即开即用",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--prompt", required=True, help="生图描述（支持中文）")
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--model", choices=SUPPORTED_MODELS, default="flux",
                        help="flux=默认高质量，turbo=极速")
    parser.add_argument("--seed", type=int, default=int(time.time()) % 100000,
                        help="种子，固定后同 prompt 出同图")
    parser.add_argument("--output", type=Path, default=Path.home() / "Desktop" / f"img_{int(time.time())}.jpg",
                        help="保存路径，默认 ~/Desktop")
    parser.add_argument("--max-time", type=int, default=120, help="单次最大等待秒数")
    parser.add_argument("--fallback-turbo", action="store_true", default=True,
                        help="flux 失败自动 fallback 到 turbo（默认开）")
    parser.add_argument("--no-fallback", dest="fallback_turbo", action="store_false")
    args = parser.parse_args()

    print("=" * 60)
    print("🖼  无水印生图（Pollinations · " + args.model + "）")
    print("=" * 60)

    ok = generate(
        prompt=args.prompt,
        width=args.width,
        height=args.height,
        model=args.model,
        seed=args.seed,
        output=args.output,
        max_time=args.max_time,
        fallback_turbo=args.fallback_turbo,
    )

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())