/**
 * I Ching 64 Hexagrams tool module.
 *
 * Two concentric plates spin in place around a fixed center (true self-rotation).
 * Upper plate = upper trigram, lower plate = lower trigram. A fixed top pointer
 * marks the current combination. Visual language: Wang Ye Fenghou Qimen disk —
 * deep blue-black ground with cyan/electric glyph glow.
 */

import { HEXAGRAMS, type IchingHexagram } from "./iching-data";

// --- Trigram helpers ---

const TRIGRAM_BITS: Record<string, [number, number, number]> = {
  "\u4E7E": [1, 1, 1], // 乾
  "\u5151": [1, 1, 0], // 兑
  "\u79BB": [1, 0, 1], // 离
  "\u9707": [1, 0, 0], // 震
  "\u5DFD": [0, 1, 1], // 巽
  "\u574E": [0, 1, 0], // 坎
  "\u826E": [0, 0, 1], // 艮
  "\u5764": [0, 0, 0], // 坤
};

function findHexagram(upper: string, lower: string): IchingHexagram | undefined {
  return HEXAGRAMS.find((h) => h.upperTrigram === upper && h.lowerTrigram === lower);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}



const TRIGRAM_NATURE: Record<string, string> = {
  "\u4E7E": "\u5929", // 乾 天
  "\u5151": "\u6CFD", // 兑 泽
  "\u79BB": "\u706B", // 离 火
  "\u9707": "\u96F7", // 震 雷
  "\u5DFD": "\u98CE", // 巽 风
  "\u574E": "\u6C34", // 坎 水
  "\u826E": "\u5C71", // 艮 山
  "\u5764": "\u5730", // 坤 地
};

/** Later Heaven (Wen Wang) compass, drawn with map orientation: north at top. */
const BAGUA_ORDER = ["\u574E", "\u826E", "\u9707", "\u5DFD", "\u79BB", "\u5764", "\u5151", "\u4E7E"];
const BAGUA_DIRECTION: Record<string, string> = {
  "\u79BB": "\u5357",     // 离 南
  "\u5764": "\u897F\u5357", // 坤 西南
  "\u5151": "\u897F",     // 兑 西
  "\u4E7E": "\u897F\u5317", // 乾 西北
  "\u574E": "\u5317",     // 坎 北
  "\u826E": "\u4E1C\u5317", // 艮 东北
  "\u9707": "\u4E1C",     // 震 东
  "\u5DFD": "\u4E1C\u5357", // 巽 东南
};

const TRIGRAM_GLYPH: Record<string, string> = {
  "\u4E7E": "\u2630", // 乾 ☰
  "\u5151": "\u2631", // 兑 ☱
  "\u79BB": "\u2632", // 离 ☲
  "\u9707": "\u2633", // 震 ☳
  "\u5DFD": "\u2634", // 巽 ☴
  "\u574E": "\u2635", // 坎 ☵
  "\u826E": "\u2636", // 艮 ☶
  "\u5764": "\u2637", // 坤 ☷
};

function trigramGlyph(name: string): string {
  return TRIGRAM_GLYPH[name] || "?";
}

/** Tone-marked pinyin for all 64 hexagram names (Yijing readings). */
const PINYIN_TONED: Record<string, string> = {
  "\u4E7E": "Qi\u00E1n",           // 乾
  "\u5764": "K\u016Bn",           // 坤
  "\u5C6F": "Zh\u016Bn",          // 屯
  "\u8499": "M\u00E9ng",          // 蒙
  "\u9700": "X\u016B",            // 需
  "\u8BBC": "S\u00F2ng",          // 讼
  "\u5E08": "Sh\u012B",           // 师
  "\u6BD4": "B\u01D0",            // 比
  "\u5C0F\u755C": "Xi\u01Ceo Ch\u00F9", // 小畜
  "\u5C65": "L\u01DA",            // 履
  "\u6CF0": "T\u00E0i",           // 泰
  "\u5426": "P\u01D0",            // 否 (Yijing reading)
  "\u540C\u4EBA": "T\u00F3ng R\u00E9n", // 同人
  "\u5927\u6709": "D\u00E0 Y\u01D2u",   // 大有
  "\u8C26": "Qi\u0101n",          // 谦
  "\u8C6B": "Y\u00F9",            // 豫
  "\u968F": "Su\u00ED",           // 随
  "\u86CA": "G\u01D4",            // 蛊
  "\u4E34": "L\u00EDn",           // 临
  "\u89C2": "Gu\u0101n",          // 观
  "\u566C\u55D1": "Sh\u00EC K\u00E8", // 噬嗑
  "\u8D32": "B\u00EC",            // 贲
  "\u5265": "B\u014D",            // 剥
  "\u590D": "F\u00F9",            // 复
  "\u65E0\u5984": "W\u00FA W\u00E0ng", // 无妄
  "\u5927\u755C": "D\u00E0 Ch\u00F9",   // 大畜
  "\u9890": "Y\u00ED",            // 颐
  "\u5927\u8FC7": "D\u00E0 Gu\u00F2",   // 大过
  "\u574E": "K\u01CEn",           // 坎
  "\u79BB": "L\u00ED",            // 离
  "\u54B8": "Xi\u00E1n",          // 咸
  "\u6052": "H\u00E9ng",          // 恒
  "\u9041": "D\u00F9n",           // 遁
  "\u5927\u58EE": "D\u00E0 Zhu\u00E0ng", // 大壮
  "\u664B": "J\u00ECn",           // 晋
  "\u660E\u5937": "M\u00EDng Y\u00ED", // 明夷
  "\u5BB6\u4EBA": "Ji\u0101 R\u00E9n", // 家人
  "\u777D": "Ku\u00ED",           // 睽
  "\u8E47": "Ji\u01CEn",          // 蹇
  "\u89E3": "Xi\u00E8",           // 解 (Yijing reading)
  "\u635F": "S\u01D4n",           // 损
  "\u76CA": "Y\u00EC",            // 益
  "\u592C": "Gu\u00E0i",          // 夬
  "\u59E4": "G\u00F2u",           // 姤
  "\u8403": "Cu\u00EC",           // 萃
  "\u5347": "Sh\u0113ng",         // 升
  "\u56F0": "K\u00F9n",           // 困
  "\u4E95": "J\u01D0ng",          // 井
  "\u9769": "G\u00E9",            // 革
  "\u9F0E": "D\u01D0ng",          // 鼎
  "\u9707": "Zh\u00E8n",          // 震
  "\u826E": "G\u00E8n",           // 艮
  "\u6E10": "Ji\u00E0n",          // 渐
  "\u5F52\u59B9": "Gu\u012B M\u00E8i", // 归妹
  "\u4E30": "F\u0113ng",          // 丰
  "\u65C5": "L\u01DA",            // 旅
  "\u5DFD": "X\u00F9n",           // 巽
  "\u5151": "Du\u00EC",           // 兑
  "\u6DA3": "Hu\u00E0n",          // 涣
  "\u8282": "Ji\u00E9",           // 节
  "\u4E2D\u5B5A": "Zh\u014Dng F\u00FA", // 中孚
  "\u5C0F\u8FC7": "Xi\u01Ceo Gu\u00F2", // 小过
  "\u65E2\u6D4E": "J\u00EC J\u00EC",   // 既济
  "\u672A\u6D4E": "W\u00E8i J\u00EC",  // 未济
};

function formatPinyinName(name: string): string {
  if (PINYIN_TONED[name]) return PINYIN_TONED[name];
  return name;
}

