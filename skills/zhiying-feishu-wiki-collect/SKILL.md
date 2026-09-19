---
name: zhiying-feishu-wiki-collect
display_name: 飞书知识库采编
display_name_en: Feishu Wiki Collect
description: "飞书知识库跨库采编：抓取源 Wiki 文档、清洗去水印、目标板块新建并内联迁移图片、自动设封面。触发词：飞书搬运、知识库采编、wiki迁移、飞书文档复制、跨库搬运、zhiying-feishu-wiki-collect。"
description_zh: "飞书知识库跨库采编：抓取源 Wiki 文档、清洗去水印、目标板块新建并内联迁移图片、自动设封面。"
description_en: "Cross-space Feishu wiki collection: fetch source docs, clean watermarks and layout blocks, recreate pages with inlined images and auto covers."
category: 办公协同
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-feishu-wiki-collect
displayName: "飞书知识库采编"
summary: "飞书知识库跨库采编：抓取源 Wiki 文档、清洗去水印、目标板块新建并内联迁移图片、自动设封面。"
license: MIT
---

# 飞书知识库跨库采编

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

## 触发场景
- 「从 XX 知识库采编/搬运内容到我的知识库」
- 「按板块分类从源库收集内容，去水印去外链」

## 随包资产
- 引擎：`scripts/collect.py`（清洗+建节点+写正文+**自动封面**），命令：
  - `python3 scripts/collect.py test <源节点token> <目标板块token>`（dry-run 预览，不写台账）
  - `python3 scripts/collect.py run <源节点token> <目标板块token> <标题前缀>`（正式采编）
- 封面工具：`scripts/add_cover.py`（单篇 `python3 scripts/add_cover.py <url>` 或批量 `--ledger` 回填）
- 台账：`采编台账.json` 首次运行自动创建于脚本同目录（防重复采编，含 `cover.source` 记录）
- 可选兜底封面：放一张品牌图到 `scripts/assets/brand_banner.png`，无首图文档自动用它当封面
- 前置依赖：`lark-cli` 已登录（`lark-cli auth login`），Python 3.9+

## 采编流程（collect.py 已封装）
```
node-get 源节点拿标题 → docs +fetch 抓正文 XML → clean_content 清洗
→ wiki +node-create 在目标板块建节点 → docs +update append 清洗后内容
（巨型文档分块 append，每块<20000字符+3次重试）
→ 回读验证图片数 → _set_cover 设封面（首图优先/品牌横幅兜底）→ 写台账
```
用法：`python3 scripts/collect.py run <源节点token> <目标板块token> <标题前缀>`（test 模式只读预览）

## 清洗规则（clean_content，顺序敏感）
1. 全部 `<a>` 去包装留文字（外链+源库内链全清）
2. **img 只保留 src token，删 href 属性**——href+src 组合 append 必报「<img> href cannot be combined with src」；src token 跨租户可直接迁移（大型公开库→个人库已验证）
3. grid/column/figure 布局容器解包（去标签留内容）——否则 append 校验失败
4. 剔除：bookmark（网页书签）、source（文件附件）、sub-page-list、cite、wiki_recent_update、title 块
5. 文本水印：来源署名 / 推广链接 / 关注公众号类（`WATERMARK_SNIPPETS` 按源库自定义）
6. 正文<30 字符视为目录页跳过

## 关键坑
1. node-create 成功但 append 失败会留空壳节点——重试前先列板块子级清理（判据：去掉 title 块后正文<10 字符）
2. lark-cli flag 必须 `--block-id` 连字符、布尔必须 `--include-children=true`；封装 subprocess 时 kwargs 下划线要转连字符
3. `drive +update-title`（重命名）需要 lark-cli ≥ 1.0.89；升级报 npm ENOTEMPTY 时 `/bin/rm -rf .../@larksuite/.cli-xxx` 临时目录后重试
4. 源库 URL 是独立首页文档（has_child=false 且 parent=''）时，内容在空间根级：node-list 不传 parent
5. 源库空间级 permission_denied 时，入口单页的内嵌 `<cite doc-id>` 文档仍可逐个 docs +fetch 读取
6. **巨型文档（>100KB）单次 append 会 network timeout**——分块写入：在顶层块闭合边界（`</p>` `</h1>`-`</h3>` `</ul>` `</ol>` `</callout>` `</blockquote>` `</table>` 及自闭合 `<img/>`）切 chunk，每块 <20000 字符，逐块 append（每块 3 次重试 + 间隔 0.3s）。实测 213KB/407图/2289块 → 10 块全部成功
7. 图片计数口径：清洗器在剔除 sub-page-list/cite 前统计 imgs，含被剔除块内的图——验证时 imgs_verified < imgs_planned 少几张属正常，不是丢图
8. 双轨路由：系统性教程/横评/工具课→编号板块；碎片化玩法/案例→媒介专区。采编前先查目标库是否已有同主题文档（用户原有内容优先，避免近重复）
9. **封面**：`docs +resource-update --doc <url> --type cover --file <rel_path>` 设封面；首图用 `docs +media-download --token <src> --output <rel_path>` 下载到相对路径再上传；`--file/--output` 禁止绝对路径（lark-shared）；img block id ≠ file_token（要 `src` 属性值，例 `K6tAboN1Go0wDex4WTQcYbyhn8f`，而 block id `PwyfdxHefogAgOxoZFScQ8Pjn1f` 不能用于 download）
