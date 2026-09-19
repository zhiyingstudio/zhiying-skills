---
name: zhiying-partial-coverage-consistency
display_name: 部分生效一致性排查
display_name_en: Partial Coverage Consistency
description: "排查并修复部分可用状态在多处消费点不一致的缺陷：某维度缺数据被剔除，下游却仍按完整生效展示或计算。触发词：部分生效、部分可用、数据不全、展示不一致、口径不一致、partial coverage、zhiying-partial-coverage-consistency。"
description_zh: "排查并修复部分可用状态在多处消费点不一致的缺陷：某维度缺数据被剔除，下游却仍按完整生效展示或计算。"
description_en: "Find and fix inconsistent consumption of partially-available state: a dimension dropped for missing data still rendered or computed downstream."
category: 开发工具
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-partial-coverage-consistency
displayName: "部分生效一致性排查"
summary: "排查并修复部分可用状态在多处消费点不一致的缺陷：某维度缺数据被剔除，下游却仍按完整生效展示或计算。"
license: MIT
---

# 部分可用状态的下游一致性

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

## 为什么需要这个 skill

系统里常有一种状态：**「原本应该生效，但因为缺依据被剔除」**。
评分模型剔除一个维度、风控跳过一条规则、推荐系统屏蔽一个候选、计费豁免一个项目……

这类状态的表达方式几乎总是同一个：**一个容器对象上挂一个"哪些被剔除了"的列表**，
而下游为了拿数据方便，把它**拍扁成普通字典**传下去：

```python
# ⚠️ 缺陷发源地：这一行丢掉了"可用性"信息
scores = {item.key: item.score for item in result.dimensions}
```

拍扁之后，**值还在**（为了排查方便保留了原始分），但**「它是否参与计算」这个标记没了**。
下游拿到的就是一个普通的 `dict[str, float]`，看不出任何异常。

**后果的严重性按下游用途递增：**

| 下游用途 | 后果 | 严重度 |
|---|---|---|
| 展示文案 | 说"5个维度"实际只算了3个 | 中 |
| 图表绘制 | 量纲/刻度对不上，形状还在但位置错 | 中 |
| 生成问题清单 | 让用户去补一个没测过的短板 | 高 |
| **下发带链接的行动指令** | **用户照做 → 指标纹丝不动 → 必然失败** | **最高** |
| 空态合成默认值 | 「0 分」被读成「你做得很差」 | 高 |

**最高危的那一类最容易被忽略**：因为它不是"显示错了"，
而是**主动指挥用户去做一件不可能有效果的事**，且用户要等一个周期后才发现没效果。

---

## 第一步：定位「拍扁」的发生点

找源对象里承载可用性信息的字段（命名常见为 `unavailable_*` / `skipped_*` / `excluded_*` /
`disabled_*` / `inactive_*`），然后：

```bash
# 1. 找到所有把对象列表拍成字典的地方
grep -rn "for .* in .*\.\(dimensions\|items\|rules\|candidates\)" --include="*.py" app/
# 2. 找到所有消费这份字典的函数
grep -rn "def .*(.*scores\|def .*(.*dimensions\|def .*(.*weights" --include="*.py" app/
```

**关键判据**：函数的参数类型是 `dict[str, float]`（或等价），
而调用点有能力拿到 `unavailable_*` 却没传 —— 这就是缺陷。

---

## 第二步：逐个消费点确认（**必须穷举，不能抽样**）

⚠️ 实测教训：某个服务有 **9 个调用点**，抽样验 2 个会漏掉 7 个。

```bash
# 先 grep 出全部调用点行号
grep -rn "\._generate_issues(\|\._build_report(\|\.calculate(" --include="*.py" app/ | grep -v "def "
```

然后用 AST 反查每个行号所属函数名，逐个确认：

```python
import ast
from pathlib import Path

src = Path("app/services/foo.py").read_text()
tree = ast.parse(src)

def enclosing(tree, lineno):
    """返回 lineno 所属的最内层函数名"""
    best = None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.lineno <= lineno <= (node.end_lineno or node.lineno):
                if best is None or node.lineno > best[1]:
                    best = (node.name, node.lineno)
    return best[0] if best else "<module>"

for ln in [118, 205, 331]:          # 上一步 grep 出的行号
    print(ln, enclosing(tree, ln))
```

