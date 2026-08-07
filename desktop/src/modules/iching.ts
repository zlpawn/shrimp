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
const HUB_R = 56;
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
  const mainOp = hot ? 1 : 0.88;

  if (bit === 1) {
    // Yang / 九: solid bar. No round caps (they fake continuity across sectors).
    return (
      (hot
        ? `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="var(--iching-glow-soft)" stroke-width="${sw + 4}" stroke-linecap="butt" opacity="0.45"/>`
        : "") +
      `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt" opacity="${mainOp}"/>`
    );
  }

  // Yin / 六: two short bars with a large center gap that must stay visible.
  const gap = width * 0.4;
  const seg = (width - gap) / 2;
  return (
    (hot
      ? `<line x1="${x}" y1="${y}" x2="${x + seg}" y2="${y}" stroke="var(--iching-glow-soft)" stroke-width="${sw + 4}" stroke-linecap="butt" opacity="0.45"/>` +
        `<line x1="${x + seg + gap}" y1="${y}" x2="${x + width}" y2="${y}" stroke="var(--iching-glow-soft)" stroke-width="${sw + 4}" stroke-linecap="butt" opacity="0.45"/>`
      : "") +
    `<line x1="${x}" y1="${y}" x2="${x + seg}" y2="${y}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt" opacity="${mainOp}"/>` +
    `<line x1="${x + seg + gap}" y1="${y}" x2="${x + width}" y2="${y}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt" opacity="${mainOp}"/>`
  );
}

function trigramStamp(trigram: string, maxWidth: number, hot: boolean): string {
  const bits = TRIGRAM_BITS[trigram];
  if (!bits) return "";
  // Hard-cap width by sector chord so neighboring yao never fuse into rings.
  const w = Math.min(maxWidth * (hot ? 0.72 : 0.58), hot ? 24 : 18);
  const x = -w / 2;
  const gap = hot ? 9.2 : 7.8;
  const sw = hot ? 4.4 : 3.4;
  // Center the 3-line stack on the sector midpoint.
  const startY = -gap;
  return bits.map((b, i) => yaoLine(b, x, w, startY + i * gap, sw, hot)).join("");
}

/** Multi-char hexagram names stack vertically along the radial axis. */
function verticalLabel(name: string, x: number, y: number, angle: number, hot: boolean): string {
  const cls = hot ? "iching-label is-hot" : "iching-label";
  const chars = Array.from(name);
  const step = hot ? 20 : 12;
  const start = -((chars.length - 1) * step) / 2;
  let texts = "";
  for (let i = 0; i < chars.length; i++) {
    texts += `<text class="${cls}" x="0" y="${(start + i * step).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${chars[i]}</text>`;
  }
  // Local +Y is radial-out after parent placement rotate(angle).
  return `<g class="iching-label-group" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle})">${texts}</g>`;
}

// --- Disk construction ---

