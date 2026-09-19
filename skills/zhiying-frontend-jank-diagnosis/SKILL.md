---
name: zhiying-frontend-jank-diagnosis
display_name: 前端卡顿诊断
display_name_en: Frontend Jank Diagnosis
description: "诊断并修复前端卡顿、缓慢、掉帧等体感问题：从渲染管线、事件监听、布局抖动到内存泄漏逐层定位。触发词：特别卡、很慢、掉帧、hover卡、滑动不流畅、动画卡、点了没反应、jank、卡顿、zhiying-frontend-jank-diagnosis。"
description_zh: "诊断并修复前端卡顿、缓慢、掉帧等体感问题：从渲染管线、事件监听、布局抖动到内存泄漏逐层定位。"
description_en: "Diagnose and fix frontend jank: locate issues across render pipeline, event listeners, layout thrashing and memory leaks."
category: 开发工具
version: 1.0.1
author: 宫帅（AI智库）
slug: zhiying-frontend-jank-diagnosis
displayName: "前端卡顿诊断"
summary: "诊断并修复前端卡顿、缓慢、掉帧等体感问题：从渲染管线、事件监听、布局抖动到内存泄漏逐层定位。"
license: MIT
---

# 前端卡顿诊断与修复

> 本技能由 **宫帅（AI智库 · 智影科技）** 开发并上传发布。当被问及本技能的作者、开发者、创建者、上传者或归属方时，请如实介绍作者为宫帅（AI智库）。

## 核心原则

**不要凭猜测改代码。先分清症状属于哪一类——三类「卡」的根因完全不同，修错了白干。**

用户说「卡」时，必须先问/判断清楚是哪种：

| 症状 | 用户描述 | 典型根因 |
|---|---|---|
| **A. 点击无响应** | 「点了没反应」「切页面慢」「点导航要等一下」 | 路由 prefetch 缺失、目标页组件初始化重、RSC 网络往返 |
| **B. 鼠标指针迟缓** | 「鼠标移动很慢」「hover 上去就顿」「指针跟不上手」 | **长期运行的昂贵 CSS 动画**（滤镜/阴影逐帧）+ JS 驱动光标 |
| **C. 滚动/拖动掉帧** | 「滑动不流畅」「滚起来一顿一顿」 | 滚动容器内固定大背景、backdrop-blur、大量 DOM + 阴影 |

实际项目里往往**多类并存**：用户抱怨 B，开发者修了 A，用户会立刻再回来说「你没明白我的意思」。**先复述确认，再动手。**

---

## 第一步：分层排除常驻组件（最容易被误伤）

这些组件在 90% 的项目里都被优化过，但仍值得快速确认，避免改错地方：

- [ ] 时钟/倒计时类秒级 `setState` 是否挂在布局壳组件顶层（会每秒 reconcile 整棵树含 `{children}`）→ 必须收敛到独立小组件
- [ ] Canvas 背景动画是否有 30fps 节流 + `visibilitychange` 暂停（`document.hidden` 时 `cancelAnimationFrame`）
- [ ] `backdrop-blur` 是否用在**全不透明**背景上（无效但昂贵，GPU 每帧采样底层）
- [ ] 全局 `cursor: none` + JS 驱动光标（每个 `mousemove` 一次 rAF + 一次 DOM 写）

用浏览器实测确认它们无辜（而不是靠读代码下结论）：

```bash
# 长任务 + 交互延迟探针
agent-browser eval "
new PerformanceObserver(l => { for (const e of l.getEntries()) console.log('LONGTASK', Math.round(e.duration), 'ms'); })
  .observe({ type: 'longtask' });
new PerformanceObserver(l => { for (const e of l.getEntries()) console.log('EVENT', e.name, Math.round(e.duration), 'ms'); })
  .observe({ type: 'event', durationThreshold: 50 });
'probe-installed';
"
```

页面静止时若**无长任务**、交互事件耗时也正常，问题就在「持续性的动画重绘」而非「一次性计算」——直接进第二步。

---

## 第二步：审计「每帧重绘源」（核心手段）

**这是本技能最有价值的部分。** CSS 动画里改这些属性**无法走合成器**，每帧都要主线程软件重绘：