逐个确认「该调用点是否传了可用性信息」。
**注意**：有些调用点是有意不传的（比如就是为了拿全量做诊断），要区别对待并写注释说明。

---

## 第三步：连前端一起查（漏斗式缺陷）

同一缺陷往往在 **service / api / 前端组件 / 报告导出** 各有一份实现。
只改后端，用户换一个页面又看到矛盾结论。

前端重点查三类：

1. **图表组件的量纲常量**：`fullMark` / `domain` / 刻度数组 / 满分文案
   ```javascript
   // ❌ 后端已改 0-100，前端还是 0-20
   const FULL_MARK = 20
   <PolarRadiusAxis domain={[0, 20]} />
   ```
   **量纲不一致极隐蔽**：图上依然有形状、有刻度、看起来完全正常，
   **只有对照具体数字才能发现**。务必用 DOM 探针读出真实刻度值，不要靠肉眼。

2. **兜底/默认解读文案**：前端常常在接口缺字段时自己拼一段解释，
   它不知道"有维度被剔除"，会照旧说满维度数。

3. **类型定义**：`interface X { has_data: boolean }` 缺字段会导致
   `undefined` 被当成 `false`，把"未知"渲染成"没有"。

---

## 第四步：空态不能合成默认值

```python
# ❌ 没有可比对象时合成一条 0 分记录 → 客户读到"本品牌 0 分"
leaderboard = [{"brand": project.brand_name, "score": 0}]

# ✅ 空列表 + 显式标记 + 说明
"data": {
    "total_brands": 0,
    "has_data": False,
    "leaderboard": [],
    "data_notice": "该项目尚未添加竞品，无法生成横向排名。",
}
```

**「0 分」比「没有分数」更危险**：没有分数客户会等；0 分会让人以为自己做得很差，
并**据此采取错误的行动**（比如去优化一个根本不存在的短板）。

---

## 第五步：验证（两个致命陷阱）

### 陷阱 1：存量数据不会因代码修复而改变

若计算结果**在生成时落库**（jsonb 列、物化表、缓存），修完代码后
**历史行的内容纹丝不动**。直接查库会看到"修复无效"的假象。

**必做**：主动触发一次重算，然后检查**新写入的行**。

```python
rec = await service.calculate(project_id, db)   # 触发重算
# 比对 rec 的字段，而不是 SELECT 出来的历史行
```

**排查心法**：先比对「记录写入时间」与「服务重启时间」。
若写入时间早于重启，那些行就是旧代码的产物，不能作为证据。

### 陷阱 2：反向验证的断言可能空转

写完修复后要反向验证（回退修复 → 测试必须失败）。但下面这些写法**永远为真**：

| 写法 | 为什么空转 |
|---|---|
| `assert "x * 0.20" in ast.unparse(fn)` | `ast.unparse` 把 `0.20` 规范化为 `0.2`，**断言从未匹配成功过** |
| `ast.literal_eval(整个 dict)` | 遇变量引用（如 `project.name`）抛 `ValueError` → 降级到"只查键存在性"分支 → **所有值断言被跳过** |
| 只匹配 `ast.FunctionDef` | `async def` 在 AST 里是 `AsyncFunctionDef`，**永远找不到 → 测试静默失效** |
| `expect(code).toMatch(/isUnavailable/)` | 变量在别处被引用也会通过 → 改 `/^\s*isUnavailable,\s*$/m` 匹配独立成行的属性 |

**正确姿势**：
- 比值就遍历 `ast.BinOp(ast.Mult)` 提 `(字段名, 数值)` 对做数值比较；
- 比结构就返回 AST 节点，用 `ast.unparse` 转字符串比 value；
- 函数查找一律用 `(ast.FunctionDef, ast.AsyncFunctionDef)`；
- **变异"存活"= 测试有盲区，必须补用例**，不是"没关系"。

### 陷阱 3：注释里的旧代码原文会让护栏误报

修复时会在注释里引用旧实现（"原先是 `xxx * 0.07`"）。
于是 `assert "xxx * 0.07" not in src` **必然误报**。