function buildBackground(): string {
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

/**
 * Build one self-rotating plate.
 * Marks are painted in plate-local space; the whole <g> rotates around (0,0).
 * That is the self-rotation: center fixed, plate spins in place.
 */
function buildPlate(isUpper: boolean): string {
  const rOuter = isUpper ? R_OUTER : R_INNER;
  const rInner = isUpper ? R_OUTER_INNER : R_INNER_INNER;
  const rotation = isUpper ? upperState.rotation : lowerState.rotation;
  const activeIdx = slotAtPointer(rotation);
  const midR = (rOuter + rInner) / 2;
  // Chord length of one 360/64 sector at mid radius. Yao must stay under this.
  const maxYaoW = 2 * midR * Math.sin((Math.PI / 180) * (SLOT / 2));

  // Plate body (rotates with content — solid disk face).
  let body =
    `<circle cx="0" cy="0" r="${midR}" fill="none" stroke="var(--iching-ring-bg)" stroke-width="${rOuter - rInner}"/>` +
    `<circle cx="0" cy="0" r="${rOuter}" fill="none" stroke="var(--iching-ring-border)" stroke-width="1.4"/>` +
    `<circle cx="0" cy="0" r="${rInner}" fill="none" stroke="var(--iching-ring-border)" stroke-width="1.4"/>`;

  // Quiet sector ticks.
  let ticks = "";
  for (let i = 0; i < N; i++) {
    const a = ((i * SLOT - SLOT / 2) - 90) * Math.PI / 180;
    const x1 = rInner * Math.cos(a);
    const y1 = rInner * Math.sin(a);
    const x2 = rOuter * Math.cos(a);
    const y2 = rOuter * Math.sin(a);
    ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="var(--iching-divider)" stroke-width="0.6"/>`;
  }

  let marks = "";
  for (let i = 0; i < N; i++) {
    const h = HEXAGRAMS[i];
    const trigram = isUpper ? h.upperTrigram : h.lowerTrigram;
    const angle = i * SLOT; // 0 = top when plate rotation is 0
    const rad = ((angle - 90) * Math.PI) / 180;
    const cx = midR * Math.cos(rad);
    const cy = midR * Math.sin(rad);
    const hot = i === activeIdx;

    // Stamp on plate: translate to sector, rotate so local +Y is radial-out.
    // Parent plate uses rotate(θ 0 0): true self-rotation around disk center.
    marks += `<g class="iching-slot${hot ? " is-hot" : ""}" transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${angle})">`;
    if (hot) {
      const bw = Math.min(maxYaoW * 0.9, 28);
      const bh = 32;
      marks += `<rect x="${(-bw / 2).toFixed(1)}" y="${(-bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="var(--iching-hot-fill)" stroke="var(--iching-glow)" stroke-width="1.3"/>`;
    }
    marks += trigramStamp(trigram, maxYaoW, hot);
    marks += `</g>`;

    if (isUpper) {
      const lx = LABEL_R * Math.cos(rad);
      const ly = LABEL_R * Math.sin(rad);
      // Two-char names stack vertically, fixed on the plate.
      marks += verticalLabel(h.name, lx, ly, angle, hot);
    }
  }

  // Explicit pivot (0,0): plate never translates, only spins in place.
  return (
    `<g class="iching-ring" data-ring="${isUpper ? "upper" : "lower"}" transform="${plateTransform(rotation)}">` +
    body + ticks + marks +
    `</g>`
  );
}

function buildHub(): string {
  const r = HUB_R;
  return `
  <g class="iching-taiji">
    <circle cx="0" cy="0" r="${r + 10}" fill="var(--iching-hub)" stroke="var(--iching-ring-border)" stroke-width="1.2"/>
    <circle cx="0" cy="0" r="${r}" fill="none" stroke="var(--iching-taiji-stroke)" stroke-width="2.2" filter="url(#iching-soft-glow)"/>
    <path d="M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} A ${r / 2} ${r / 2} 0 0 1 0 0 A ${r / 2} ${r / 2} 0 0 0 0 ${-r} Z"
      fill="none" stroke="var(--iching-taiji-stroke)" stroke-width="2.2" filter="url(#iching-soft-glow)"/>
    <circle cx="0" cy="${-r / 2}" r="4.5" fill="var(--iching-taiji-stroke)"/>
    <circle cx="0" cy="${r / 2}" r="4.5" fill="var(--iching-taiji-stroke)"/>
  </g>`;
}

function renderRingSVG(): string {
  // Order: bg (fixed) -> plates (self-spin around Taiji center) -> hub (fixed).
  // No external arrow: top reading is indicated by the hot-slot highlight.
  const content =
    buildBackground() +
    buildPlate(true) +
    buildPlate(false) +
    buildHub();
  const vb = -(R_OUTER + VIEW_PAD);
  const size = (R_OUTER + VIEW_PAD) * 2;
  return `<svg class="iching-ring-svg" viewBox="${vb} ${vb} ${size} ${size}" preserveAspectRatio="xMidYMid meet">${content}</svg>`;
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
  if (svgDist >= R_INNER_INNER - 18 && svgDist <= R_INNER + 10) return "lower";
  return null;
}

/**
 * Rebuild rotating plate markup so active-slot highlight tracks the pointer.
 * Still cheap: pure string + one innerHTML on the two plate groups' parent SVG.
 */
