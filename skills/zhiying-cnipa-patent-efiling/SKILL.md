---
name: zhiying-cnipa-patent-efiling
display_name: 专利电子申请助手
display_name_en: CNIPA Patent E-Filing
description: "中国专利电子申请系统全流程自动填报：三书填写、请求书、费减勾选、附图上传、提交校验与缴费核账。触发词：专利申请、专利填报、CNIPA、电子申请、专利缴费、案卷填报、zhiying-cnipa-patent-efiling。"
description_zh: "中国专利电子申请系统全流程自动填报：三书填写、请求书、费减勾选、附图上传、提交校验与缴费核账。"
description_en: "Full-flow automation for CNIPA e-filing: claims/spec/abstract entry, request form, fee reduction, drawing upload, submission checks and fee reconciliation."
category: 效率工具
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-cnipa-patent-efiling
displayName: "专利电子申请助手"
summary: "中国专利电子申请系统全流程自动填报：三书填写、请求书、费减勾选、附图上传、提交校验与缴费核账。"
license: MIT
---

# 中国专利电子申请系统（CNIPA）自动填报

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

## 适用场景

在 CNIPA「专利业务办理系统」的发明专利申请案卷页（URL 含 `fmzlxg?dianzisqajbh=<案卷号>`）自动完成填报。验证案例：某发明专利案卷全流程提交成功。

登录入口：`https://tysf.cponline.cnipa.gov.cn/am/#/user/login`，3 个 tab（自然人登录 / 法人登录 / 代理机构登录），扫码按钮 `button.qrImg`。

## 铁律（违反必失败）

### 1. 所有点击必须用「合成 DOM MouseEvent」，绝不用 CDP 坐标投递

`Input.dispatchMouseEvent` 在这个页面上**时灵时不灵**（Tab 切换、弹窗按钮经常完全无响应，8 次点击零效果）。**唯一可靠方式**：

```js
const el = /* 目标元素 */;
const o = {bubbles:true, cancelable:true, view:window, button:0, buttons:1};
const r = el.getBoundingClientRect();
['mousedown','mouseup','click'].forEach(ty =>
  el.dispatchEvent(new MouseEvent(ty, Object.assign({clientX:r.x+r.width/2, clientY:r.y+r.height/2}, o))));
```

对 Element-UI 的 radio/checkbox/button 再补一句 `el.click()`。

### 2. 字段定位绝不能用「向上找祖先容器含某文本」

大表单容器会让**所有字段命中同一条件**。踩过的坑：定位「指定说明书附图中的图 __ 为摘要附图」时，用 `inp.parentElement` 向上找 6 层含该文本 → **误命中了发明名称输入框，把发明名称改成了「1」**。

**正确方式，按优先级**：
1. `.el-form-item__label` 精确文本匹配
2. **宽度特征**（最稳）：发明名称 `w≈811`；摘要附图 `w≈100`；联系人字段 `w≈255/194/244`
3. `y` 坐标范围

### 3. 每次操作前先清理

```js
document.querySelectorAll('.el-message').forEach(e=>e.remove());
document.querySelectorAll('*').forEach(e=>{ if(e.scrollTop>0) e.scrollTop=0; });
```

- `.el-message` 残留 3.5 分钟会误读为新提示
- `el-scrollbar__wrap` 的 scrollTop 非零会把按钮推到视口外（y=-2404）

### 4. 保存是「三段式」，必须过确认框

点「保存」→ 弹 **「对正在编辑的项号/段号/图号是否进行刷新?」**（按钮：`取消保存` / `保存并刷新` / `保存不刷新`）→ 点**「保存并刷新」** → `POST /editor/review-text-editor/html2Xml` → `GET /zxsq-guojia/zxsq/fjwj/savewushupage?wenjianbs=N` → 提示「保存成功!」

**点「确定」或「取消保存」会触发删除**，必须精确匹配 `保存并刷新`。

### 5. Chrome 必须长驻保活

每次 Bash 调用结束 Chrome 被回收。必须用 `run_in_background: true` + 末尾 `[HOLD]` 循环。

启动参数：`--no-sandbox --disable-gpu-sandbox --disable-software-rasterizer`（**不可用 `--disable-gpu`**，会 `FATAL: GPU process isn't usable`）。

## 关键结构速查

### 案卷页 Tabs

| Tab 文本 | DOM id | pane id |
|---|---|---|
| 权利要求书 | `tab-Claims` | `pane-Claims` |
| 说明书 | `tab-Description` | `pane-Description` |
| 说明书附图 | `tab-Drawings` | `pane-Drawings` |
| 说明书摘要 | `tab-Abstract` | `pane-Abstract` |
| 申请文件 | `tab-ShenQingWJ` | `pane-ShenQingWJ` |
| 发明专利请求书 | `tab-FaMingQQS` | `pane-FaMingQQS` |