**凡「断言某个旧实现不存在」的护栏，一律 `ast.parse` + `ast.walk` 找真实节点**，
不要字符串匹配源码。

### 陷阱 4：裸文案锚点会被自己的修复说明注释命中

`src.find("请先添加关键词")` 本想定位 JSX 空态，
但**同一文件头部你刚写的注释里也有这句话**（说明为什么要加这个空态）→ 命中注释。

**规律**：只要项目里存在"修复说明注释"（本类项目的惯例），裸文案锚点就必然踩坑。

**修法**：锚点用**该结构独有的形态**，例如 `title="请先添加关键词"`
（只可能出现在 JSX props 里）。同理，`find("if (noSampleNotice)")` 要确认它只出现一次。

### 陷阱 5：锚点串在文件里出现多次 → 断言永远通过

`assert 'value="keywords"' in src` 看似合理，但该串出现 **2 次**：
`<TabsTrigger value="keywords">` 与 `<TabsContent value="keywords">`。
删掉 Trigger 后 Content 仍在 → 断言**空转**，变异存活。

**修法**：断言**完整结构形态**，例如
`'<TabsTrigger value="keywords">关键词管理</TabsTrigger>' in src`。

**判据**：写断言前先 `src.count(锚点)`。若 > 1，说明锚点不独有，必须加长。

### 陷阱 6：断言"某条件存在"但没断言"它在正确位置"

只断言「有 isError 分支」不够，还要断言它**在空态分支之前**：
否则接口失败时会先命中空态，把「读取失败」显示成「还没有数据」。

```python
assert err_idx < empty_idx, "失败分支必须在空态之前"
```

### 陷阱 7：变异框架自身的判定条件要自检

`pytest` 退出码语义：`0=全绿`，`1=有用例失败`，`2=中断`，`5=没收集到用例`。

「变异被捕获」的标志是 **`returncode != 0`**（测试变红）。
用 `returncode == 0` 判"被捕获"会把逻辑**完全写反** ——
现象是明明输出 `1 failed`，脚本却报"存活"，差点误判测试有 5 个盲区。

### ⭐ 陷阱 9：**死变量** —— 赋值了但从不消费（第 9 类反模式）

这是「部分可用」在**代码层**的镜像形态：数据算出来了，但**没有任何消费点**。
修了一半，客户看到的行为与没修一样。

**实例**（真实生产事故）：

```python
authority_score: Optional[float] = None
authority_basis: Optional[str] = None          # ← 三次赋值都写了
...
    authority_basis = "measured_source_type_ratio"
else:
    authority_basis = "no_citations"
...
payload["score_source"] = score_source          # ← 相邻字段导出了
payload["coverage_basis"] = coverage_basis      # ← 相邻字段导出了
# ❌ 漏了 payload["authority_basis"] = authority_basis
```

**后果链**：前端只拿到 `source_authority_score`，无法区分
- ①「有引用但都不权威」→ `0.0`（真实短板，应给优化建议）
- ②「完全无引用」→ `null`（未知，不应下任何结论）

两者在界面上都是「0 / 暂无」→ **必然被混为一谈**。

**⭐ 检测法：AST 统计「赋值点」与「消费点」**，差集就是死变量。
不要靠人眼读代码 —— 赋值与导出在文件里可能相隔几百行。

```python
# 收集 xxx_basis / xxx_score 类局部变量的赋值行
assigned = {}
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for n in ast.walk(node):
            if isinstance(n, ast.Assign):
                for t in n.targets:
                    if isinstance(t, ast.Name) and ('basis' in t.id or 'score' in t.id):
                        assigned.setdefault(t.id, []).append(n.lineno)

# 收集 payload["xxx"] 导出的键
payload_keys = set()
for n in ast.walk(tree):
    if isinstance(n, ast.Assign):
        for t in n.targets:
            if (isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name)
                    and t.value.id == 'payload' and isinstance(t.slice, ast.Constant)):
                payload_keys.add(t.slice.value)

# 差集 = 死变量
for k in assigned:
    if k not in payload_keys:
        print(f'❌ {k} 赋了值但从未导出（死变量）')
```

**为什么最危险**：它**不报错、不告警、测试全绿**，且因为「相邻字段是对的」，
code review 极易滑过。发现方式只有「AST 差集」或「追问每个字段的下游消费者在哪」。

