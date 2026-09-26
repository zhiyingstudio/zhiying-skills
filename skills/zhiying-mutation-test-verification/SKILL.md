---
name: zhiying-mutation-test-verification
display_name: 变异测试验证
display_name_en: Mutation Test Verification
description: "反向验证测试用例是否真的能抓住缺陷：向源码注入变异体并跑测试，确认用例不是永远绿的摆设。触发词：变异测试、验证测试、测试有效性、mutation test、测试打假、假绿测试、zhiying-mutation-test-verification。"
description_zh: "反向验证测试用例是否真的能抓住缺陷：向源码注入变异体并跑测试，确认用例不是永远绿的摆设。"
description_en: "Reverse-verify that tests actually catch defects: inject mutants into source and re-run suites to prove they are not always-green placeholders."
category: 开发工具
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-mutation-test-verification
displayName: "变异测试验证"
summary: "反向验证测试用例是否真的能抓住缺陷：向源码注入变异体并跑测试，确认用例不是永远绿的摆设。"
license: MIT
---

# 反向验证（变异测试）工作流

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

## 为什么必须做

**通过的测试 ≠ 有效的测试。** 现实中反复出现的三类假绿：

| 假绿类型 | 表现 | 真实案例 |
|---|---|---|
| **mock 过宽** | `MagicMock()` 对任意方法名 + 任意关键字参数都照单全收 | 适配器漏了一个形参，`MagicMock` 测不出来；真实调用 100% `TypeError` |
| **断言选错目标** | 用源码字符串匹配代替行为断言 | 断言 `"foo=bar" in source`，重构写法后假红；而字段真丢了也测不出 |
| **切片命中注释** | 字符串替换先命中 docstring 里的示例文字 | 把 `type=image` 改成 `news`，代码没改到（只改了注释），测试仍全绿 |

**判断标准**：一个测试如果"删掉被测逻辑它也照样绿"，那它没有价值，甚至有负价值（给人虚假的安全感）。

## 标准流程

### 1. 先跑基线，确认当前是绿的

```bash
cd <backend> && <python> -m pytest tests/ -q 2>&1 | tail -5
```

记下通过数（如 `464 passed`）。**后续所有对比都以这个数字为锚。**

### 2. 记录基线哈希（**不要用 `cp` 备份恢复**）

```bash
cd <repo> && for f in app/services/foo.py app/schemas/bar.py; do
  echo "$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)  $f"
done
```

**⚠️ 为什么禁 `cp 备份` 恢复**：变异是多轮进行的，到第二轮时你**无法知道那个 `.bak`
是修复前的版本还是某个中间版本**。一旦用它恢复，可能把已修好的代码退回旧版 ——
**静默自毁修复**，而且测试会"恢复后依然绿"（因为测的是旧代码），极难发现。

**正确做法**：脚本内存里留 `original[path] = p.read_text()`，每轮变异后
`p.write_text(original[path])` 写回，最后再 `md5` 逐文件核对与基线一致。

### 3. 注入缺陷（每次只注入一个）

优先用 **Python 脚本做精确替换**，并 `assert` 替换生效：

```bash
<python> - <<'PY'
import pathlib
p = pathlib.Path('app/services/foo.py')
src = p.read_text(encoding='utf-8')
old = "    if platform_code not in WHITELIST:"
new = "    if False:  # 注入缺陷：跳过白名单校验"
assert old in src, "替换未生效，别继续"
p.write_text(src.replace(old, new), encoding='utf-8')
print("已注入缺陷")
PY
```

⚠️ **`assert old in src` 不可省**：替换没生效时你会误以为"测试没抓住"，实际是缺陷压根没注入进去。

⚠️ **不要用会引入 `NameError` 的切片**：如果缺陷是把整段删掉、导致变量未定义，测试报的是 `NameError` 而非你想要的断言失败——这证明不了断言有效。改用「把条件改成永假」这种**保留变量赋值**的注入方式。

⚠️ **⭐ 注入点必须在语法合法位置**（2026-09-16 实测踩到）：
在 Python 文件里按「行号 + 偏移」插入代码时，很容易插到
`async def foo(...)` 与紧随其后的 **docstring 之间** —— 那位置**不能有语句**，
会直接造成 `SyntaxError`。表现是静态扫描器报 `L0: 语法错误` / 测试整体收集失败，
而**不是**你期望的「断言失败」——它证明不了任何东西。

