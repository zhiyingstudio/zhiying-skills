---
name: zhiying-fullstack-security-audit
display_name: 全栈安全审查
display_name_en: Full-Stack Security Audit
description: "对已上线 Web 项目做全栈安全与质量审查：并行派子代理分领域深挖（后端/前端/基础设施），再由主代理独立复现验证每条 P0，产出能直接当工单用的分级整改清单。适用于全面检查有没有 bug、代码审查、安全审计、权限审计、漏洞扫描、合规性自查、上线前体检等请求。触发词：安全审计、代码审查、漏洞扫描、合规自查、上线体检、渗透检查、权限审计、zhiying-fullstack-security-audit。"
description_zh: "上线 Web 项目的全栈安全与质量审查：并行子代理分域深挖 + 主代理独立复现 P0 + 分级整改清单，含 30+ 真实漏洞模式速查表。"
description_en: "Full-stack security and quality audit for live web projects: parallel domain agents, independent P0 reproduction, and a work-order-ready prioritized fix list."
category: 安全合规
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-fullstack-security-audit
displayName: "全栈安全审查"
summary: "上线 Web 项目的全栈安全与质量审查：并行子代理分域深挖 + 主代理独立复现 P0 + 分级整改清单，含 30+ 真实漏洞模式速查表。"
license: MIT
---

# 全栈安全与质量审查工作流

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

## 何时用
用户要求「全面检查是否还有 bug」「代码审查」「安全审计」「上线前体检」，且项目已有一定规模（万行级以上）。

## 核心原则（血泪教训）

1. **子代理会误报，主代理必须独立复现每一条 P0**。本次审查 3 个子代理报了 9 条 P0，实测**至少 3 条是误报**（例：nginx 缓存策略——子代理读的是仓库里的 `deploy/nginx.conf`，而生产实际用的是宝塔生成的 vhost，两者已漂移）。
2. **区分「代码里的问题」和「运行环境的实际状态」**。审查报告基于代码；但配置类问题（nginx/缓存/安全头）必须实测生产才能定论。
3. **修复优先级 = 可利用性 × 影响面**，不是报告里的顺序。能被外部直接利用的（如验证码回显）必须当天修。
4. **报告必须能直接当工单用**：精确行号 + 影响范围 + 修复代码。

## 执行步骤

### 第 1 步：摸清规模，切分审查域
```bash
find backend/app -name "*.py" | wc -l; find backend/app -name "*.py" -exec wc -l {} + | tail -1
find frontend/src \( -name "*.ts" -o -name "*.tsx" \) -exec wc -l {} + | tail -1
```
超过 2 万行就派 3 个子代理并行：**后端**（api/services/models）、**前端**（组件/构建/兼容性）、**基础设施**（配置/密钥/部署/回调）。

### 第 2 步：并行派子代理（关键：prompt 要写死输出格式）
每个子代理的 prompt 必须包含：
- 项目背景（技术栈、Python 版本、服务器规格、近期新增功能）
- 审查清单（按优先级：认证授权 → 注入 → 逻辑边界 → 异常 → 性能 → 语法兼容）
- **强制输出格式**：`### [严重程度] 标题` + 位置(文件:行号) + 类型 + 问题 + 影响范围 + 修复建议
- **纪律要求**：只报验证过的、不凑数、末尾附「已排查确认安全」清单
- 严重程度定义：P0 可利用漏洞/数据丢失/服务不可用；P1 明确逻辑错误；P2 边界性能；P3 改进

### 第 3 步：主代理独立复现 P0（不可跳过）
对每条 P0 用**独立手段**验证，不采信子代理的结论：
```bash
# 接口类漏洞：直接打生产（用无害测试数据）
curl -s --noproxy '*' -X POST https://域名/api/auth/send-code -d '{"phone":"13800138000"}'
# 构建产物类：grep 产物
grep -o '??' dist/assets/*.js | wc -l
# 配置类：读生产真实配置，不是仓库副本
ssh ... "cat /www/server/panel/vhost/nginx/<域名>.conf"
```
**发现误报要明确记录并纠正**——这比多报一条更有价值。