### 三书正文：CKEditor 5

- 唯一实例 `.ck-editor__editable.editor1`，**切 Tab 复用同一 DOM**，非 iframe
- 注入纯文本后编辑器自动加段号：说明书 `0001.` `0002.`；权利要求书 `1.` `2.`
- 注入方式：聚焦 → `Cmd+A`（macOS modifier=4）→ Backspace → 逐段 `Input.insertText` + Enter

### 附图 Tab 专属按钮（顶部 y≈192）

| 文字 | 作用 |
|---|---|
| 保存 | 保存（走三段式） |
| 清空 | 清空（弹「此操作将删除文件, 是否继续?」） |
| 启动word转xml工具 | 案卷包流程 |
| **上传** | **只接受 `.zip`**（案卷包），**不能传 PNG/JPG** |

**附图上传唯一正确路径**：点 CKEditor 工具栏的「**插入图像**」按钮（提示文本 `插入图像`）→ 触发 `input[type=file][accept="image/jpeg,image/tiff"]`（class `ck-hidden`）→ 用 `DOM.setFileInputFiles` 注入。

工具栏按钮**无 aria-label/title**，需从 `.ck-button__label` 文本或 `.ck-tooltip` 识别。附图 Tab 工具栏实测：`首图/上一图/下一图/末图/行间距/字体放大/字体缩小/打印/搜索/自动浏览/字数/插入图像/编辑图片/删除图片/撤销/重做`。

### 附图上传硬性要求

- **只接受 JPEG / TIFF，不接受 PNG**（先用 `sips -s format jpeg` 转换）
- **必须 300 DPI**（72 DPI 会报「拷贝图片文件异常」）
- 尺寸上限：图形区 ≤ 15×22cm → **1772×2598 px @300dpi**
- 转换命令：
  ```bash
  sips --resampleWidth <w> in.jpg
  sips -s format jpeg -s formatOptions 95 -s dpiWidth 300 -s dpiHeight 300 out.jpg
  ```
- 上传后图元素带 `num="1"` `num="2"` 属性和图题 `<label>图 1</label>`

### 请求书关键字段定位（按宽度）

| 字段 | 宽度 | 位置 |
|---|---|---|
| 用户案卷号 | w≈200 | y≈240 |
| **发明名称** | **w≈811** | y≈330 |
| 联系人姓名 | w≈194 | ph「请输入姓名」 |
| 电话 | w≈255 | ph「请输入电话」 |
| 电子邮箱 | w≈255 | ph「请输入电子邮箱地址」 |
| 省（el-select） | w≈255 | 级联，选项 34 项，辽宁省=`210000` |
| 市县（el-select） | w≈255 | 级联，大连市=`210200` |
| 详细地址 | w≈255 | ph「请输入详细地址」 |
| 邮政编码 | w≈255 | ph「请输入邮政编码」 |
| **摘要附图** | **w≈100** | y≈2333（长距离滚动） |

### el-select 级联选择（Vue 数据层）

坐标点击/dropdown 面板会被立即关闭。**用 Vue 实例直接赋值**：

```js
function findVue(el){ let x=el; while(x){ if(x.__vue__) return x.__vue__; x=x.parentElement; } return null; }
const v = findVue(document.querySelectorAll('.el-select')[INDEX]);
v.$emit('input', '210000');
v.$emit('change', '210000');
v.handleOptionSelect({value:'210000', label:'辽宁省', selected:false});
```

选省后市县 options 自动级联（辽宁省 → 14 市）。

### 费减勾选

`.el-checkbox` 只能调 **`label.click()` 一次**。用 `mousedown/mouseup/click` 序列会触发两次 toggle 相互抵消。成功标志：申请人列表「费减请求」列显示 **「请求费减」**。

> **注意**：`label.click()` 有时不生效（状态不变）。更稳的是**点内部原生 input**：
> ```js
> const inp = lb.querySelector('input.el-checkbox__original');
> inp.click();
> ```
> 且 Element-UI 的 checked 状态**异步更新**，`click()` 返回后立刻读 `classList.contains('is-checked')` 可能仍是旧值——**必须等 800ms 再读**才准。

## ⭐ 提交校验报错处置（提交前必过）

点「预 览 / 提 交」（**按钮文本带空格！** 匹配前必须 `innerText.trim().replace(/\s+/g,'')`）后进入校验页 `gjsq/yulan?bh=<案卷号>`。若失败会列出校验表：

