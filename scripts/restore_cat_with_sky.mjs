import sharp from 'sharp';

const src = 'C:/Users/xtea/.gemini/antigravity/brain/ebc4a24f-c880-4f2d-b739-ffe98bbd4de6/.user_uploaded/media_1788072079659.png';

async function run() {
  const img = sharp(src).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Replace ONLY the top-left ceiling corner (where x < 68 and y < 85 and x*1.2 + y < 95) with transparent/sky
  // This leaves 100% of the cat's face, ears, whiskers, eyes, and paws completely intact!
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      
      // Top-left ceiling corner:
      // The cat top ear starts around x=70, y=55; left ear starts around x=45, y=110
      const isTopLeftCeiling = (x < 65 && y < 75 && (x * 1.3 + y < 85));
      const isExtremeTopCorner = (x < 30 && y < 100);

      if (isTopLeftCeiling || isExtremeTopCorner) {
        data[idx + 3] = 0; // Transparent for background to show
      }
    }
  }

  // Create Circular Mask
  const circleMask128 = Buffer.from('<svg width="128" height="128"><circle cx="64" cy="64" r="64" fill="#fff"/></svg>');
  const circleMask48 = Buffer.from('<svg width="48" height="48"><circle cx="24" cy="24" r="24" fill="#fff"/></svg>');
  const circleMask16 = Buffer.from('<svg width="16" height="16"><circle cx="8" cy="8" r="8" fill="#fff"/></svg>');

  const catCutout = sharp(data, { raw: info });

  // Render SVG with Sunny Blue Sky, Soft White Clouds and Vibrant Grass
  const bgSvg = `
  <svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="45%" stop-color="#bae6fd"/>
        <stop offset="58%" stop-color="#86efac"/>
        <stop offset="100%" stop-color="#22c55e"/>
      </linearGradient>
    </defs>
    <rect width="256" height="256" fill="url(#sky)"/>
    <!-- Cute Clouds in top left/right -->
    <ellipse cx="45" cy="40" rx="35" ry="16" fill="#ffffff" opacity="0.95"/>
    <ellipse cx="35" cy="32" rx="20" ry="14" fill="#ffffff" opacity="0.95"/>
    <ellipse cx="60" cy="35" rx="22" ry="13" fill="#ffffff" opacity="0.95"/>
    <ellipse cx="200" cy="35" rx="38" ry="16" fill="#ffffff" opacity="0.85"/>
  </svg>
  `;

  const bgBuf = await sharp(Buffer.from(bgSvg)).resize(224, 224).png().toBuffer();
  const catBuf = await catCutout.png().toBuffer();

  // Composite: Background Sky -> Cat Photo on Top
  const merged224 = await sharp(bgBuf)
    .composite([{ input: catBuf, top: 0, left: 0 }])
    .png()
    .toBuffer();

  const dest128 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon128.png';
  const dest48 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon48.png';
  const dest16 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon16.png';

  await sharp(merged224)
    .resize(128, 128, { fit: 'cover' })
    .sharpen({ sigma: 1.2 })
    .composite([{ input: circleMask128, blend: 'dest-in' }])
    .png()
    .toFile(dest128);

  await sharp(merged224)
    .resize(48, 48, { fit: 'cover' })
    .sharpen({ sigma: 1.5 })
    .composite([{ input: circleMask48, blend: 'dest-in' }])
    .png()
    .toFile(dest48);

  await sharp(merged224)
    .resize(16, 16, { fit: 'cover' })
    .sharpen({ sigma: 2.0 })
    .composite([{ input: circleMask16, blend: 'dest-in' }])
    .png()
    .toFile(dest16);

  console.log('PERFECT CAT RESTORED WITH SKY BACKGROUND');
}

run().catch(console.error);