✅ 正确做法：**按语义锚点替换，不按行号插入**。找一个确定在函数体内的既有语句作为锚点，
把注入代码插在它**前面**：

```python
anchor = "    trend = await svc.get_history(project.id, days, db)"
assert anchor in src, "锚点没找到，说明代码变了，先重新确认再注入"
src = src.replace(anchor, mutant_line + anchor, 1)
```

⚠️ **对静态扫描器/契约检查器注入时**，还要注意它**自身会不会被注入搞瞎**：
若扫描器先解析 AST，语法错误会让它进入「自检失败」分支（退出码 2），
这跟「发现了缺陷」（退出码 1）是**两种不同信号**，别混为一谈。
先确认 `rc == 1` 且输出**精确定位到行号 + 符号名**，才算真的抓到。

### 4. 跑测试，确认变红

```bash
<python> -m pytest tests/test_xxx.py -q 2>&1 | tail -12
```

**期望**：恰好那几条相关测试失败，且失败原因就是注入的缺陷。

分三种结果处理：

| 结果 | 含义 | 行动 |
|---|---|---|
| ✅ 精准变红 | 测试有效 | 继续下一步 |
| ⚠️ **没变红** | **测试是摆设**（这是最有价值的发现） | 补/改测试，让它是唯一能拦住缺陷的原因 |
| ⚠️ 全红了 | 测试耦合过重 | 收紧测试范围 |

### 5. 恢复，确认变绿

```bash
cp /tmp/foo.bak app/services/foo.py
<python> -m pytest tests/ -q 2>&1 | tail -5
```

必须回到基线数字。

### 6. 对所有新增/修改的防线逐条重复

一个测试文件里有 N 个独立断言，就注入 N 次。**不要只验一条就认为整个文件有效。**

## 「没变红」时怎么补测试

这是本工作流的核心产出。补测原则：**让被测逻辑成为唯一能让调用成功的原因。**

❌ **错误补法**：断言"函数被调用过"
```python
# 没用：不关心参数是否可接受
mock.assert_called_once()
```

❌ **错误补法**：继续用 `MagicMock`
```python
# 没用：MagicMock 什么都收
adapter = MagicMock()
```

✅ **正确补法**：用一个**故意不支持全部参数**的真实类
```python
class _NarrowAdapter:
    """只接受 title/content_html/digest，**不接受** thumb_media_id。"""
    def create_draft(self, credential, credential_type, *, title, content_html, digest=""):
        captured["kwargs"] = {...}
        return PublisherResult(ok=True, status="draft_created")

# 若调度层走了签名过滤 → 调用成功
# 若调度层无脑传参 → TypeError → 被 except 吞成"执行异常"
assert done.status == "draft_created", f"未走过滤：{done.error_message}"
```

✅ **正确补法**：用 `inspect.signature().bind()` 做**接口契约测试**
```python
sig = inspect.signature(real_adapter.create_draft)
sig.bind("cred", "cookie", **scheduler_kwargs)  # 不匹配直接 TypeError
```

## 接口契约测试（mock 盲区的根治方案）

**凡是「调度层调用适配器/服务」的关系，都要有契约测试。** 用真实类而非 mock：

```python
def test_all_draft_adapters_accept_scheduler_kwargs():
    """声明 supports_draft=True 的适配器，必须能接受调度层传入的全部参数。"""
    failures = []
    for code in supported_platforms():
        adapter = get_publisher(code)
        if not adapter.supports_draft:
            continue
        sig = inspect.signature(adapter.create_draft)
        try:
            sig.bind("cred", "cookie", **filtered_kwargs)
        except TypeError as exc:
            failures.append(f"{code}: {exc}")
    assert not failures, "以下适配器与调度层传参不兼容：\n  " + "\n  ".join(failures)
```

**契约测试的价值**：新增平台时若忘补形参，立刻变红——而不是等线上崩溃。

## 静态断言的正确姿势：用 AST，不用字符串

❌ **错误**：字符串切片/匹配
```python
assert "media/uploadimg" not in fn_body      # 会命中注释里的对比表格
assert "thumb_media_id=task.thumb_media_id" in src  # 重构传参写法就假红
```