function paintPlates(svg: SVGSVGElement) {
  const upper = svg.querySelector<SVGGElement>('.iching-ring[data-ring="upper"]');
  const lower = svg.querySelector<SVGGElement>('.iching-ring[data-ring="lower"]');
  // Replace whole plates to refresh hot stamps. Keep hub/pointer untouched.
  const tmp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  tmp.innerHTML = buildPlate(true) + buildPlate(false);
  const newUpper = tmp.querySelector<SVGGElement>('.iching-ring[data-ring="upper"]');
  const newLower = tmp.querySelector<SVGGElement>('.iching-ring[data-ring="lower"]');
  if (upper && newUpper) upper.replaceWith(newUpper);
  if (lower && newLower) lower.replaceWith(newLower);
}

function updateTransformsOnly() {
  const u = document.querySelector<SVGGElement>('.iching-ring[data-ring="upper"]');
  const l = document.querySelector<SVGGElement>('.iching-ring[data-ring="lower"]');
  if (u) u.setAttribute("transform", plateTransform(upperState.rotation));
  if (l) l.setAttribute("transform", plateTransform(lowerState.rotation));
}

function updateDisplay() {
  const current = currentHexagram();
  const name = document.getElementById("iching-current-name");
  const sub = document.getElementById("iching-current-sub");
  if (name) name.textContent = current ? formatDockTitle(current) : "\u7EC4\u5408\u65E0\u6548";
  if (sub) sub.textContent = current ? formatDockSub(current) : "";
}

let lastPaintSlotU = -1;
let lastPaintSlotL = -1;

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

function setupDrag(container: HTMLElement) {
  const svg = container.querySelector<SVGSVGElement>(".iching-ring-svg");
  if (!svg) return;
  let activeState: RingState | null = null;

  svg.addEventListener("pointerdown", (evt) => {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = evt.clientX - cx;
    const dy = evt.clientY - cy;
    // Use unscaled geometry for hit-testing: getBoundingClientRect already includes CSS scale.
    const scale = ((R_OUTER + VIEW_PAD) * 2) / Math.max(rect.width, 1);
    const svgDist = Math.sqrt(dx * dx + dy * dy) * scale;

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

    if (dragKind === "upper") {
      upperState.dragging = false;
      lowerState.dragging = false;
      upperState.velocity *= 1.12;
      lowerState.velocity *= 1.12;
    } else {
      activeState.dragging = false;
      activeState.velocity *= 1.12;
    }

    activeState = null;
    dragKind = null;
    activePointerId = null;
    try { svg.releasePointerCapture(evt.pointerId); } catch { /* */ }
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
  const startU = shortestDelta(0, upperState.rotation);
  const startL = shortestDelta(0, lowerState.rotation);
  upperState.rotation = startU;
  lowerState.rotation = startL;
  upperState.animating = true;
  lowerState.animating = true;
  upperState.velocity = 0;
  lowerState.velocity = 0;

  const dur = 720;
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
          <h2>${h.symbol} ${h.name}</h2>
          <p class="iching-detail-meta">\u7B2C${h.number}\u5366 \u00B7 ${h.upperTrigram}\u4E0A${h.lowerTrigram}\u4E0B</p>
        </div>
      </div>

      <div class="iching-detail-section">
        <h3>\u5366\u8F9E</h3>
        <p class="iching-classic-text">${h.judgment}</p>
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
  dragKind = null;
  activePointerId = null;
  if (zoomRAF !== null) { cancelAnimationFrame(zoomRAF); zoomRAF = null; }
  viewScale = 1;
  targetScale = 1;
  lastPaintSlotU = -1;
  lastPaintSlotL = -1;

  const current = currentHexagram();

  detail.innerHTML = `
    <button class="tools-detail-back" onclick="backToToolsCards()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      \u8FD4\u56DE\u5DE5\u5177\u5217\u8868
    </button>

    <div class="iching-main">
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
  applyViewScale(true);
  // Ensure hot slot paint matches initial state.
  refreshVisual(true);
}

// --- Global handlers ---

(window as any).ichingReset = function (): void {
  animateReset();
};

(window as any).ichingViewDetail = function (): void {
  const current = currentHexagram();
  if (!current) return;
  const detail = document.getElementById("tools-detail");
  if (!detail) return;
  stopInertia();
  detail.innerHTML = renderDetail(current);
  document.querySelector(".content-area")?.scrollTo({ top: 0, behavior: "smooth" });
};

(window as any).ichingBackToRing = function (): void {
  renderIchingDetail();
};
