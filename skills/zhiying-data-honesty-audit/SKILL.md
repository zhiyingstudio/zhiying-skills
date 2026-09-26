---
name: zhiying-data-honesty-audit
display_name: 数据诚实审查
display_name_en: Data Honesty Audit
description: "审查给客户看的数字是否诚实：揪出假回退、编造因果、自证循环三类数据造假反模式。触发词：数据造假、假数据、数据诚实、指标审查、看板审查、CTR造假、data honesty、zhiying-data-honesty-audit。"
description_zh: "审查给客户看的数字是否诚实：揪出假回退、编造因果、自证循环三类数据造假反模式。"
description_en: "Audit whether numbers shown to customers are honest: expose fake fallbacks, fabricated causality and self-proving loops."
category: 数据分析
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-data-honesty-audit
displayName: "数据诚实审查"
summary: "审查给客户看的数字是否诚实：揪出假回退、编造因果、自证循环三类数据造假反模式。"
license: MIT
---

# 数据诚实性审查

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

## 为什么需要这个 skill

看板类产品的头号信任杀手不是「页面打不开」，而是**数字看起来很专业但对不上任何真实样本**。
客户会拿这些数字做预算、写周报、向老板汇报——**错了比没有更糟**。

三类反模式中，**自证循环最隐蔽**：它只在「有数据」时出现，永远不会触发空态告警；
数字精确且跨客户稳定，反而比随机数更像真的。

---

## 三类反模式（必须逐个排查）

### ① 假回退：无数据时用行业均值/常量冒充客户数据

```python
# ❌ 客户一个样本都没有，却被告知"你的 CTR 是 7%"
ctr = observed_ctr if samples > 0 else 7.0
```

**危害**：客户以为已有 7% 转化，据此判断"我的落地页没问题"。

**正确**：返回 `None`，并把「无数据」变成**显式状态**（`has_data: false`），
让前端渲染空态引导而非数字。

### ② 编造因果：两个无因果关系的量相除/相乘

```python
# ❌ "诊断次数"与"AI 曝光量"没有任何因果关系
estimated_views = diag_count * 2000
```

**排查手法**：对每个估算公式问一句「**这两个量的因果关系是什么？系数 2000 从哪来？**」
若答案是「大概差不多」「拍脑袋定的」，就是编造。

**正确**：用**同一业务域内、有真实分子分母**的比率推导。
例：`views = (mentioned/total) * 池子 * 占比` —— 提及率是真实观测，池子是可解释假设。

### ③ 自证循环：分子由假设算出，再反算"假设"当"结果"

```python
# ❌ CTR 恒等于 7.0 —— 分子就是这么造出来的
estimated_clicks = views * 0.07          # 用假设系数造分子
ctr = estimated_clicks / views * 100     # 再反算，得到 7.0
```

前端把它渲染成「点击率(CTR) 7.0% · AI引用→官网点击转化」，读起来**像实测结果**。

**排查手法（关键）**：搜索所有 `X / Y` 形式的比率计算，**回溯分子是怎么来的**。
如果分子 = 分母 × 某个常量，那这个比率**恒等于该常量**，是一个纯装饰数字。

**正确**：

```python
ASSUMED_CTR = 0.07   # 显式常量，命名里就写明是假设

estimated_clicks = views * ASSUMED_CTR
return {
    "click_through_rate": None,        # 恒为 None：真 CTR 需接 GA
    "assumed_ctr": ASSUMED_CTR * 100,  # 假设参数单独暴露
    "ctr_is_assumption": True,         # 标记口径，供前端说明
}
```

前端文案从「你的转化率是 7%」改为「**点击量按 7% 行业假设测算**」——
同一批数字，但口径从"实测"降级为"假设"，诚实了。

---

## 其他必备检查项

### ④ `None`（未知）不得与"实测落在某档"共用分支

```python
# ❌ "无排名数据"（未知）与"排名 3 名以外"（实测偏低）拿到同一个权重
if avg_rank <= 1:   rank_weight = 1.0
elif avg_rank <= 2: rank_weight = 0.7
else:               rank_weight = 0.4   # ← None 也走这里
```

**危害**：`None` 被伪装成"已实测"。客户看到一个历经排名加权的曝光量，实际一条排名样本都没有。

**正确**：单列可得性字段，让前端有机会说明口径。

```python
rank_data_available = avg_rank is not None
# 返回时同时给出 avg_rank: None 与 rank_data_available: False
```

### ⑤ 前端 catch 里绝不能返回编造数据

```typescript
// ❌ 接口一失败（401/500/网络抖动），客户看到一整套虚构报表
catch {
  return { views: 12500, clicks: 875, trend: [...6个月], platforms: [...5个] }
}
```

**危害**：比直接报错恶劣得多——报错用户会重试，假数据用户会**当真**。

**正确**：失败就是失败，进 `isError` 分支展示真实错误 + 重试入口。

### ⑥ 「无数据」与「数据为 0」必须区分

```python
# ❌ 无历史时回填 6 个 0 值月份 —— 0 会被读成"确实为 0"
trend = [{"date": m, "views": 0} for m in last_6_months]
```