### 第 4 步：产出分级整改清单
`deliverables/code-audit-<日期>/` 下放：
- `00-整改总纲.md`（用户先看的：结论摘要 + P0 清单 + 修复路线图三阶段 + 已确认安全清单）
- `01-后端审查.md` / `02-前端审查.md` / `03-基础设施审查.md`（详细报告）

### 第 5 步：当天修可零风险落地的项
优先级：**线上正在被利用的漏洞 > 白屏/崩溃风险 > 配置加固**。修完必须实测验证效果（改动前后的对比证据）。

## 常见真实漏洞模式（两轮审查累计命中）

| 模式 | 检测方法 |
|---|---|
| **验证码/调试信息回显** | mock 模式未加环境门禁 → 直接 curl 生产接口看响应 |
| **构建 target 未设** | 产物含 `??`/可选链未降级 → `grep -o '??' dist/assets/*.js \| wc -l` |
| **凭据明文入库/入档** | `grep -rl "BEGIN.*PRIVATE KEY"`、交接文档含密码 |
| **打包脚本打进 .env** | 看 tar 命令有无 `--exclude='.env*'` |
| **后台退款不调渠道 API** | grep 退款相关代码有无真实 HTTP 调用 |
| **支付回调未验签/未校验金额** | 读回调处理逻辑 |
| **IDOR（越权读写）** | 检查资源查询是否带 `user_id` 过滤；特别注意**完全无 Depends 鉴权**的端点 |
| **f-string 拼 SQL** | 判断是否 `:param` 绑定（硬编码 where + params 是安全的） |
| **三元优先级吃掉链式调用** | `select(X).where(*c) if c else select(X).order_by().limit()` —— `.order_by/.limit/.offset` 只挂 `else` 分支，带筛选时分页全失效。`grep -rn "if conds else select"` |
| **SSRF 重定向绕过** | 有 `guard_public_url` 但客户端仍 `follow_redirects=True` → 302 到内网。`grep -rn "follow_redirects=True"` 逐个核对有无逐跳校验 |
| **SSRF 防护静默失效**（更隐蔽） | 钩子加了但类型不匹配：`async def` 钩子注入同步 `httpx.Client` → 协程被丢弃、校验从未执行。**必须实发内网请求验证会抛错**，不能只看代码有没有写 |
| **关系属性懒加载（async 下）** | `obj.relationship` 在 AsyncSession 触发同步 IO → `MissingGreenlet`。`grep -rnE '\.(plan\|user)\b' --include=*.py \| grep -v "_id"` |
| **前端造假数据** | `Math.random()` 画图表、系数放大冒充 KPI（与「可信数据」类产品定位冲突，按 P1 处理） |
| **模拟/调试入口无环境门禁** | `grep -rn "模拟\|mock" src/` 逐个核对是否有 `import.meta.env.DEV` 门禁 |
| **开放重定向** | `window.location.href = <后端返回值>` 未校验协议 → `grep -rn "location.href" src/` |
| **ErrorBoundary 泄露内部信息** | 直接渲染 `error.message`/`error.stack` 给用户 |
| **懒加载 chunk 无兜底** | 有 `React.lazy` 但无 `vite:preloadError` 监听 → 发版后点侧边栏死循环 |
| **三元/callback 绕过白名单** | `if (x === 'special') return true` 想跳过校验 —— 入参可控即漏洞 |
| **内联条件绕过白名单** | 逐个审 `return true` 前的条件 |
| **登出/改密后 token 仍有效** | jti 生成了却从不校验、登出只清 localStorage、refresh 路径绕过吊销。检查：`grep -rn "jti" app/` —— 若只在签发处出现、校验处没有 = 形同虚设。且**改密必须写账号级代次**（`token_version` + 签发时写 `tv` claim），否则旧 refresh token 能无限续期 |
| **内存降级 Redis 缺方法** ⚠️ 极隐蔽 | `InMemoryRedis` 只实现了 `get/set/delete`，业务调 `set(nx=True)`/`getdel`/`incr` → `AttributeError` 被 `except` 静默吞掉 → **防护静默失效**（线上 Redis 正常时永远测不出）。必检：把 fallback 类实现的每个方法与全仓调用做差集，缺的补齐；并**直接对 fallback 类跑一遍测试** |
| **Docker 密钥烘焙** | `.env` 被 `COPY . .` 打进镜像层 → 层不可逆，`docker save` / registry pull 仍能捞出。双保险：`.dockerignore` + **白名单式精确 COPY**（逐个列 `app/`/`alembic/` 等） |
| **compose 默认弱口令/端口外露** | `${POSTGRES_PASSWORD:-example123}` 写默认值 = 没配也能起；端口写 `5432:5432` 而非 `127.0.0.1:5432`。改用 `${VAR:?必须显式提供}` + 全端口本机绑定 |
| **回调重放无防护** | 验签只证明「来源可信」，不防「同一请求重放」。需叠**时间戳新鲜度窗口** + **密文/事件摘要 `SET NX` 去重**（TTL ≥ 窗口） |
| **签名比较非常量时间** | `==` 比较签名/state → 改 `hmac.compare_digest`（与同体系其他校验保持一致） |
| **FastAPI 裸参数是 query** ⚠️ | `async def f(authorization: Optional[str] = None)` 被当作 **query 参数**，读不到请求头 → 静默失效（返回 200 但功能没生效）。请求头/响应/路径必须显式 `Header()`/`Cookie()`/`Path()`。**只有真实端到端断言能发现** |

