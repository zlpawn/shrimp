import sharp from 'sharp';
import fs from 'node:fs';

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="earPink" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffafbd"/>
      <stop offset="100%" stop-color="#ff8da1"/>
    </radialGradient>
    <radialGradient id="mouthGrad" cx="50%" cy="60%" r="60%">
      <stop offset="0%" stop-color="#ff4b68"/>
      <stop offset="70%" stop-color="#d82346"/>
      <stop offset="100%" stop-color="#88001b"/>
    </radialGradient>
    <radialGradient id="tongueGrad" cx="50%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#ff8da1"/>
      <stop offset="100%" stop-color="#ff597b"/>
    </radialGradient>
    <linearGradient id="bodyShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#edf2f7"/>
    </linearGradient>
    <linearGradient id="blackFur" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3d4147"/>
      <stop offset="100%" stop-color="#181a1c"/>
    </linearGradient>
  </defs>

  <g transform="rotate(5, 256, 256)">
    <!-- Left Ear (Black with pink inside) -->
    <path d="M140 190 L90 70 Q145 65 210 120 Z" fill="url(#blackFur)" />
    <path d="M145 170 L108 90 Q145 88 185 125 Z" fill="url(#earPink)" />

    <!-- Right Ear (Black with pink inside) -->
    <path d="M350 110 Q420 55 440 60 L400 180 Z" fill="url(#blackFur)" />
    <path d="M370 120 Q410 80 422 85 L395 165 Z" fill="url(#earPink)" />

    <!-- White Body / Chest Base -->
    <ellipse cx="260" cy="380" rx="180" ry="120" fill="url(#bodyShade)" />

    <!-- Back / Left Black Patch on Body (Cow cat pattern) -->
    <path d="M85 360 Q70 440 180 480 Q100 420 120 330 Z" fill="url(#blackFur)" />
    <path d="M370 320 Q450 350 440 440 Q390 470 360 410 Z" fill="url(#blackFur)" />

    <!-- Head Base (White) -->
    <ellipse cx="265" cy="250" rx="165" ry="145" fill="url(#bodyShade)" />

    <!-- Cow Cat Black Mask (Left Head) -->
    <path d="M105 230 Q100 140 190 120 Q220 170 180 230 Q130 250 105 230 Z" fill="url(#blackFur)" />

    <!-- Cow Cat Black Mask (Right Head) -->
    <path d="M425 220 Q430 130 340 110 Q310 160 350 220 Q400 240 425 220 Z" fill="url(#blackFur)" />

    <!-- Cute Closed Sleepy Eyes (⌒ ⌒) -->
    <!-- Left Eye -->
    <path d="M175 225 Q205 200 235 225" fill="none" stroke="#181a1c" stroke-width="12" stroke-linecap="round" />
    <!-- Right Eye -->
    <path d="M305 220 Q335 195 365 220" fill="none" stroke="#181a1c" stroke-width="12" stroke-linecap="round" />

    <!-- Sweet Pink Cheeks -->
    <ellipse cx="165" cy="255" rx="25" ry="15" fill="#ff9eb5" opacity="0.6" />
    <ellipse cx="375" cy="250" rx="25" ry="15" fill="#ff9eb5" opacity="0.6" />

    <!-- Pink Nose -->
    <path d="M260 250 Q270 250 278 258 Q270 272 268 274 Q266 272 258 258 Z" fill="#ff7a95" />

    <!-- Yawning Mouth (Open Wide) -->
    <path d="M230 282 Q270 275 310 282 Q340 375 270 405 Q200 375 230 282 Z" fill="url(#mouthGrad)" />

    <!-- Little Teeth -->
    <!-- Top Left Fang -->
    <polygon points="238,284 246,298 254,285" fill="#ffffff" />
    <!-- Top Right Fang -->
    <polygon points="286,285 294,298 302,284" fill="#ffffff" />
    <!-- Bottom Tiny Teeth -->
    <polygon points="252,398 256,390 260,398" fill="#ffffff" />
    <polygon points="276,398 280,390 284,398" fill="#ffffff" />

    <!-- Pink Tongue -->
    <path d="M245 350 Q270 330 295 350 Q305 385 270 395 Q235 385 245 350 Z" fill="url(#tongueGrad)" />
    <line x1="270" y1="345" x2="270" y2="385" stroke="#e03e62" stroke-width="4" stroke-linecap="round" />

    <!-- Whiskers Left -->
    <path d="M180 270 Q110 260 50 255" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round" opacity="0.8" />
    <path d="M180 282 Q110 285 60 295" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round" opacity="0.8" />
    <path d="M185 295 Q120 315 80 340" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round" opacity="0.8" />

    <!-- Whiskers Right -->
    <path d="M355 265 Q425 255 485 250" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round" opacity="0.8" />
    <path d="M355 278 Q425 278 475 288" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round" opacity="0.8" />
    <path d="M350 290 Q415 310 455 335" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round" opacity="0.8" />

    <!-- Cute Front White Paws -->
    <ellipse cx="215" cy="445" rx="38" ry="28" fill="#ffffff" stroke="#cbd5e1" stroke-width="4" />
    <path d="M200 455 L200 435 M225 455 L225 435" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" />

    <ellipse cx="315" cy="445" rx="38" ry="28" fill="#ffffff" stroke="#cbd5e1" stroke-width="4" />
    <path d="M300 455 L300 435 M325 455 L325 435" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" />
  </g>
</svg>
`;

async function main() {
  const dest128 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon128.png';
  const dest48 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon48.png';
  const dest16 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon16.png';

  const buf = Buffer.from(svg);
  await sharp(buf).resize(128, 128).png().toFile(dest128);
  await sharp(buf).resize(48, 48).png().toFile(dest48);
  await sharp(buf).resize(16, 16).png().toFile(dest16);
  console.log('COW CAT ICONS GENERATED');
}

main().catch(console.error);