**修法**：全链路打通 —— 服务 payload → schema 声明 → 前端类型 → 组件渲染，
四层缺一层就等于没修（schema 未声明时 Pydantic 会**静默丢弃**该键）。

### ⭐ 陷阱 10：断言用「子串匹配」→ 改名后仍通过

```python
assert "authority_basis: Optional[str]" in src     # ❌ 子串匹配
```

把字段改名成 `_removed_authority_basis: Optional[str]` 后，
**子串依然存在**（因为它是 `_removed_authority_basis` 的一部分）→ 断言恒真。

这是**最隐蔽的变异存活原因** —— 它看起来是在做「精确断言」，
实际上只要目标名是另一个名字的后缀/子串就永远为真。

**修法三选一**：

| 场景 | 解法 |
|---|---|
| Python 类字段声明 | **AST 取真实字段名**：`ast.AnnAssign` 遍历 `ClassDef.body`，收 `stmt.target.id` |
| TS 接口字段 | **行首锚定**：`any(line.strip() == "authority_basis?: string | null" for line in lines)` |
| 路由 / 装饰器 | **AST 提 `decorator_list` 的参数值** |

**通用判据**：任何形如 `assert "标识符" in src` 的断言都要怀疑。
先问：**把标识符改名成 `xxx_标识符` 或 `标识符_xxx`，断言还会通过吗？**
会 → 必须改 AST 或行首锚定。

**修法**：写变异框架时，先拿一个**必然被捕获的变异**验证框架本身。

### 陷阱 8：中文 query 参数不编码 → `code=None`，会被误判成「接口不存在」

用 `urllib` 请求带中文的 query（如 `?search=自动化验证`）时，
**不 URL 编码会抛 `UnicodeEncodeError`**，现象是**客户端异常（`code=None`）**
而不是 4xx/5xx。

**这是"接口不存在"误判的头号来源**：
看到"没拿到数据"就写成"实测 404"，实际请求根本没发出去，
于是把**功能完好的接口判成废弃**，进而做出错误的删除/重写决策。

```python
# ❌ 中文直接拼进 URL
url = API + f"/keywords?search={kw}"
# ✅ 先编码
url = API + urllib.parse.quote(path, safe="/?=&")
```

**纪律**：报「接口 404」之前，先区分两种情况：
- 服务端真的返回了 404 → 打印响应体确认
- 客户端根本没发出去（异常）→ 是**你的请求构造**有问题，不是接口的问题

**排查法**：把异常类型也打出来（`f"{type(e).__name__}: {e}"`）。
`code=None` + `UnicodeEncodeError` = 请求构造问题；
`code=404` + 服务端 JSON = 真的不存在。

---

## 第六步：孤儿组件与平行实现（本类缺陷的存储库）

本类缺陷最爱的藏身之处是**孤儿组件**：组件写好了、有测试、甚至被精心修过，
但**全应用没有任何渲染入口**。

### 危害链

1. **修复永远不对客户生效**——在孤儿组件里加的空值守卫是死代码
2. **与真实页面的内联实现构成平行实现**——两套口径必然漂移
3. **被 tree-shake 不进入打包产物**——既占维护成本又不产生价值

### 检测方法

⚠️ **`grep 组件名 dist/assets/*.js` 不能可靠检测死代码**——minifier 会重命名符号，
存活的组件同样可能 0 命中。

**正确检测**（从渲染侧反查，而非从产物侧）：

```bash
# 1. 列出目录下所有组件
# 2. 对每个组件名，全项目搜索 import 与 JSX 渲染点
#    注意命中"文件自身定义行"与"同目录引用"都要排除
```

用 Grep 工具而非 shell `grep`（中文路径下 shell grep 会静默失效）。

### 分档处置（不要一刀切）

| 档 | 特征 | 处置 |
|---|---|---|
| 已被新实现取代 | 真实页面有完全对应功能 | **删除** + 防复活护栏 |
| 后端 API 就绪、前端零调用 | 功能做了一半 | **接入** 或 删除 |
| 绑死废弃链 | 后端已明令"新前端不得调用" | **删除**（接入 = 接 404 接口） |
| 与现役页面功能重叠 | 平行实现 | **删除**（重写 = 造第二套） |

