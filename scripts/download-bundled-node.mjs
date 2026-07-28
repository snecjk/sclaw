#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_VERSION = '22.16.0';
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const CACHE_DIR = path.join(ROOT_DIR, '.download-cache');
const CACHE_MANIFEST = path.join(CACHE_DIR, 'node-manifest.json');

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

const TARGETS = {
  'win32-x64': {
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-x64`,
  },
  'win32-arm64': {
    filename: `node-v${NODE_VERSION}-win-arm64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-arm64`,
  },
};

const PLATFORM_GROUPS = {
  win: ['win32-x64'],
};

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_node_extract');
  const cacheKey = `${NODE_VERSION}_${target.filename}`;
  const cachedArchive = path.join(CACHE_DIR, cacheKey);
  const downloadUrl = `${BASE_URL}/${target.filename}`;
  const outputNode = path.join(targetDir, 'node.exe');

  echo(chalk.blue`\n📦 Setting up Node.js for ${id}...`);

  // Check if binary already exists and is valid
  const cacheManifest = await loadCacheManifest();
  
  if (await fs.pathExists(outputNode)) {
    // Verify cached archive exists and binary is from this version
    if (cacheManifest[cacheKey] && await fs.pathExists(cachedArchive)) {
      echo(chalk.green`   ✅ Using existing binary (cached)`);
      return;
    }
  }

  // Cleanup & Prep
  if (await fs.pathExists(outputNode)) {
    await fs.remove(outputNode);
  }
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
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      await fs.writeFile(archivePath, Buffer.from(buffer));
      
      // Save to cache
      await fs.copyFile(archivePath, cachedArchive);
      cacheManifest[cacheKey] = {
        version: NODE_VERSION,
        filename: target.filename,
        downloadedAt: new Date().toISOString(),
      };
      await saveCacheManifest(cacheManifest);
    }

    echo`📂 Extracting...`;
    if (os.platform() === 'win32') {
      const { execFileSync } = await import('child_process');
      const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit', windowsHide: true });
    } else {
      await $`unzip -q -o ${archivePath} -d ${tempDir}`;
    }

    const expectedNode = path.join(tempDir, target.sourceDir, 'node.exe');
    if (await fs.pathExists(expectedNode)) {
      await fs.move(expectedNode, outputNode, { overwrite: true });
    } else {
      echo(chalk.yellow`🔍 node.exe not found in expected directory, searching...`);
      const files = await glob('**/node.exe', { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await fs.move(files[0], outputNode, { overwrite: true });
      } else {
        throw new Error('Could not find node.exe in extracted files.');
      }
    }

    echo(chalk.green`✅ Success: ${outputNode}`);
  } finally {
    await fs.remove(tempDir);
    if (needsCleanup) {
      await fs.remove(path.join(ROOT_DIR, target.filename));
    }
  }
}

const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading Node.js binaries for all Windows targets...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  echo(chalk.cyan`🎯 Downloading Node.js binaries for platform: ${platform}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  if (TARGETS[currentId]) {
    echo(chalk.cyan`💻 Detected Windows system: ${currentId}`);
    await setupTarget(currentId);
  } else {
    echo(chalk.cyan`🎯 Defaulting to Windows multi-arch Node.js download`);
    for (const id of PLATFORM_GROUPS.win) {
      await setupTarget(id);
    }
  }
}

echo(chalk.green`\n🎉 Done!`);
