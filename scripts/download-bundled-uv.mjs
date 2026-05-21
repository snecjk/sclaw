#!/usr/bin/env zx

import 'zx/globals';
import { createHash } from 'node:crypto';

const ROOT_DIR = path.resolve(__dirname, '..');
const UV_VERSION = '0.10.0';
const BASE_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const CACHE_DIR = path.join(ROOT_DIR, '.download-cache');
const CACHE_MANIFEST = path.join(CACHE_DIR, 'uv-manifest.json');

// Ensure cache directory exists
await fs.ensureDir(CACHE_DIR);

// Load or initialize cache manifest
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
  await fs.writeJson(CACHE_MANIFEST, manifest, { spaces: 2 });
}

// Calculate file hash for cache validation
async function calculateHash(filePath) {
  const hash = createHash('sha256');
  const content = await fs.readFile(filePath);
  hash.update(content);
  return hash.digest('hex');
}

// Mapping Node platforms/archs to uv release naming
const TARGETS = {
  'darwin-arm64': {
    filename: 'uv-aarch64-apple-darwin.tar.gz',
    binName: 'uv',
  },
  'darwin-x64': {
    filename: 'uv-x86_64-apple-darwin.tar.gz',
    binName: 'uv',
  },
  'win32-arm64': {
    filename: 'uv-aarch64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  },
  'win32-x64': {
    filename: 'uv-x86_64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  },
  'linux-arm64': {
    filename: 'uv-aarch64-unknown-linux-gnu.tar.gz',
    binName: 'uv',
  },
  'linux-x64': {
    filename: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    binName: 'uv',
  }
};

// Platform groups for building multi-arch packages
const PLATFORM_GROUPS = {
  'mac': ['darwin-x64', 'darwin-arm64'],
  'win': ['win32-x64', 'win32-arm64'],
  'linux': ['linux-x64', 'linux-arm64']
};

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_uv_extract');
  const cacheKey = `${UV_VERSION}_${target.filename}`;
  const cachedArchive = path.join(CACHE_DIR, `${cacheKey}`);
  const downloadUrl = `${BASE_URL}/${target.filename}`;

  echo(chalk.blue`\n📦 Setting up uv for ${id}...`);

  // Check if binary already exists and is valid
  const destBin = path.join(targetDir, target.binName);
  const cacheManifest = await loadCacheManifest();
  
  if (await fs.pathExists(destBin)) {
    // Verify cached archive exists and binary is from this version
    if (cacheManifest[cacheKey] && await fs.pathExists(cachedArchive)) {
      echo(chalk.green`   ✅ Using existing binary (cached)`);
      return;
    }
  }

  // Cleanup & Prep
  await fs.remove(targetDir);
  await fs.remove(tempDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);

  let archivePath;
  let needsCleanup = false;

  try {
    // Check if we have a valid cached archive
    if (cacheManifest[cacheKey] && await fs.pathExists(cachedArchive)) {
      echo`   📦 Using cached archive`;
      archivePath = cachedArchive;
    } else {
      // Download
      archivePath = path.join(ROOT_DIR, target.filename);
      needsCleanup = true;
      echo`⬇️ Downloading: ${downloadUrl}`;
      const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      await fs.writeFile(archivePath, Buffer.from(buffer));
      
      // Save to cache
      await fs.copyFile(archivePath, cachedArchive);
      cacheManifest[cacheKey] = {
        version: UV_VERSION,
        filename: target.filename,
        downloadedAt: new Date().toISOString(),
      };
      await saveCacheManifest(cacheManifest);
    }

    // Extract
    echo`📂 Extracting...`;
    if (target.filename.endsWith('.zip')) {
      if (os.platform() === 'win32') {
        const { execFileSync } = await import('child_process');
        const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
        execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
      } else {
        await $`unzip -q -o ${archivePath} -d ${tempDir}`;
      }
    } else {
      await $`tar -xzf ${archivePath} -C ${tempDir}`;
    }

    // Move binary
    // uv archives usually contain a folder named after the target
    const folderName = target.filename.replace('.tar.gz', '').replace('.zip', '');
    const sourceBin = path.join(tempDir, folderName, target.binName);

    if (await fs.pathExists(sourceBin)) {
      await fs.move(sourceBin, destBin, { overwrite: true });
    } else {
      echo(chalk.yellow`🔍 Binary not found in expected subfolder, searching...`);
      const files = await glob(`**/${target.binName}`, { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await fs.move(files[0], destBin, { overwrite: true });
      } else {
        throw new Error(`Could not find ${target.binName} in extracted files.`);
      }
    }

    // Permission fix
    if (os.platform() !== 'win32') {
      await fs.chmod(destBin, 0o755);
    }

    echo(chalk.green`✅ Success: ${destBin}`);
  } finally {
    // Cleanup temp files
    await fs.remove(tempDir);
    if (needsCleanup) {
      await fs.remove(path.join(ROOT_DIR, target.filename));
    }
  }
}

// Main logic
const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  // Download for all platforms
  echo(chalk.cyan`🌐 Downloading uv binaries for ALL supported platforms...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  // Download for a specific platform (e.g., --platform=mac)
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  
  echo(chalk.cyan`🎯 Downloading uv binaries for platform: ${platform}`);
  echo(`   Architectures: ${targets.join(', ')}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  // Download for current system only (default for local dev)
  const currentId = `${os.platform()}-${os.arch()}`;
  echo(chalk.cyan`💻 Detected system: ${currentId}`);
  
  if (TARGETS[currentId]) {
    await setupTarget(currentId);
  } else {
    echo(chalk.red`❌ Current system ${currentId} is not in the supported download list.`);
    echo(`Supported targets: ${Object.keys(TARGETS).join(', ')}`);
    echo(`\nTip: Use --platform=<platform> to download for a specific platform`);
    echo(`     Use --all to download for all platforms`);
    process.exit(1);
  }
}

echo(chalk.green`\n🎉 Done!`);
