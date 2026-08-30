import sharp from 'sharp';

const src = 'C:/Users/xtea/.gemini/antigravity/brain/ebc4a24f-c880-4f2d-b739-ffe98bbd4de6/.user_uploaded/media_1788072079659.png';

async function build() {
  // 1. High precision feathered vector mask to extract the entire cat & paws cleanly from the indoor room
  const catMaskSvg = `
  <svg width="224" height="224" viewBox="0 0 224 224" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="feather" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.2" />
      </filter>
    </defs>
    <!-- Smooth polygon closely hugging the cat's contour, ears, and paws -->
    <path d="
      M 75 52
      C 82 45, 96 48, 108 72
      C 122 62, 142 50, 178 52
      C 210 58, 222 90, 218 125
      C 220 148, 206 175, 188 182
      C 172 186, 160 210, 130 216
      C 100 220, 75 212, 62 186
      C 46 172, 30 148, 30 120
      C 28 92, 52 86, 68 76
      Z
    " fill="#ffffff" filter="url(#feather)"/>
  </svg>
  `;

  const maskBuf = Buffer.from(catMaskSvg);

  // 2. Cutout the cat with smooth feathered edges
  const catCutoutBuf = await sharp(src)
    .ensureAlpha()
    .composite([{ input: maskBuf, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 3. Render a stunning, high-contrast Sunny Blue Sky + Fluffy White Clouds + Rolling Green Hills Meadow Background
  const landscapeSvg = `
  <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Deep Sky Gradient -->
      <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0284c7"/>
        <stop offset="28%" stop-color="#38bdf8"/>
        <stop offset="55%" stop-color="#bae6fd"/>
        <stop offset="68%" stop-color="#e0f2fe"/>
      </linearGradient>

      <!-- Warm Sun Glow -->
      <radialGradient id="sun" cx="80%" cy="18%" r="45%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="35%" stop-color="#fef08a" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
      </radialGradient>

      <!-- Cloud Drop Shadows -->
      <filter id="cloudShdw" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#0369a1" flood-opacity="0.25"/>
      </filter>

      <!-- Rolling Grass Hills Gradients -->
      <linearGradient id="hill1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#86efac"/>
        <stop offset="100%" stop-color="#22c55e"/>
      </linearGradient>
      <linearGradient id="hill2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4ade80"/>
        <stop offset="100%" stop-color="#16a34a"/>
      </linearGradient>
      <linearGradient id="hill3" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#22c55e"/>
        <stop offset="100%" stop-color="#15803d"/>
      </linearGradient>
    </defs>

    <!-- 1. Deep Blue Sky -->
    <rect width="512" height="512" fill="url(#skyGrad)"/>

    <!-- 2. Radiant Sun Glow -->
    <circle cx="410" cy="90" r="130" fill="url(#sun)"/>

    <!-- 3. Big Fluffy White Clouds -->
    <g fill="#ffffff" filter="url(#cloudShdw)">
      <!-- Left Prominent Cloud -->
      <ellipse cx="110" cy="120" rx="75" ry="32"/>
      <ellipse cx="85" cy="100" rx="46" ry="30"/>
      <ellipse cx="140" cy="105" rx="50" ry="30"/>

      <!-- Right Soft Cloud -->
      <ellipse cx="390" cy="130" rx="85" ry="34"/>
      <ellipse cx="360" cy="115" rx="52" ry="32"/>
      <ellipse cx="425" cy="120" rx="55" ry="28"/>

      <!-- Central High Cloud -->
      <ellipse cx="250" cy="75" rx="60" ry="22" opacity="0.9"/>
      <ellipse cx="230" cy="65" rx="35" ry="20" opacity="0.9"/>
      <ellipse cx="275" cy="68" rx="38" ry="20" opacity="0.9"/>
    </g>

    <!-- 4. Lush Rolling Green Hills -->
    <!-- Back Hill -->
    <path d="M0 320 Q140 280 280 310 T512 295 L512 512 L0 512 Z" fill="url(#hill1)"/>
    <!-- Middle Hill -->
    <path d="M0 355 Q190 320 380 345 T512 335 L512 512 L0 512 Z" fill="url(#hill2)"/>
    <!-- Front Hill -->
    <path d="M0 395 Q240 360 512 385 L512 512 L0 512 Z" fill="url(#hill3)"/>
  </svg>
  `;

  const bgBuf = await sharp(Buffer.from(landscapeSvg)).resize(512, 512).png().toBuffer();
  
  // Resize Cat to comfortably sit on the landscape with blue sky & clouds clearly framing its head
  const catResizedBuf = await sharp(catCutoutBuf)
    .resize(410, 410, { fit: 'contain' })
    .sharpen({ sigma: 1.1 })
    .png()
    .toBuffer();

  const circleMask512 = Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="#fff"/></svg>');
  const circleMask128 = Buffer.from('<svg width="128" height="128"><circle cx="64" cy="64" r="64" fill="#fff"/></svg>');
  const circleMask48 = Buffer.from('<svg width="48" height="48"><circle cx="24" cy="24" r="24" fill="#fff"/></svg>');
  const circleMask16 = Buffer.from('<svg width="16" height="16"><circle cx="8" cy="8" r="8" fill="#fff"/></svg>');

  // 4. Composite: Background (Landscape) + Cat (Center-Bottom) + Circular Badge
  const finalComposite = await sharp(bgBuf)
    .composite([
      { input: catResizedBuf, left: 51, top: 75 }
    ])
    .composite([{ input: circleMask512, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const dest128 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon128.png';
  const dest48 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon48.png';
  const dest16 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon16.png';

  await sharp(finalComposite)
    .resize(128, 128)
    .composite([{ input: circleMask128, blend: 'dest-in' }])
    .png()
    .toFile(dest128);

  await sharp(finalComposite)
    .resize(48, 48)
    .composite([{ input: circleMask48, blend: 'dest-in' }])
    .png()
    .toFile(dest48);

  await sharp(finalComposite)
    .resize(16, 16)
    .composite([{ input: circleMask16, blend: 'dest-in' }])
    .png()
    .toFile(dest16);

  console.log('HIGH CONTRAST BLUE SKY + WHITE CLOUDS + ROLLING HILLS COW CAT ICONS GENERATED');
}

build().catch(console.error);