❌ **错误**：`ast.literal_eval(整个 dict)`
```python
# payload 里若有 max(0, offset) 这类 ast.Call，literal_eval 抛错
# 被 try/except: continue 静默吞成空 → 测试从此永远绿（比没写更危险）
value = ast.literal_eval(dict_node)
```

✅ **正确**：逐个 key/value 取字面量
```python
pairs = {}
for k, v in zip(d.items, d.values):
    if isinstance(k, ast.Constant) and isinstance(k.value, str):
        pairs[k.value] = v.value if isinstance(v, ast.Constant) else f"<{type(v).__name__}>"
```

✅ **正确**：取函数体内的名字集合
```python
def _names_in_func(src: str, func_name: str) -> set[str]:
    found = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func_name:
            for sub in ast.walk(node):
                if isinstance(sub, ast.Name): found.add(sub.id)
                elif isinstance(sub, ast.keyword) and sub.arg: found.add(sub.arg)
                elif isinstance(sub, ast.Attribute): found.add(sub.attr)
    return found
```

✅ **正确**：取关键字参数名
```python
kwonly = {a.arg for a in node.args.kwonlyargs}
```

## 常见踩坑

| 坑 | 规避 |
|---|---|
| `.env` 污染测试 | 项目若用 `GEO_REBUILD_ENABLED` 之类开关，**跑测试必须不带 `.env`**，否则会污染依赖默认值的用例 |
| 替换未生效 | 每次替换后 `assert old in src` |
| 注入引入新错误 | 用「条件改永假」而非「删代码」，避免 `NameError` 混淆判断 |
| 只验一条 | N 条防线就注入 N 次 |
| **⭐ 用 `cp .bak` 恢复** | **禁止**。多轮变异后无法判断 `.bak` 是哪个版本 → 自毁修复。改「内存写回 + md5 核对」 |
| **⭐ 断言是「子串匹配」** | `assert "field: Optional[str]" in src` —— 把字段改名成 `_removed_field` 后**子串仍在**，断言恒真。这是最隐蔽的存活原因 |
| **⭐ 锚点命中注释** | 项目删除处都会留「已移除 xxx」说明注释，**必然引用被删代码原文**。`assert "old_code" not in src` 会被自己的注释命中 |
| 变异「存活」当噪声忽略 | **存活 = 测试有盲区，必须补用例**，然后补更刁钻的变体验证加固有效 |
| 测试耦合 | 反向验证时若大面积变红，说明测试的边界没切干净 |
| **⭐ 断言依赖解释器内省能力** | 见下方专节 —— 这类红是**假失败**，最容易被误读成「新引入了 bug」 |

### ⭐⭐ 断言写死「内省结果」→ 换解释器必红（假失败）

**实例**（2026-09-16，`test_publisher_contract.py`）：断言 `_filter_supported_kwargs(print, {"title":"x"}) == {}`。
本机（Python 3.9）跑必红，同代码在 3.13 上绿。根因：

| Python | `inspect.signature(print)` | 函数返回 |
|---|---|---|
| **3.9** | **抛 `ValueError: no signature found for builtin`** | 走 `except` → **`{"title":"x"}`** |
| 3.13 | `(*args, sep=' ', end='\n', file=None, flush=False)` | 签名可解析 → **`{}`** |

**两个返回值都是正确实现** —— 因为 `inspect` 的能力本身就是版本相关的。
更糟的是该测试**改过两次、两版注释的理由都是错的**（先「含 `**kwargs` 故放行」、后「不含 `VAR_KEYWORD` 故过滤」），
说明**光改注释不改断言锚点，等于把错误固化得更牢**。

**识别信号**：`inspect.signature` / `__wrapped__` / `get_type_hints` / `typing.get_origin` /
`ast.unparse` 的输出格式 / `dict` 有序性 / `re` 的转义行为 —— 这些都**可能随版本变**。

**正确姿势**：把测试拆成「**不变量**」+「**分能力断言**」两层。

```python
# 第一层：真正要守的不变量（跨版本必须恒真）
result = _filter_supported_kwargs(print, {"title": "x"})
assert isinstance(result, dict), "取签名失败时必须优雅降级，不能抛异常"

# 第二层：运行时探测该能力是否可用，再按版本断言实际行为
try:
    inspect.signature(print)
    signature_available = True
except (TypeError, ValueError):
    signature_available = False

if signature_available:
    assert result == {}, "本解释器可解析签名 → 应走过滤分支"
else:
    assert result == {"title": "x"}, "本解释器无法解析签名 → 按设计原样返回"
```

