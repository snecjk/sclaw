#!/usr/bin/env zx

import 'zx/globals';
import sharp from 'sharp';
import png2icons from 'png2icons';
import { fileURLToPath } from 'url';

// Calculate paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(PROJECT_ROOT, 'resources', 'icons');
const SVG_SOURCE = path.join(ICONS_DIR, 'icon.svg');

echo`🎨 Generating StoClaw icons using Node.js...`;

// Check if SVG source exists
if (!fs.existsSync(SVG_SOURCE)) {
  echo`❌ SVG source not found: ${SVG_SOURCE}`;
  process.exit(1);
}

// Ensure icons directory exists
await fs.ensureDir(ICONS_DIR);

try {
  // Configurable sizes - adjust these values to change icon size
  const MASTER_SIZE = 1024; // Master buffer size
  const OUTPUT_SIZE = 1024; // Main icon.png output size (standard macOS icon size)
  const ICON_PADDING = 0; // Padding ratio (15% padding on each side = 70% icon content)
  const CORNER_RADIUS = 150; // Rounded corner radius (~20% of 512)

  // 1. Generate Master PNG Buffer
  echo`  Processing SVG source...`;
  let masterPngBuffer = await sharp(SVG_SOURCE)
    .resize(MASTER_SIZE, MASTER_SIZE)
    .png()
    .toBuffer();

  // 2. Add padding (shrink icon content to make room for padding)
  echo`  Adding padding...`;
  const contentSize = Math.floor(MASTER_SIZE * (1 - ICON_PADDING * 2));
  const paddedIcon = await sharp(masterPngBuffer)
    .resize(contentSize, contentSize)
    .toBuffer();
  
  // Create a new canvas with padding
  masterPngBuffer = await sharp({
    create: {
      width: MASTER_SIZE,
      height: MASTER_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{
      input: paddedIcon,
      top: Math.floor(MASTER_SIZE * ICON_PADDING),
      left: Math.floor(MASTER_SIZE * ICON_PADDING)
    }])
    .png()
    .toBuffer();

  // 3. Create rounded corner mask
  echo`  Adding rounded corners...`;
  const roundedRectSvg = `
    <svg width="${MASTER_SIZE}" height="${MASTER_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${MASTER_SIZE}" height="${MASTER_SIZE}" rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}" fill="white"/>
    </svg>
  `;
  
  // Apply the rounded corner mask to the icon
  const masterIconWithRoundedCorners = await sharp(masterPngBuffer)
    .composite([{
      input: Buffer.from(roundedRectSvg),
      blend: 'dest-in'
    }])
    .toBuffer();

  // 4. Save the main icon.png
  await sharp(masterIconWithRoundedCorners)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .toFile(path.join(ICONS_DIR, 'icon.png'));
  echo`  ✅ Created icon.png (${OUTPUT_SIZE}x${OUTPUT_SIZE}) with padding and rounded corners`;

  // 4. Generate Windows .ico
  echo`🪟 Generating Windows .ico...`;
  const icoBuffer = png2icons.createICO(masterIconWithRoundedCorners, png2icons.HERMITE, 0, false);
  
  if (icoBuffer) {
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), icoBuffer);
    echo`  ✅ Created icon.ico`;
  } else {
    echo(chalk.red`  ❌ Failed to create icon.ico`);
  }

  // 5. Generate macOS .icns
  echo`🍎 Generating macOS .icns...`;
  const icnsBuffer = png2icons.createICNS(masterIconWithRoundedCorners, png2icons.HERMITE, 0);
  
  if (icnsBuffer) {
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.icns'), icnsBuffer);
    echo`  ✅ Created icon.icns`;
  } else {
    echo(chalk.red`  ❌ Failed to create icon.icns`);
  }

  // 6. Generate Linux PNGs (various sizes)
  echo`🐧 Generating Linux PNG icons...`;
  const linuxSizes = [16, 32, 48, 64, 128, 256, 512];
  let generatedCount = 0;
  
  for (const size of linuxSizes) {
    await sharp(masterIconWithRoundedCorners)
      .resize(size, size)
      .toFile(path.join(ICONS_DIR, `${size}x${size}.png`));
    generatedCount++;
  }
  echo`  ✅ Created ${generatedCount} Linux PNG icons`;

  // 7. Generate macOS Tray Icon Template
  echo`📍 Generating macOS tray icon template...`;
  const TRAY_SVG_SOURCE = path.join(ICONS_DIR, 'tray-icon-template.svg');
  
  if (fs.existsSync(TRAY_SVG_SOURCE)) {
    await sharp(TRAY_SVG_SOURCE)
      .resize(22, 22)
      .png()
      .toFile(path.join(ICONS_DIR, 'tray-icon-Template.png'));
    echo`  ✅ Created tray-icon-Template.png (22x22)`;
  } else {
    echo`  ⚠️  tray-icon-template.svg not found, skipping tray icon generation`;
  }

  echo`\n✨ Icon generation complete! Files located in: ${ICONS_DIR}`;

} catch (error) {
  echo(chalk.red`\n Fatal Error: ${error.message}`);
  process.exit(1);
}