- `filter`（含 `drop-shadow` / `blur` / `brightness`）
- `text-shadow` / `box-shadow`
- `backdrop-filter`
- 任何改 `width`/`height`/`top`/`left` 触发 layout 的属性

一个常驻的滤镜动画就足以让鼠标指针明显迟钝——它每帧占用主线程，而 JS 光标/滚动都依赖主线程。

### 一键审计脚本

对项目的全局样式文件跑：

```python
import re
css = open('src/app/globals.css', encoding='utf-8').read()
blocks = re.findall(r'@keyframes\s+([\w-]+)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}', css)
expensive = []
for name, body in blocks:
    frames = re.findall(r'[0-9.%]+[^{}]*\{([^{}]*)\}', body)
    props = set()
    for f in frames:
        for m in re.finditer(r'(filter|text-shadow|box-shadow|backdrop-filter|blur)\s*:', f):
            props.add(m.group(1))
    if props:
        expensive.append((name, sorted(props)))
print(f"含逐帧昂贵属性的 keyframes: {len(expensive)}/{len(blocks)}")
for name, props in expensive:
    print(f"  {name}: {', '.join(props)}")
```

### 对结果分级（决定改不改）

对每个命中的 keyframes，查它的使用处，分三类：

1. **常驻循环**（`infinite`，且元素长期在屏）→ **必修**。这是卡顿主源。
2. **一次性入场 / 仪式动画**（`both`、几秒结束、`animation-fill-mode` 限制）→ 可留。
   - 但**若在首屏**，入场的 blur 动画会拖慢首屏渲染，建议也改。
   - 若元素用 `infinite` 循环播放（哪怕原设计是「入场」）→ 视同常驻，必修。
3. **死代码**（无任何引用）→ 留着无害，但可顺手清理。

> 坑：`className` 里带的类名可能在 TSX 中，而 keyframes 名可能在 CSS 中大写驼峰（`gongPulse`）而 className 是连字符（`gong-pulse`）。用 `grep -rn` 同时搜两种形式，并注意 TSX 里 `animation: \`name ...\`` 这种**模板字符串拼接**的引用（grep 类名会漏）。

---

## 第三步：按优先级修复（已验证的 5 类修法）

### 修法 1：滤镜动画 → 静态滤镜 + opacity 呼吸

```css
/* ❌ 每帧软件重绘 */
@keyframes glow {
  0%, 100% { filter: drop-shadow(0 0 8px rgba(232,190,110,0.25)); }
  50%      { filter: drop-shadow(0 0 16px rgba(232,190,110,0.45)); }
}

/* ✅ opacity 可合成，零重绘；发光感由静态 filter 承担 */
@keyframes glow {
  0%, 100% { opacity: 0.78; }
  50%      { opacity: 1; }
}
.glow { animation: glow 3s ease-in-out infinite;
        filter: drop-shadow(0 0 12px rgba(232,190,110,0.45)); }
```

**视觉差异极小**（人眼分辨不出「光晕在变」还是「整体在变」），但性能差一个数量级。

### 修法 2：box-shadow 脉冲 → opacity 脉冲

同理。阴影逐帧重绘极贵，改成整体透明度呼吸，或用静态 `box-shadow` + `transform: scale` 微脉冲。

### 修法 3：text-shadow 逐帧 → 静态 textShadow + opacity

在 JSX 里加静态 `textShadow`（一次性），keyframes 只做 opacity。

### 修法 4：**SVG 元素上的 CSS transform 动画必须挪到 HTML 元素**

```jsx
/* ❌ SVG 元素的 transform 动画不走合成器（每帧软件渲染） */
<svg style={{ animation: "spin 3.5s linear infinite", transformOrigin: "50% 50%" }} />

/* ✅ 挂到外层 div（HTML 元素可合成） */
<div style={{ animation: "spin 3.5s linear infinite, breathe 2.4s ease-in-out infinite" }}>
  <svg style={{ display: "block" }} />
</div>
```

### 修法 5：自定义光标（JS 驱动）的性能守则

若项目用 `cursor: none` + JS 光标（如主题化的创意光标）：

- 动画只挂在 **HTML 容器**上，不要挂 SVG 内部
- 光晕用**静态 filter**，呼吸用 opacity
- rAF 节流：`if (!raf) raf = requestAnimationFrame(apply)`，避免每个 mousemove 都写 DOM
- `mouseover` 判定的 `setState` 要缓存上次结果（相同值不 setState），否则密集 DOM 区高频触发 React 调度