| ID | 提示 | 根因 | 处置 |
|---|---|---|---|
| **JY010313** | 请指定一位申请人作为代表人 | 没有任何申请人被勾「代表人」 | 在「修改申请人」弹窗勾上「代表人」 |
| **JY010335** | 代表人应当是提交专利申请的申请人，请核查代表人姓名或名称及证件号码是否与登录用户信息一致 | 申请人**名称与登录账号/营业执照全称不完全一致** | 按营业执照**全称**逐字补全（常见漏「（个体工商户）」后缀） |
| **JY010316** | 第1申请人未完成费减资格备案 | **同一根因**——名称不匹配导致匹配不到备案记录 | 同上，一并解决 |

**关键结论（已实证）**：
1. **「代表人」是必须勾的**。取消勾选 → JY010335 消失但立刻触发 JY010313。正确解法不是取消，而是**让名称精确匹配**。
2. **名称必须全等匹配**。营业执照全称里的「（个体工商户）」是**全角括号**，必须原样带上。页头登录身份显示 `大连市甘井子区智影数字科技工作室（个体工商户）（宫帅）`，其中前段即申请人应有全称。
3. **两条报错同源**。改名后 JY010335 + JY010316 **同时消失**（费减备案本身是通过的，只是匹配不到）。
4. **诊断路径**：不要盲目取消勾选。先打印申请人表格行 → 对比页头登录身份 → 对比营业执照 → 补全名称。

「修改申请人」弹窗结构：
- `序号`（disabled，`el-input`）
- **`姓名或名称`** ← 要改的就是它，`w≈?` 用 `label.innerText.trim()==='姓名或名称'` 精确匹配
- **`代表人`** ← 不是独立 form-item！是紧跟在「姓名或名称」输入框右侧的 `label.el-checkbox`（父容器 `el-col-3.5`），label 文本 `代表人`

改名称写值要用 React/Vue 认的原生 setter：
```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
setter.call(inp, '大连市甘井子区智影数字科技工作室（个体工商户）');
inp.dispatchEvent(new Event('input',{bubbles:true}));
inp.dispatchEvent(new Event('change',{bubbles:true}));
inp.dispatchEvent(new Event('blur',{bubbles:true}));
```

## 提交动作与回执

校验通过后自动跳转预览页，按钮变为 **「返回编辑」+「签名」**。点「签名」弹：

> **「已开启免签功能，是否确定提交？」** [取消 / 确定]

点**「确定」**即完成递交。成功后**自动跳回案卷列表页** `gjsq/fmzlsq`，列表中新增该案并带**申请号**（13 位，如 `2026XXXXXXXXX`）。

点该行「查看结果」→ 弹「查看结果详情」，内容形如：

> 您于 2026年09月16日 提交 发明专利申请 请求,已经提交成功，申请号为: 2026XXXXXXXXX

**注意**：若点了「查看结果」后弹窗读不到，先关掉所有残留弹窗、再用**该行内**的按钮定位（`tr` 内含申请号则取该 `tr` 内的按钮），并在跳转后（URL 可能变到 `zljffw/zancunkbl/chuzancrh`）遍历**所有** `.el-dialog__wrapper`（含 `display:none` 的）读 `innerText`。

## ⭐ 缴费与费用核账（提交后）

### 关键认知：费用挂在「申请号」上，不是挂在「案卷号」上

提交发明专利时若**同时勾选了「实质审查请求」**，系统会生成**两个独立案卷**：

| 案卷类型 | 含义 | 举例 |
|---|---|---|
| **新申请** | 专利申请本身（带内部编号，如 MY-2026-001） | 1000XXXXXXXX |
| **中间文件** | 单独递交的**实质审查请求书** | 10000566852404 |

两个案卷**各自在「待缴费业务」里列出同一套 4 项费用** → 列表看起来是双份。

**但系统按申请号归并，实际只需缴一套。** 不要误判为「重复计费」或「系统错误」。

### 权威核账路径（二选一，交叉验证）

**路径 A：电子申请案卷查询**（厘清案卷关系）
```
查询统计 → 电子申请案卷查询
URL: public-app-zxsq-guojia/chaxuntjmk/chaxun/tijiaoajqkcx
列：电子申请案卷编号 | 内部编号 | 申请号 | 发明创造名称 | 专利类型 | 办理业务类型 | 案卷类型 | 提交时间 | 提交账户
```