## 关键坑（务必记住）

1. **nginx `add_header` 就近覆盖**：只要某个 `location` 内有任意 `add_header`（如 Cache-Control），父级 server 块的所有 `add_header` 全部失效。安全头必须在每个带 add_header 的 location 内**重复声明**。验证：
   ```bash
   curl -sI https://域名/ | grep -iE 'strict-transport|x-frame|x-content-type'
   ```
2. **Python 3.9 + PEP 604**：`str | None` 在 FastAPI 端点签名里会在导入期求值 → 需 `eval_type_backport`，否则干净环境启动即崩。正确做法是双管齐下：代码改 `Optional[X]` + requirements 补包兜底。
3. **仓库配置 ≠ 生产配置**：宝塔等面板会生成自己的 vhost，仓库里的 `deploy/*.conf` 只是模板。审查配置类问题**必须读生产实际文件**。同理，**部署脚本绝不可覆盖已存在的 vhost**——会静默丢掉 SSL 与安全头。
4. **修复要连带验证副作用**：如修了验证码回显，会导致 mock 环境下用户收不到验证码——这是业务影响，必须主动告知用户并提出选项（接入真实通道 / 临时下线入口）。
5. **子代理说"已排查确认安全"的部分也要抽查几条**，避免它漏判。
6. **发布必须设门禁并写进流程**：`??` 计数为 0、静态 chunk 循环依赖为 0、生产产物无调试字符串——只验 HTTP 200 会导致白屏在线上挂一天。
7. **alembic 多 head 要先合并**：改迁移前遍历所有文件的 `revision`/`down_revision` 求"不是任何 down_revision"的节点；多 head 必须建 merge 迁移（`down_revision = (a, b)`）。revision id ≤ 32 字符。老迁移补 `sa.inspect` 幂等守卫。
8. **修复顺序心法**：先做不需要用户授权的代码/配置类修复；凭据轮换（SSH 密钥/DB 密码）放最后单独确认——轮换会断当前部署通道，风险最高。
9. **httpx event_hooks 的同步/异步钩子不可混用（防护静默失效陷阱）** ⚠️ 极隐蔽：`AsyncClient` 的 hook **必须是协程函数**，`Client`（同步）的 hook **必须是普通函数**。若把 `async def` 钩子注入同步 `httpx.Client`，httpx 会直接调用并丢弃返回的协程——只抛一条 `RuntimeWarning: coroutine was never awaited`，**校验函数体从未执行**，SSRF 防护等于零，且功能测试看起来「正常」（请求照样成功）。必检：
   ```python
   # 反例：一个 async hook 被两个客户端共用 → 同步链路防护失效
   async def _validate_redirect(request): ...
   httpx.Client(event_hooks={"request": [_validate_redirect]})    # ❌ 永不执行
   httpx.AsyncClient(event_hooks={"request": [_validate_redirect]})  # ✅
   ```
   **正确做法**：抽出公共同步校验体，再包成 `_sync` / `_async` 两个薄壳分别绑定。**验证不能只看「有没有加钩子」，必须真的发一个内网请求看是否抛错**，并同时测同步、异步两条链路 + 一条正常公网请求（确认未误拦）。
