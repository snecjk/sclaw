#!/usr/bin/env zx

/**
 * Prepare SAI CLI binaries for bundling into the StoClaw app.
 *
 * Copies pre-downloaded binaries from the local SAI/ directory
 * (pulled from internal GitLab) into resources/bin/<platform>/
 * so electron-builder can pack them alongside uv.
 *
 * OSS download logic is commented out and reserved for future use.
 *
 * Usage:
 *   pnpm run sai-cli:download              # current platform only
 *   pnpm run sai-cli:download:mac          # macOS (both archs)
 *   pnpm run sai-cli:download:win          # Windows (both archs)
 *   pnpm run sai-cli:download:linux        # Linux (both archs)
 *   pnpm run sai-cli:download:all          # all platforms
 */

import 'zx/globals';
import { createHash } from 'node:crypto';

const ROOT_DIR = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT_DIR, 'SAI');
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const CACHE_DIR = path.join(ROOT_DIR, '.download-cache');
const CACHE_MANIFEST = path.join(CACHE_DIR, 'sai-cli-manifest.json');

// ── Local source → electron-builder target mapping ──────────────────────────
//
// Local files from GitLab:
//   SAI/mac-amd64/sai-cli
//   SAI/mac-arm64/sai-cli
//   SAI/linux-amd64/sai-cli
//   SAI/linux-arm64/sai-cli
//   SAI/win-amd64/sai-cli.exe
//   SAI/win-arm64/sai-cli.exe
//
// electron-builder packs:
//   resources/bin/darwin-x64/sai
//   resources/bin/darwin-arm64/sai
//   resources/bin/linux-x64/sai
//   resources/bin/linux-arm64/sai
//   resources/bin/win32-x64/sai.exe
//   resources/bin/win32-arm64/sai.exe

const TARGETS = {
  'darwin-arm64': {
    sourceSubdir: 'mac-arm64',
    sourceName: 'sai-cli',
    destName: 'sai',
  },
  'darwin-x64': {
    sourceSubdir: 'mac-amd64',
    sourceName: 'sai-cli',
    destName: 'sai',
  },
  'win32-x64': {
    sourceSubdir: 'win-amd64',
    sourceName: 'sai-cli.exe',
    destName: 'sai.exe',
  },
  'win32-arm64': {
    sourceSubdir: 'win-arm64',
    sourceName: 'sai-cli.exe',
    destName: 'sai.exe',
  },
  'linux-x64': {
    sourceSubdir: 'linux-amd64',
    sourceName: 'sai-cli',
    destName: 'sai',
  },
  'linux-arm64': {
    sourceSubdir: 'linux-arm64',
    sourceName: 'sai-cli',
    destName: 'sai',
  },
};

const PLATFORM_GROUPS = {
  mac: ['darwin-x64', 'darwin-arm64'],
  win: ['win32-x64', 'win32-arm64'],
  linux: ['linux-x64', 'linux-arm64'],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadCacheManifest() {
  if (await fs.pathExists(CACHE_MANIFEST)) {
    try {
      return await fs.readJson(CACHE_MANIFEST);
    } catch {
      return {};
    }
  }
  return {};
}

async function saveCacheManifest(manifest) {
  await fs.ensureDir(CACHE_DIR);
  await fs.writeJson(CACHE_MANIFEST, manifest, { spaces: 2 });
}

async function calculateHash(filePath) {
  const hash = createHash('sha256');
  const content = await fs.readFile(filePath);
  hash.update(content);
  return hash.digest('hex');
}

// ── OSS download (reserved for future use) ──────────────────────────────────
//
// const SAI_CLI_VERSION = process.env.SAI_CLI_VERSION || 'latest';
// const SAI_CLI_DOWNLOAD_BASE_URL = process.env.SAI_CLI_DOWNLOAD_BASE_URL || '';
//
// function resolveDownloadUrl(targetId) {
//   const base = SAI_CLI_DOWNLOAD_BASE_URL.replace(/\/$/, '');
//   return `${base}/${SAI_CLI_VERSION}/${targetId}/${TARGETS[targetId].destName}`;
// }

// ── Per-target setup (local copy) ───────────────────────────────────────────

async function setupTarget(targetId) {
  const target = TARGETS[targetId];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${targetId} is not supported.`);
    return;
  }

  const sourceDir = path.join(SOURCE_DIR, target.sourceSubdir);
  const sourceBin = path.join(sourceDir, target.sourceName);
  const targetDir = path.join(OUTPUT_BASE, targetId);
  const destBin = path.join(targetDir, target.destName);
  const cacheKey = `sai-cli_local_${targetId}`;

  // Skip if already up-to-date
  const cacheManifest = await loadCacheManifest();
  if (await fs.pathExists(destBin) && await fs.pathExists(sourceBin)) {
    if (cacheManifest[cacheKey]) {
      const sourceHash = await calculateHash(sourceBin);
      if (sourceHash === cacheManifest[cacheKey].hash) {
        echo(chalk.green`   ✅ ${targetId}: up-to-date (${target.destName})`);
        return;
      }
    }
  }

  if (!(await fs.pathExists(sourceBin))) {
    echo(chalk.yellow`   ⚠️ ${targetId}: source not found — ${sourceBin}`);
    return;
  }

  await fs.ensureDir(targetDir);

  // Copy from local SAI/ directory
  echo(chalk.blue`📦 ${targetId}: copying ${path.relative(ROOT_DIR, sourceBin)} → ${path.relative(ROOT_DIR, destBin)}`);
  await fs.copyFile(sourceBin, destBin);

  // Fix permissions (non-Windows)
  if (os.platform() !== 'win32') {
    await fs.chmod(destBin, 0o755);
  }

  // Cache hash
  const sourceHash = await calculateHash(sourceBin);
  cacheManifest[cacheKey] = {
    source: target.sourceSubdir,
    hash: sourceHash,
    copiedAt: new Date().toISOString(),
  };
  await saveCacheManifest(cacheManifest);

  const stats = await fs.stat(destBin);
  echo(chalk.green`   ✅ ${targetId}: saved ${target.destName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

// ── Main ────────────────────────────────────────────────────────────────────

const downloadAll = argv.all;
const platform = argv.platform;

await fs.ensureDir(CACHE_DIR);

if (downloadAll) {
  echo(chalk.cyan`🌐 Copying SAI CLI binaries for ALL platforms...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  echo(chalk.cyan`🎯 Copying SAI CLI for platform: ${platform}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  echo(chalk.cyan`💻 Detected system: ${currentId}`);
  if (TARGETS[currentId]) {
    await setupTarget(currentId);
  } else {
    echo(chalk.red`❌ System ${currentId} not in supported targets.`);
    echo(`Supported: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
}

echo(chalk.green`\n🎉 SAI CLI prepare complete.`);