function formatPinyin(h: IchingHexagram): string {
  if (PINYIN_TONED[h.name]) return PINYIN_TONED[h.name];
  // Fallback for unexpected data: title-case the slug without tones.
  return h.pinyin
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDockTitle(h: IchingHexagram): string {
  return `${h.symbol} ${h.name}  ${formatPinyin(h)}`;
}

function formatDockSub(h: IchingHexagram): string {
  const upper = `${h.upperTrigram}${trigramGlyph(h.upperTrigram)}`;
  const lower = `${h.lowerTrigram}${trigramGlyph(h.lowerTrigram)}`;
  // e.g. 第1卦 · 上乾☰ · 下乾☰
  return `\u7B2C${h.number}\u5366 \u00B7 \u4E0A${upper} \u00B7 \u4E0B${lower}`;
}


// --- Geometry ---
// Coordinates are SVG user units. Origin is the fixed disk center.

const R_OUTER = 312;
const R_OUTER_INNER = 228;
const R_INNER = 212;
const R_INNER_INNER = 118;
const LABEL_R = 348;
const HUB_R = 34;
const BAGUA_INNER = 52;
const BAGUA_OUTER = 104;
const N = 64;
const SLOT = 360 / N;
const VIEW_PAD = 120;

/**
 * Spin transform around the FIXED Taiji center (SVG user space 0,0).
 * We use translate(c) rotate(θ) translate(-c) so the pivot is unambiguous
 * even if a browser remaps SVG transform attributes through CSS.
 */
function plateTransform(rotation: number): string {
  // Center is always the disk/Taiji origin.
  return `rotate(${rotation} 0 0)`;
}

function applyViewScale(immediate = false): void {
  const svg = document.querySelector<SVGSVGElement>(".iching-ring-svg");
  if (!svg) return;
  if (immediate) {
    viewScale = targetScale;
    svg.style.transform = `scale(${viewScale})`;
    return;
  }
  // Smoothly chase targetScale for buttery wheel zoom.
  const next = viewScale + (targetScale - viewScale) * 0.22;
  if (Math.abs(targetScale - next) < 0.0015) {
    viewScale = targetScale;
    svg.style.transform = `scale(${viewScale})`;
    zoomRAF = null;
    return;
  }
  viewScale = next;
  svg.style.transform = `scale(${viewScale})`;
  zoomRAF = requestAnimationFrame(() => applyViewScale(false));
}

function requestZoomTo(nextTarget: number): void {
  targetScale = Math.min(VIEW_SCALE_MAX, Math.max(VIEW_SCALE_MIN, nextTarget));
  if (zoomRAF === null) {
    zoomRAF = requestAnimationFrame(() => applyViewScale(false));
  }
}


// --- State ---

interface RingState {
  /** Absolute plate rotation in degrees. Positive = clockwise self-spin. */
  rotation: number;
  dragging: boolean;
  lastAngle: number;
  velocity: number;
  animating: boolean;
  lastTs: number;
}

let upperState: RingState = blankState();
let lowerState: RingState = blankState();
let inertiaRAF: number | null = null;
let activePointerId: number | null = null;
let viewScale = 1;
let targetScale = 1;
let zoomRAF: number | null = null;
const VIEW_SCALE_MIN = 0.72;
const VIEW_SCALE_MAX = 1.85;
let dragKind: "upper" | "lower" | null = null;

function blankState(): RingState {
  return { rotation: 0, dragging: false, lastAngle: 0, velocity: 0, animating: false, lastTs: 0 };
}

function normalizeAngle(deg: number): number {
  let r = deg % 360;
  if (r < 0) r += 360;
  return r;
}

function shortestDelta(from: number, to: number): number {
  let delta = to - from;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

/**
 * Which HEXAGRAMS index sits under the fixed top pointer.
 * Content is painted with slot i at angle i*SLOT when rotation=0.
 * After plate self-rotates by `rotation`, the top (0°) shows index:
 *   round((-rotation) / SLOT) mod 64
 */
function slotAtPointer(rotation: number): number {
  const r = normalizeAngle(-rotation);
  return Math.round(r / SLOT) % N;
}

function nearestSlotRotation(rotation: number): number {
  return Math.round(rotation / SLOT) * SLOT;
}

function trigramAtPointer(rotation: number, isUpper: boolean): string {
  const h = HEXAGRAMS[slotAtPointer(rotation)];
  return isUpper ? h.upperTrigram : h.lowerTrigram;
}

function currentHexagram(): IchingHexagram | undefined {
  return findHexagram(
    trigramAtPointer(upperState.rotation, true),
    trigramAtPointer(lowerState.rotation, false),
  );
}

// --- SVG yao / trigram marks ---

/**
 * One yao line centered on local origin-ish coords.
 * Yang = full bar, Yin = broken bar. Drawn with a soft glow under-stroke.
 */
function yaoLine(bit: number, x: number, width: number, y: number, sw: number, hot: boolean): string {
  const stroke = hot ? "var(--iching-glow)" : "var(--iching-yao)";
  const mainOp = hot ? 1 : (visualSkin === "cyber" ? 0.78 : 0.88);
  const glowW = visualSkin === "cyber" ? sw + 2.2 : sw + 4;
  const glowOp = visualSkin === "cyber" ? (hot ? 0.55 : 0.18) : (hot ? 0.45 : 0);

  if (bit === 1) {
    // Yang / 九: solid bar. No round caps (they fake continuity across sectors).
    return (
      (glowOp > 0
        ? `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="var(--iching-glow-soft)" stroke-width="${glowW}" stroke-linecap="butt" opacity="${glowOp}"/>`
        : "") +
      `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt" opacity="${mainOp}"/>`
    );
  }

  // Yin / 六: two short bars with a large center gap that must stay visible.
  const gap = width * (visualSkin === "cyber" ? 0.36 : 0.4);
  const seg = (width - gap) / 2;
  return (
    (glowOp > 0
      ? `<line x1="${x}" y1="${y}" x2="${x + seg}" y2="${y}" stroke="var(--iching-glow-soft)" stroke-width="${glowW}" stroke-linecap="butt" opacity="${glowOp}"/>` +
        `<line x1="${x + seg + gap}" y1="${y}" x2="${x + width}" y2="${y}" stroke="var(--iching-glow-soft)" stroke-width="${glowW}" stroke-linecap="butt" opacity="${glowOp}"/>`
      : "") +
    `<line x1="${x}" y1="${y}" x2="${x + seg}" y2="${y}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt" opacity="${mainOp}"/>` +
    `<line x1="${x + seg + gap}" y1="${y}" x2="${x + width}" y2="${y}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt" opacity="${mainOp}"/>`
  );
}

function trigramStamp(trigram: string, maxWidth: number, hot: boolean): string {
  const bits = TRIGRAM_BITS[trigram];
  if (!bits) return "";
  // Hard-cap width by sector chord so neighboring yao never fuse into rings.
  // Cyber skin: thinner instrument-like yao, closer to the reference disk.
  const cyber = visualSkin === "cyber";
  const w = Math.min(maxWidth * (hot ? (cyber ? 0.66 : 0.72) : (cyber ? 0.5 : 0.58)), hot ? (cyber ? 20 : 24) : (cyber ? 15 : 18));
  const x = -w / 2;
  const gap = cyber ? (hot ? 7.4 : 6.4) : (hot ? 9.2 : 7.8);
  const sw = cyber ? (hot ? 2.6 : 1.7) : (hot ? 4.4 : 3.4);
  // Center the 3-line stack on the sector midpoint.
  const startY = -gap;
  return bits.map((b, i) => yaoLine(b, x, w, startY + i * gap, sw, hot)).join("");
}

/** Multi-char hexagram names stack vertically along the radial axis. */
function verticalLabel(h: IchingHexagram, x: number, y: number, angle: number, hot: boolean): string {
  const cls = hot ? "iching-label is-hot" : "iching-label";
  const chars = Array.from(h.name);
  const cyber = visualSkin === "cyber";
  const step = hot ? (cyber ? 16 : 20) : (cyber ? 10 : 12);
  const start = -((chars.length - 1) * step) / 2;
  let texts = "";
  for (let i = 0; i < chars.length; i++) {
    texts += `<text class="${cls}" x="0" y="${(start + i * step).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${chars[i]}</text>`;
  }
  const hitH = Math.max(chars.length * step + 14, 28);
  const hitW = hot ? (cyber ? 28 : 32) : (cyber ? 22 : 24);
  const hit = `<rect class="iching-label-hit" x="${(-hitW / 2).toFixed(1)}" y="${(-hitH / 2).toFixed(1)}" width="${hitW.toFixed(1)}" height="${hitH.toFixed(1)}" rx="6" fill="transparent" pointer-events="all"/>`;
  // Local +Y is radial-out after parent placement rotate(angle).
  return `<g class="iching-label-group" data-hex="${h.number}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle})" role="button" tabindex="0" aria-label="查看第${h.number}卦 ${h.name}">${hit}${texts}</g>`;
}

// --- Disk construction ---

function buildBackground(): string {
  if (visualSkin === "cyber") {
    // Night-sky instrument: material glow + dense layers. No binary crumb noise.
    return `
  <defs>
    <radialGradient id="iching-disc-bg" cx="50%" cy="45%" r="80%">
      <stop offset="0%" stop-color="#1a4d86"/>
      <stop offset="14%" stop-color="#0d2f58"/>
      <stop offset="34%" stop-color="#071c36"/>
      <stop offset="58%" stop-color="#04101f"/>
      <stop offset="82%" stop-color="#020914"/>
      <stop offset="100%" stop-color="#01040a"/>
    </radialGradient>
    <radialGradient id="iching-core-bloom" cx="50%" cy="50%" r="52%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="8%" stop-color="#e9feff" stop-opacity="0.95"/>
      <stop offset="18%" stop-color="#7af7ff" stop-opacity="0.72"/>
      <stop offset="34%" stop-color="#00e5ff" stop-opacity="0.42"/>
      <stop offset="58%" stop-color="#0088ff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#003a66" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="iching-material-sheen" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#9af9ff" stop-opacity="0.2"/>
      <stop offset="35%" stop-color="#00f0ff" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#00f0ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="iching-rim-glow" cx="50%" cy="50%" r="50%">
      <stop offset="62%" stop-color="#00f0ff" stop-opacity="0"/>
      <stop offset="82%" stop-color="#00f0ff" stop-opacity="0.18"/>
      <stop offset="94%" stop-color="#9af9ff" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.2"/>
    </radialGradient>
    <filter id="iching-soft-glow" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="2.1" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="iching-arc-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.8" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="iching-core-soft" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- deep night body -->
  <circle cx="0" cy="0" r="${R_OUTER + 86}" fill="url(#iching-disc-bg)"/>
  <circle cx="0" cy="0" r="${R_OUTER + 86}" fill="url(#iching-rim-glow)"/>
  <circle cx="0" cy="0" r="${R_OUTER + 70}" fill="url(#iching-material-sheen)"/>
  ${buildStarDust()}

  <!-- multi luminous rims: glow first, then hard edge -->
  <circle cx="0" cy="0" r="${R_OUTER + 74}" fill="none" stroke="rgba(154,249,255,0.22)" stroke-width="10" filter="url(#iching-soft-glow)"/>
  <circle cx="0" cy="0" r="${R_OUTER + 70}" fill="none" stroke="rgba(180,250,255,0.7)" stroke-width="2.4" filter="url(#iching-soft-glow)"/>
  <circle cx="0" cy="0" r="${R_OUTER + 63}" fill="none" stroke="rgba(0,240,255,0.35)" stroke-width="1.2"/>
  <circle cx="0" cy="0" r="${R_OUTER + 56}" fill="none" stroke="rgba(186,240,255,0.16)" stroke-width="0.7" stroke-dasharray="1.5 5"/>
  <circle cx="0" cy="0" r="${R_OUTER + 48}" fill="none" stroke="rgba(0,220,255,0.28)" stroke-width="0.9"/>
  <circle cx="0" cy="0" r="${R_OUTER + 40}" fill="none" stroke="rgba(120,220,255,0.12)" stroke-width="0.6"/>

  ${buildEnergyArcs()}
  ${buildMicroTickRing()}

  <!-- strong energy core under taiji -->
  <circle cx="0" cy="0" r="${HUB_R + 70}" fill="url(#iching-core-bloom)" filter="url(#iching-core-soft)"/>
  <circle cx="0" cy="0" r="${HUB_R + 42}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2" filter="url(#iching-soft-glow)"/>
  <circle cx="0" cy="0" r="${HUB_R + 28}" fill="none" stroke="rgba(0,240,255,0.35)" stroke-width="1.2"/>
`;
  }

  return `
  <defs>
    <radialGradient id="iching-disc-bg" cx="50%" cy="46%" r="68%">
      <stop offset="0%" stop-color="var(--iching-disc-center)"/>
      <stop offset="58%" stop-color="var(--iching-disc-mid)"/>
      <stop offset="100%" stop-color="var(--iching-disc-edge)"/>
    </radialGradient>
    <radialGradient id="iching-disc-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="var(--iching-sheen)" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="var(--iching-sheen)" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="var(--iching-sheen)" stop-opacity="0"/>
    </radialGradient>
    <filter id="iching-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <circle cx="0" cy="0" r="${R_OUTER + 62}" fill="url(#iching-disc-bg)" stroke="var(--iching-rim)" stroke-width="2"/>
  <circle cx="0" cy="0" r="${R_OUTER + 62}" fill="url(#iching-disc-glow)"/>
  <circle cx="0" cy="0" r="${R_OUTER + 48}" fill="none" stroke="var(--iching-ring-border)" stroke-width="1"/>`;
}

function buildStarDust(): string {
  // Stars only on the disk face. Nebula belongs to the outer stage background, not over yao.
  let dots = "";
  for (let i = 0; i < 180; i++) {
    const a = (i * 137.508) % 360;
    const rad = ((a - 90) * Math.PI) / 180;
    // Keep most stars near outer rim / gaps; avoid dense clouding over readable yao bands.
    const rr = 95 + ((i * 59) % 360);
    const x = rr * Math.cos(rad);
    const y = rr * Math.sin(rad);
    const s = 0.22 + (i % 6) * 0.22;
    const op = 0.07 + (i % 7) * 0.045;
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}" fill="rgba(220,245,255,${op.toFixed(2)})"/>`;
    if (i % 18 === 0) {
      dots += `<circle cx="${(x * 0.96).toFixed(1)}" cy="${(y * 0.96).toFixed(1)}" r="${(s + 0.4).toFixed(2)}" fill="rgba(255,255,255,${Math.min(0.8, op + 0.22).toFixed(2)})"/>`;
    }
  }
  return `<g class="iching-stardust">${dots}</g>`;
}

function buildEnergyArcs(): string {
  const arcs = [
    { a0: -36, a1: 22, r: R_OUTER + 64, w: 2.2, op: 0.5 },
    { a0: 40, a1: 88, r: R_OUTER + 58, w: 1.8, op: 0.42 },
    { a0: 110, a1: 158, r: R_OUTER + 66, w: 2.0, op: 0.46 },
    { a0: 175, a1: 228, r: R_OUTER + 54, w: 1.7, op: 0.38 },
    { a0: 245, a1: 292, r: R_OUTER + 62, w: 1.9, op: 0.44 },
    { a0: 310, a1: 350, r: R_OUTER + 50, w: 1.5, op: 0.34 },
    { a0: 8, a1: 46, r: (R_OUTER + R_OUTER_INNER) / 2 + 4, w: 1.3, op: 0.28 },
    { a0: 130, a1: 172, r: (R_OUTER + R_OUTER_INNER) / 2 - 6, w: 1.2, op: 0.24 },
    { a0: 210, a1: 255, r: (R_INNER + R_INNER_INNER) / 2 + 18, w: 1.1, op: 0.24 },
  ];
  let out = "";
  for (const arc of arcs) {
    const a0 = ((arc.a0 - 90) * Math.PI) / 180;
    const a1 = ((arc.a1 - 90) * Math.PI) / 180;
    const x0 = arc.r * Math.cos(a0);
    const y0 = arc.r * Math.sin(a0);
    const x1 = arc.r * Math.cos(a1);
    const y1 = arc.r * Math.sin(a1);
    const am = (((arc.a0 + arc.a1) / 2 - 90) * Math.PI) / 180;
    const rm = arc.r + 12;
    const mx = rm * Math.cos(am);
    const my = rm * Math.sin(am);
    // soft bloom under hard filament = material/energy light
    out += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="rgba(120,230,255,${arc.op * 0.55})" stroke-width="${arc.w + 3}" stroke-linecap="round" filter="url(#iching-arc-glow)" class="iching-energy-arc"/>`;
    out += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="rgba(230,255,255,${Math.min(0.9, arc.op + 0.15)})" stroke-width="${Math.max(0.7, arc.w - 0.5)}" stroke-linecap="round" class="iching-energy-arc"/>`;
  }
  return `<g class="iching-energy-arcs" pointer-events="none">${out}</g>`;
}

function buildMicroTickRing(): string {
  // Dense instrument rings only — no binary crumb text (those read as noisy red-box junk).
  const rings = [
    { r1: HUB_R + 18, r2: HUB_R + 26, n: 180, majorEvery: 5 },
    { r1: HUB_R + 30, r2: HUB_R + 40, n: 160, majorEvery: 4 },
    { r1: HUB_R + 44, r2: HUB_R + 54, n: 144, majorEvery: 4 },
    { r1: HUB_R + 58, r2: HUB_R + 68, n: 128, majorEvery: 4 },
    { r1: HUB_R + 72, r2: HUB_R + 80, n: 96, majorEvery: 3 },
  ];
  let ticks = "";
  for (const ring of rings) {
    // soft band fill for material density
    ticks += `<circle cx="0" cy="0" r="${(ring.r1 + ring.r2) / 2}" fill="none" stroke="rgba(0,180,255,0.06)" stroke-width="${ring.r2 - ring.r1}"/>`;
    ticks += `<circle cx="0" cy="0" r="${ring.r1}" fill="none" stroke="rgba(120,220,255,0.14)" stroke-width="0.45"/>`;
    ticks += `<circle cx="0" cy="0" r="${ring.r2}" fill="none" stroke="rgba(0,240,255,0.12)" stroke-width="0.45"/>`;
    for (let i = 0; i < ring.n; i++) {
      const a = ((i * 360) / ring.n - 90) * Math.PI / 180;
      const major = i % ring.majorEvery === 0;
      const inner = major ? ring.r1 : ring.r1 + 2;
      const outer = major ? ring.r2 : ring.r2 - 1.8;
      ticks += `<line x1="${(inner * Math.cos(a)).toFixed(2)}" y1="${(inner * Math.sin(a)).toFixed(2)}" x2="${(outer * Math.cos(a)).toFixed(2)}" y2="${(outer * Math.sin(a)).toFixed(2)}" stroke="${major ? "rgba(180,245,255,0.38)" : "rgba(0,220,255,0.12)"}" stroke-width="${major ? 0.55 : 0.25}"/>`;
    }
  }
  return `<g class="iching-micro-ring">${ticks}</g>`;
}


function buildPlate(isUpper: boolean): string {
  const rOuter = isUpper ? R_OUTER : R_INNER;
  const rInner = isUpper ? R_OUTER_INNER : R_INNER_INNER;
  const rotation = isUpper ? upperState.rotation : lowerState.rotation;
  const activeIdx = slotAtPointer(rotation);
  const midR = (rOuter + rInner) / 2;
  // Chord length of one 360/64 sector at mid radius. Yao must stay under this.
  const maxYaoW = 2 * midR * Math.sin((Math.PI / 180) * (SLOT / 2));

  // Plate body (rotates with content — solid disk face).
  let body = "";
  if (visualSkin === "cyber") {
    // Material energy band: soft fill + bloom rim + thin hard edge.
    body =
      `<circle cx="0" cy="0" r="${midR}" fill="none" stroke="rgba(0,180,255,0.07)" stroke-width="${rOuter - rInner}"/>` +
      `<circle cx="0" cy="0" r="${rOuter}" fill="none" stroke="rgba(120,230,255,0.28)" stroke-width="4.5" filter="url(#iching-soft-glow)"/>` +
      `<circle cx="0" cy="0" r="${rOuter}" fill="none" stroke="rgba(220,255,255,0.75)" stroke-width="1.15"/>` +
      `<circle cx="0" cy="0" r="${rOuter - 4}" fill="none" stroke="rgba(0,240,255,0.18)" stroke-width="0.55"/>` +
      `<circle cx="0" cy="0" r="${rInner}" fill="none" stroke="rgba(120,230,255,0.22)" stroke-width="3.2" filter="url(#iching-soft-glow)"/>` +
      `<circle cx="0" cy="0" r="${rInner}" fill="none" stroke="rgba(200,250,255,0.55)" stroke-width="0.9"/>` +
      `<circle cx="0" cy="0" r="${rInner + 4}" fill="none" stroke="rgba(186,240,255,0.12)" stroke-width="0.5"/>`;
  } else {
    body =
      `<circle cx="0" cy="0" r="${midR}" fill="none" stroke="var(--iching-ring-bg)" stroke-width="${rOuter - rInner}"/>` +
      `<circle cx="0" cy="0" r="${rOuter}" fill="none" stroke="var(--iching-ring-border)" stroke-width="1.4"/>` +
      `<circle cx="0" cy="0" r="${rInner}" fill="none" stroke="var(--iching-ring-border)" stroke-width="1.4"/>`;
  }

  // Quiet sector ticks.
  let ticks = "";
  for (let i = 0; i < N; i++) {
    const a = ((i * SLOT - SLOT / 2) - 90) * Math.PI / 180;
    const x1 = rInner * Math.cos(a);
    const y1 = rInner * Math.sin(a);
    const x2 = rOuter * Math.cos(a);
    const y2 = rOuter * Math.sin(a);
    const tickStroke = visualSkin === "cyber" ? "rgba(0,240,255,0.12)" : "var(--iching-divider)";
    const tickW = visualSkin === "cyber" ? 0.45 : 0.6;
    ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${tickStroke}" stroke-width="${tickW}"/>`;
  }

  let marks = "";
  for (let i = 0; i < N; i++) {
    const h = HEXAGRAMS[i];
    const trigram = isUpper ? h.upperTrigram : h.lowerTrigram;
    const angle = i * SLOT; // 0 = top when plate rotation is 0
    const rad = ((angle - 90) * Math.PI) / 180;
    const cx = midR * Math.cos(rad);
    const cy = midR * Math.sin(rad);
    const related = selectedBagua !== null && trigram === selectedBagua;
    const pure = related && h.upperTrigram === selectedBagua && h.lowerTrigram === selectedBagua;
    const hot = selectedBagua === null && i === activeIdx;

    // Stamp on plate: translate to sector, rotate so local +Y is radial-out.
    // Parent plate uses rotate(θ 0 0): true self-rotation around disk center.
    const slotClass = [
      "iching-slot",
      hot ? "is-hot" : "",
      related ? "is-related" : "",
      pure ? "is-pure" : "",
      selectedBagua && !related ? "is-dim" : "",
    ].filter(Boolean).join(" ");
    marks += `<g class="${slotClass}" transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${angle})">`;
    if (hot || related) {
      const bw = Math.min(maxYaoW * 0.9, 28);
      const bh = 32;
      if (visualSkin === "cyber") {
        // Slim neon frame instead of heavy card fill.
        marks += `<rect x="${(-bw / 2).toFixed(1)}" y="${(-bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="rgba(0,240,255,0.05)" stroke="rgba(0,240,255,0.75)" stroke-width="0.9"/>`;
      } else {
        marks += `<rect x="${(-bw / 2).toFixed(1)}" y="${(-bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="var(--iching-hot-fill)" stroke="var(--iching-glow)" stroke-width="1.3"/>`;
      }
    }
    marks += trigramStamp(trigram, maxYaoW, hot || related);
    marks += `</g>`;

    if (isUpper) {
      const lx = LABEL_R * Math.cos(rad);
      const ly = LABEL_R * Math.sin(rad);
      // Two-char names stack vertically, fixed on the plate.
      marks += verticalLabel(h, lx, ly, angle, hot || related);
    }
  }

  // Explicit pivot (0,0): plate never translates, only spins in place.
  return (
    `<g class="iching-ring" data-ring="${isUpper ? "upper" : "lower"}" transform="${plateTransform(rotation)}">` +
    body + ticks + marks +
    `</g>`
  );
}

function baguaWedgePath(index: number, inner: number, outer: number): string {
  const start = (index * 45 - 22.5 - 90) * Math.PI / 180;
  const end = ((index + 1) * 45 - 22.5 - 90) * Math.PI / 180;
  const x1 = inner * Math.cos(start);
  const y1 = inner * Math.sin(start);
  const x2 = outer * Math.cos(start);
  const y2 = outer * Math.sin(start);
  const x3 = outer * Math.cos(end);
  const y3 = outer * Math.sin(end);
  const x4 = inner * Math.cos(end);
  const y4 = inner * Math.sin(end);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${outer} ${outer} 0 0 1 ${x3.toFixed(2)} ${y3.toFixed(2)} L ${x4.toFixed(2)} ${y4.toFixed(2)} A ${inner} ${inner} 0 0 0 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

function buildBaguaRing(): string {
  const mid = (BAGUA_INNER + BAGUA_OUTER) / 2;
  const cyber = visualSkin === "cyber";
  let marks = `
    <circle cx="0" cy="0" r="${(BAGUA_INNER + BAGUA_OUTER) / 2}" fill="none" stroke="${cyber ? "rgba(0,180,255,0.10)" : "var(--iching-ring-bg)"}" stroke-width="${BAGUA_OUTER - BAGUA_INNER}"/>
    <circle cx="0" cy="0" r="${BAGUA_OUTER}" fill="none" stroke="${cyber ? "rgba(120,230,255,0.28)" : "var(--iching-ring-border)"}" stroke-width="${cyber ? 1.1 : 1.2}"/>
    <circle cx="0" cy="0" r="${BAGUA_INNER}" fill="none" stroke="${cyber ? "rgba(120,230,255,0.22)" : "var(--iching-ring-border)"}" stroke-width="${cyber ? 0.9 : 1.1}"/>`;
  for (let i = 0; i < BAGUA_ORDER.length; i++) {
    const name = BAGUA_ORDER[i];
    const angle = i * 45;
    const rad = ((angle - 90) * Math.PI) / 180;
    const cx = mid * Math.cos(rad);
    const cy = mid * Math.sin(rad);
    const active = selectedBagua === name;
    const cls = active ? "iching-bagua-cell is-active" : "iching-bagua-cell";
    const fill = active
      ? (cyber ? "rgba(0,240,255,0.14)" : "var(--iching-hot-fill)")
      : "transparent";
    const stroke = active
      ? (cyber ? "rgba(0,240,255,0.85)" : "var(--iching-glow)")
      : (cyber ? "rgba(0,240,255,0.16)" : "var(--iching-divider)");
    const direction = BAGUA_DIRECTION[name] || "";
    const nature = TRIGRAM_NATURE[name] || "";
    marks += `<g class="${cls}" data-bagua="${name}" transform="translate(0 0)" role="button" tabindex="0" aria-label="${direction} ${name} ${nature}">`;
    marks += `<path d="${baguaWedgePath(i, BAGUA_INNER, BAGUA_OUTER)}" fill="${fill}" stroke="${stroke}" stroke-width="${active ? 1.4 : 0.6}" pointer-events="all"/>`;
    marks += `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${angle})">`;
    marks += `<g transform="translate(0 -6)">${trigramStamp(name, 18, active)}</g>`;
    marks += `<text class="iching-bagua-name" x="0" y="10" text-anchor="middle" dominant-baseline="middle">${name}</text>`;
    marks += `<text class="iching-bagua-dir" x="0" y="20" text-anchor="middle" dominant-baseline="middle">${direction}</text>`;
    marks += `</g></g>`;
  }
  return `<g class="iching-bagua-ring">${marks}</g>`;
}

function buildHub(): string {
  const r = HUB_R;
  const half = r / 2;
  // Eye radius ~10% of disk radius.
  const eye = Math.max(4.5, r * 0.1);

  // Standard, unambiguous taiji construction (vertical):
  // 1) black base disk
  // 2) white right half
  // 3) white upper head circle + black lower head circle
  // 4) black eye in white head, white eye in black head
  //
  // Hardcode #000/#fff so eyes never vanish if CSS vars fail.
  // Spin with SVG animateTransform around (0,0) only.
  const spin = prefersReducedMotion()
    ? ""
    : `<animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="28s" repeatCount="indefinite"/>`;

  const cyberAura = visualSkin === "cyber"
    ? `<circle cx="0" cy="0" r="${r + 40}" fill="rgba(0,220,255,0.08)" filter="url(#iching-core-soft)"/>
       <circle cx="0" cy="0" r="${r + 28}" fill="none" stroke="rgba(0,240,255,0.25)" stroke-width="18" opacity="0.75" filter="url(#iching-soft-glow)"/>
       <circle cx="0" cy="0" r="${r + 18}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3.2" filter="url(#iching-soft-glow)"/>
       <circle cx="0" cy="0" r="${r + 10}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2"/>`
    : "";

  return `
  <g class="iching-taiji">
    <circle cx="0" cy="0" r="${r + 11}" fill="var(--iching-hub)" stroke="var(--iching-ring-border)" stroke-width="1.2"/>
    ${cyberAura}
    <g class="iching-taiji-spin" transform="rotate(0 0 0)">
      ${spin}
      <!-- 1. yin base -->
      <circle class="iching-taiji-disk" cx="0" cy="0" r="${r}" fill="#000000"/>
      <!-- 2. yang half (right) -->
      <path class="iching-taiji-yang-half" d="M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} Z" fill="#ffffff"/>
      <!-- 3. heads -->
      <circle class="iching-taiji-head-yang" cx="0" cy="${-half}" r="${half}" fill="#ffffff"/>
      <circle class="iching-taiji-head-yin" cx="0" cy="${half}" r="${half}" fill="#000000"/>
      <!-- 4. eyes -->
      <circle class="iching-taiji-eye-yin" cx="0" cy="${-half}" r="${eye}" fill="#000000"/>
      <circle class="iching-taiji-eye-yang" cx="0" cy="${half}" r="${eye}" fill="#ffffff"/>
      <!-- outer rim -->
      <circle cx="0" cy="0" r="${r}" fill="none" stroke="${visualSkin === "cyber" ? "rgba(223,252,255,0.55)" : "rgba(255,255,255,0.35)"}" stroke-width="1.4"/>
    </g>
  </g>`;
}

function renderRingSVG(): string {
  const topMarker = visualSkin === "cyber"
    ? `<g class="iching-top-marker" pointer-events="none">
        <path d="M -34 ${-R_OUTER - 10} A ${R_OUTER + 16} ${R_OUTER + 16} 0 0 1 34 ${-R_OUTER - 10}" fill="none" stroke="rgba(0,240,255,0.28)" stroke-width="14" stroke-linecap="round"/>
        <path d="M -20 ${-R_OUTER - 6} A ${R_OUTER + 10} ${R_OUTER + 10} 0 0 1 20 ${-R_OUTER - 6}" fill="none" stroke="#9af9ff" stroke-width="2" filter="url(#iching-soft-glow)"/>
        <circle cx="0" cy="${-R_OUTER - 2}" r="3" fill="#ffffff"/>
      </g>`
    : "";
  const content =
    buildBackground() +
    buildPlate(true) +
    buildPlate(false) +
    buildBaguaRing() +
    buildHub() +
    topMarker;
  const vb = -(R_OUTER + VIEW_PAD);
  const size = (R_OUTER + VIEW_PAD) * 2;
  return `<svg class="iching-ring-svg" data-skin="${visualSkin}" viewBox="${vb} ${vb} ${size} ${size}" preserveAspectRatio="xMidYMid meet">${content}</svg>`;
}

// --- Interaction: true in-place self-rotation ---

function pointerAngle(evt: PointerEvent, svg: SVGSVGElement): number {
  const rect = svg.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = evt.clientX - cx;
  const dy = evt.clientY - cy;
  // 0° at top, clockwise positive — same convention as SVG rotate().
  let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

function hitPlate(svgDist: number): "upper" | "lower" | null {
  // Outer plate includes label rim so users can grab near names too.
  if (svgDist >= R_OUTER_INNER - 8 && svgDist <= LABEL_R + 24) return "upper";
  if (svgDist >= R_INNER_INNER - 8 && svgDist <= R_INNER + 10) return "lower";
  return null;
}

function hitBagua(svgDist: number): boolean {
  return svgDist >= BAGUA_INNER - 4 && svgDist <= BAGUA_OUTER + 8;
}

/**
 * Rebuild rotating plate markup so active-slot highlight tracks the pointer.
 * Still cheap: pure string + one innerHTML on the two plate groups' parent SVG.
 */
function paintPlates(svg: SVGSVGElement) {
  const upper = svg.querySelector<SVGGElement>('.iching-ring[data-ring="upper"]');
  const lower = svg.querySelector<SVGGElement>('.iching-ring[data-ring="lower"]');
  const bagua = svg.querySelector<SVGGElement>('.iching-bagua-ring');
  // Replace whole plates to refresh hot stamps. Keep hub/pointer untouched.
  // Important: do NOT paint full 6-yao hexagram glyphs here — outer/inner plates are 3-yao only.
  const tmp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  tmp.innerHTML = buildPlate(true) + buildPlate(false) + buildBaguaRing();
  const newUpper = tmp.querySelector<SVGGElement>('.iching-ring[data-ring="upper"]');
  const newLower = tmp.querySelector<SVGGElement>('.iching-ring[data-ring="lower"]');
  const newBagua = tmp.querySelector<SVGGElement>('.iching-bagua-ring');
  if (upper && newUpper) upper.replaceWith(newUpper);
  if (lower && newLower) lower.replaceWith(newLower);
  if (bagua && newBagua) bagua.replaceWith(newBagua);
  else if (!bagua && newBagua) svg.appendChild(newBagua);
  // Cleanup any leftover decorative glyph belt from previous builds.
  svg.querySelectorAll(".iching-glyph-ring").forEach((el) => el.remove());
}

function updateTransformsOnly() {
  const u = document.querySelector<SVGGElement>('.iching-ring[data-ring="upper"]');
  const l = document.querySelector<SVGGElement>('.iching-ring[data-ring="lower"]');
  if (u) u.setAttribute("transform", plateTransform(upperState.rotation));
  if (l) l.setAttribute("transform", plateTransform(lowerState.rotation));
}

let lastPaintSlotU = -1;
let lastPaintSlotL = -1;
let lastDisplayKey = "";
let wasResting = true;
/** Visual comparison skin: classic | cyber */
let visualSkin: "classic" | "cyber" = "classic";
let selectedBagua: string | null = null;

function currentDisplayKey(h: IchingHexagram | undefined): string {
  return h ? `${h.number}:${h.name}:${h.upperTrigram}:${h.lowerTrigram}` : "";
}

function pulseClass(el: Element | null, className: string, ms = 520): void {
  if (!el) return;
  // Even with reduced motion, apply a single-frame class so feedback still exists.
  el.classList.remove(className);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), prefersReducedMotion() ? 180 : ms);
}

function triggerSettlePulse(reason: "settle" | "reset" | "enter" = "settle"): void {
  // Premium/quiet: only a soft breath on the active slot + taiji.
  // No full-disk flash, no dock neon burst.
  const hotSlots = document.querySelectorAll(".iching-slot.is-hot");
  const hotLabels = document.querySelectorAll(".iching-label.is-hot");
  const hub = document.querySelector(".iching-taiji");

  pulseClass(hub, "is-hub-pulse", 900);
  hotSlots.forEach((el) => pulseClass(el, "is-hit-pulse", 720));
  hotLabels.forEach((el) => pulseClass(el, "is-hit-pulse", 720));

  if (reason === "reset" || reason === "enter") {
    pulseClass(document.getElementById("iching-current-name"), "is-text-swap", 380);
    pulseClass(document.getElementById("iching-current-sub"), "is-text-swap", 380);
  }
}

function formatBaguaHint(name: string): string {
  const nature = TRIGRAM_NATURE[name] || "";
  const glyph = trigramGlyph(name);
  const pinyin = formatPinyinName(name);
  const count = HEXAGRAMS.filter((h) => h.upperTrigram === name || h.lowerTrigram === name).length;
  const direction = BAGUA_DIRECTION[name] || "";
  return `\u516B\u5366\u00B7${direction} ${name}${glyph}  ${pinyin}  ${nature}  \u00B7  ${count}\u5366`;
}

function updateDisplay(options?: { animate?: boolean }): void {
  const current = currentHexagram();
  const name = document.getElementById("iching-current-name");
  const sub = document.getElementById("iching-current-sub");
  const key = currentDisplayKey(current) + (selectedBagua ? `|bagua:${selectedBagua}` : "");
  const changed = key !== lastDisplayKey;

  if (selectedBagua) {
    if (name) name.textContent = formatBaguaHint(selectedBagua);
    if (sub) sub.textContent = current ? formatDockSub(current) : "";
  } else {
    if (name) name.textContent = current ? formatDockTitle(current) : "\u7EC4\u5408\u65E0\u6548";
    if (sub) sub.textContent = current ? formatDockSub(current) : "";
  }

  if (changed) {
    lastDisplayKey = key;
    if (options?.animate !== false) {
      pulseClass(name, "is-text-swap", 420);
      pulseClass(sub, "is-text-swap", 420);
      pulseClass(document.querySelector(".iching-dock-info"), "is-text-swap", 420);
    }
  }
}

function platesAreResting(): boolean {
  return !upperState.dragging && !lowerState.dragging
    && !upperState.animating && !lowerState.animating
    && Math.abs(upperState.velocity) <= 0.07
    && Math.abs(lowerState.velocity) <= 0.07
    && Math.abs(upperState.rotation - nearestSlotRotation(upperState.rotation)) < 0.08
    && Math.abs(lowerState.rotation - nearestSlotRotation(lowerState.rotation)) < 0.08;
}

function refreshVisual(forcePaint = false) {
  const slotU = slotAtPointer(upperState.rotation);
  const slotL = slotAtPointer(lowerState.rotation);
  const svg = document.querySelector<SVGSVGElement>(".iching-ring-svg");

  if (svg && (forcePaint || slotU !== lastPaintSlotU || slotL !== lastPaintSlotL)) {
    paintPlates(svg);
    lastPaintSlotU = slotU;
    lastPaintSlotL = slotL;
  } else {
    updateTransformsOnly();
  }

  updateDisplay();

  // Edge-trigger: every time plates go from moving -> resting, fire FX.
  // Important: outer-ring linked motion often keeps the same hexagram, so we
  // must NOT require the hexagram identity to change.
  const resting = platesAreResting();
  if (resting && !wasResting && selectedBagua === null) {
    // Wait one frame so freshly painted hot slots exist in the DOM.
    requestAnimationFrame(() => triggerSettlePulse("settle"));
  }
  wasResting = resting;
}

function applyInertia() {
  let needContinue = false;
  const friction = 0.968;
  const minV = 0.07;

  for (const s of [upperState, lowerState]) {
    if (s.dragging || s.animating) continue;

    if (Math.abs(s.velocity) > minV) {
      // Keep spinning around fixed center.
      s.rotation += s.velocity;
      s.velocity *= friction;
      needContinue = true;
      continue;
    }

    // Settle onto nearest sector like a weighted plate.
    const target = nearestSlotRotation(s.rotation);
    const delta = target - s.rotation;
    if (Math.abs(delta) < 0.06) {
      s.rotation = target;
      s.velocity = 0;
    } else {
      s.rotation += delta * 0.2;
      s.velocity = 0;
      needContinue = true;
    }
  }

  refreshVisual(false);
  inertiaRAF = needContinue ? requestAnimationFrame(applyInertia) : null;
}

function startInertia() {
  if (inertiaRAF === null) inertiaRAF = requestAnimationFrame(applyInertia);
}

function stopInertia() {
  if (inertiaRAF !== null) {
    cancelAnimationFrame(inertiaRAF);
    inertiaRAF = null;
  }
}

function labelFromEvent(evt: Event): HTMLElement | null {
  const target = evt.target;
  if (!(target instanceof Element)) return null;
  return target.closest(".iching-label-group");
}

function baguaFromEvent(evt: Event): HTMLElement | null {
  const target = evt.target;
  if (!(target instanceof Element)) return null;
  return target.closest(".iching-bagua-cell");
}

function toggleBagua(name: string | null): void {
  selectedBagua = selectedBagua === name ? null : name;
  lastPaintSlotU = -1;
  lastPaintSlotL = -1;
  refreshVisual(true);
}

function hexagramFromLabel(label: Element | null): IchingHexagram | undefined {
  if (!label) return undefined;
  const raw = label.getAttribute("data-hex");
  const number = raw ? Number(raw) : NaN;
  if (!Number.isInteger(number)) return undefined;
  return HEXAGRAMS.find((item) => item.number === number);
}

function setupDrag(container: HTMLElement) {
  const svg = container.querySelector<SVGSVGElement>(".iching-ring-svg");
  if (!svg) return;
  let activeState: RingState | null = null;
  let pendingLabel: HTMLElement | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerMoved = false;

  svg.addEventListener("pointerdown", (evt) => {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = evt.clientX - cx;
    const dy = evt.clientY - cy;
    // Use unscaled geometry for hit-testing: getBoundingClientRect already includes CSS scale.
    const scale = ((R_OUTER + VIEW_PAD) * 2) / Math.max(rect.width, 1);
    const svgDist = Math.sqrt(dx * dx + dy * dy) * scale;

    pendingLabel = labelFromEvent(evt);
    pointerStartX = evt.clientX;
    pointerStartY = evt.clientY;
    pointerMoved = false;

    if (hitBagua(svgDist) || baguaFromEvent(evt)) {
      const cell = baguaFromEvent(evt);
      const name = cell?.getAttribute("data-bagua") || "";
      if (name) toggleBagua(name);
      return;
    }

    const kind = hitPlate(svgDist);
    if (!kind) return;
    dragKind = kind;
    activeState = kind === "upper" ? upperState : lowerState;

    activeState.dragging = true;
    activeState.animating = false;
    activeState.velocity = 0;
    // When outer drives both plates, mark lower as driven too so inertia settles both.
    if (kind === "upper") {
      lowerState.dragging = true;
      lowerState.animating = false;
      lowerState.velocity = 0;
    }
    activeState.lastAngle = pointerAngle(evt, svg);
    activeState.lastTs = performance.now();
    activePointerId = evt.pointerId;
    svg.setPointerCapture(evt.pointerId);
  });

  svg.addEventListener("pointermove", (evt) => {
    if (!activeState || !activeState.dragging || !dragKind) return;
    if (activePointerId !== null && evt.pointerId !== activePointerId) return;

    if (!pointerMoved) {
      const moved = Math.hypot(evt.clientX - pointerStartX, evt.clientY - pointerStartY);
      if (moved > 6) pointerMoved = true;
    }

    const angle = pointerAngle(evt, svg);
    const delta = shortestDelta(activeState.lastAngle, angle);
    const now = performance.now();
    const dt = Math.max(now - activeState.lastTs, 1);
    const vel = delta * (16 / dt) * 0.9;

    // Outer plate drag: both rings share the same delta so the current hexagram
    // pairing is preserved (standard upper/lower stay aligned while browsing).
    // Inner plate drag: only lower moves, allowing deliberate recombination.
    if (dragKind === "upper") {
      upperState.rotation += delta;
      lowerState.rotation += delta;
      upperState.velocity = vel;
      lowerState.velocity = vel;
      upperState.lastAngle = angle;
      upperState.lastTs = now;
      lowerState.lastAngle = angle;
      lowerState.lastTs = now;
    } else {
      lowerState.rotation += delta;
      lowerState.velocity = vel;
      lowerState.lastAngle = angle;
      lowerState.lastTs = now;
    }

    refreshVisual(false);
  });

  const endDrag = (evt: PointerEvent) => {
    if (!activeState || !dragKind) return;
    if (activePointerId !== null && evt.pointerId !== activePointerId) return;

    const label = pendingLabel;
    const openedFromLabel = Boolean(label) && !pointerMoved && evt.type === "pointerup";

    if (dragKind === "upper") {
      upperState.dragging = false;
      lowerState.dragging = false;
      if (openedFromLabel) {
        upperState.velocity = 0;
        lowerState.velocity = 0;
      } else {
        upperState.velocity *= 1.12;
        lowerState.velocity *= 1.12;
      }
    } else {
      activeState.dragging = false;
      activeState.velocity = openedFromLabel ? 0 : activeState.velocity * 1.12;
    }

    activeState = null;
    dragKind = null;
    activePointerId = null;
    pendingLabel = null;
    try { svg.releasePointerCapture(evt.pointerId); } catch { /* */ }

    if (openedFromLabel) {
      const hexagram = hexagramFromLabel(label);
      if (hexagram) {
        openHexagramDetail(hexagram);
        return;
      }
    }
    startInertia();
  };

  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  // Smooth wheel zoom around the fixed Taiji center.
  const zoomHost = container.querySelector<HTMLElement>("#iching-ring-container") || container;
  zoomHost.addEventListener(
    "wheel",
    (evt) => {
      evt.preventDefault();
      // Normalize across mouse wheel / trackpad.
      const dy = evt.deltaMode === 1 ? evt.deltaY * 16 : evt.deltaY;
      // Exponential mapping: small trackpad moves feel continuous, not stepped.
      const factor = Math.exp(-dy * 0.0018);
      requestZoomTo(targetScale * factor);
    },
    { passive: false },
  );
}

function animateReset() {
  stopInertia();
  if (selectedBagua) {
    selectedBagua = null;
    lastPaintSlotU = -1;
    lastPaintSlotL = -1;
  }
  const startU = shortestDelta(0, upperState.rotation);
  const startL = shortestDelta(0, lowerState.rotation);
  upperState.rotation = startU;
  lowerState.rotation = startL;
  upperState.animating = true;
  lowerState.animating = true;
  upperState.velocity = 0;
  lowerState.velocity = 0;

  const hub = document.querySelector(".iching-taiji");
  pulseClass(hub, "is-hub-pulse", 1000);

  const dur = prefersReducedMotion() ? 1 : 860;
  const t0 = performance.now();

  function step(now: number) {
    const t = Math.min((now - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    upperState.rotation = startU * (1 - eased);
    lowerState.rotation = startL * (1 - eased);
    if (t >= 1) {
      upperState.rotation = 0;
      lowerState.rotation = 0;
      upperState.animating = false;
      lowerState.animating = false;
      wasResting = false;
      refreshVisual(true);
      return;
    }
    refreshVisual(false);
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// --- Detail page ---

function hexagramBits(h: IchingHexagram): number[] {
  return [...TRIGRAM_BITS[h.lowerTrigram], ...TRIGRAM_BITS[h.upperTrigram]];
}

function renderDetail(h: IchingHexagram): string {
  const bits = hexagramBits(h);
  const yaoW = 128;
  const yaoX = 36;
  const yaoGap = 18;
  const sY = 30;
  let yaoSvg = "";
  for (let i = 5; i >= 0; i--) {
    yaoSvg += yaoLine(bits[i], yaoX, yaoW, sY + (5 - i) * yaoGap, 5.4, true);
  }
  const yaoH = sY + 5 * yaoGap + 30;

  return `
    <button class="tools-detail-back" onclick="ichingBackToRing()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      \u8FD4\u56DE\u5706\u76D8
    </button>

    <div class="iching-detail-layout">
      <div class="iching-detail-header">
        <svg class="iching-detail-symbol" viewBox="0 0 200 ${yaoH}" width="200" height="${yaoH}">
          ${yaoSvg}
        </svg>
        <div class="iching-detail-title">
          <h2>${h.symbol} ${h.name} <span class="iching-detail-pinyin">${formatPinyin(h)}</span></h2>
          <p class="iching-detail-meta">\u7B2C${h.number}\u5366 \u00B7 ${h.upperTrigram}\u4E0A <span class="iching-detail-pinyin">${formatPinyinName(h.upperTrigram)}</span> \u00B7 ${h.lowerTrigram}\u4E0B <span class="iching-detail-pinyin">${formatPinyinName(h.lowerTrigram)}</span></p>
        </div>
      </div>

      <div class="iching-detail-section">
        <h3>\u5366\u8F9E</h3>
        <p class="iching-classic-text">${h.judgment}</p>
        <div class="iching-explain" data-object-type="hexagram" data-object-id="${h.name}"></div>
      </div>

      <div class="iching-detail-section">
        <h3>\u5927\u8C61\u4F20</h3>
        <p class="iching-classic-text">${h.image}</p>
      </div>

      <div class="iching-detail-section">
        <h3>\u723B\u8F9E\u4E0E\u5C0F\u8C61\u4F20</h3>
        <div class="iching-lines">
          ${h.lines.map((line) => `
            <div class="iching-line-item">
              <div class="iching-line-position">${line.position}</div>
              <div class="iching-line-content">
                <p class="iching-classic-text iching-line-text">${line.text}</p>
                ${line.commentary ? `<p class="iching-classic-text iching-line-commentary">${line.commentary}</p>` : ""}
                <div class="iching-explain" data-object-type="line" data-object-id="${h.name}/${line.position}"></div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

// --- Main entry ---

export function renderIchingDetail(): void {
  const cards = document.getElementById("tools-cards");
  const detail = document.getElementById("tools-detail");
  if (!cards || !detail) return;
  cards.style.display = "none";

  stopInertia();
  upperState = blankState();
  lowerState = blankState();
  selectedBagua = null;
  dragKind = null;
  activePointerId = null;
  if (zoomRAF !== null) { cancelAnimationFrame(zoomRAF); zoomRAF = null; }
  viewScale = 1;
  targetScale = 1;
  lastPaintSlotU = -1;
  lastPaintSlotL = -1;
  lastDisplayKey = "";
  wasResting = true;

  const current = currentHexagram();

  detail.innerHTML = `
    <button class="tools-detail-back" onclick="backToToolsCards()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      \u8FD4\u56DE\u5DE5\u5177\u5217\u8868
    </button>

    <div class="iching-main" data-skin="${visualSkin}">
      <div class="iching-stage">
        <div class="iching-ring-container" id="iching-ring-container">
          ${renderRingSVG()}
        </div>
      </div>

      <div class="iching-dock">
        <div class="iching-dock-info">
          <div class="iching-current-symbol" id="iching-current-name">${current ? formatDockTitle(current) : "\u7EC4\u5408\u65E0\u6548"}</div>
          <div class="iching-current-sub" id="iching-current-sub">${current ? formatDockSub(current) : ""}</div>
        </div>
        <div class="iching-actions">
          <button class="btn btn-primary iching-reset-btn" onclick="ichingReset()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            \u590D\u4F4D
          </button>
          <button class="btn iching-view-btn" onclick="ichingViewDetail()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            \u67E5\u770B\u8BE6\u60C5
          </button>
        </div>
      </div>
    </div>
  `;

  setupDrag(detail);
  bindIchingSkinHotkey();
  applyViewScale(true);
  // Ensure hot slot paint matches initial state.
  refreshVisual(true);
  // Entrance pulse so FX are obvious even before the first drag.
  requestAnimationFrame(() => triggerSettlePulse("enter"));
}

// --- Global handlers ---

(window as any).ichingReset = function (): void {
  animateReset();
};

let skinHotkeyBound = false;

function applyIchingSkin(next?: "classic" | "cyber"): void {
  // Keep ring angles/zoom; only swap the visual language.
  if (next) visualSkin = next;
  else visualSkin = visualSkin === "classic" ? "cyber" : "classic";

  const detail = document.getElementById("tools-detail");
  if (!detail) return;
  // Only operate while the I Ching tool is mounted.
  const main = detail.querySelector(".iching-main") as HTMLElement | null;
  const container = detail.querySelector("#iching-ring-container") as HTMLElement | null;
  if (!main || !container) return;

  main.setAttribute("data-skin", visualSkin);
  container.innerHTML = renderRingSVG();
  lastPaintSlotU = -1;
  lastPaintSlotL = -1;
  setupDrag(detail);
  applyViewScale(true);
  refreshVisual(true);
}

function bindIchingSkinHotkey(): void {
  if (skinHotkeyBound) return;
  skinHotkeyBound = true;
  window.addEventListener("keydown", (evt) => {
    // Secret toggle: Ctrl+Shift+Q
    // Hidden from normal UI so strangers don't casually switch skins.
    if (!evt.ctrlKey || !evt.shiftKey || evt.altKey || evt.metaKey) return;
    // Use both key and code for layout robustness.
    const isQ = evt.key.toLowerCase() === "q" || evt.code === "KeyQ";
    if (!isQ) return;
    if (evt.repeat) return;

    const detail = document.getElementById("tools-detail");
    if (!detail?.querySelector(".iching-main")) return; // only on I Ching page

    evt.preventDefault();
    evt.stopPropagation();
    applyIchingSkin();
  }, true);
}

(window as any).ichingToggleSkin = function (): void {
  applyIchingSkin();
};

function playPageTransition(detail: HTMLElement, html: string, enterClass: string, done?: () => void): void {
  if (prefersReducedMotion()) {
    detail.innerHTML = html;
    done?.();
    return;
  }
  detail.classList.remove("iching-page-enter", "iching-page-enter-detail", "iching-page-enter-ring");
  detail.classList.add("iching-page-leave");
  window.setTimeout(() => {
    detail.innerHTML = html;
    detail.classList.remove("iching-page-leave");
    detail.classList.add("iching-page-enter", enterClass);
    done?.();
    window.setTimeout(() => {
      detail.classList.remove("iching-page-enter", enterClass);
    }, 520);
  }, 160);
}

function formatClipRange(start: number, end: number): string {
  const fmt = (seconds: number) => {
    const m = Math.floor(Math.max(0, seconds) / 60);
    const s = Math.floor(Math.max(0, seconds) % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

async function fetchClipAnchors(objectType: string, objectId: string): Promise<any[]> {
  const params = new URLSearchParams({
    collection: "iching-up",
    object_type: objectType,
    object_id: objectId,
    for_display: "1",
  });
  try {
    const res = await fetch(`/v1/clip-anchors?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.anchors) ? data.anchors : [];
  } catch {
    return [];
  }
}

function renderExplainCards(target: Element, anchors: any[], title: string): void {
  if (!anchors.length) {
    target.innerHTML = "";
    return;
  }
  target.innerHTML = anchors.map((anchor, index) => `
    <div class="iching-explain-card">
      <div class="iching-explain-range">${formatClipRange(Number(anchor.start_seconds), Number(anchor.end_seconds))}</div>
      <div class="iching-explain-quote">${anchor.quote || "讲解片段"}</div>
      <button type="button" class="btn iching-explain-play" data-idx="${index}">播放这一段</button>
    </div>
  `).join("");
  target.querySelectorAll(".iching-explain-play").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number((btn as HTMLElement).dataset.idx || 0);
      const anchor = anchors[idx];
      if (!anchor) return;
      const open = (window as any).clipPlayerOpen;
      if (typeof open !== "function") return;
      open({
        video_id: anchor.video_id,
        start_seconds: Number(anchor.start_seconds),
        end_seconds: Number(anchor.end_seconds),
        title,
        quote: anchor.quote || "",
        source_url: anchor.source_url || "",
      });
    });
  });
}

async function loadHexagramExplanations(hexagram: IchingHexagram): Promise<void> {
  const slots = Array.from(document.querySelectorAll(".iching-explain"));
  for (const slot of slots) {
    const objectType = slot.getAttribute("data-object-type") || "";
    const objectId = slot.getAttribute("data-object-id") || "";
    if (!objectType || !objectId) continue;
    const anchors = await fetchClipAnchors(objectType, objectId);
    const title = objectType === "line" ? objectId.replace("/", " ") : `${hexagram.name} 卦辞`;
    renderExplainCards(slot, anchors, title);
  }
}

function openHexagramDetail(hexagram: IchingHexagram): void {
  const detail = document.getElementById("tools-detail");
  if (!detail) return;
  stopInertia();
  playPageTransition(detail, renderDetail(hexagram), "iching-page-enter-detail", () => {
    document.querySelector(".content-area")?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    pulseClass(document.querySelector(".iching-detail-symbol"), "is-flip-in", 700);
    pulseClass(document.querySelector(".iching-detail-layout"), "is-detail-reveal", 700);
    void loadHexagramExplanations(hexagram);
  });
}

(window as any).ichingViewDetail = function (): void {
  const current = currentHexagram();
  if (!current) return;
  openHexagramDetail(current);
};

(window as any).ichingBackToRing = function (): void {
  const detail = document.getElementById("tools-detail");
  if (!detail || prefersReducedMotion()) {
    renderIchingDetail();
    return;
  }
  detail.classList.add("iching-page-leave");
  window.setTimeout(() => {
    renderIchingDetail();
    const d = document.getElementById("tools-detail");
    if (!d) return;
    d.classList.add("iching-page-enter", "iching-page-enter-ring");
    pulseClass(document.querySelector(".iching-ring-svg"), "is-settle-pulse", 650);
    pulseClass(document.querySelector(".iching-dock"), "is-settle-pulse", 650);
    window.setTimeout(() => {
      d.classList.remove("iching-page-enter", "iching-page-enter-ring");
    }, 520);
  }, 160);
};
