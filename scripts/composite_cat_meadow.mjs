import sharp from 'sharp';

const src = 'C:/Users/xtea/.gemini/antigravity/brain/ebc4a24f-c880-4f2d-b739-ffe98bbd4de6/.user_uploaded/media_1788072079659.png';

async function generate() {
  const image = sharp(src).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Flood fill from (0,0), (0, h-1), (w-1, 0), (w-1, h-1) to mark background
  const visited = new Uint8Array(w * h);
  const queue = [[0, 0], [0, 50], [0, 100], [10, 10], [50, 0], [100, 0], [w-1, 0]];

  // Mark seed points
  for (const [sx, sy] of queue) {
    visited[sy * w + sx] = 1;
  }

  let head = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    const idx = (y * w + x) * 4;
    
    // Check neighbors
    const neighbors = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const npos = ny * w + nx;
        if (!visited[npos]) {
          const nidx = npos * 4;
          const nr = data[nidx];
          const ng = data[nidx + 1];
          const nb = data[nidx + 2];

          // Is it ceiling / wall background?
          // Ceiling is very light (r > 190, g > 185, b > 180) or light warm gray
          const isLightCeiling = (nr > 180 && ng > 175 && nb > 170 && Math.abs(nr - ng) < 30 && Math.abs(ng - nb) < 30);
          const isWallEdge = (nx < 80 && ny < 130 && nr > 160 && ng > 155 && nb > 150);
          const isTopSky = (ny < 55 && (nx < 80 || nx > 140) && nr > 170);

          // Stop flood fill if we hit dark cat fur (r < 80, g < 80, b < 80) or yellow cushion
          const isDarkFur = (nr < 90 && ng < 90 && nb < 90);
          const isYellowCushion = (nr > 150 && ng > 130 && nb < 80);

          if ((isLightCeiling || isWallEdge || isTopSky) && !isDarkFur && !isYellowCushion) {
            visited[npos] = 1;
            queue.push([nx, ny]);
          }
        }
      }
    }
  }

  // Set alpha = 0 for all visited background pixels
  for (let i = 0; i < w * h; i++) {
    if (visited[i]) {
      data[i * 4 + 3] = 0;
    }
  }

  // Cutout cat image
  const cutoutCat = sharp(data, { raw: info });

  // Create SVG background with Sunny Blue Sky, Fluffy White Clouds, and Lush Green Grassland
  const meadowSkySvg = `
  <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="38%" stop-color="#bae6fd"/>
        <stop offset="50%" stop-color="#e0f2fe"/>
        <stop offset="52%" stop-color="#86efac"/>
        <stop offset="70%" stop-color="#22c55e"/>
        <stop offset="100%" stop-color="#15803d"/>
      </linearGradient>
      <radialGradient id="sunGlow" cx="15%" cy="15%" r="60%">
        <stop offset="0%" stop-color="#fffbeb" stop-opacity="1"/>
        <stop offset="40%" stop-color="#fef08a" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
      </radialGradient>
      <filter id="cloudShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0284c7" flood-opacity="0.2"/>
      </filter>
    </defs>

    <!-- Base Sky and Grassland -->
    <rect width="512" height="512" fill="url(#skyGrad)"/>
    
    <!-- Warm Sun Glow in upper left -->
    <circle cx="90" cy="80" r="140" fill="url(#sunGlow)"/>

    <!-- Fluffy Clouds (Layer 1) -->
    <g fill="#ffffff" filter="url(#cloudShadow)">
      <!-- Left Cloud -->
      <ellipse cx="120" cy="110" rx="60" ry="26" />
      <ellipse cx="100" cy="95" rx="35" ry="25" />
      <ellipse cx="145" cy="100" rx="38" ry="24" />

      <!-- Right Cloud -->
      <ellipse cx="380" cy="90" rx="75" ry="30" />
      <ellipse cx="355" cy="75" rx="42" ry="28" />
      <ellipse cx="410" cy="80" rx="45" ry="26" />

      <!-- Distant small cloud -->
      <ellipse cx="250" cy="140" rx="45" ry="18" opacity="0.9"/>
      <ellipse cx="235" cy="130" rx="28" ry="18" opacity="0.9"/>
    </g>

    <!-- Rolling Green Hill / Meadow curves -->
    <path d="M0 260 Q130 230 260 255 T512 245 L512 512 L0 512 Z" fill="#4ade80" opacity="0.8"/>
    <path d="M0 275 Q180 250 360 270 T512 260 L512 512 L0 512 Z" fill="#22c55e"/>
    <path d="M0 320 Q220 290 512 310 L512 512 L0 512 Z" fill="#16a34a"/>
  </svg>
  `;

  const bgBuf = await sharp(Buffer.from(meadowSkySvg)).resize(512, 512).png().toBuffer();
  const catBuf = await cutoutCat.resize(440, 440, { fit: 'contain' }).png().toBuffer();

  // Create Circular Mask
  const circleMask512 = Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="#fff"/></svg>');
  const circleMask128 = Buffer.from('<svg width="128" height="128"><circle cx="64" cy="64" r="64" fill="#fff"/></svg>');
  const circleMask48 = Buffer.from('<svg width="48" height="48"><circle cx="24" cy="24" r="24" fill="#fff"/></svg>');
  const circleMask16 = Buffer.from('<svg width="16" height="16"><circle cx="8" cy="8" r="8" fill="#fff"/></svg>');

  // Composite cat onto Blue Sky & Meadow background
  const final512 = await sharp(bgBuf)
    .composite([
      { input: catBuf, gravity: 'center', top: 50, left: 36 }
    ])
    .composite([{ input: circleMask512, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const dest128 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon128.png';
  const dest48 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon48.png';
  const dest16 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon16.png';

  await sharp(final512)
    .resize(128, 128)
    .composite([{ input: circleMask128, blend: 'dest-in' }])
    .png()
    .toFile(dest128);

  await sharp(final512)
    .resize(48, 48)
    .composite([{ input: circleMask48, blend: 'dest-in' }])
    .png()
    .toFile(dest48);

  await sharp(final512)
    .resize(16, 16)
    .composite([{ input: circleMask16, blend: 'dest-in' }])
    .png()
    .toFile(dest16);

  console.log('BLUE SKY + WHITE CLOUDS + MEADOW COW CAT ICONS GENERATED');
}

generate().catch(console.error);