10. **rsync 多源文件 → 单目标目录会扁平化**：`rsync a/x.py b/y.py c/z.py host:/app/` 会把三个文件全部平铺到 `/app/` 根下，目录层级信息丢失，产生 `app/admin.py` 这类错位文件（不报错，静默错位）。**部署必须逐文件写完整目标路径**：`host:/app/api/admin.py`。部署后务必 `ls` 目标目录核对。
11. **残留复查是必须的独立环节**：不要相信「已经全部改完」。用 grep 扫全仓（`grep -rn "follow_redirects=True"`、`grep -rn "if conds else select"`、`grep -rnE '\.(plan|user)\b' | grep -v _id`），按模式逐条核对。本项目第三批复查正是靠这步抓出 3 处漏网，其中 SSRF 那处**比原报告更严重**（原报告的修复方案本身有缺陷）。
12. **验证要用「可对照的证据」**：修前修后各取一次实测数据（例：同一 SQL 在修复前 `ORDER BY=False` / 修复后 `=True`；同一请求修复前 `RuntimeWarning` 不拦截 / 修复后抛 `ValueError`）。带对照的验证才能证明修复真的生效，而不是「看起来通了」。
13. **HTTP 200 不算验证** ⚠️ 最容易自我欺骗的一点：接口返回 200 只说明「请求被接受了」，不说明「功能打到了正确的分支」。本项目登出功能就是反例——第 4 处修复上线后接口全 200，实际 `revoked: 0`，旧 token 依旧可用（根因是参数绑定错了，见模式表最后一条）。**正确姿势是带状态断言的端到端脚本**：
    ```
    取 token → 调受保护接口断言 200 → 执行动作 → 用同一 token 再调断言 **401** → 换新 token 断言 200
    ```
    并**在多 worker 部署下重复多次**（本项目 4 个 uvicorn worker，登出前 6 次全 200、登出后 8 次全 401 才算过）——否则可能只命中了持有旧缓存的那个 worker。
14. **加校验后测试失败，先判「测试错」还是「代码错」**：本项目加微信时间戳新鲜度校验后 3 个老测试失败，根因是测试硬编码了 2009 年的时间戳——**处置是改测试，并补一条新测试锁定该防护**（`test_crypto_rejects_stale_timestamp`），而不是删校验。同理，测试因 `naive json.load` 读不了带 `//` 注释的 `tsconfig.json` 时，应写 JSONC 解析器而非删注释——**当测试在惩罚好实践，改测试**。
15. **`is_active` 之类的差异化提示要放在密码校验之后**：先合并成一个 `if` 会导致「死代码 + 账号枚举侧信道」。正确顺序是**密码正确才给差异化文案**（攻击者必须先证明知道口令），既消除死代码又不泄露账号是否存在。
16. **平滑上线的兼容设计**：新增账号级吊销字段时，把**缺失 claim 视为旧默认值**（`payload.get("tv", 0)`），存量 token 部署后就不会被集体踢下线。上线后必查：`SELECT count(*) FROM users WHERE token_version <> 0` 应为 **0**。

## 交付话术
- 先给「一句话结论」+ 表格化的数量统计（P0/P1/P2/P3 各几条）
- 明确区分：**已修复并验证** / **待你决策** / **已排期**
- 误报要主动说明（体现审查严谨性，而非掩盖）