**正确**：返回空数组 + `has_history: false`，前端渲染空态。
「没观测到」和「观测到是 0」在业务上是两件事。

### ⑦ 「未知」的归集桶不得静默

平台/渠道/分类的归一表，未识别的项会被塞进「其他」。
一旦有拼写或命名变更，真实数据**整体消失**却无人察觉。

```python
# ❌ 子串匹配赌命名巧合：键 tongyi vs 真实码 qwen2_5_7b_instruct_model_api —— 零重叠
if key in platform_code: return key
return "other"          # 静默吞掉

# ✅ 显式别名表 + 未识别时告警
PLATFORM_ALIASES = {"tongyi": ("tongyi", "qwen"), ...}
logger.warning("未识别的 platform_code=%s，已归入 other", code)
```

**别名表铁律**：**别名之间不得重叠**。
`seed_oss` 若同时写进 `doubao` 和 `seed`，字典序中靠前的会抢走匹配，导致另一个平台整体消失。

### ⑧ 派生指标不显示时，说明「为何不显示」

`avg_rank` 为 `None` 时，前端**不要**显示空白或 0，而应显示
「排名维度暂无数据」——让用户知道是**没测**，不是**测出来很差**。

---

## 执行流程

### Step 1 — 列出所有对外数字
把接口返回值里的每个数值字段列出来，逐个问：
- 这个数字的计算式是什么？
- 分子分母各自从哪来？
- 无样本时会变成什么？

### Step 2 — 搜三类反模式的代码特征
```
# 假回退
grep -n "or 7\.0\|else 7\.0\|DEFAULT_.*=\s*[0-9]" 

# 编造因果
grep -n "\* 2000\|\* 1000\|count \* " 

# 自证循环（重点）
grep -n "= .*\* [0-9.]\+"     # 找造分子处
grep -n "/ .* \* 100"          # 找反算比率处
# 然后人工回溯：比率的分子是否正是上面造出来的？
```

### Step 3 — 写诚实性测试（必须反向验证）
```python
async def test_ctr_never_self_proving_seven_percent():
    result = await get_traffic_estimate(project=_project(), db=db)
    data = result["data"]
    assert data["click_through_rate"] is None, (
        "返回了 CTR 数值 —— 极可能是又用 clicks/views 反算，"
        "而 clicks 由假设系数算出，导致 CTR 恒等于假设值（自证循环）"
    )
    assert data["ctr_is_assumption"] is True
    assert data["assumed_ctr"] == 7.0
```

### Step 4 — 反向验证（不可跳过）
把修复**改回缺陷写法**，确认测试变红，再恢复。

```bash
# ⚠️ 危险：不要把「备份」和「修复版」搞混
# 先记哈希再动文件，否则极易自毁修复
md5 -q src/advanced.py > /tmp/hash_before.txt
# 注入缺陷 → pytest 应变红
# 恢复 → 记哈希 → 确认与 hash_before 一致
```

**踩坑记录**：`cp /tmp/xxx.orig src.py && pytest` 这类命令，
**无法知道备份文件是修复前还是修复后**。曾因此一度误判"修复全部丢失"。
→ 铁律：**动文件前先 `md5` 记哈希**，用哈希判断版本，不要靠 grep 猜。

### Step 5 — 生产实测（决定性证据）
本地测试全绿 ≠ 生产生效。必须用**真实登录态**调真实接口：
```python
# 注意生产可能启用令牌代次校验，token_version 必须从库里取
row = await s.execute(text("SELECT id, COALESCE(token_version,0) FROM users WHERE ..."))
token = create_access_token(subject=user_id, token_version=tv)
```

---

## 反面清单（一眼识别可疑代码）

| 代码特征 | 可疑点 |
|---|---|
| `... or 7.0` / `DEFAULT_XXX = 7.0` | 假回退 |
| `diag_count * 2000` | 编造因果 |
| `clicks = views * 0.07` 紧跟 `ctr = clicks/views*100` | **自证循环** |
| `else: weight = 0.4` 前面是 `if rank <= 3` | `None` 与实测共用分支 |
| `catch { return {...} }` | 前端假数据兜底 |
| `for m in last_6: append({views: 0})` | 「无数据」伪装成「数据为 0」 |
| `return "other"` 无日志 | 归一静默失败 |

---

## 汇报口径

修完必须能回答：

1. **每个数字的来源** —— 是实测、是假设、还是推算？各自占比多少？
2. **无数据时显示什么** —— 空态、报错、还是数字？
3. **假设参数是否可见** —— 客户能否知道"7% 是行业假设而非我的实测"？
4. **反向验证记录** —— 注入缺陷后测试是否真的变红？

**最忌讳的一句汇报**：「接口正常返回 200，字段都有值」——
字段有值恰恰可能是最严重的问题。


---

## 效果预览

![效果预览](https://raw.githubusercontent.com/zhiyingstudio/zhiying-skills/main/skills/zhiying-data-honesty-audit/preview.jpg)

*上图为本技能的效果预览：真实界面演示或能力概览卡。安装后按 SKILL.md 指引即可复现同等效果。*
