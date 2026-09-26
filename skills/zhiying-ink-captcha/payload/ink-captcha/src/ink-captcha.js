/**
 * ink-captcha · 点选验证码前端组件（原生 JS，零依赖）
 *
 * 不依赖 React / Vue / jQuery / Tailwind，不注入任何全局样式表 ——
 * 所有样式都挂在 Shadow DOM 里，宿主页面样式不会污染它，它也不会污染宿主。
 *
 * 【用法 1｜自动挂载】
 *   <div data-ink-captcha
 *        data-endpoint="/api/captcha/points"
 *        data-verify-endpoint="/api/captcha/points/verify"
 *        data-callback="onCaptchaPassed"></div>
 *   <script>
 *     function onCaptchaPassed(passToken) { window.myToken = passToken; }
 *   </script>
 *
 * 【用法 2｜命令式】
 *   const cap = InkCaptcha.mount(document.querySelector("#box"), {
 *     endpoint: "/api/captcha/points",
 *     verifyEndpoint: "/api/captcha/points/verify",
 *     theme: "paper",
 *     onVerified: (passToken) => { ... },
 *     onStateChange: ({ verified, loading }) => { ... },
 *   });
 *   cap.reset();       // 重置（例如提交失败后）
 *   cap.getToken();    // 取当前凭证（null 表示未通过）
 *   cap.destroy();     // 卸载
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.InkCaptcha = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ── 默认值 ────────────────────────────────────────────────
  var DEFAULTS = {
    endpoint: "/api/captcha/points",
    verifyEndpoint: "/api/captcha/points/verify",
    /** 字段名映射：如果你的后端返回结构不同，改这里 */
    responseKeys: {
      /** 挑战接口：{ success, data: { token, targets, chars, bg, width, height } } */
      challengeData: function (json) {
        return json && json.success && json.data ? json.data : null;
      },
      /** 校验接口：{ success, data: { passToken } } —— 兼容 captchaToken 旧字段 */
      passToken: function (json) {
        if (!json || !json.success || !json.data) return null;
        return json.data.passToken || json.data.captchaToken || null;
      },
      errorText: function (json) {
        return (json && json.error) || null;
      },
    },
    /** 请求时额外带的头，例如 CSRF token */
    headers: {},
    /** 画布缩放上限，1 = 不放大 */
    maxScale: 1,
    /** 语言文案 */
    texts: {
      hint: "按顺序点击图中文字",
      loading: "加载中…",
      loadingCanvas: "正在加载验证码…",
      checking: "校验中…",
      passed: "验证通过",
      failed: "验证失败",
      tapHint: "按顺序点击",
      passedTag: "已通过",
      failedTag: "验证失败",
      loadFail: "验证码加载失败，点击刷新",
      networkFail: "网络异常，点击刷新",
      retryNetwork: "网络异常，请重试",
      retryFail: "验证失败，请重试",
      refreshLabel: "刷新验证码",
      progress: function (done, total) {
        return "（" + done + "/" + total + "）";
      },
    },
    /** 主题：'auto' 跟随 Shadow DOM 外部容器的背景亮度自动选 paper/dark */
    theme: "paper",
    onVerified: null,
    onStateChange: null,
  };

  var HIT_RADIUS_FALLBACK = 26;

  /** 合并配置（浅合并 + texts / responseKeys 深一层的合并） */
  function mergeConfig(user) {
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    user = user || {};
    for (var k2 in user) {
      if (k2 === "texts" || k2 === "responseKeys") continue;
      cfg[k2] = user[k2];
    }
    cfg.texts = {};
    for (var k3 in DEFAULTS.texts) cfg.texts[k3] = DEFAULTS.texts[k3];
    for (var k4 in user.texts || {}) cfg.texts[k4] = user.texts[k4];
    cfg.responseKeys = {};
    for (var k5 in DEFAULTS.responseKeys) cfg.responseKeys[k5] = DEFAULTS.responseKeys[k5];
    for (var k6 in user.responseKeys || {}) cfg.responseKeys[k6] = user.responseKeys[k6];
    cfg.headers = user.headers || {};
    return cfg;
  }

  // ── 样式（全部内联进 Shadow DOM）───────────────────────────
  function styles(theme) {
    // 组件为「深色卡面」设计：底图本身是浅色宣纸，卡片外壳用深色，
    // 这样在亮色站点和暗色站点里都能立住。
    var cardBg = theme === "dark" ? "rgba(12,18,22,0.92)" : "rgba(16,24,30,0.90)";
    return [
      ":host{display:block;--ink-ok:#22c55e;--ink-err:#ef4444;--ink-line:rgba(255,255,255,0.16);}",
      "*{box-sizing:border-box;margin:0;padding:0;}",
      ".wrap{position:relative;width:100%;}",
      ".card{width:320px;transform-origin:top left;}",
      // 提示条
      ".bar{display:flex;align-items:center;gap:8px;border-radius:12px;border:1px solid var(--ink-line);",
      "padding:8px 12px;margin-bottom:8px;transition:border-color .2s,background-color .2s;}",
      ".bar.is-fail{border-color:rgba(239,68,68,.55);background:rgba(239,68,68,.12);}",
      ".bar.is-done{border-color:rgba(34,197,94,.55);background:rgba(34,197,94,.12);}",
      ".bar.is-idle{background:rgba(0,0,0,.30);}",
      ".bar-label{flex:0 0 auto;font-size:11px;font-weight:500;color:rgba(255,255,255,.65);",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;}",
      ".bar-slots{display:flex;flex:1 1 auto;align-items:center;gap:6px;}",
      ".slot{display:flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:8px;",
      "font-size:14px;font-weight:700;line-height:1;transition:all .2s;",
      "font-family:'Songti SC','STSong','SimSun','Noto Serif SC',serif;}",
      ".slot.is-done{background:rgba(34,197,94,.9);color:#fff;box-shadow:0 0 9px rgba(34,197,94,.5);transform:scale(1.06);}",
      ".slot.is-todo{background:rgba(255,255,255,.13);color:rgba(255,255,255,.92);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);}",
      ".bar-empty{font-size:11px;color:rgba(255,255,255,.4);",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;}",
      ".refresh{flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:2px;",
      "border:0;background:none;color:rgba(255,255,255,.5);cursor:pointer;border-radius:4px;transition:color .18s;}",
      ".refresh:hover{color:rgba(255,255,255,.9);}",
      ".refresh:disabled{opacity:.3;cursor:default;}",
      ".refresh.is-spin svg{animation:ink-spin .7s linear infinite;}",
      // 画布
      ".canvas{position:relative;border-radius:12px;border:1px solid var(--ink-line);overflow:hidden;",
      "cursor:crosshair;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;",
      "box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),0 2px 10px rgba(0,0,0,.28);",
      "transition:border-color .2s,box-shadow .2s;}",
      ".canvas.is-fail{border-color:rgba(239,68,68,.55);",
      "box-shadow:inset 0 0 0 1px rgba(239,68,68,.18),0 2px 10px rgba(0,0,0,.28);}",
      ".canvas.is-done{border-color:rgba(34,197,94,.55);cursor:default;",
      "box-shadow:inset 0 0 0 1px rgba(34,197,94,.18),0 2px 10px rgba(0,0,0,.28);}",
      ".bg{position:absolute;inset:0;pointer-events:none;}",
      ".bg svg{display:block;width:100%;height:100%;}",
      // 字
      ".ch{position:absolute;display:flex;align-items:center;justify-content:center;",
      "pointer-events:none;transition:transform .2s,opacity .2s;}",
      ".ch span{line-height:1;font-weight:700;",
      "font-family:'Songti SC','STSong','SimSun','Noto Serif SC',serif;}",
      ".badge{position:absolute;right:-4px;top:-4px;display:flex;width:16px;height:16px;align-items:center;",
      "justify-content:center;border-radius:999px;font-size:9px;font-weight:700;color:#fff;",
      "background:var(--ink-ok);box-shadow:0 1px 3px rgba(0,0,0,.35);",
      "font-family:-apple-system,BlinkMacSystemFont,sans-serif;}",
      ".ch.is-fail .badge,.badge.is-fail{background:var(--ink-err);}",
      // 遮罩
      ".mask{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;",
      "justify-content:center;gap:6px;}",
      ".mask.check{background:rgba(0,0,0,.35);}",
      ".mask.done{background:rgba(0,0,0,.30);}",
      ".spinner{width:24px;height:24px;border-radius:999px;border:2px solid rgba(255,255,255,.25);",
      "border-top-color:rgba(255,255,255,.9);animation:ink-spin .7s linear infinite;}",
      "@keyframes ink-spin{to{transform:rotate(360deg)}}",
      ".okcircle{display:flex;width:36px;height:36px;align-items:center;justify-content:center;",
      "border-radius:999px;background:rgba(34,197,94,.92);}",
      ".mask-text{font-size:12px;font-weight:500;color:#fff;",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;}",
      ".loading-text{font-size:12px;color:rgba(255,255,255,.4);",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;}",
      // 底部
      ".foot{margin-top:6px;text-align:center;font-size:11px;color:rgba(255,255,255,.45);",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;}",
      ".foot.is-fail{color:rgba(248,113,113,.95);}",
      ".foot.is-done{color:rgba(74,222,128,.95);}",
      ".foot .prog{color:rgba(255,255,255,.35);}",
      // 无障碍：仅屏读可见
      ".sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;",
      "clip:rect(0,0,0,0);white-space:nowrap;border:0;}",
      // 极窄屏兜底（缩放由 JS 处理，这里只兜底文字换行）
      "@media (max-width:360px){.foot{font-size:10px;}}",
    ].join("");
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function Captcha(host, userConfig) {
    if (!host) throw new Error("[ink-captcha] 需要一个挂载容器元素");
    // 同一 host 重复挂载：先销毁上一个，避免影子树里堆两套 DOM
    if (host.__inkCaptcha && host.__inkCaptcha !== this) {
      try {
        host.__inkCaptcha.destroy();
      } catch (_) {
        /* 忽略 */
      }
    }
    var cfg = mergeConfig(userConfig);
    var self = this;

    this._cfg = cfg;
    this._host = host;
    this._destroyed = false;
    host.__inkCaptcha = this;

    // ── 状态 ──
    var data = null; // 当前挑战
    var status = "idle"; // idle | checking | success | fail
    var picked = []; // 已点中的 id 顺序
    var hint = cfg.texts.hint;
    var scale = 1;
    var passToken = null;
    var stamps = []; // 每步点击的绝对时间戳
    var startTs = 0;
    var reqSeq = 0; // 防止并发请求乱序覆盖
    var timers = [];

    // ── 构建 Shadow DOM ──
    // 【注意】同一个 host 二次 attachShadow 会抛 NotSupportedError
    // （React 严格模式双挂载、HMR 热更新、用户手动 mount 两次都会触发）。
    // 这里做复用：已有 shadowRoot 就直接拿来用，并清空旧内容。
    var shadow;
    if (host.shadowRoot) {
      shadow = host.shadowRoot;
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    } else if (host.attachShadow) {
      shadow = host.attachShadow({ mode: "open" });
    } else {
      // 极老浏览器兜底：退化为普通 DOM
      shadow = host;
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    }

    var styleEl = document.createElement("style");
    styleEl.textContent = styles(cfg.theme);
    shadow.appendChild(styleEl);

    var wrap = el("div", "wrap");
    var card = el("div", "card");
    wrap.appendChild(card);
    shadow.appendChild(wrap);

    // 提示条
    var bar = el("div", "bar is-idle");
    var barLabel = el("span", "bar-label");
    var barSlots = el("div", "bar-slots");
    var refreshBtn = el("button", "refresh");
    refreshBtn.type = "button";
    refreshBtn.setAttribute("aria-label", cfg.texts.refreshLabel);
    refreshBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V6h-3.5" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    bar.appendChild(barLabel);
    bar.appendChild(barSlots);
    bar.appendChild(refreshBtn);
    card.appendChild(bar);

    // 画布
    var canvas = el("div", "canvas");
    canvas.setAttribute("role", "img");
    var bgEl = el("div", "bg");
    canvas.appendChild(bgEl);
    card.appendChild(canvas);

    // 底部说明
    var foot = el("p", "foot");
    card.appendChild(foot);

    // 屏读播报
    var live = el("div", "sr");
    live.setAttribute("aria-live", "polite");
    shadow.appendChild(live);

    var msgEl = el("div", "loading-text");
    msgEl.textContent = cfg.texts.loadingCanvas;
    var msgWrap = el("div", "");
    msgWrap.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;";
    msgWrap.appendChild(msgEl);
    canvas.appendChild(msgWrap);

    // ── 响应式缩放 ──────────────────────────────────────────
    function measure() {
      if (self._destroyed) return;
      var w = wrap.clientWidth || host.clientWidth;
      if (w <= 0) return;
      var next = Math.min(cfg.maxScale, w / 320);
      if (Math.abs(next - scale) < 0.001) return;
      scale = next;
      card.style.transform = "scale(" + scale + ")";
      // 卡片缩放后不占原有高度，需要手动撑开容器，否则下方元素会重叠
      var h = card.offsetHeight || 0;
      wrap.style.height = Math.round(h * scale) + "px";
    }
    this._measure = measure;

    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(wrap);
    window.addEventListener("resize", measure);

    // ── 网络 ────────────────────────────────────────────────
    function post(url, body) {
      return fetch(url, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, cfg.headers),
        body: JSON.stringify(body),
        credentials: "same-origin",
      }).then(function (r) {
        return r.json();
      });
    }

    function loadChallenge() {
      if (self._destroyed) return;
      var seq = ++reqSeq;
      data = null;
      status = "idle";
      picked = [];
      stamps = [];
      startTs = 0;
      passToken = null;
      hint = cfg.texts.hint;
      canvas.style.width = "320px";
      canvas.style.height = "180px";
      bgEl.innerHTML = "";
      msgWrap.style.display = "";
      render();
      measure();

      fetch(cfg.endpoint, {
        cache: "no-store",
        credentials: "same-origin",
        headers: cfg.headers,
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (json) {
          if (seq !== reqSeq || self._destroyed) return; // 已被更新的请求取代
          var d = cfg.responseKeys.challengeData(json);
          if (!d || !d.token || !Array.isArray(d.chars)) {
            hint = cfg.texts.loadFail;
            render();
            return;
          }
          data = d;
          canvas.style.width = (d.width || 320) + "px";
          canvas.style.height = (d.height || 180) + "px";
          bgEl.innerHTML = d.bg || "";
          msgWrap.style.display = "none";
          render();
          measure();
        })
        .catch(function () {
          if (seq !== reqSeq || self._destroyed) return;
          hint = cfg.texts.networkFail;
          render();
        });
    }

    function submit(ids) {
      if (!data) return;
      status = "checking";
      render();

      var base = startTs || Date.now();
      var picks = ids.map(function (id, i) {
        return { id: id, ts: (stamps[i] || base) - base };
      });

      post(cfg.verifyEndpoint, { token: data.token, picks: picks })
        .then(function (json) {
          if (self._destroyed) return;
          var tok = cfg.responseKeys.passToken(json);
          if (tok) {
            status = "success";
            passToken = tok;
            hint = cfg.texts.passed;
            render();
            if (cfg.onVerified) cfg.onVerified(tok);
            if (cfg.onStateChange) cfg.onStateChange({ verified: true, loading: false });
          } else {
            status = "fail";
            hint = cfg.responseKeys.errorText(json) || cfg.texts.retryFail;
            render();
            if (cfg.onStateChange) cfg.onStateChange({ verified: false, loading: false });
            timers.push(setTimeout(loadChallenge, 1100));
          }
        })
        .catch(function () {
          if (self._destroyed) return;
          status = "fail";
          hint = cfg.texts.retryNetwork;
          render();
          if (cfg.onStateChange) cfg.onStateChange({ verified: false, loading: false });
          timers.push(setTimeout(loadChallenge, 1100));
        });
    }

    // ── 交互 ────────────────────────────────────────────────
    function onCanvasClick(e) {
      if (status === "success" || status === "checking" || !data) return;

      // 【坐标换算铁律】必须用实测渲染宽度算比例，不能用 scale 推断 ——
      // transform:scale 的实际渲染宽度受亚像素舍入影响，
      // 用 scale 推断会带来系统偏差（曾恒定错位 15px）。
      var rect = canvas.getBoundingClientRect();
      var W = data.width || 320;
      var ratio = rect.width > 0 ? W / rect.width : 1;
      var lx = (e.clientX - rect.left) * ratio;
      var ly = (e.clientY - rect.top) * ratio;

      var hitRadius = data.hitRadius || HIT_RADIUS_FALLBACK;
      var best = null;
      var bestDist = Infinity;
      for (var i = 0; i < data.chars.length; i++) {
        var c = data.chars[i];
        if (picked.indexOf(c.id) >= 0) continue;
        var d = Math.hypot(c.x - lx, c.y - ly);
        if (d <= hitRadius && d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (!best) return;

      if (startTs === 0) startTs = Date.now();
      stamps.push(Date.now());

      picked = picked.concat([best.id]);
      render();
      if (cfg.onStateChange) cfg.onStateChange({ verified: false, loading: false });

      if (picked.length >= (data.targets ? data.targets.length : 4)) {
        submit(picked);
      }
    }

    canvas.addEventListener("click", onCanvasClick);
    // 触屏：click 在移动端有 ~300ms 延迟，用 touchend 提前响应
    canvas.addEventListener(
      "touchend",
      function (e) {
        if (e.changedTouches && e.changedTouches.length === 1) {
          e.preventDefault();
          onCanvasClick(e.changedTouches[0]);
        }
      },
      { passive: false },
    );
    refreshBtn.addEventListener("click", function () {
      if (status === "success") return;
      loadChallenge();
    });

    // ── 渲染 ────────────────────────────────────────────────
    var charNodes = {}; // id → element，避免每次全量重建

    function render() {
      var isDone = status === "success";
      var isFail = status === "fail";
      var total = data && data.targets ? data.targets.length : 4;

      // 提示条状态
      bar.className = "bar " + (isFail ? "is-fail" : isDone ? "is-done" : "is-idle");
      barLabel.textContent = isDone
        ? cfg.texts.passedTag
        : isFail
          ? cfg.texts.failedTag
          : cfg.texts.tapHint;

      // 目标字槽位
      var tHtml = "";
      if (data && data.targets) {
        for (var i = 0; i < data.targets.length; i++) {
          var done = i < picked.length && !isFail;
          tHtml +=
            '<span class="slot ' +
            (done ? "is-done" : "is-todo") +
            '">' +
            (done ? "&#10003;" : esc(data.targets[i])) +
            "</span>";
        }
      } else {
        tHtml = '<span class="bar-empty">' + esc(cfg.texts.loading) + "</span>";
      }
      if (barSlots.innerHTML !== tHtml) barSlots.innerHTML = tHtml;

      refreshBtn.disabled = isDone;

      // 画布状态
      canvas.className = "canvas" + (isFail ? " is-fail" : isDone ? " is-done" : "");

      // 字节点（增量更新）
      if (data && data.chars) {
        var seen = {};
        for (var j = 0; j < data.chars.length; j++) {
          var c = data.chars[j];
          seen[c.id] = 1;
          var node = charNodes[c.id];
          if (!node) {
            node = el("div", "ch");
            var inner = document.createElement("span");
            node.appendChild(inner);
            var badge = el("span", "badge");
            node.appendChild(badge);
            charNodes[c.id] = node;
            canvas.appendChild(node);
          }
          var idx = picked.indexOf(c.id);
          var isPicked = idx >= 0;
          node.style.left = c.x + "px";
          node.style.top = c.y + "px";
          node.style.width = c.size * 1.5 + "px";
          node.style.height = c.size * 1.5 + "px";
          node.style.transform =
            "translate(-50%,-50%) rotate(" + c.rotate + "deg) scale(" + (isPicked ? 1.12 : 1) + ")";
          var sp = node.firstChild;
          sp.textContent = c.char;
          sp.style.fontSize = c.size + "px";
          sp.style.color = isPicked ? "rgba(10,132,60,0.98)" : "rgba(18,30,36,0.96)";
          // 白色描边让字在任何底纹上都清晰可读
          sp.style.webkitTextStroke = isPicked
            ? "0.7px rgba(255,255,255,0.9)"
            : "0.6px rgba(255,255,255,0.88)";
          sp.style.textShadow = isPicked
            ? "0 0 14px rgba(34,197,94,0.8),0 1px 2px rgba(0,0,0,0.2)"
            : "0 1px 2px rgba(255,255,255,0.9),0 1px 3px rgba(0,0,0,0.16)";
          var bd = node.lastChild;
          node.className = "ch" + (isPicked && isFail ? " is-fail" : "");
          if (isPicked) {
            bd.style.display = "";
            bd.textContent = isFail ? "\u00d7" : String(idx + 1);
          } else {
            bd.style.display = "none";
          }
        }
        // 清掉上一轮残留
        for (var id in charNodes) {
          if (!seen[id]) {
            if (charNodes[id].parentNode) charNodes[id].parentNode.removeChild(charNodes[id]);
            delete charNodes[id];
          }
        }
      } else {
        for (var id2 in charNodes) {
          if (charNodes[id2].parentNode) charNodes[id2].parentNode.removeChild(charNodes[id2]);
          delete charNodes[id2];
        }
      }

      // 遮罩层
      var existing = canvas.querySelector(".mask");
      if (existing) existing.parentNode.removeChild(existing);

      if (status === "checking") {
        var m1 = el("div", "mask check");
        var sp1 = el("div", "spinner");
        var tx1 = el("div", "mask-text");
        tx1.textContent = cfg.texts.checking;
        m1.appendChild(sp1);
        m1.appendChild(tx1);
        canvas.appendChild(m1);
      } else if (isDone) {
        var m2 = el("div", "mask done");
        var cir = el("div", "okcircle");
        cir.innerHTML =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
          '<path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" stroke-width="2.5" ' +
          'stroke-linecap="round" stroke-linejoin="round"/></svg>';
        var tx2 = el("div", "mask-text");
        tx2.textContent = cfg.texts.passed;
        m2.appendChild(cir);
        m2.appendChild(tx2);
        canvas.appendChild(m2);
      }

      // 底部
      foot.className = "foot" + (isFail ? " is-fail" : isDone ? " is-done" : "");
      var progHtml =
        !isDone && !isFail && picked.length > 0
          ? '<span class="prog">' + esc(cfg.texts.progress(picked.length, total)) + "</span>"
          : "";
      var footHtml = esc(hint) + progHtml;
      if (foot.innerHTML !== footHtml) foot.innerHTML = footHtml;

      live.textContent = isDone ? cfg.texts.passed : isFail ? hint : "";
      measure();
    }

    function el(tag, cls) {
      var d = document.createElement(tag);
      if (cls) d.className = cls;
      return d;
    }

    // ── 生命周期 ────────────────────────────────────────────
    this.reset = function () {
      loadChallenge();
    };
    this.getToken = function () {
      return status === "success" ? passToken : null;
    };
    this.refresh = function () {
      loadChallenge();
    };
    this.destroy = function () {
      self._destroyed = true;
      reqSeq++;
      timers.forEach(clearTimeout);
      timers = [];
      window.removeEventListener("resize", measure);
      if (ro) ro.disconnect();
      canvas.removeEventListener("click", onCanvasClick);
      // 清空影子树内容（保留 shadowRoot 本身，便于后续重新 mount）
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
      if (host.__inkCaptcha === self) host.__inkCaptcha = null;
    };

    // 启动
    if (cfg.theme === "auto") {
      // 跟随宿主容器亮度
      try {
        var bg = getComputedStyle(host).backgroundColor || "";
        var m = bg.match(/\d+/g);
        if (m && m.length >= 3) {
          var lum = (parseInt(m[0], 10) * 299 + parseInt(m[1], 10) * 587 + parseInt(m[2], 10) * 114) / 1000;
          styleEl.textContent = styles(lum > 150 ? "paper" : "dark");
        }
      } catch (_) {
        /* 忽略 */
      }
    }

    loadChallenge();
    measure();
  }

  // ── 自动挂载 ──────────────────────────────────────────────
  function autoMount(scope) {
    var root = scope || document;
    var nodes = root.querySelectorAll("[data-ink-captcha]");
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.__inkCaptcha) {
        out.push(n.__inkCaptcha);
        continue;
      }
      var cbName = n.getAttribute("data-callback");
      var cb = cbName && typeof window[cbName] === "function" ? window[cbName] : null;
      var inst = new Captcha(n, {
        endpoint: n.getAttribute("data-endpoint") || undefined,
        verifyEndpoint: n.getAttribute("data-verify-endpoint") || undefined,
        theme: n.getAttribute("data-theme") || undefined,
        onVerified: cb || undefined,
      });
      n.__inkCaptcha = inst;
      out.push(inst);
    }
    return out;
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        autoMount();
      });
    } else {
      autoMount();
    }
  }

  return { mount: function (host, cfg) { return new Captcha(host, cfg); }, autoMount: autoMount, Captcha: Captcha };
});
