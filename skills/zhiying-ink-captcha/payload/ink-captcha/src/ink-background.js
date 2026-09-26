/**
 * 墨韵底图生成器 —— 程序化生成国风水墨 SVG，零图片资产
 *
 * 【为什么程序化生成】
 *   1. 零资产：不用往仓库塞图片，不增加包体，不依赖 CDN
 *   2. 每次不重样：色相 / 山形 / 云雾 / 印章随机，同一用户刷新也不会见到同一张图
 *   3. 参数化：可精确控制「字压在什么纹理上」，保证字始终清晰可辨
 *
 * 【为什么零依赖】纯字符串拼接，不引任何 SVG 库。Node 和浏览器都能跑。
 *
 * 【注意】这里的随机**只用于视觉**（山形起伏、噪点位置），
 * 与安全答案无关，所以用 Math.random 完全没问题。
 */

/** 可复现随机（mulberry32）—— 同一 seed 出同一张图，便于排查问题 */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成一条水墨山形路径（贝塞尔起伏） */
function mountainPath(rng, w, baseY, amp, peaks) {
  const step = w / peaks;
  let d = `M -10 ${baseY + amp * 0.4}`;
  for (let i = 0; i < peaks; i++) {
    const x1 = i * step + step * 0.28;
    const x2 = i * step + step * 0.72;
    const x3 = (i + 1) * step;
    const h = amp * (0.35 + rng() * 0.65);
    d += ` C ${x1.toFixed(1)} ${(baseY - h).toFixed(1)}, ${x2.toFixed(1)} ${(baseY - h * (0.6 + rng() * 0.6)).toFixed(1)}, ${x3.toFixed(1)} ${(baseY + amp * 0.2 * (rng() - 0.5)).toFixed(1)}`;
  }
  d += ` L ${w + 10} ${baseY + amp} L -10 ${baseY + amp} Z`;
  return d;
}

/**
 * 生成国风水墨底图。
 *
 * @param {object} input
 * @param {number} input.width   画布逻辑宽度，须与挑战的 width 一致
 * @param {number} input.height  画布逻辑高度，须与挑战的 height 一致
 * @param {number} [input.seed]  随机种子；不传则用 Math.random
 * @param {'paper'|'dark'} [input.theme='paper'] 配色：paper 宣纸米白 / dark 深色墨夜
 * @returns {string} 完整的 <svg>…</svg> 字符串
 *
 * @example
 *   import { buildInkBackground } from "ink-captcha";
 *   const svg = buildInkBackground({ width: 320, height: 200 });
 */