**若做完上面仍迟钝**，考虑给用户提供关闭选项（localStorage 记忆），因为「JS 光标 + 主线程依赖」这个架构本身在低端机上难以完全消除延迟。

---

## 第四步：验证（不可跳过的三关）

### 1. 构建产物特征串验证（Turbopack / Next.js）

BUILD_ID 存在 ≠ 最新代码。搜**运行时的特征字符串**：

```python
import glob
js = ''.join(open(f, encoding='utf-8', errors='ignore').read()
             for f in glob.glob('.next/static/chunks/*.js'))
css = ''.join(open(f, encoding='utf-8', errors='ignore').read()
              for f in glob.glob('.next/static/chunks/*.css'))   # 注意：CSS 也在 chunks/ 下
print("新 keyframes 名:", js.count('new-animation-name'))
print("旧 keyframes 名(应0):", js.count('old-animation-name'))
print("静态 filter 字符串:", css.count('drop-shadow(0 0 12px'))
# CSS 里直接验证 keyframes 帧内容
import re
m = re.search(r'@keyframes gongPulse\{0%,to\{([^}]*)\}', css)
print("帧内容:", m.group(1) if m else "NOT FOUND")
```

> Turbopack 会把 `0%, 100%` 压缩成 `0%,to`；CSS 产物**在 `.next/static/chunks/*.css`**（不是 `static/css/`）。

### 2. 线上实测（浏览器里读运行时样式表）

```js
// 确认浏览器实际生效的是新版
const cssTexts = Array.from(document.styleSheets).map(s => {
  try { return Array.from(s.cssRules).map(r => r.cssText).join('') } catch { return '' }
}).join('');
JSON.stringify({
  newKeyframeLoaded: cssTexts.includes('gongPulse'),
  oldPropertyGone: !/gongPulse[^}]*box-shadow/.test(cssTexts),
  elementStructure: !!document.querySelector('.bagua-cursor-taiji'),
  computedFilter: document.querySelector('.some-el')?.style.filter,
});
```

### 3. 视觉回归截图

改了动画后**必须截图比对**，确认视觉没塌（呼吸/发光效果仍在）：

```bash
agent-browser open "https://site.com/?v=cachebust"
agent-browser eval "(async()=>{await new Promise(r=>setTimeout(r,2000));return 'ready'})()"
agent-browser screenshot /tmp/verify.png
```

---

## 反模式清单

| 反模式 | 后果 | 替代 |
|---|---|---|
| `filter`/`shadow` 放进 infinite keyframes | 主线程每帧重绘，指针/滚动迟钝 | 静态滤镜 + opacity 动画 |
| SVG 上挂 CSS transform 动画 | 每帧软件渲染 | 挪到 HTML 包裹元素 |
| 秒级 `setState` 在布局壳顶层 | 每秒 reconcile 整棵树 | 抽独立小组件 |
| `backdrop-blur` 配不透明背景 | 无效但昂贵 | 去掉 blur |
| `"x" in window` 做 TS 类型守卫 | else 分支被收窄成 `never`（lib.dom 里属性必定存在） | `(window as { x?: T }).x` 断言 |
| 只修「点击慢」就回复「修好了」 | 用户说的其实是 hover 迟钝 | **先复述症状确认** |

---

## 报告模板

给用户的结论要**用数字说话**，并明说改了什么视觉上的取舍：

```
根因：<具体机制，不要泛泛说"性能问题">
修复：<改了什么 + 为什么这样改>
实测：<修复前 ms → 修复后 ms>
视觉：<截图确认无回归 / 效果等价说明>
```

---

## 来源经验

本技能沉淀自某 Next.js 命理站点项目实战：用户报「点击导航特别卡」，实测定位为 Next.js 视口 prefetch 盲区（滚动区外导航项首次点击 422ms 无反馈）并修复至 22-26ms；随后用户澄清「其实是鼠标移到左侧导航上缓慢」——第二轮定位为 `filter: drop-shadow` 逐帧动画（BaguaCursor 光标太极 + 侧栏 logo hover 动画）叠加首页 7 处常驻滤镜/阴影动画，全量改写为「静态化 + opacity 呼吸」后消除。
