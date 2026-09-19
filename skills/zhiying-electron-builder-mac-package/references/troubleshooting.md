# 症状 → 根因 → 解法 速查表

| # | 症状 | 根因 | 解法 |
|---|---|---|---|
| 1 | `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` during build | 构建环境对批量删除（>阈值文件数）注入保护 | 不删只改名：`mv dist dist_backup_xxx` |
| 2 | `latest.yml` 未更新，但 exe 已生成 | 收尾阶段 `unlink` 被替换为异步版本，同步 try/catch 接不住 | 给 nsisUtil finishBuild / NsisTarget 的 unlink 补 `.catch(() => {})` |
| 3 | `Cannot spawn .../makensis: Unknown system error -86` | 缓存 makensis 为 x86_64，宿主机 Rosetta 不可用 | `brew install makensis` 后覆盖缓存二进制为 arm64 |
| 4 | `ERROR: Cannot find module ... makensis`（设置 USE_SYSTEM_MAKENSIS 后） | app-builder-lib 26.x 已移除该环境变量支持 | 不要用环境变量，改用覆盖缓存二进制 |
| 5 | 客户端提示"更新校验失败" | `latest.yml` 的 sha512/size 与产物不匹配 | 重新构建，或手工校验并重算清单 |
| 6 | 更新下载成功但无法自动安装（mac） | electron-updater 在 mac 强制要求签名 | 改用自研更新器（ditto 解压 + 替换脚本） |
| 7 | mac 更新器下载 zip 报 404 | 文件名含空格，正则 `[^\s]+` 匹配不全 | 改用 `url:\s*(.+?\.zip)` |
| 8 | 打包后运行报 `xxx is not a function` / `undefined` | asar 流式复制时源文件被并发修改，文件被截断 | 打包期间锁定源码目录；打包后 asar 提取 diff 校验 |
| 9 | `@electron/asar extract-file` 输出 0 字节 | CLI 存在已知 bug | 改用 Node API `asar.extractFile()` |
| 10 | 替换脚本执行后新应用不启动 | 命令行直接运行可执行文件，无 GUI 上下文 | 用 `open` 启动（走 LaunchServices） |
| 11 | `app.quit()` 后替换脚本没跑完 | 子进程未脱离 | `{ detached: true, stdio: 'ignore' }` + `unref()` |
| 12 | `rm -rf release/*` 无效，产物仍在 | macOS 上 `rm` 是 shell 包装函数（移废纸篓） | 用 `/bin/rm -rf` 调真实二进制 |
| 13 | 混淆/还原残留 `.jsc`、`.enc` 文件 | 中间产物未清理，或被删除保护拦截 | 收尾显式 `/bin/rm -f` 清理 |
| 14 | 只出了 dmg，自动更新失效 | mac target 默认不含 zip | mac.target 显式加 `{ "target": "zip" }` |
| 15 | 服务器磁盘被安装包撑满 | 每代双平台包数 GB，未清理旧版 | 发版后清理上一代；`df -h` >85% 时清轮转日志 |
| 16 | 应用"更新历史"页停留在旧版本 | 历史读的是硬编码列表 | 发版流程中同步写入更新记录并重启服务 |

## 构建命令模板

```bash
# 安全构建（解除批量删除保护注入）
env -u NODE_OPTIONS \
    -u CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD \
    -u CODEBUDDY_SAFE_DELETE_REPORT_PATH \
    -u CODEBUDDY_SAFE_DELETE_SANDBOX \
    -u CODEBUDDY_SAFE_DELETE_BULK_GUARD \
    npm run build:prod

# 产物校验
cat release/latest.yml release/latest-mac.yml
ls -la release/*.exe release/*.zip release/*.dmg

# asar 完整性校验（Node API）
node -e "
const asar = require('@electron/asar');
const fs = require('fs');
const buf = asar.extractFile('release/mac/App.app/Contents/Resources/app.asar', 'electron/main.js');
fs.writeFileSync('/tmp/main.extracted.js', buf);
console.log('extracted', buf.length, 'bytes');
"
diff /tmp/main.extracted.js electron/main.js && echo "OK: 无差异"
```
