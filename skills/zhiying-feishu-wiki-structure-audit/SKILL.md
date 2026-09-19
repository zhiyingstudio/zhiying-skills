---
name: zhiying-feishu-wiki-structure-audit
display_name: 飞书知识库体检
display_name_en: Feishu Wiki Structure Audit
description: "飞书知识库结构审查：BFS 全量盘点节点树、导航死链校验、零宽字符标题检测、重复与空板块识别。触发词：飞书体检、知识库盘点、目录树、死链检查、wiki结构、zhiying-feishu-wiki-structure-audit。"
description_zh: "飞书知识库结构审查：BFS 全量盘点节点树、导航死链校验、零宽字符标题检测、重复与空板块识别。"
description_en: "Feishu wiki structure audit: BFS node inventory, dead navigation link checks, zero-width title detection, duplicate and empty section discovery."
category: 办公协同
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-feishu-wiki-structure-audit
displayName: "飞书知识库体检"
summary: "飞书知识库结构审查：BFS 全量盘点节点树、导航死链校验、零宽字符标题检测、重复与空板块识别。"
license: MIT
---

# 飞书知识库结构审查

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

## 触发场景
- 「审查我的飞书知识库结构/分类/导航」
- 「盘点知识库全部页面，出目录树」
- 「评估分类体系是否合理，给调整方案」

## 前置
1. 先加载 lark-wiki + lark-shared skill（身份 `--as user`，判断成功用 `ok == true`）
2. 整理/重构类任务必须走 lark-drive 的 `knowledge_organize` workflow（写操作前必须用户确认）

## 执行流程

### 1. 解析目标
```bash
lark-cli wiki +node-get --node-token '<wiki_url>' --as user --format json
```
从 `data.space_id` 取空间 ID，`data.node_token` 取根节点。若 `parent_node_token` 为空说明是空间根级节点。

### 2. BFS 全量盘点
Python 脚本模式（随包 `scripts/inventory_wiki.py`，参数化用法见脚本 docstring）：
- 队列 BFS，`has_child=true` 才钻取；每层生成 `path`（父路径 / 标题）
- 分页：`--page-size 50`，循环 `page_token` 直到 `has_more=false`
- 记录：node_token / obj_token / obj_type / node_type / depth / path
- 输出 JSON 清单 + 缩进目录树文本

### 3. 结构分析（固定检查项）
| 检查项 | 方法 |
|--------|------|
| 一级/二级板块节点数分布 | 按 path 前缀统计 |
| 空板块 | `has_child=false` 且标题带编号/专区字样 |
| 零宽字符标题 | `unicodedata.category(c) in ('Cf','Cc')` 检测（源库复制常带入 40-50 个） |
| 同名重复节点 | 按 title 分组，比较 obj_token 判断是独立副本还是快捷方式 |
| 导航死链 | 抓根文档正文提取 wiki 链接 token，与节点树比对；不在树中的用 `wiki +node-get` 二次确认（not_found=死链） |
| 导航名与节点名不一致 | 导航链接文本 vs 实际节点 title |

### 4. 报告输出
固定结构：现状概况表 → P1 结构性 / P2 导航规范 / P3 板块内容 三级问题清单 → 调整方案（分类合并/层级重构/导航完善/缺失板块）→ 执行计划分阶段标注风险等级。**写入操作必须等用户确认。**

## 关键坑
1. **lark-cli wiki +node-list 返回信封是 `{ok, data:{nodes}}`**——脚本里直接 `.get("nodes")` 会静默拿到空列表，必须 `.get("data",{}).get("nodes",[])`（已踩过：5 个源库全部误报 0 板块）
2. 源库 URL 若 `has_child=false` 且 `parent=''`，内容可能在**空间根级**（parent 省略调 node-list）而非该节点下；空间级 permission_denied 时入口单页+内嵌 `<cite doc-id>` 引用文档仍可逐个读取
3. 大型公开知识库的编号体系（如 1.1–2.0 教程编号）常被其他库映射复用，审查时可作同构锚点参考
4. **首页节点 ≠ 空间根级**：知识空间常以首页文档为目录树根，一级板块挂在首页节点下。BFS 要从首页节点开始；重建一级板块必须 `--parent-node-token <首页token>`，用 `--space-id`（不传 parent）会建到空间根级、脱离目录树（踩过：回滚时各路大神建错位置，BFS 少了 59 个节点的假象）
5. **审查≠重构授权**：报告里把"空板块"列为问题时，先问清是否为用户预留（宫帅案例：空板块是他打算自己填的，媒体场景分区是他的偏好，合并双轨被要求回滚）。结构调整方案必须逐项确认后再动

