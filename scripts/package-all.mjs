#!/usr/bin/env zx

import 'zx/globals';
import { mkdir, writeFile, rm, access, readdir, stat as fsStat } from 'fs/promises';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const RELEASE_BASE = path.join(ROOT, 'release');

// Check if this is a test build
const isTest = process.argv.includes('--test') || process.env.BUILD_ENV === 'test';
const BUILD_SUFFIX = isTest ? '.test' : '';

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function getNextBatchDir() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yyyymmdd = `${yyyy}${mm}${dd}`;

  const entries = await readdir(RELEASE_BASE).catch(() => []);
  let maxBatch = 0;
  for (const entry of entries) {
    const entryPath = path.join(RELEASE_BASE, entry);
    const st = await fsStat(entryPath).catch(() => null);
    if (st?.isDirectory() && new RegExp(`^${yyyymmdd}\\d{3}(${BUILD_SUFFIX.replace('.', '\\.')})?$`).test(entry)) {
      const batchNum = parseInt(entry.slice(8, 11), 10);
      maxBatch = Math.max(maxBatch, batchNum);
    }
  }

  const batch = String(maxBatch + 1).padStart(3, '0');
  const dirName = `${yyyymmdd}${batch}${BUILD_SUFFIX}`;
  const dateBatch = `${yyyymmdd}.${batch}${BUILD_SUFFIX}`;
  const targetDir = path.join(RELEASE_BASE, dirName);
  await ensureDir(targetDir);

  return { yyyymmdd, batch, dateBatch, targetDir };
}

async function main() {
  const { yyyymmdd, batch, dateBatch, targetDir } = await getNextBatchDir();

  echo(chalk.blue('\n📦 Package All — Date: ' + yyyymmdd + ', Batch: ' + batch));
  echo(chalk.gray('   Output: ' + targetDir + '\n'));

  // 1. Download all bundled binaries (uv + node for every platform/arch)
  echo(chalk.blue('🔧 Downloading bundled binaries for all platforms...'));
  await $`pnpm run uv:download:all`;
  await $`pnpm run prep:win-binaries`;

  // 2. Build frontend & bundles (once)
  echo(chalk.blue('\n🏗️  Building frontend & bundles...'));
  const packageScript = isTest ? 'package:test' : 'package';
  await $`pnpm run ${packageScript}`;

  // 3. Create dynamic builder config
  const dynamicConfigPath = path.join(ROOT, 'electron-builder.package-all.js');
  const dynamicConfig = "const base = require('./electron-builder.config.js');\n" +
    "module.exports = {\n" +
    "  ...base,\n" +
    "  directories: {\n" +
    "    ...base.directories,\n" +
    "    output: " + JSON.stringify(targetDir) + ",\n" +
    "  },\n" +
    "  artifactName: base.artifactName.replace('-${os}-${arch}.', '-" + dateBatch + "-${os}-${arch}.'),\n" +
    "};\n";
  await writeFile(dynamicConfigPath, dynamicConfig, 'utf8');

  try {
    // 4. Package macOS
    echo(chalk.blue('\n🍎 Packaging macOS...'));
    await $`electron-builder --mac --publish never --config ${dynamicConfigPath}`;

    // 5. Package Windows
    echo(chalk.blue('\n🪟 Packaging Windows...'));
    await $`electron-builder --win --publish never --config ${dynamicConfigPath}`;

    // 6. Cleanup temp directories
    const tempDirs = ['mac', 'mac-arm64', 'win-unpacked', 'win-arm64-unpacked'];
    for (const dir of tempDirs) {
      const dirPath = path.join(targetDir, dir);
      if (await pathExists(dirPath)) {
        await rm(dirPath, { recursive: true, force: true });
      }
    }

    // Cleanup debug files
    const debugFiles = ['builder-debug.yml', 'builder-effective-config.yaml'];
    for (const file of debugFiles) {
      const filePath = path.join(targetDir, file);
      if (await pathExists(filePath)) {
        await rm(filePath, { force: true });
      }
    }

    // List final artifacts
    const artifacts = await readdir(targetDir);
    echo(chalk.green('\n✅ Package All Complete!'));
    echo(chalk.green('   Output: ' + targetDir));
    echo(chalk.gray('\n📂 Artifacts (' + artifacts.length + '):'));
    for (const f of artifacts.sort()) {
      const st = await fsStat(path.join(targetDir, f));
      const size = st.isFile() ? '(' + (st.size / 1024 / 1024).toFixed(1) + ' MB)' : '(dir)';
      echo(chalk.gray('   • ' + f + ' ' + size));
    }
  } finally {
    if (await pathExists(dynamicConfigPath)) {
      await rm(dynamicConfigPath, { force: true });
    }
  }
}

await main();
