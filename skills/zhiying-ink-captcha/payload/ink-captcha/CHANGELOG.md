# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-09-24

首个公开版本。

### 核心

- 点选式人机验证：随机抽目标字 + 干扰字，随机布点，用户按提示顺序点击
- 答案用 **AES-256-GCM** 加密成 token 下发，响应体只含字面与坐标
- **一次性凭证**：`consumePassToken()` 取出即删，无法重放
- **单挑战尝试上限**：默认 5 次，超限作废
- **IP 限流**：签发 60/分、校验 20/分（内存实现，零依赖）
- **时序判据**：全部点击间隔 < 60ms 判为脚本（辅助信号，刻意宽松以防误伤）
- **目标字位置分散化**：爬山法最大化目标字两两最小距离，
  避免 4 个目标字挤在同一侧导致搜索空间变小

### 底图

- 程序化生成国风水墨 SVG，**零图片资产**
- 要素：宣纸纤维质感、三层水墨远山（贝塞尔起伏）、横向云雾、
  墨点飞白、暗角收边、朱红印章
- 两套配色：`paper`（宣纸）/ `dark`（墨夜）
- 支持 `seed` 固定以复现
- **印章避让**：布点显式排除右下角印章区，防止字与印章视觉打架

### 前端

- 原生 JS 组件，**零框架依赖、零 CSS 框架依赖**
- 挂载在 **Shadow DOM** 内，样式完全隔离，不污染宿主页面
- UMD 格式，可直接 `<script src>` 引入，也支持 ES import
- 支持 `data-ink-captcha` 声明式自动挂载
- 内置响应式缩放（`ResizeObserver`），窄屏等比缩小且正确撑开容器高度
- **坐标换算用实测 `getBoundingClientRect().width`**，不用 scale 状态推断
  （避免亚像素舍入导致的系统性错位）
- 触屏用 `touchend` 提前响应，规避移动端 ~300ms 点击延迟
- 无障碍：`aria-live` 播报状态
- React 封装（`ink-captcha/react`）作为可选项

### 示例

- `examples/node-http` —— 纯 `node:http`，零框架
- `examples/express` —— Express 4，含限流中间件写法
- `examples/nextjs` —— Next.js App Router，含服务端单例（`globalThis` 缓存）

### 测试

- `scripts/selftest.mjs` —— 36 项核心自测，零依赖
- `scripts/browser-e2e.mjs` —— Playwright 真实浏览器端到端
- `scripts/preview-sheet.mjs` —— 底图多 seed 对照页生成

### 文档

- README（30 秒上手 + 安全模型 + API 参考）
- docs/接入指南.md（生产环境改造清单 + 多实例部署）
- docs/安全说明.md（威胁模型 + 明确不防的攻击）
- docs/FAQ.md（集成 / 安全 / 体验 / 开发四类问题）

### 已知限制

- 内存限流按进程计数，多实例需前置 nginx `limit_req`
- 一次性凭证存进程内存，多实例不共享（可用 Redis 替换）
- 不防打码平台、真人众包、分布式低频攻击（所有图形验证码的共性问题）