**心法**：
- 断言**行为**，不要断言**内省结果**。`inspect` 的输出是「实现细节的副产品」，不是契约。
- 若确实要断言内省结果，必须**先探测再分支**（如上），或 `pytest.mark.skipif`。
- **修这类红之前先确认它是假失败** —— 用另一个解释器跑同一测试就知道：
  `A 红 B 绿` ⇒ 版本相关，不是新 bug；`A B 都红` ⇒ 才是真回归。

### ⭐ 断言空转的三种形态与解法

| 形态 | 反例 | 解法 |
|---|---|---|
| **子串匹配** | `assert "authority_basis: Optional[str]" in src` → 改名 `_removed_authority_basis` 仍通过 | **AST 取真实字段名**：`ast.AnnAssign` 遍历 `ClassDef.body`；TS 文件用**行首锚定** `line.strip() == "..."` |
| **三元式分支残留** | `assert "data.notice" in src` → 把判定源换掉，`? data.notice` 分支仍在 | 断言**整个判定表达式**（含守卫条件） |
| **锚点位置错** | 字段名先出现在**变量计算**（守卫之前）而非 JSX 渲染处 | 锚点取 `{data.xxx}` 这种**渲染形态** |

**通用兜底**：静态护栏断言**一律用 AST**，不用字符串匹配。
`grep -c 'A\|B'` 在 zsh 下不可靠（中文路径尤甚）→ 用 Grep 工具。

### ⭐ 变异脚本自身的锚点陷阱

**锚点未命中 ≠ 缺陷不存在**，而是你把变异打在了错误的语法形态上。

实例：想变异 `"avg_sentiment": round(avg_sent, 4),`（dict 键），
但项目里那处是 **Pydantic 构造参数**（`TrendPoint(avg_sentiment=round(...))`），
而 dict 键版本已随方法删除一并移除 → 锚点未命中。

**规避**：变异前先 `grep` 确认锚点的**确切语法形态**；
锚点未命中时打印告警（而不是当成功），并把变异改打到**当前真实存在**的位置。

### ⭐ AST 提取路由路径（优于字符串匹配）

```python
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and dec.args and isinstance(dec.args[0], ast.Constant):
                paths.add(dec.args[0].value)
```

## pytest 退出码语义

| 码 | 含义 |
|---|---|
| `0` | 全绿 |
| `1` | 有用例失败 ← **「变异被捕获」的标志** |
| `2` | 执行中断 |
| `5` | 没收集到用例（**危险**：写错 node id 时会伪装成"没有失败"） |

判定捕获必须用 **`returncode != 0`**，不要用「输出里有没有 FAILED」字符串判断。

**⚠️ `async def` 在 AST 里是 `AsyncFunctionDef`**：只匹配 `FunctionDef` 会永远找不到目标（测试静默失效）。
**⚠️ `ast.unparse` 会规范化数字字面量**：`0.20`→`0.2` → 字符串断言永远为真。必须遍历 `ast.BinOp(ast.Mult)` 提数值对比较。
**⚠️ `ast.literal_eval` 遇变量引用抛 `ValueError`** → 若降级到「只查键存在性」，值层面断言被静默跳过。

## 输出模板

做完后给用户的汇报应包含：

```
### 反向验证（注入缺陷 → 确认测试变红）

| 注入缺陷 | 结果 |
|---|---|
| 去掉大小校验 | ✅ 捕获 |
| 去掉格式白名单 | ✅ 捕获 |
| 上传时 type 改成 news | ✅ 捕获（第二轮补测后）|
| 调度层无脑传参 | ⚠️ 首轮未捕获 → 已补 test_xxx，复测 ✅ 捕获 |

测试基线：448 → 464 passed
```


---

## 效果预览

![效果预览](https://raw.githubusercontent.com/zhiyingstudio/zhiying-skills/main/skills/zhiying-mutation-test-verification/preview.jpg)

*上图为本技能的效果预览：真实界面演示或能力概览卡。安装后按 SKILL.md 指引即可复现同等效果。*