**路径 B：应缴费查询**（⭐ 系统权威应缴金额）
```
缴费服务 → 费用查询 → 应缴费查询
URL: public-app-zljffw/feiyongcx/dangesqhcx
操作：输入申请号 → 点「查询」→ 结果按申请号给出**一组**费用
列：费用种类 | 缴费期限届满日 | *金额
```
页面原文提示：
> 「应缴费用查询」结果显示的是缴费期限届满日前需缴纳的费用信息，如费用已缴纳可忽略。具体已缴费用情况可进入「专利费用查询」中输入申请号查看专利费用详细信息。…本页面显示信息仅供参考。

### 待缴费业务页

```
我的办公桌 → 待缴费业务(N)
URL: public-app-zxsq-guojia/wdbgz/wdbj
Tab：待答复案件(N) / 未提交业务(N) / 待缴费业务(N) / 近一年业务办理历史 / 全部业务办理历史
列：电子申请案件编号 | 申请号/专利号 | 发明创造名称 | 办理业务类型 | 待缴费用名称 | 应缴费用金额 | 期限届满日 | 创建时间 | 操作
```
- 每行有独立勾选框（`el-table-column--selection`）+ 独立「去缴费」按钮
- **无「删除待缴记录」入口**——用户无法删记录
- 页面提示：**「办理业务缴费提示信息，系统仅保留 1 月，逾期系统将自动清除。」**
  （但**本金缴费义务不因提醒消失而免除**）
- ⚠️ 反复点「去缴费」+ 取消后，**前端表格状态会错乱**（tab 计数仍为 N 但表格只渲染 2 行、分页显示「共 0 条」）→ **`Page.navigate` 重载页面即可恢复**

### 缴费单页（点「去缴费」→ 确认后进入）

```
URL: public-app-zljffw/onlinePay/fillInList
```
- 点「去缴费」弹自定义 `.el-dialog`（**不是** `.el-message-box`！）文本「确定要跳转去缴费么?」
  - 按钮选择器：`[...document.querySelectorAll('.el-dialog')].filter(d=>d.offsetParent!==null)` 取最后一个，再找 `button` 文本 `确定`
- 缴费单按「序号」分组，每组 = 一个申请号的缴费任务单，标注 `申请号/专利号`、`票据抬头`、`小计`
- 明细表：`费用种类 | 金额 | 操作`
- **每项费用右侧有独立「删除」按钮**，顶部有全局「删除」「修改」「增加」
- 提示：「【下一步】功能将提交列表所有费用信息」
- **进入缴费单页本身不产生任何订单**；只有点「下一步」并完成支付才会

### 订单核对

```
缴费服务 → 网上缴费 → 订单管理
URL: public-app-zljffw/onlinePay/orderManagerList
Tab：全部(N) / 待支付(N) / 已支付(N) / 支付失败(N) / 支付中(N) / 已失效(N)
```
**缴费前先查这里应为 0 条**，可确认未误缴。

### 发明专利费用标准（费减 85% 后，单主体个体户）

| 科目 | 全价 | 费减后 |
|---|---|---|
| 发明专利申请费 | ¥900 | **¥135** |
| 公布印刷费 | ¥50 | **¥50**（不减免） |
| 发明专利申请实质审查费 | ¥2500 | **¥375** |
| 权利要求附加费（超出 10 项部分） | ¥150/项 | **¥150/项**（不减免） |
| **一套合计**（含 2 项附加费） | | **¥860** |

常见期限：申请费/公布印刷费/权利要求附加费 = 申请日起 2 个月内；实质审查费 = 申请日起 3 年内。

### 踩坑：Element UI 折叠菜单（`li.el-submenu`）子项点不动

「费用查询」下的「应缴费查询」「专利费用查询」是折叠子项，**单次点击容易落空**（菜单展开又收起）。

**解法：分两次 Runtime.evaluate 调用**
1. 第 1 次：点 `li.el-submenu` 的 `.el-submenu__title`（展开）
2. 等 **1.2 秒**
3. 第 2 次：立即用 `innerText` 正则 `/^\s*应缴费查询\s*$/` 找子项并合成点击

### CDP 脚本模板

见 `scripts/query_dues.js`（应缴费查询取值）与 `scripts/dump_fee_list.js`（待缴费列表全量抓取）。

## 其他环境要点

- **CDP 端口识别**：用户机器上 9222 常被日常 Chrome 占用。专利系统专用实例实测在 **9333**（`/json/list` 里找 URL 含 `cponline` 的 page）。动手前先探测端口。
- **页面重载后 Vue 渲染慢**：`Page.navigate` 后至少等 **10–12 秒**再读 DOM，否则会读到空表格导致误判「数据丢失」。
- **生产构建无 `__vue_app__`**：想从 Vue 内存读数据会拿到 `has_app:true` 但挖不到 `$data`（devtools 关闭）。**回退到 DOM 读取即可**，DOM 层数据始终可靠。

