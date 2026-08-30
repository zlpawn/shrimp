import sharp from 'sharp';

const src = 'C:/Users/xtea/.gemini/antigravity/brain/ebc4a24f-c880-4f2d-b739-ffe98bbd4de6/.user_uploaded/media_1788072079659.png';
const dest128 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon128.png';
const dest48 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon48.png';
const dest16 = 'd:/agent-transfer/extensions/leo-cookie-txt-locally/icons/icon16.png';

async function run() {
  const circleSvg128 = Buffer.from('<svg width="128" height="128"><circle cx="64" cy="64" r="64" fill="#fff"/></svg>');
  const circleSvg48 = Buffer.from('<svg width="48" height="48"><circle cx="24" cy="24" r="24" fill="#fff"/></svg>');
  const circleSvg16 = Buffer.from('<svg width="16" height="16"><circle cx="8" cy="8" r="8" fill="#fff"/></svg>');

  await sharp(src)
    .resize(128, 128, { fit: 'cover', position: 'center' })
    .sharpen({ sigma: 1.2 })
    .modulate({ brightness: 1.05, saturation: 1.1 })
    .composite([{ input: circleSvg128, blend: 'dest-in' }])
    .png()
    .toFile(dest128);

  await sharp(src)
    .resize(48, 48, { fit: 'cover', position: 'center' })
    .sharpen({ sigma: 1.5 })
    .modulate({ brightness: 1.05, saturation: 1.1 })
    .composite([{ input: circleSvg48, blend: 'dest-in' }])
    .png()
    .toFile(dest48);

  await sharp(src)
    .resize(16, 16, { fit: 'cover', position: 'center' })
    .sharpen({ sigma: 2.0 })
    .modulate({ brightness: 1.1, saturation: 1.15 })
    .composite([{ input: circleSvg16, blend: 'dest-in' }])
    .png()
    .toFile(dest16);

  console.log('REF COW CAT ICONS GENERATED');
}

run().catch(console.error);
