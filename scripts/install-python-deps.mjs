#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const platform = os.platform();
const arch = os.arch();
const target = `${platform}-${arch}`;

// Find uv binary: prefer bundled, fallback to system PATH
const bundledUv = path.join(ROOT_DIR, 'resources', 'bin', target, platform === 'win32' ? 'uv.exe' : 'uv');
let uvBin;

if (await fs.pathExists(bundledUv)) {
  uvBin = bundledUv;
  echo(chalk.blue`📦 Using bundled uv: ${uvBin}`);
} else {
  try {
    await $`which uv`;
    uvBin = 'uv';
    echo(chalk.blue`📦 Using system uv`);
  } catch {
    echo(chalk.red`❌ uv not found. Run "pnpm run uv:download" first.`);
    process.exit(1);
  }
}

// Install openpyxl for Python 3.12
echo(chalk.blue`\n📦 Installing Python dependencies...`);

try {
  // Ensure Python 3.12 is available (idempotent)
  await $`${uvBin} python install 3.12`;

  // Install openpyxl into the managed Python 3.12
  await $`${uvBin} pip install openpyxl --python 3.12 --system`;

  echo(chalk.green`✅ openpyxl installed successfully`);
} catch (err) {
  echo(chalk.red`❌ Failed to install Python dependencies: ${err.message}`);
  process.exit(1);
}

echo(chalk.green`\n🎉 Python dependencies installed!`);
