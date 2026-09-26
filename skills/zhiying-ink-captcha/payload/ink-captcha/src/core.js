/**
 * ink-captcha · 点选式人机验证核心（框架无关，零运行时依赖）
 *
 * 只依赖 Node 内置 crypto。Express / Koa / Fastify / Next.js / 原生 http
 * 都能直接用，不需要任何框架适配层。
 *
 * ── 安全模型（核心：答案顺序绝不明文下发）────────────────────────────
 *
 *   ① 签发挑战  createChallenge()
 *      服务端随机抽 N 个目标字 + M 个干扰字，随机布点，
 *      把「目标字的 id 顺序」用 AES-256-GCM 加密成 token。
 *      下发的数据里只有「字面 + 坐标」——这是呈现给用户看的题目本身，
 *      人类必须看见才能作答，所以它必然在响应体里。
 *      但没有任何字段直接标明「第 i 步该点哪个」。
 *
 *   ② 用户按顺序点击 → verify(token, picks)
 *      前端只提交 { id, ts } 序列（点了哪些元素 + 每步间隔），
 *      顺序判定 100% 在服务端解密后比对，客户端无法伪造。
 *
 *   ③ 通过 → 签发一次性 passToken，业务接口只认它
 *      consumePassToken() 取出即删，无法重放。
 *
 * ── 为什么「答案就在响应体里」不算漏洞 ────────────────────────────────
 *   底图上的字必须让用户看见，否则无法作答 —— 这与「藏答案」天然冲突。
 *   真正拦住脚本的是这四件套：
 *     · 必须走完整流程（不能跳过签发直接提交）
 *     · 一次性凭证（用即删，无法重放）
 *     · 单挑战尝试次数上限（防爆破）
 *     · IP 限流（防批量刷）
 *   不要为了「藏字」牺牲可用性 —— 那会把真人挡在门外，脚本照样用打码平台过。
 */

import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────
// 默认配置
// ─────────────────────────────────────────────────────────────

/** 默认画布逻辑尺寸。改尺寸时记得同步调整 margin / gap，否则布点会挤。 */
export const DEFAULT_WIDTH = 320;
export const DEFAULT_HEIGHT = 200;

const DEFAULTS = {
  secret: "",
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  /** 需要按顺序点击的字数 */
  targetCount: 4,
  /** 干扰字数量 */
  distractorCount: 4,
  /** 字之间的最小中心间距 */
  minCenterGap: 50,
  /** 命中判定半径（逻辑坐标） */
  hitRadius: 26,
  /** 挑战时效：签发后多久必须提交 */
  challengeMaxAgeMs: 5 * 60 * 1000,
  /** 凭证时效：验证通过后多久内必须被业务接口消费 */
  passMaxAgeMs: 5 * 60 * 1000,
  /** 同一挑战最多允许尝试几次 */
  maxAttempts: 5,
  /** 时序判据：全部点击间隔都小于此值 → 判定为脚本（辅助信号） */
  minHumanStepMs: 60,
  /**
   * 题库。选字原则：
   *   ① 字形差异大（避免「日/曰」「未/末」这类视觉混淆）
   *   ② 常用字，无生僻字
   *   ③ 长度必须 ≥ targetCount + distractorCount
   */
  charPool: [
    "春", "风", "得", "意", "山", "水", "云", "月", "松", "竹",
    "梅", "兰", "鹤", "鹿", "琴", "棋", "书", "画", "茶", "香",
    "星", "斗", "江", "河", "天", "地", "玄", "黄", "宇", "宙",
    "莲", "桂", "雪", "霜", "雨", "露", "烟", "霞", "石", "泉",
  ],
};

// ─────────────────────────────────────────────────────────────
// 实例
// ─────────────────────────────────────────────────────────────

/**
 * 创建一个验证码实例。
 *
 * @example
 *   import { createCaptcha } from "ink-captcha";
 *   const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET });
 *   const challenge = captcha.createChallenge();
 *   const result = captcha.verify(token, picks);
 *   if (captcha.consumePassToken(passToken)) { ...注册逻辑... }
 */