### ⭐ 处置前必须实证，不能只看"组件写好了"

本类项目反复出现的误判：把"后端有接口"读成"可以接入"。必须逐项核对：

1. **后端服务是否已被标废弃**？查文件首行 docstring（`【DEPRECATED】`、"新前端不得调用"）
2. **路由是否真的挂载**？查 `router.py` 的 gate 条件（如 `if not settings.XXX:`）
3. **生产开关是什么值**？`.env` 里核对，然后 **curl 实测**（404 vs 401）
4. **组件读的字段出自哪个服务**？若只存在于废弃服务的 `_build_report_data` → 绑死废弃链
5. **现役页面是否已实现同样功能**？若是 → 重写就是造第二套渲染且无第二个消费点
6. **⭐ 前端 API 路径与后端路由逐条比对**（不要靠"实测了一下不对"就下结论）——
   实测失败可能是**你自己的请求构造问题**（中文未编码 → `code=None`），
   而非接口不存在。见陷阱 8。

> ⚠️ **实证纪律**：任何"接口 404 / 未挂载"的结论，都必须附上
> **服务端返回的响应体**作为证据。只有客户端异常而没拿到响应体时，
> **不得**下"接口不存在"的结论。
>
> 实例代价：曾把 `api/keywords.ts`（路径完全正确）误判为"缺前缀、实测 404"，
> 差点据此去"修"一个本来就没坏的 API 层。

### 比"孤儿组件"更严重的形态：**功能断链**

孤儿组件只是"没人看"，但有一种更糟：**页面提示用户去做一个全站都做不到的动作**。

实例：某页空态写「请先添加关键词」，而**全站没有任何地方能添加关键词**
（4 个管理组件全是孤儿）→ 用户被卡死在**无法完成的操作**上。

**排查法**：把所有空态的 `action` / 提示文案反过来追问
——「用户照这句话去做，去哪做？那个入口存在吗？」

**修法**：空态必须**给出路**，且出路必须指向真实存在的入口：

```tsx
<EmptyState
  title="请先添加关键词"
  action={<button onClick={() => setActiveTab('keywords')}>去添加关键词</button>}
/>
```

### 旧路径重定向也要检查

清理时容易漏掉：`<Route path="/keywords" element={<Navigate to="/settings" />} />`
—— 设置页**并没有**关键词管理，旧书签进来的用户永远到不了目的地。

**检查法**：grep 所有 `<Navigate to=` 的兼容路径，逐个确认目标页真的有该功能。


---

## 交付检查清单

- [ ] 源对象上承载可用性信息的字段名已确认
- [ ] 所有"拍扁成字典"的位置已 grep 出来
- [ ] 每个消费点已用 AST 确认所属函数（**穷举，非抽样**）
- [ ] 高危消费点（下发行动指令）已优先修复
- [ ] 前端图表量纲已用 **DOM 探针读真实刻度**核对，非肉眼
- [ ] 兜底文案已同步过滤
- [ ] 空态改为显式标记 + 说明，**不合成默认值**
- [ ] 触发重算验证新写入的记录，**未把历史行当证据**
- [ ] 反向验证跑过且**无变异存活**；存活过的一律补用例
- [ ] 变异框架自身的判定条件已用「必然被捕获的变异」验证过
- [ ] 护栏断言用 AST 而非字符串匹配
- [ ] 写字符串锚点前先 `src.count(锚点)`，> 1 则加长到结构独有形态
- [ ] 位置断言不只查"存在"，还查"在正确位置"（如 isError 在空态之前）
- [ ] 动文件前记 md5，恢复后核对一致（**禁用 `cp 备份` 回滚**）
- [ ] 报「接口 404」前已拿到**服务端响应体**（排除 `code=None` 的客户端异常）
- [ ] 孤儿组件处置已按六项实证核对（废弃标记 / 路由挂载 / 生产开关 / 字段出处 / 现役页面重叠 / 路径比对）
- [ ] 所有空态的 `action` 都指向**真实存在的入口**（无「功能断链」）
- [ ] 所有 `<Navigate to=` 兼容路径的目标页**真的有该功能**
