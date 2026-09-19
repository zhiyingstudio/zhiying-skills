#!/bin/zsh
# Chrome 长驻启动器（CNIPA 专利业务办理系统）
# 必须用 run_in_background: true 调用本脚本，否则每轮 Bash 结束 Chrome 会被回收
# 注意：不可加 --disable-gpu，会 FATAL: GPU process isn't usable

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=9333
PROFILE="$HOME/.workbuddy/chrome-cponline-faren"
STATE_FILE="/tmp/cnipa_last_url.txt"

# 读取上次的 URL（保持案卷页），默认登录页
if [ -f "$STATE_FILE" ]; then
  URL=$(cat "$STATE_FILE")
else
  URL="https://tysf.cponline.cnipa.gov.cn/am/#/user/login"
fi

# 杀掉旧实例
pkill -f "remote-debugging-port=$PORT" 2>/dev/null
sleep 1

nohup "$CHROME" \
  --remote-debugging-port=$PORT \
  --user-data-dir="$PROFILE" \
  --window-size=1600,1000 \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --disable-gpu-sandbox \
  --disable-software-rasterizer \
  "$URL" \
  < /dev/null > /tmp/chrome_$PORT.log 2>&1 &

sleep 4
echo "[BOOT] Chrome started on port $PORT with URL: $URL"
echo "[BOOT] CDP: http://127.0.0.1:$PORT/json/list"

# 保活循环 —— 绝不能提前退出
while true; do
  sleep 60
done