export function createCaptcha(userConfig = {}) {
  const config = { ...DEFAULTS, ...userConfig };

  if (!config.secret || typeof config.secret !== "string") {
    throw new Error(
      "[ink-captcha] 必须提供 secret（且不能为空字符串）。\n" +
        "建议从环境变量读取，例如：createCaptcha({ secret: process.env.CAPTCHA_SECRET })",
    );
  }
  if (config.charPool.length < config.targetCount + config.distractorCount) {
    throw new Error(
      `[ink-captcha] charPool 长度不足：需要至少 ${config.targetCount + config.distractorCount} 个，` +
        `当前 ${config.charPool.length} 个。`,
    );
  }

  const {
    secret,
    width: W,
    height: H,
    targetCount,
    distractorCount,
    minCenterGap,
    hitRadius,
    challengeMaxAgeMs,
    passMaxAgeMs,
    maxAttempts,
    minHumanStepMs,
    charPool,
  } = config;

  /** AES-256-GCM 密钥：对 secret 做 sha256 派生 32 字节 */
  const KEY = crypto.createHash("sha256").update(`ink-captcha:${secret}`).digest();

  // ── 运行期状态（进程内存，无需数据库）──────────────────────
  /** 已签发但未被消费的一次性凭证：passToken → 签发时间 */
  const passTokens = new Map();
  /** 每个挑战的已尝试次数：challengeId → count */
  const attempts = new Map();

  let lastSweep = Date.now();
  /** 惰性清理，避免 Map 无限增长（5 分钟最多跑一次） */
  function sweep() {
    const now = Date.now();
    if (now - lastSweep < 5 * 60 * 1000) return;
    lastSweep = now;
    for (const [t, ts] of passTokens) {
      if (now - ts > passMaxAgeMs) passTokens.delete(t);
    }
    if (attempts.size > 10000) attempts.clear();
  }

  // ── 加解密 ────────────────────────────────────────────────
  function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString("base64url"),
      enc.toString("base64url"),
      tag.toString("base64url"),
    ].join(".");
  }

  function decrypt(blob) {
    try {
      const parts = String(blob).split(".");
      if (parts.length !== 3) return null;
      const [ivB64, dataB64, tagB64] = parts;
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        KEY,
        Buffer.from(ivB64, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
      const dec = Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64url")),
        decipher.final(),
      ]);
      return dec.toString("utf8");
    } catch {
      // 篡改 / 密钥不匹配 / 格式错误 一律返回 null
      return null;
    }
  }

  // ── 布点 ──────────────────────────────────────────────────
  /**
   * 在画布上做「尽量均匀且不重叠」的随机布点。
   * 拒绝采样：每个点检查与已有点的距离，不够远就重试；
   * 重试若干轮仍失败则逐步放宽阈值，最后走网格兜底 —— 保证不死循环。
   */
  function layout(count) {
    const pts = [];
    // 边距：字宽约 33px + 旋转外扩，边距不足会让靠边的字被裁掉
    const marginX = 42;
    const marginTop = 32;
    // 下边距小一些，让字铺满画布（否则头重脚轻）
    const marginBottom = 38;

    const usableW = W - marginX * 2;
    const usableH = H - marginTop - marginBottom;

    // 【避开右下角印章】底图在右下角画了一枚朱红印章（装饰）。
    // 字中心最远可达 x=marginX+usableW，字半宽 ≈ size*0.75 ≈ 25px，
    // 右边缘最大到 ~302px，会压到印章（288px 起）→ 重叠约 15px。
    // 这里把「右下角禁区」显式排除掉。
    const sealW = 20;
    const sealH = 20;
    const sealLeft = W - sealW - 12 - 14; // 印章左边再外扩 14px 缓冲
    const sealTop = H - sealH - 10 - 14;
    const charHalf = 25; // size 最大 32 → 半径 16，加旋转外扩取 25
    const inSealZone = (x, y) => x + charHalf > sealLeft && y + charHalf > sealTop;

    for (let i = 0; i < count; i++) {
      let placed = false;
      // 逐步放宽最小间距，下限 38（再小会视觉粘连）
      for (let gap = minCenterGap; gap >= 38 && !placed; gap -= 4) {
        for (let t = 0; t < 80 && !placed; t++) {
          const x = marginX + crypto.randomInt(0, usableW + 1);
          const y = marginTop + crypto.randomInt(0, usableH + 1);
          if (inSealZone(x, y)) continue; // 落在印章区，换个位置
          const ok = pts.every((p) => Math.hypot(p.x - x, p.y - y) >= gap);
          if (ok) {
            pts.push({ x, y });
            placed = true;
          }
        }
      }
      if (!placed) {
        // 兜底：网格均匀铺开，保证绝不重叠
        const cols = 3;
        const rows = Math.ceil(count / cols);
        const i2 = pts.length;
        pts.push({
          x: marginX + ((i2 % cols) + 0.5) * (usableW / cols),
          y: marginTop + (Math.floor(i2 / cols) + 0.5) * (usableH / rows),
        });
      }
    }
    return pts;
  }

  /** Fisher–Yates 洗牌（用 CSPRNG，不用 Math.random） */
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── 对外 API ──────────────────────────────────────────────

  /**
   * 生成一次点选挑战。
   *
   * @returns {{
   *   token: string,          // 加密后的答案，回传给前端后原样提交
   *   targets: string[],      // 顶部提示：按顺序要点的字（题目本身）
   *   chars: Array<{id,char,x,y,rotate,size}>,  // 画布上的所有字（已剥离 isTarget）
   *   width: number,
   *   height: number,
   * }}
   */
  function createChallenge() {
    sweep();

    // 抽目标字 + 干扰字：从题库里不重复地取
    const pool = shuffle(charPool);
    const need = targetCount + distractorCount;
    const picked = pool.slice(0, need);
    const targets = picked.slice(0, targetCount);
    const distractors = picked.slice(targetCount, need);

    const all = [...targets, ...distractors];
    const positions = layout(all.length);

    // 【关键】打乱「字 ↔ 位置」的对应关系。
    // 若不打乱，目标字会永远占据前排坐标 → 等于直接把答案送给脚本。
    let shuffled = shuffle(all);

    // 【分散化】仅靠 shuffle 还不够：它只保证「不固定占前排」，
    // 却不保证目标字在画布上彼此分散 —— 实测会出现 4 个目标字全挤左半区
    // 或全挤右半区的情况，那样脚本的搜索空间会显著变小。
    // 这里对「目标字占据哪些位置」再做一次贪心挑选：
    // 从当前布局出发，反复做「目标位 ↔ 干扰位」交换，直到最小两两距离无法再拉大。
    const targetSet = new Set(targets);
    const targetSlots = [];
    const otherSlots = [];
    for (let i = 0; i < shuffled.length; i++) {
      (targetSet.has(shuffled[i]) ? targetSlots : otherSlots).push(i);
    }

    if (targetSlots.length >= 2 && otherSlots.length > 0) {
      const dist = (i, j) =>
        Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
      /** 一组槽位里，任意两者距离的最小值 —— 越大说明越分散 */
      const spread = (idxs) => {
        let min = Infinity;
        for (let a = 0; a < idxs.length; a++) {
          for (let b = a + 1; b < idxs.length; b++) min = Math.min(min, dist(idxs[a], idxs[b]));
        }
        return min;
      };

      let best = [...targetSlots];
      let bestScore = spread(best);
      let guard = 0;
      let improved = true;
      while (improved && guard < 60) {
        improved = false;
        guard++;
        for (let t = 0; t < best.length; t++) {
          for (let k = 0; k < otherSlots.length; k++) {
            const cand = [...best];
            cand[t] = otherSlots[k];
            const sc = spread(cand);
            if (sc > bestScore + 0.01) {
              otherSlots[k] = best[t]; // 原目标位让给干扰字
              best = cand;
              bestScore = sc;
              improved = true;
            }
          }
        }
      }

      // 按最终槽位分配：目标字依次占 best，干扰字填 otherSlots
      const next = new Array(shuffled.length);
      const tChars = shuffled.filter((c) => targetSet.has(c));
      const oChars = shuffled.filter((c) => !targetSet.has(c));
      best.forEach((slot, i) => (next[slot] = tChars[i]));
      otherSlots.forEach((slot, i) => (next[slot] = oChars[i]));
      for (let i = 0; i < next.length; i++) if (!next[i]) next[i] = shuffled[i];
      shuffled = next;
    }

    const chars = shuffled.map((char, i) => {
      const pos = positions[i];
      return {
        id: crypto.randomBytes(5).toString("base64url"),
        char,
        x: pos.x,
        y: pos.y,
        // 轻微旋转：既自然，也提高 OCR 难度
        rotate: crypto.randomInt(-18, 19),
        size: 26 + crypto.randomInt(0, 7),
        /** 仅服务端内部使用，**绝不下发** */
        _isTarget: targets.includes(char),
      };
    });

    // 正确顺序 = 「提示顺序」下各目标字对应的元素 id
    const order = targets.map((t) => chars.find((c) => c.char === t && c._isTarget).id);

    const challengeId = crypto.randomBytes(9).toString("base64url");
    const payload = { order, challengeId, ts: Date.now() };

    return {
      token: encrypt(JSON.stringify(payload)),
      targets,
      // 【关键】剥掉 _isTarget 再下发 —— 前端不需要知道哪些是目标字
      chars: chars.map(({ id, char, x, y, rotate, size }) => ({
        id,
        char,
        x,
        y,
        rotate,
        size,
      })),
      width: W,
      height: H,
    };
  }

  /**
   * 校验点选结果。
   *
   * @param {string} token  createChallenge() 返回的 token
   * @param {Array<{id:string, ts?:number}>} picks 用户按顺序点击的元素 id（可带每步相对时间戳 ms）
   * @returns {{ok:boolean, passToken?:string, reason?:string}}
   *
   * reason 取值：
   *   invalid_token     token 无法解密（篡改 / 换密钥 / 格式错）
   *   invalid_payload   解密成功但结构不对
   *   expired           挑战超时
   *   invalid_picks     没提交点击记录
   *   too_fast          全部点击间隔过短，判定为脚本
   *   too_many_attempts 同一挑战尝试次数超限
   *   mismatch          顺序或数量不对
   */
  function verify(token, picks) {
    sweep();

    const plain = decrypt(token);
    if (!plain) return { ok: false, reason: "invalid_token" };

    let payload;
    try {
      payload = JSON.parse(plain);
    } catch {
      return { ok: false, reason: "invalid_payload" };
    }

    if (!Array.isArray(payload.order) || !payload.challengeId) {
      return { ok: false, reason: "invalid_payload" };
    }
    if (Date.now() - payload.ts > challengeMaxAgeMs) {
      return { ok: false, reason: "expired" };
    }
    if (!Array.isArray(picks) || picks.length === 0) {
      return { ok: false, reason: "invalid_picks" };
    }

    // 【行为特征】真人连点 4 个目标，总耗时必然 >150ms；
    // 脚本常一次性提交全部 id（每步间隔 0）。只在「全部间隔都过短」时判异常，
    // 避免误伤手速快的用户。
    if (picks.length >= 2) {
      const stamps = picks
        .map((p) => p.ts)
        .filter((t) => typeof t === "number");
      if (stamps.length === picks.length) {
        let allTooFast = true;
        for (let i = 1; i < stamps.length; i++) {
          if (stamps[i] - stamps[i - 1] >= minHumanStepMs) {
            allTooFast = false;
            break;
          }
        }
        if (allTooFast) return { ok: false, reason: "too_fast" };
      }
    }

    // 限制单挑战尝试次数（防爆破）
    const tried = (attempts.get(payload.challengeId) ?? 0) + 1;
    attempts.set(payload.challengeId, tried);
    if (tried > maxAttempts) {
      attempts.delete(payload.challengeId);
      return { ok: false, reason: "too_many_attempts" };
    }

    if (picks.length !== payload.order.length) {
      return { ok: false, reason: "mismatch" };
    }

    // 逐项比对顺序（用定长比较，避免时序侧信道）
    for (let i = 0; i < payload.order.length; i++) {
      const a = String(picks[i]?.id ?? "");
      const b = payload.order[i];
      if (a.length !== b.length || !crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))) {
        return { ok: false, reason: "mismatch" };
      }
    }

    // 通过 → 签发一次性凭证
    attempts.delete(payload.challengeId);
    const passToken = crypto.randomBytes(18).toString("base64url");
    passTokens.set(passToken, Date.now());

    return { ok: true, passToken };
  }

  /**
   * 消费一次性通过凭证。取出即删 —— 同一个 passToken 无法用第二次。
   * 在你的注册 / 发短信 / 领券接口里调用它。
   *
   * @returns {boolean} 是否有效
   */
  function consumePassToken(passToken) {
    sweep();
    if (!passToken || typeof passToken !== "string") return false;
    const ts = passTokens.get(passToken);
    if (ts === undefined) return false;
    passTokens.delete(passToken); // 先删，避免并发重放
    if (Date.now() - ts > passMaxAgeMs) return false;
    return true;
  }

    return {
      createChallenge,
      verify,
      consumePassToken,
      /** 仅调试用：当前待消费凭证数 / 追踪中的挑战数 */
      _stats: () => ({ pendingPassTokens: passTokens.size, trackedChallenges: attempts.size }),
      config: { ...config, secret: "***" },
      /** 命中半径（前端也用它做「点了哪个字」的判定，导出保证两端一致） */
      hitRadius,
      width: W,
      height: H,
    };
}

/** 人类可读的失败原因文案（可直接用于前端提示） */
export const REASON_TEXT = {
  invalid_token: "验证信息无效，请刷新重试",
  invalid_payload: "验证信息无效，请刷新重试",
  expired: "验证已过期，请刷新重试",
  invalid_picks: "请按顺序点选图中的文字",
  too_fast: "操作过快，请重新点选",
  too_many_attempts: "尝试次数过多，请刷新后重试",
  mismatch: "顺序不正确，请重新点选",
};

export default createCaptcha;