## API 接口族（`/zxsq-guojia/` 前缀，域名 `api.cponline.cnipa.gov.cn`）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/gjsq/fmzlsq/add` | 建案 |
| POST | `/gjsq/fmr/save` | 保存发明人 |
| POST | `/gjsq/sqr/save` | 保存申请人 |
| POST | `/gjsq/fmzlsq/zhu/save` | **保存请求书主表** |
| POST | `/editor/review-text-editor/html2Xml` | 正文转 XML |
| GET | `/zxsq/fjwj/savewushupage?wenjianbs=N` | **保存正文页** |
| POST | `/editor/upload/img` | **附图上传** |
| POST | `/editor/review-text-editor/deleteDmhwjst` | 删除 |
| POST | `/editor/review-text-editor/xml2Html` | 反向读取 |
| POST | `/zxsq/fjwj/saveFjwj` | 附加文件保存 |

真实 API 域名是 `api.cponline.cnipa.gov.cn`（不是 `interactive.`）→ 跨域受限，**必须走 UI 操作**。

## 标准作业流程

1. **启动 Chrome 长驻**（后台任务 + HOLD 循环，profile 目录保留 Cookie）
2. **扫码登录**：切对应 tab → 提取 `img[src^="data:image"]` 且 `naturalWidth>=150` → 导出 PNG 给用户扫
3. **逐 Tab 填正文**：合成事件切 Tab → 清空 → 注入纯文本 → 保存（走三段式）
4. **附图**：PNG→300DPI JPEG（≤1772×2598）→ 合成事件点「插入图像」→ `setFileInputFiles` 注入 → 保存
5. **请求书**：按宽度定位字段填 → 选摘要附图 → 保存
6. **重载验证**：`Page.navigate` 回案卷页 → 逐 Tab 回读确认持久化
7. **核对申请人名称**（⭐ 提交前的关键一步）：`dump_applicants.js` 打印表格 → 与**营业执照全称**逐字比对（特别是「（个体工商户）」后缀）→ 不一致则 `fix_applicant_name.js` 修正 → 保存主表
8. **过校验**：`check_and_submit.js` → 点「预览/提交」→ 若出校验表按上文处置；通过则进预览页
9. **停在这里**，向用户报告并请求确认提交（若用户已授权则可直接点「签名」→「确定」）

## 完整链路验证记录

| 日期 | 案卷号 | 申请号 | 结果 |
|---|---|---|---|
| 2026-09 | 某发明专利案 | **2026XXXXXXXXX** | ✅ 全流程提交成功 |
| 2026-09-15 | 10000566745533（创课案） | 2026114260670 | ✅ 已提交（原案保留） |

## 脚本清单

见 `scripts/`：
- `cdp.js` — CDP 连接 + send/ev/合成点击的通用库
- `boot_chrome.sh` — Chrome 长驻启动器
- `inject_text.js` — CKEditor 正文注入
- `upload_fig.js` — 附图上传（规范化 + 注入）
- `save_tab.js` — 通用保存 + 三段式确认框处理
- `set_select.js` — el-select 级联赋值
- `dump_applicants.js` — 打印申请人/发明人表格当前状态（诊断第一步）
- `fix_applicant_name.js` — 改申请人名称为营业执照全称 + 保证「代表人」勾选
- `check_and_submit.js` — 保存 → 点「预览/提交」→ 抓校验表 / 或进入预览页 → 点签名 → 确定提交
- `dump_fee_list.js` — 抓「待缴费业务」全量（第 1 页 + 翻到第 2 页）+ 汇总金额
- `query_dues.js` — 「应缴费查询」按申请号查权威应缴金额（含折叠菜单展开两步法）
- `dump_fee_order.js` — 抓缴费单页（`onlinePay/fillInList`）结构与各「删除」按钮坐标

> 所有脚本顶部 `WS_PORT` 默认 9333，按实际端口改。

## 已知的假警报（不要被误导）

- **弹窗反复出现但 API 返回 200 + 「保存成功!」** = 数据已落库，弹窗是 UI 状态未复位，**可忽略**
- **`.el-dialog__wrapper` 有 47 个实例**，多数是隐藏的；`display:block` 不代表真的在等交互，Vue 的 `visible` 可能已 false
- **`el-dialog__close` 点击无效** + Vue 链上只有 `transition` 组件 = 僵尸节点，**重载页面即可清除**
- **编辑器读到的「请检查填写内容的完整性」** 很可能是 3.5 分钟前的 DOM 残留
