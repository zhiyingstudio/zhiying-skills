#!/usr/bin/env bash
#
# 一键跑起来 —— 不需要装任何依赖
#
#   bash start.sh          # 启动纯 Node 示例（默认 3737 端口）
#   PORT=8080 bash start.sh
#
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-3737}"

echo ""
echo "  ink-captcha · 本地演示"
echo "  ────────────────────────────────────────"

# 检查 Node 版本
NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "  ❌ 找不到 node，请先安装 Node 18+"
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  ❌ 需要 Node 18+，当前是 $("$NODE_BIN" -v)"
  exit 1
fi

echo "  ✅ Node $("$NODE_BIN" -v)"

# 先跑自测，确认核心逻辑没问题
echo ""
echo "  ▶ 运行核心自测…"
if "$NODE_BIN" scripts/selftest.mjs > /tmp/ink-captcha-selftest.log 2>&1; then
  SUMMARY="$(grep -E '通过 [0-9]+ / 失败' /tmp/ink-captcha-selftest.log | tail -1 | sed 's/^ *//')"
  echo "    ✅ $SUMMARY"
else
  echo "    ❌ 自测未通过，完整输出："
  cat /tmp/ink-captcha-selftest.log
  exit 1
fi

# 启动示例服务
echo ""
echo "  ▶ 启动示例服务…"
pkill -f "examples/node-http/server.mjs" 2>/dev/null || true
sleep 0.4

PORT="$PORT" "$NODE_BIN" examples/node-http/server.mjs > /tmp/ink-captcha-server.log 2>&1 &
SERVER_PID=$!

# 探活
ready=0
for _ in $(seq 1 40); do
  sleep 0.25
  if curl -s -o /dev/null "http://localhost:${PORT}/" 2>/dev/null; then
    ready=1
    break
  fi
done

if [ "$ready" != "1" ]; then
  echo "    ❌ 启动失败，日志："
  cat /tmp/ink-captcha-server.log
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

echo "    ✅ 已启动（PID ${SERVER_PID}）"
echo ""
echo "  ────────────────────────────────────────"
echo "  🌐 打开浏览器访问：http://localhost:${PORT}"
echo ""
echo "     页面上会显示水墨底图和 4 个待点选的字，"
echo "     按提示顺序点中即可通过验证。"
echo ""
echo "     按 Ctrl+C 停止服务。"
echo "  ────────────────────────────────────────"
echo ""

# 优雅退出：Ctrl+C 时清掉子进程（加个哨兵，避免 EXIT 与 INT 各触发一次）
SERVER_PID="${SERVER_PID:-}"
CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  echo ""
  echo "  正在停止服务…"
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  echo "  已停止。"
}
trap cleanup EXIT INT TERM

wait "$SERVER_PID"