export function buildInkBackground(input) {
  const { width, height } = input;
  const theme = input.theme === "dark" ? "dark" : "paper";
  const seed = input.seed ?? Math.floor(Math.random() * 1e9);
  const rng = makeRng(seed);

  // 宣纸底色：暖白 → 极浅青（提亮，避免整体发灰）
  const isDark = theme === "dark";
  const paperTop = isDark ? "#1b2226" : "#fbfaf6";
  const paperBottom = isDark ? "#0f1417" : "#e9efec";

  // 远山色（黛青系），三层景深。
  // 山形必须有色有层次，构图才完整、才像一张山水画；
  // 字的可读性由前端的加粗 + 白描边保证，不依赖底图变白。
  const farInk = isDark ? "rgba(150, 185, 195, 0.16)" : "rgba(96, 128, 138, 0.34)";
  const midInk = isDark ? "rgba(130, 170, 182, 0.22)" : "rgba(74, 106, 118, 0.44)";
  const nearInk = isDark ? "rgba(110, 150, 164, 0.30)" : "rgba(52, 82, 96, 0.52)";

  const fiberAlpha = isDark ? 0.05 : 0.04;
  const fiberInk = isDark ? "190,200,196" : "140,145,138";
  const speckleInk = isDark ? "170,195,205" : "90,110,116";
  const mistInk = isDark ? "rgba(255,255,255," : "rgba(255,255,255,";
  const mistAlpha = isDark ? 0.10 : 0.26;
  const mistAlphaSpan = isDark ? 0.12 : 0.30;
  const vignetteInk = isDark ? "rgba(0,0,0,0.34)" : "rgba(45,70,80,0.11)";

  // 纤维噪点（模拟宣纸）
  const fibers = [];
  for (let i = 0; i < 130; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const len = 2 + rng() * 11;
    const ang = rng() * Math.PI;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    fibers.push(
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(${fiberInk},${(fiberAlpha + rng() * 0.06).toFixed(3)})" stroke-width="0.9"/>`,
    );
  }

  // 墨点飞白
  const speckles = [];
  for (let i = 0; i < 26; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const r = 0.6 + rng() * 2.0;
    speckles.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="rgba(${speckleInk},${(0.05 + rng() * 0.09).toFixed(3)})"/>`,
    );
  }

  // 云雾：横向柔化椭圆（集中在中部，别飘到山下去）
  const mists = [];
  const mistCount = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < mistCount; i++) {
    const cx = rng() * width;
    const cy = height * (0.24 + rng() * 0.34);
    const rx = width * (0.22 + rng() * 0.30);
    const ry = 6 + rng() * 14;
    mists.push(
      `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${mistInk}${(mistAlpha + rng() * mistAlphaSpan).toFixed(2)})"/>`,
    );
  }

  // 远山三层（景深）—— 整体下压到画布最下方约 1/5，
  // 【为什么压这么低】字区 y 上限是 height-38，若山脊爬到 y≈0.6·height，
  // 后排的字会正好压在山脊线上，白描边虽能救可读性，但视觉上会糊、
  // 且山脊走势会被字切断，不像一张完整的山水画。
  // 压到 0.86 以下后，只有最下面一行的字会与山有轻微交叠，画面关系反而更像「题字于山水之上」。
  const farPath = mountainPath(rng, width, height * 0.88, height * 0.10, 3 + Math.floor(rng() * 2));
  const midPath = mountainPath(rng, width, height * 0.96, height * 0.11, 2 + Math.floor(rng() * 2));
  const nearPath = mountainPath(rng, width, height * 1.08, height * 0.10, 2 + Math.floor(rng() * 2));

  // 朱红印章（右下角），国风点缀
  const sealSize = 20;
  const sealX = width - sealSize - 12;
  const sealY = height - sealSize - 10;

  const uid = `ik${seed.toString(36).slice(0, 6)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="${uid}paper" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="${paperTop}"/>
      <stop offset="100%" stop-color="${paperBottom}"/>
    </linearGradient>
    <linearGradient id="${uid}mistFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0)"/>
      <stop offset="55%" stop-color="rgba(255,255,255,${isDark ? 0.10 : 0.55})"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <radialGradient id="${uid}glow" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="rgba(255,255,255,${isDark ? 0.07 : 0.45})"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <radialGradient id="${uid}vignette" cx="50%" cy="45%" r="78%">
      <stop offset="68%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="${vignetteInk}"/>
    </radialGradient>
  </defs>

  <!-- 底色 -->
  <rect width="${width}" height="${height}" fill="url(#${uid}paper)"/>
  ${fibers.join("")}

  <!-- 中部提亮（让画面通透，避免发灰） -->
  <rect width="${width}" height="${height}" fill="url(#${uid}glow)"/>

  <!-- 云雾（山之前） -->
  <g>${mists.join("")}</g>
  <rect x="0" y="${(height * 0.28).toFixed(1)}" width="${width}" height="${(height * 0.34).toFixed(1)}" fill="url(#${uid}mistFade)" opacity="0.55"/>

  <!-- 远山 / 中山 / 近山（三层景深） -->
  <path d="${farPath}" fill="${farInk}"/>
  <path d="${midPath}" fill="${midInk}"/>
  <path d="${nearPath}" fill="${nearInk}"/>

  <!-- 墨点飞白 -->
  ${speckles.join("")}

  <!-- 暗角（极轻，仅用于收边） -->
  <rect width="${width}" height="${height}" fill="url(#${uid}vignette)"/>

  <!-- 四角描边（淡墨） -->
  <rect x="4.5" y="4.5" width="${width - 9}" height="${height - 9}" fill="none" stroke="${isDark ? "rgba(200,215,220,0.16)" : "rgba(70,85,90,0.22)"}" stroke-width="1" rx="6"/>

  <!-- 朱红印章点缀 -->
  <rect x="${sealX}" y="${sealY}" width="${sealSize}" height="${sealSize}" rx="3" fill="rgba(172,52,42,0.80)"/>
  <rect x="${sealX + 3}" y="${sealY + 3}" width="${sealSize - 6}" height="${sealSize - 6}" rx="2" fill="none" stroke="rgba(247,245,240,0.88)" stroke-width="1.2"/>
</svg>`;
}

export default buildInkBackground;
