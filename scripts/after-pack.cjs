/**
 * after-pack.cjs
 *
 * electron-builder afterPack hook.
 *
 * Problem: electron-builder respects .gitignore when copying extraResources.
 * Since .gitignore contains "node_modules/", the openclaw bundle's
 * node_modules directory is silently skipped during the extraResources copy.
 *
 * Solution: This hook runs AFTER electron-builder finishes packing. It manually
 * copies build/openclaw/node_modules/ into the output resources directory,
 * bypassing electron-builder's glob filtering entirely.
 *
 * Additionally it performs two rounds of cleanup:
 *   1. General cleanup — removes dev artifacts (type defs, source maps, docs,
 *      test dirs) from both the openclaw root and its node_modules.
 *   2. Platform-specific cleanup — strips native binaries for non-target
 *      platforms (koffi multi-platform prebuilds, @napi-rs/canvas, @img/sharp,
 *      @mariozechner/clipboard).
 */

const { cpSync, existsSync, readdirSync, rmSync, statSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, createWriteStream, symlinkSync } = require('fs');
const { execSync } = require('child_process');
const { join, dirname, basename } = require('path');
const { tmpdir } = require('os');
const { createPackageWithOptions } = require('@electron/asar');
const zlib = require('zlib');
const tar = require('tar');

// On Windows, paths in pnpm's virtual store can exceed the default MAX_PATH
// limit (260 chars). Node.js 18.17+ respects the system LongPathsEnabled
// registry key, but as a safety net we normalize paths to use the \\?\ prefix
// on Windows, which bypasses the limit unconditionally.
// Native modules and prebuilt binaries must stay outside the ASAR archive.
//
// IMPORTANT: must use createPackageWithOptions (not createPackage) — the latter
// ignores the unpack option entirely.
//
// Match PLATFORM_NATIVE_SCOPES below plus generic binary extensions. Entire
// package directories must unpack (not only *.node) so sibling .dylib/.dll load
// via @loader_path (e.g. sharp + libvips).
const OPENCLAW_ASAR_UNPACK = `{${[
  '**/*.node',
  '**/*.dylib',
  '**/*.so',
  '**/*.dll',
  '**/sharp/**',
  '**/koffi/**',
  '**/@img/**',
  '**/@napi-rs/**',
  '**/@mariozechner/**',
  '**/@lydell/**',
  '**/@reflink/**',
  '**/sqlite-vec-*/**',
].join(',')}}`;

function countFilesRecursive(dir) {
  let count = 0;
  if (!existsSync(dir)) return 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(fullPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

async function packDirectoryToAsar(sourceDir, asarPath, label) {
  if (!existsSync(sourceDir)) {
    console.warn(`[after-pack] ⚠️  Skipping ${label} ASAR pack — source missing: ${sourceDir}`);
    return false;
  }

  const fileCount = countFilesRecursive(sourceDir);
  const unpackedPath = `${asarPath}.unpacked`;
  if (existsSync(asarPath)) rmSync(asarPath, { force: true });
  if (existsSync(unpackedPath)) rmSync(unpackedPath, { recursive: true, force: true });

  
  await createPackageWithOptions(sourceDir, asarPath, { unpack: OPENCLAW_ASAR_UNPACK });
  validateAsarNativeUnpack(asarPath, label);
  rmSync(sourceDir, { recursive: true, force: true });
  
  return true;
}

function getClaudeBinaryFileName(platform) {
  return platform === 'win32' ? 'claude.exe' : 'claude';
}

function getClaudeOptionalPackageName(platform, arch) {
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
}

function readClaudeSdkVersion(projectNodeModules) {
  const sdkPkgPath = join(projectNodeModules, '@anthropic-ai', 'claude-agent-sdk', 'package.json');
  if (!existsSync(sdkPkgPath)) {
    throw new Error('[after-pack] Cannot resolve claude-agent-sdk version — package.json missing');
  }
  const version = JSON.parse(readFileSync(sdkPkgPath, 'utf8')).version;
  if (!version) {
    throw new Error('[after-pack] Cannot resolve claude-agent-sdk version — version field missing');
  }
  return version;
}

function installClaudeSdkPackageViaPack(spec, destFolder) {
  const tmpPackDir = mkdtempSync(join(tmpdir(), 'claude-sdk-pack-'));
  try {
    const output = execSync(`npm pack "${spec}" --pack-destination "${tmpPackDir}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const tgzName = output.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!tgzName) {
      throw new Error(`[after-pack] npm pack produced no tarball for ${spec}`);
    }
    const tgzPath = join(tmpPackDir, basename(tgzName));
    mkdirSync(destFolder, { recursive: true });
    // Use Node.js tar module instead of shell tar for Windows compatibility
    tar.extract({
      file: tgzPath,
      cwd: destFolder,
      strip: 1,
      sync: true,
    });
  } finally {
    rmSync(tmpPackDir, { recursive: true, force: true });
  }
}

/**
 * Cross-compile: fetch target claude-agent-sdk via npm pack (same pattern as sharp).
 * Mac dev machines no longer need ~450MB of win32 SDK packages in node_modules.
 */
function ensureTargetClaudeSdkPackage(resourcesDir, platform, arch) {
  const projectNodeModules = join(__dirname, '..', 'node_modules');
  const version = readClaudeSdkVersion(projectNodeModules);
  const packageName = getClaudeOptionalPackageName(platform, arch);
  const binaryName = getClaudeBinaryFileName(platform);
  const destDir = join(resourcesDir, 'app.asar.unpacked', 'node_modules', ...packageName.split('/'));
  const binaryPath = join(destDir, binaryName);

  if (existsSync(binaryPath)) return;

  installClaudeSdkPackageViaPack(`${packageName}@${version}`, destDir);
}

function cleanupClaudeSdkPackages(resourcesDir, platform, arch) {
  const anthropicDir = join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@anthropic-ai');
  if (!existsSync(anthropicDir)) return 0;

  const keepPackage = `claude-agent-sdk-${platform}-${arch}`;
  let removed = 0;
  for (const entry of readdirSync(anthropicDir)) {
    if (!entry.startsWith('claude-agent-sdk-') || entry === keepPackage) continue;
    try {
      rmSync(join(anthropicDir, entry), { recursive: true, force: true });
      removed++;
    } catch { /* */ }
  }
  return removed;
}

function validateBundledClaudeSdk(resourcesDir, platform, arch) {
  const packageName = getClaudeOptionalPackageName(platform, arch);
  const binaryName = getClaudeBinaryFileName(platform);
  const unpackedRoot = join(resourcesDir, 'app.asar.unpacked');
  const candidate = join(unpackedRoot, 'node_modules', ...packageName.split('/'), binaryName);

  if (!existsSync(candidate)) {
    throw new Error(
      `[after-pack] Claude SDK validation failed — missing unpacked binary for ${platform}/${arch}: ${candidate}\n`
      + `Ensure electron-builder asarUnpack includes node_modules/@anthropic-ai/claude-agent-sdk-*/** `
      + `and ensureTargetClaudeSdkPackage can fetch the target platform package.`,
    );
  }

  
}

function resolveRuntimePackageSource(projectNodeModules, resolvedSources, entry) {
  if (entry.resolveFromPackageName) {
    const parentSource = resolvedSources.get(entry.resolveFromPackageName);
    if (parentSource) {
      const parentRealPath = realpathSync(parentSource);
      const nestedSource = join(dirname(parentRealPath), ...entry.packageName.split('/'));
      if (existsSync(nestedSource)) {
        return realpathSync(nestedSource);
      }
    }
  }

  const rootSource = join(projectNodeModules, ...entry.packageName.split('/'));
  if (existsSync(rootSource)) {
    return realpathSync(rootSource);
  }

  throw new Error(`[after-pack] Required app runtime package missing in source node_modules: ${rootSource}`);
}

function ensureAppRuntimePackages(resourcesDir, packageEntries) {
  const projectNodeModules = join(__dirname, '..', 'node_modules');
  const packagedNodeModules = join(resourcesDir, 'node_modules');
  const resolvedSources = new Map();
  mkdirSync(packagedNodeModules, { recursive: true });

  for (const entry of packageEntries) {
    const normalizedEntry = typeof entry === 'string' ? { packageName: entry } : entry;
    const { packageName } = normalizedEntry;
    const src = resolveRuntimePackageSource(projectNodeModules, resolvedSources, normalizedEntry);
    const dest = join(packagedNodeModules, ...packageName.split('/'));
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, dereference: true });
    resolvedSources.set(packageName, src);
    
  }
}

/** Fail the build if native modules were not extracted to {asar}.unpacked. */
function validateAsarNativeUnpack(asarPath, label) {
  const unpackedRoot = `${asarPath}.unpacked`;

  // Plugin mirrors are mostly TS/JS; native deps are deduped against openclaw
  // runtime and resolved via NODE_PATH. No .unpacked dir is expected when there
  // are no matching binary files.
  if (label !== 'OpenClaw runtime') {
    if (existsSync(unpackedRoot)) {
      const unpackedCount = countFilesRecursive(unpackedRoot);
      
    } else {
      
    }
    return;
  }

  if (!existsSync(unpackedRoot)) {
    throw new Error(
      `[after-pack] ${label} ASAR unpack failed: ${unpackedRoot} does not exist. `
      + 'Native modules (sharp/libvips, koffi, canvas, …) will not load at runtime. '
      + 'Use createPackageWithOptions with OPENCLAW_ASAR_UNPACK.',
    );
  }

  const unpackedCount = countFilesRecursive(unpackedRoot);
  if (unpackedCount === 0) {
    throw new Error(`[after-pack] ${label} ASAR unpack failed: ${unpackedRoot} is empty`);
  }

  // OpenClaw runtime: sharp/libvips is required for multimodal image processing.
  if (label === 'OpenClaw runtime') {
    const imgScope = join(unpackedRoot, 'node_modules', '@img');
    if (!existsSync(imgScope)) {
      throw new Error(
        `[after-pack] ${label} ASAR unpack failed: node_modules/@img missing from ${unpackedRoot}`,
      );
    }
    const libvipsDir = readdirSync(imgScope).find((name) => name.startsWith('sharp-libvips-'));
    if (!libvipsDir) {
      throw new Error(
        `[after-pack] ${label} ASAR unpack failed: sharp-libvips-* missing from ${imgScope}`,
      );
    }
    const nativeLibDir = join(imgScope, libvipsDir, 'lib');
    const nativeLibs = existsSync(nativeLibDir)
      ? readdirSync(nativeLibDir).filter((f) => /\.(dylib|so|dll)$/i.test(f))
      : [];
    if (nativeLibs.length === 0) {
      throw new Error(
        `[after-pack] ${label} ASAR unpack failed: no libvips binary in ${nativeLibDir}`,
      );
    }
  }

  
}

function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

// ── Arch helpers ─────────────────────────────────────────────────────────────
// electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
const ARCH_MAP = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function resolveArch(archEnum) {
  return ARCH_MAP[archEnum] || 'x64';
}

// ── General cleanup ──────────────────────────────────────────────────────────
// Only remove dev-only dirs/files at npm *package roots* (sibling of package.json).
// Never delete nested dirs like yaml/dist/doc or zod/v4/locales — those are runtime code.

function normalizePathForCompare(filePath) {
  return filePath.replace(/\\/g, '/');
}

function isInsideNodeModules(filePath) {
  return normalizePathForCompare(filePath).includes('/node_modules/');
}

/** True when `dirPath` is a direct child of an npm package (parent has package.json). */
function isNpmPackageRootChild(dirPath) {
  return existsSync(join(dirname(dirPath), 'package.json'));
}

/**
 * OpenClaw runtime resolves workspace bootstrap files from
 * docs/reference/templates/ (AGENTS.md, SOUL.md, etc.). The rest of docs/ is
 * dev documentation and safe to drop from the packaged runtime.
 */
function pruneOpenclawRuntimeDocs(docsDir) {
  const templatesDir = join(docsDir, 'reference', 'templates');
  if (!existsSync(templatesDir)) return false;

  const parentDir = dirname(docsDir);
  const stagingDir = join(parentDir, '.docs-templates-staging');
  try {
    rmSync(stagingDir, { recursive: true, force: true });
    cpSync(templatesDir, stagingDir, { recursive: true });
    rmSync(docsDir, { recursive: true, force: true });
    mkdirSync(join(docsDir, 'reference'), { recursive: true });
    cpSync(stagingDir, templatesDir, { recursive: true });
    return true;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function cleanupUnnecessaryFiles(dir) {
  let removedCount = 0;

  // Do NOT include bare `doc` — packages like `yaml` ship runtime code under dist/doc/.
  const REMOVE_PACKAGE_ROOT_DIRS = new Set([
    'test', 'tests', '__tests__', '.github', 'examples', 'example',
    'docs', 'website', 'benchmark', 'benchmarks', 'coverage', '.nyc_output', 'man',
  ]);
  const REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown', '.flow'];
  const REMOVE_FILE_NAMES = new Set([
    '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    'History.md', 'HISTORY.md', 'AUTHORS', 'NOTICE', 'License',
    'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
  ]);
  const ENGLISH_LOCALE_RE = /^(en|en[-_].*)\.(json|js|yaml|yml)$/i;
  const I18N_LOCALE_RESOURCE_RE = /\.(json|yaml|yml)$/i;

  function isEnglishLocaleFile(name) {
    return ENGLISH_LOCALE_RE.test(name);
  }

  function isI18nLocaleResourceFile(name) {
    return I18N_LOCALE_RESOURCE_RE.test(name);
  }

  function walk(currentDir) {
    let entries;
    try { entries = readdirSync(currentDir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'docs' && !isInsideNodeModules(fullPath)) {
          // Keep docs/reference/templates for OpenClaw workspace bootstrap; drop the rest.
          try {
            if (pruneOpenclawRuntimeDocs(fullPath)) removedCount++;
          } catch { /* */ }
          continue;
        }
        if (
          REMOVE_PACKAGE_ROOT_DIRS.has(entry.name)
          && (!isInsideNodeModules(fullPath) || isNpmPackageRootChild(fullPath))
        ) {
          try { rmSync(fullPath, { recursive: true, force: true }); removedCount++; } catch { /* */ }
          continue;
        }
        if (
          (entry.name === 'locale' || entry.name === 'locales')
          && isNpmPackageRootChild(fullPath)
        ) {
          // Package-root i18n only (e.g. moment). Skip zod/dist/... nested locale code trees.
          try {
            for (const localeFile of readdirSync(fullPath)) {
              if (isI18nLocaleResourceFile(localeFile) && !isEnglishLocaleFile(localeFile)) {
                try { rmSync(join(fullPath, localeFile), { force: true }); removedCount++; } catch { /* */ }
              }
            }
          } catch { /* */ }
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        const name = entry.name;
        if (REMOVE_FILE_NAMES.has(name) || name === 'LICENSE' || REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
          try { rmSync(fullPath, { force: true }); removedCount++; } catch { /* */ }
        }
      }
    }
  }

  walk(dir);
  return removedCount;
}

/** Fail the build early if cleanup removed runtime-critical openclaw paths. */
// ── Unindexed bundled extensions removal ─────────────────────────────────────
// OpenClaw ships a precompiled BUNDLED_PLUGIN_METADATA index (in
// dist/manifest-registry-*.js). Extensions listed there skip on-disk manifest
// reads entirely. Extensions NOT in the index go through loadPluginManifest's
// fd-identity check (lstat vs fstat dev/ino), which can NEVER pass inside an
// ASAR archive: Electron extracts asar entries to temp files on open(), so the
// identities never match. Shipping unindexed extensions inside openclaw.asar
// makes the Gateway exit with "Config invalid: unsafe plugin manifest path".

function readBundledPluginIndexDirNames(openclawRoot) {
  const distDir = join(openclawRoot, 'dist');
  if (!existsSync(distDir)) return null;
  const registryFile = readdirSync(distDir).find(
    (name) => name.startsWith('manifest-registry-') && name.endsWith('.js'),
  );
  if (!registryFile) return null;
  const source = readFileSync(join(distDir, registryFile), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/dirName:\s*"([^"]+)"/g)) {
    names.add(match[1]);
  }
  return names.size > 0 ? names : null;
}

function removeUnindexedBundledExtensions(openclawRoot) {
  const extensionsDir = join(openclawRoot, 'dist', 'extensions');
  if (!existsSync(extensionsDir)) return;

  const indexed = readBundledPluginIndexDirNames(openclawRoot);
  if (!indexed) {
    throw new Error(
      '[after-pack] Could not read BUNDLED_PLUGIN_METADATA index from openclaw dist — '
      + 'refusing to pack dist/extensions into ASAR (unindexed extensions would crash the Gateway).',
    );
  }

  const removed = [];
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (indexed.has(entry.name)) continue;
    rmSync(join(extensionsDir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  if (removed.length > 0) {
    
  }
}

function validateOpenclawBundleBeforeAsar(openclawRoot) {
  const requiredPaths = [
    'openclaw.mjs',
    'package.json',
    join('docs', 'reference', 'templates', 'AGENTS.md'),
    join('node_modules', 'yaml', 'dist', 'doc', 'directives.js'),
    join('node_modules', 'yaml', 'dist', 'compose', 'composer.js'),
    join('node_modules', 'zod', 'v4', 'locales', 'index.js'),
    join('node_modules', 'zod', 'v4', 'core', 'index.js'),
  ];

  const missing = requiredPaths.filter((rel) => !existsSync(join(openclawRoot, rel)));
  if (missing.length > 0) {
    throw new Error(
      `[after-pack] OpenClaw bundle validation failed — missing runtime files:\n`
      + missing.map((p) => `  - ${p}`).join('\n'),
    );
  }

  // Every remaining dist/extensions dir MUST be covered by the precompiled
  // plugin index, otherwise the Gateway fails config validation inside ASAR.
  const extensionsDir = join(openclawRoot, 'dist', 'extensions');
  if (existsSync(extensionsDir)) {
    const indexed = readBundledPluginIndexDirNames(openclawRoot) ?? new Set();
    const unindexed = readdirSync(extensionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !indexed.has(entry.name))
      .map((entry) => entry.name);
    if (unindexed.length > 0) {
      throw new Error(
        `[after-pack] OpenClaw bundle validation failed — unindexed extensions would crash the Gateway inside ASAR:\n`
        + unindexed.map((p) => `  - dist/extensions/${p}`).join('\n'),
      );
    }
  }
}

// ── Plugin node_modules dedupe against openclaw runtime ─────────────────────
// Bundled plugins copy transitive deps into their own node_modules. Packages
// with the same name+version as openclaw's runtime are removed; Gateway resolves
// them via NODE_PATH (see getOpenClawNodeModulesPath in electron/utils/paths.ts).

function readPackageVersion(pkgDir) {
  try {
    const raw = readFileSync(join(pkgDir, 'package.json'), 'utf8');
    return JSON.parse(raw).version ?? null;
  } catch {
    return null;
  }
}

function buildOpenclawPackageIndex(openclawNodeModulesDir) {
  const index = new Map();
  if (!existsSync(openclawNodeModulesDir)) return index;

  for (const entry of readdirSync(openclawNodeModulesDir)) {
    if (entry === '.bin') continue;
    const fullPath = join(openclawNodeModulesDir, entry);
    if (entry.startsWith('@')) {
      let subs;
      try { subs = readdirSync(fullPath); } catch { continue; }
      for (const sub of subs) {
        index.set(`${entry}/${sub}`, readPackageVersion(join(fullPath, sub)));
      }
    } else {
      index.set(entry, readPackageVersion(fullPath));
    }
  }
  return index;
}

function removeEmptyPluginNodeModules(pluginNodeModulesDir) {
  if (!existsSync(pluginNodeModulesDir)) return;
  let entries;
  try { entries = readdirSync(pluginNodeModulesDir); } catch { return; }
  if (entries.length === 0 || (entries.length === 1 && entries[0] === '.bin')) {
    rmSync(pluginNodeModulesDir, { recursive: true, force: true });
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith('@')) continue;
    const scopeDir = join(pluginNodeModulesDir, entry);
    try {
      if (readdirSync(scopeDir).length === 0) {
        rmSync(scopeDir, { recursive: true, force: true });
      }
    } catch { /* */ }
  }
}

function dedupePluginNodeModules(pluginDir, openclawPackageIndex) {
  const pluginNodeModulesDir = join(pluginDir, 'node_modules');
  if (!existsSync(pluginNodeModulesDir) || openclawPackageIndex.size === 0) return 0;

  let removed = 0;
  for (const entry of readdirSync(pluginNodeModulesDir)) {
    if (entry === '.bin') continue;
    const fullPath = join(pluginNodeModulesDir, entry);
    if (entry.startsWith('@')) {
      let subs;
      try { subs = readdirSync(fullPath); } catch { continue; }
      for (const sub of subs) {
        const pkgName = `${entry}/${sub}`;
        const runtimeVersion = openclawPackageIndex.get(pkgName);
        if (runtimeVersion == null) continue;
        const pluginVersion = readPackageVersion(join(fullPath, sub));
        if (pluginVersion === runtimeVersion) {
          try {
            rmSync(join(fullPath, sub), { recursive: true, force: true });
            removed++;
          } catch { /* */ }
        }
      }
      try {
        if (existsSync(fullPath) && readdirSync(fullPath).length === 0) {
          rmSync(fullPath, { recursive: true, force: true });
        }
      } catch { /* */ }
    } else {
      const runtimeVersion = openclawPackageIndex.get(entry);
      if (runtimeVersion == null) continue;
      const pluginVersion = readPackageVersion(fullPath);
      if (pluginVersion === runtimeVersion) {
        try {
          rmSync(fullPath, { recursive: true, force: true });
          removed++;
        } catch { /* */ }
      }
    }
  }

  removeEmptyPluginNodeModules(pluginNodeModulesDir);
  return removed;
}

function sharpPkgVersion(sharpPkg, packageName) {
  return sharpPkg.optionalDependencies?.[packageName]
    ?? sharpPkg.devDependencies?.[packageName];
}

/**
 * Cross-compile: fetch target @img/sharp + libvips before cleanup strips host packages.
 * npm install rejects foreign os/cpu (EBADPLATFORM); npm pack + extract works on any host.
 */
function installSharpPackageViaPack(spec, destFolder) {
  const tmpPackDir = mkdtempSync(join(tmpdir(), 'sharp-pack-'));
  try {
    const output = execSync(`npm pack "${spec}" --pack-destination "${tmpPackDir}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const tgzName = output.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!tgzName) {
      throw new Error(`[after-pack] npm pack produced no tarball for ${spec}`);
    }
    const tgzPath = join(tmpPackDir, basename(tgzName));
    mkdirSync(destFolder, { recursive: true });
    // Use Node.js tar module instead of shell tar for Windows compatibility
    tar.extract({
      file: tgzPath,
      cwd: destFolder,
      strip: 1,
      sync: true,
    });
  } finally {
    rmSync(tmpPackDir, { recursive: true, force: true });
  }
}

function ensureTargetSharpPackages(nodeModulesDir, platform, arch) {
  const sharpPkgPath = join(nodeModulesDir, 'sharp', 'package.json');
  if (!existsSync(sharpPkgPath)) return;

  const sharpPkg = JSON.parse(readFileSync(sharpPkgPath, 'utf8'));
  const imgDir = join(nodeModulesDir, '@img');
  const platformToken = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';
  const packageNames = [
    `@img/sharp-${platformToken}-${arch}`,
    `@img/sharp-libvips-${platformToken}-${arch}`,
  ];

  const missing = packageNames.filter((name) => {
    const folder = name.slice('@img/'.length);
    return !existsSync(join(imgDir, folder));
  });
  if (missing.length === 0) return;

  mkdirSync(imgDir, { recursive: true });
  const specs = missing.map((name) => {
    const version = sharpPkgVersion(sharpPkg, name);
    if (!version) {
      throw new Error(`[after-pack] Cannot resolve version for ${name} from sharp/package.json`);
    }
    return `${name}@${version}`;
  });
  
  for (const spec of specs) {
    const folder = spec.slice('@img/'.length).replace(/@[^@]+$/, '');
    installSharpPackageViaPack(spec, join(imgDir, folder));
  }
}

// ── Claude Agent SDK cross-compile ────────────────────────────────────────────
// When cross-compiling (e.g. building win32 on macOS), the target platform's
// optional dependency (@anthropic-ai/claude-agent-sdk-win32-x64) is not installed
// by pnpm/npm because its os/cpu constraints don't match the host. We fetch it
// via npm pack + tar extract (same pattern as installSharpPackageViaPack) and
// inject it into both the source node_modules (for future builds) and the
// resources output directory (for the current build's app.asar.unpacked).

function installClaudeSdkPackageViaPack(spec, destFolder) {
  const tmpPackDir = mkdtempSync(join(tmpdir(), 'claude-sdk-pack-'));
  try {
    const output = execSync(`npm pack "${spec}" --pack-destination "${tmpPackDir}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const tgzName = output.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!tgzName) {
      throw new Error(`[after-pack] npm pack produced no tarball for ${spec}`);
    }
    const tgzPath = join(tmpPackDir, basename(tgzName));
    mkdirSync(destFolder, { recursive: true });
    // Use Node.js tar module instead of shell tar for Windows compatibility
    tar.extract({
      file: tgzPath,
      cwd: destFolder,
      strip: 1,
      sync: true,
    });
  } finally {
    rmSync(tmpPackDir, { recursive: true, force: true });
  }
}

function ensureTargetClaudeSdkPackage(resourcesDir, platform, arch) {
  const packageName = getClaudeOptionalPackageName(platform, arch);
  const binaryName = getClaudeBinaryFileName(platform);
  const projectNodeModules = join(__dirname, '..', 'node_modules');
  const sourcePackageDir = join(projectNodeModules, ...packageName.split('/'));
  const unpackedRoot = join(resourcesDir, 'app.asar.unpacked');

  // Check if the binary already exists in the unpacked output (asar extracted it).
  const unpackedCandidate = join(unpackedRoot, 'node_modules', ...packageName.split('/'), binaryName);
  if (existsSync(unpackedCandidate)) {
    console.log(`[after-pack] ✅ Claude SDK binary already in app.asar.unpacked: ${unpackedCandidate}`);
    return;
  }

  console.log(`[after-pack] Claude SDK binary missing for ${platform}/${arch} — cross-compiling from ${process.platform}/${process.arch}`);

  // Determine the version from the main SDK package's optionalDependencies.
  const sdkPkgPath = join(projectNodeModules, '@anthropic-ai', 'claude-agent-sdk', 'package.json');
  let version;
  if (existsSync(sdkPkgPath)) {
    const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, 'utf8'));
    version = sdkPkg.optionalDependencies?.[packageName];
  }
  if (!version) {
    throw new Error(`[after-pack] Cannot resolve version for ${packageName} from @anthropic-ai/claude-agent-sdk/package.json`);
  }

  // Download the package via npm pack + tar extract into source node_modules
  // (persists for future builds so electron-builder can include it in the asar).
  if (!existsSync(sourcePackageDir)) {
    const spec = `${packageName}@${version}`;
    console.log(`[after-pack] Fetching Claude SDK package: ${spec}`);
    const scopeDir = join(projectNodeModules, '@anthropic-ai');
    mkdirSync(scopeDir, { recursive: true });
    const folder = packageName.split('/').pop(); // e.g. "claude-agent-sdk-win32-x64"
    installClaudeSdkPackageViaPack(spec, join(scopeDir, folder));
    console.log(`[after-pack] ✅ Claude SDK package installed to source node_modules: ${sourcePackageDir}`);
  }

  // For the current build: electron-builder already created the asar without this
  // package, so we must manually inject it into app.asar.unpacked where
  // getBundledClaudeExecutablePath() (in claude-adapter.ts) resolves the binary.
  const unpackedPkgDir = join(unpackedRoot, 'node_modules', '@anthropic-ai', packageName.split('/').pop());
  mkdirSync(unpackedPkgDir, { recursive: true });
  cpSync(sourcePackageDir, unpackedPkgDir, { recursive: true, dereference: true });
  console.log(`[after-pack] ✅ Claude SDK injected into app.asar.unpacked: ${unpackedPkgDir}`);
}

// ── Platform-specific: koffi ─────────────────────────────────────────────────
// koffi ships 18 platform pre-builds under koffi/build/koffi/{platform}_{arch}/.
// We only need the one matching the target.

function cleanupKoffi(nodeModulesDir, platform, arch) {
  const koffiDir = join(nodeModulesDir, 'koffi', 'build', 'koffi');
  if (!existsSync(koffiDir)) return 0;

  const keepTarget = `${platform}_${arch}`;
  let removed = 0;
  for (const entry of readdirSync(koffiDir)) {
    if (entry !== keepTarget) {
      try { rmSync(join(koffiDir, entry), { recursive: true, force: true }); removed++; } catch { /* */ }
    }
  }
  return removed;
}

// ── Platform-specific: scoped native packages ────────────────────────────────
// Packages like @napi-rs/canvas-darwin-arm64, @img/sharp-linux-x64, etc.
// Only the variant matching the target platform should survive.
//
// Some packages use non-standard platform names:
//   - @node-llama-cpp: "mac" instead of "darwin", "win" instead of "win32"
//   - sqlite-vec: "windows" instead of "win32" (unscoped, handled separately)
// We normalise them before comparison.

const PLATFORM_ALIASES = {
  darwin: 'darwin', mac: 'darwin',
  linux: 'linux', linuxmusl: 'linux',
  win32: 'win32', win: 'win32', windows: 'win32',
};

// Each regex MUST have capture group 1 = platform name and group 2 = arch name.
// Compound arch suffixes (e.g. "x64-msvc", "arm64-gnu", "arm64-metal") are OK —
// we strip the suffix after the first dash to get the base arch.
const PLATFORM_NATIVE_SCOPES = {
  '@napi-rs': /^canvas-(darwin|linux|win32)-(x64|arm64)/,
  '@img': /^sharp(?:-libvips)?-(darwin|linux(?:musl)?|win32)-(x64|arm64|arm|ppc64|riscv64|s390x)/,
  '@mariozechner': /^clipboard-(darwin|linux|win32)-(x64|arm64|universal)/,
  '@snazzah': /^davey-(darwin|linux|android|freebsd|win32|wasm32)-(x64|arm64|arm|ia32|arm64-gnu|arm64-musl|x64-gnu|x64-musl|x64-msvc|arm64-msvc|ia32-msvc|arm-eabi|arm-gnueabihf|wasi)/,
  '@lydell': /^node-pty-(darwin|linux|win32)-(x64|arm64)/,
  '@reflink': /^reflink-(darwin|linux|win32)-(x64|arm64|x64-gnu|x64-musl|arm64-gnu|arm64-musl|x64-msvc|arm64-msvc)/,
  '@node-llama-cpp': /^(mac|linux|win)-(arm64|x64|armv7l)(-metal|-cuda|-cuda-ext|-vulkan)?$/,
  '@esbuild': /^(darwin|linux|win32|android|freebsd|netbsd|openbsd|sunos|aix|openharmony)-(x64|arm64|arm|ia32|loong64|mips64el|ppc64|riscv64|s390x)/,
};

// Unscoped packages that follow a <name>-<platform>-<arch> convention.
// Each entry: { prefix, pattern } where pattern captures (platform, arch).
const UNSCOPED_NATIVE_PACKAGES = [
  // sqlite-vec uses "windows" instead of "win32"
  { prefix: 'sqlite-vec-', pattern: /^sqlite-vec-(darwin|linux|windows)-(x64|arm64)$/ },
];

/**
 * Normalise the base arch from a potentially compound value.
 * e.g. "x64-msvc" → "x64", "arm64-gnu" → "arm64", "arm64-metal" → "arm64"
 */
function baseArch(rawArch) {
  const dash = rawArch.indexOf('-');
  return dash > 0 ? rawArch.slice(0, dash) : rawArch;
}

function cleanupNativePlatformPackages(nodeModulesDir, platform, arch) {
  let removed = 0;

  // 1. Scoped packages (e.g. @snazzah/davey-darwin-arm64)
  for (const [scope, pattern] of Object.entries(PLATFORM_NATIVE_SCOPES)) {
    const scopeDir = join(nodeModulesDir, scope);
    if (!existsSync(scopeDir)) continue;

    for (const entry of readdirSync(scopeDir)) {
      const match = entry.match(pattern);
      if (!match) continue; // not a platform-specific package, leave it

      const pkgPlatform = PLATFORM_ALIASES[match[1]] || match[1];
      const pkgArch = baseArch(match[2]);

      const isMatch =
        pkgPlatform === platform &&
        (pkgArch === arch || pkgArch === 'universal');

      if (!isMatch) {
        try {
          rmSync(join(scopeDir, entry), { recursive: true, force: true });
          removed++;
        } catch { /* */ }
      }
    }
  }

  // 2. Unscoped packages (e.g. sqlite-vec-darwin-arm64)
  for (const { pattern } of UNSCOPED_NATIVE_PACKAGES) {
    let entries;
    try { entries = readdirSync(nodeModulesDir); } catch { continue; }

    for (const entry of entries) {
      const match = entry.match(pattern);
      if (!match) continue;

      const pkgPlatform = PLATFORM_ALIASES[match[1]] || match[1];
      const pkgArch = baseArch(match[2]);

      const isMatch =
        pkgPlatform === platform &&
        (pkgArch === arch || pkgArch === 'universal');

      if (!isMatch) {
        try {
          rmSync(join(nodeModulesDir, entry), { recursive: true, force: true });
          removed++;
        } catch { /* */ }
      }
    }
  }

  return removed;
}

// ── Broken module patcher ─────────────────────────────────────────────────────
// Some bundled packages have transpiled CJS that sets `module.exports = exports.default`
// without ever assigning `exports.default`, leaving module.exports === undefined.
// This causes `TypeError: Cannot convert undefined or null to object` in Node.js 22+
// ESM interop (translators.js hasOwnProperty call).  We patch these after copying.

const MODULE_PATCHES = {
  // node-domexception@1.0.0: index.js sets module.exports = undefined.
  // Node.js 18+ ships DOMException as a built-in; this shim re-exports it.
  'node-domexception/index.js': [
    "'use strict';",
    '// Shim: original transpiled file sets module.exports = exports.default (undefined).',
    '// Node.js 18+ has DOMException as a built-in global.',
    'const dom = globalThis.DOMException ||',
    '  class DOMException extends Error {',
    "    constructor(msg, name) { super(msg); this.name = name || 'Error'; }",
    '  };',
    'module.exports = dom;',
    'module.exports.DOMException = dom;',
    'module.exports.default = dom;',
  ].join('\n') + '\n',
};

function patchBrokenModules(nodeModulesDir) {
  const { writeFileSync, readFileSync } = require('fs');
  let count = 0;
  for (const [rel, content] of Object.entries(MODULE_PATCHES)) {
    const target = join(nodeModulesDir, rel);
    if (existsSync(target)) {
      writeFileSync(target, content, 'utf8');
      count++;
    }
  }

  // lru-cache v7: only exports the class as `module.exports = LRUCache` (default).
  // Newer packages like hosted-git-info@9 use `const { LRUCache } = require('lru-cache')`
  // expecting a named export from lru-cache v11+.  Since bundle-openclaw.mjs BFS
  // deduplication keeps the first version encountered (v7), we add a named export
  // shim so both import styles work.
  const lruIndexPath = join(nodeModulesDir, 'lru-cache', 'index.js');
  if (existsSync(lruIndexPath)) {
    try {
      const lruContent = readFileSync(lruIndexPath, 'utf8');
      if (!lruContent.includes('module.exports.LRUCache')) {
        writeFileSync(
          lruIndexPath,
          lruContent + '\n// Shim: expose named export for lru-cache v11+ consumers\nmodule.exports.LRUCache = module.exports;\n',
          'utf8'
        );
        count++;
        
      }
    } catch (err) {
      console.warn('[after-pack] ⚠️  Failed to patch lru-cache:', err.message);
    }
  }

  // https-proxy-agent: add a CJS `require` condition only when we can point to
  // a real CommonJS entry. Mapping `require` to an ESM file can cause
  // ERR_REQUIRE_CYCLE_MODULE in Node.js CLI/TUI flows.
  const hpaPkgPath = join(nodeModulesDir, 'https-proxy-agent', 'package.json');
  if (existsSync(hpaPkgPath)) {
    try {
      const { existsSync: fsExistsSync } = require('fs');
      const raw = readFileSync(hpaPkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      const exp = pkg.exports;
      const hasRequireCondition = Boolean(
        (exp && typeof exp === 'object' && exp.require) ||
        (exp && typeof exp === 'object' && exp['.'] && exp['.'].require)
      );

      const pkgDir = dirname(hpaPkgPath);
      const mainEntry = typeof pkg.main === 'string' ? pkg.main : null;
      const dotImport = exp && typeof exp === 'object' && exp['.'] && typeof exp['.'].import === 'string'
        ? exp['.'].import
        : null;
      const rootImport = exp && typeof exp === 'object' && typeof exp.import === 'string'
        ? exp.import
        : null;
      const importEntry = dotImport || rootImport;

      const cjsCandidates = [
        mainEntry,
        importEntry && importEntry.endsWith('.js') ? importEntry.replace(/\.js$/, '.cjs') : null,
        './dist/index.cjs',
      ].filter(Boolean);

      const requireTarget = cjsCandidates.find((candidate) =>
        fsExistsSync(join(pkgDir, candidate)),
      );

      // Only patch if exports exists, lacks a CJS `require` condition, and we
      // have a verified CJS target file.
      if (exp && !hasRequireCondition && requireTarget) {
        pkg.exports = {
          '.': {
            import: importEntry || requireTarget,
            require: requireTarget,
            default: importEntry || requireTarget,
          },
        };
        writeFileSync(hpaPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        count++;
        
      }
    } catch (err) {
      console.warn('[after-pack] ⚠️  Failed to patch https-proxy-agent:', err.message);
    }
  }

  if (count > 0) {
    
  }
}

// ── Plugin ID mismatch patcher ───────────────────────────────────────────────
// Some plugins (e.g. wecom) have a compiled JS entry that hardcodes a different
// ID than what openclaw.plugin.json declares.  The Gateway rejects mismatches,
// so we fix them after copying.

const PLUGIN_ID_FIXES = {
  'wecom-openclaw-plugin': 'wecom',
};

function patchPluginIds(pluginDir, expectedId) {
  const { readFileSync, writeFileSync } = require('fs');

  const pkgJsonPath = join(pluginDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return;

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const entryFiles = [pkg.main, pkg.module].filter(Boolean);

  for (const entry of entryFiles) {
    const entryPath = join(pluginDir, entry);
    if (!existsSync(entryPath)) continue;

    let content = readFileSync(entryPath, 'utf8');
    let patched = false;

    for (const [wrongId, correctId] of Object.entries(PLUGIN_ID_FIXES)) {
      if (correctId !== expectedId) continue;
      const pattern = new RegExp(`(\\bid\\s*:\\s*)(["'])${wrongId.replace(/-/g, '\\-')}\\2`, 'g');
      const replaced = content.replace(pattern, `$1$2${correctId}$2`);
      if (replaced !== content) {
        content = replaced;
        patched = true;
        
      }
    }

    if (patched) {
      writeFileSync(entryPath, content, 'utf8');
    }
  }
}

// ── Plugin bundler ───────────────────────────────────────────────────────────
// Bundles a single OpenClaw plugin (and its transitive deps) from node_modules
// directly into the packaged resources directory.  Mirrors the logic in
// bundle-openclaw-plugins.mjs so the packaged app is self-contained even when
// build/openclaw-plugins/ was not pre-generated.

function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== dirname(dir)) {
    if (basename(dir) === 'node_modules') return dir;
    dir = dirname(dir);
  }
  return null;
}

function listPkgs(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!existsSync(nDir)) return result;
  for (const entry of readdirSync(nDir)) {
    if (entry === '.bin') continue;
    // Use original (non-normWin) join for the logical path stored in result.fullPath,
    // so callers can still call getVirtualStoreNodeModules() on it correctly.
    const fullPath = join(nodeModulesDir, entry);
    if (entry.startsWith('@')) {
      let subs;
      try { subs = readdirSync(normWin(fullPath)); } catch { continue; }
      for (const sub of subs) {
        result.push({ name: `${entry}/${sub}`, fullPath: join(fullPath, sub) });
      }
    } else {
      result.push({ name: entry, fullPath });
    }
  }
  return result;
}

function bundlePlugin(nodeModulesRoot, npmName, destDir) {
  const pkgPath = join(nodeModulesRoot, ...npmName.split('/'));
  if (!existsSync(pkgPath)) {
    console.warn(`[after-pack] ⚠️  Plugin package not found: ${pkgPath}. Run pnpm install.`);
    return false;
  }

  let realPluginPath;
  try { realPluginPath = realpathSync(pkgPath); } catch { realPluginPath = pkgPath; }

  // Copy plugin package itself
  if (existsSync(normWin(destDir))) rmSync(normWin(destDir), { recursive: true, force: true });
  mkdirSync(normWin(destDir), { recursive: true });
  cpSync(normWin(realPluginPath), normWin(destDir), { recursive: true, dereference: true });

  // Collect transitive deps via pnpm virtual store BFS
  const collected = new Map();
  const queue = [];

  const rootVirtualNM = getVirtualStoreNodeModules(realPluginPath);
  if (!rootVirtualNM) {
    console.warn(`[after-pack] ⚠️  Could not find virtual store for ${npmName}, skipping deps.`);
    return true;
  }
  queue.push({ nodeModulesDir: rootVirtualNM, skipPkg: npmName });

  // Read peerDependencies from the plugin's package.json so we don't bundle
  // packages that are provided by the host environment (e.g. openclaw itself).
  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  const SKIP_SCOPES = ['@types/'];
  try {
    const pluginPkg = JSON.parse(
      require('fs').readFileSync(join(destDir, 'package.json'), 'utf8')
    );
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch { /* ignore */ }

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    for (const { name, fullPath } of listPkgs(nodeModulesDir)) {
      if (name === skipPkg) continue;
      if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) continue;
      let rp;
      try { rp = realpathSync(fullPath); } catch { continue; }
      if (collected.has(rp)) continue;
      collected.set(rp, name);
      const depVirtualNM = getVirtualStoreNodeModules(rp);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  // Copy flattened deps into destDir/node_modules
  const destNM = join(destDir, 'node_modules');
  mkdirSync(destNM, { recursive: true });
  const copiedNames = new Set();
  let count = 0;
  for (const [rp, pkgName] of collected) {
    if (copiedNames.has(pkgName)) continue;
    copiedNames.add(pkgName);
    const d = join(destNM, pkgName);
    try {
      mkdirSync(normWin(dirname(d)), { recursive: true });
      cpSync(normWin(rp), normWin(d), { recursive: true, dereference: true });
      count++;
    } catch (e) {
      console.warn(`[after-pack]   Skipped dep ${pkgName}: ${e.message}`);
    }
  }
  
  return true;
}

/**
 * Bundle a local plugin into the packaged resources directory.
 * Prefers the pre-built output from bundle-openclaw-plugins.mjs if available,
 * otherwise falls back to copying raw source from sto-plugin/<localDir>/.
 */
function bundleLocalPlugin(preBuildDir, rawSourceDir, nodeModulesRoot, destDir) {
  // Filter for excluding test files when copying from raw source
  function copyFilter(src) {
    const name = basename(src);
    if (/\.(test|spec)\.(ts|js|mjs)$/.test(name)) return false;
    if (name === '__tests__' || name === 'node_modules') return false;
    return true;
  }

  // Prefer pre-built output (already has deps bundled by bundle-openclaw-plugins.mjs)
  if (existsSync(join(preBuildDir, 'openclaw.plugin.json'))) {
    
    if (existsSync(normWin(destDir))) rmSync(normWin(destDir), { recursive: true, force: true });
    mkdirSync(normWin(destDir), { recursive: true });
    cpSync(normWin(preBuildDir), normWin(destDir), { recursive: true, dereference: true });
    return true;
  }

  // Fallback: copy from raw source directory
  if (!existsSync(join(rawSourceDir, 'openclaw.plugin.json'))) {
    console.warn(`[after-pack] ⚠️  Local plugin not found at ${rawSourceDir}`);
    return false;
  }

  
  if (existsSync(normWin(destDir))) rmSync(normWin(destDir), { recursive: true, force: true });
  mkdirSync(normWin(destDir), { recursive: true });
  cpSync(normWin(rawSourceDir), normWin(destDir), { recursive: true, dereference: true, filter: copyFilter });

  // If the plugin has npm dependencies, resolve and copy them
  const pkgJsonPath = join(destDir, 'package.json');
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(require('fs').readFileSync(pkgJsonPath, 'utf8'));
      const deps = Object.keys(pkg.dependencies || {});
      for (const depName of deps) {
        const depPath = join(nodeModulesRoot, ...depName.split('/'));
        if (!existsSync(depPath)) {
          console.warn(`[after-pack]   ⚠️  Dependency "${depName}" not found, skipping`);
          continue;
        }
        let realDepPath;
        try { realDepPath = realpathSync(depPath); } catch { realDepPath = depPath; }

        const depDest = join(destDir, 'node_modules', depName);
        mkdirSync(normWin(dirname(depDest)), { recursive: true });
        cpSync(normWin(realDepPath), normWin(depDest), { recursive: true, dereference: true });

        // Also collect transitive deps for this dependency
        const ok = bundlePlugin(nodeModulesRoot, depName, join(destDir, '__tmp_dep_bundle'));
        if (ok) {
          const tmpNM = join(destDir, '__tmp_dep_bundle', 'node_modules');
          if (existsSync(tmpNM)) {
            const targetNM = join(destDir, 'node_modules');
            cpSync(normWin(tmpNM), normWin(targetNM), { recursive: true, dereference: true });
          }
          rmSync(join(destDir, '__tmp_dep_bundle'), { recursive: true, force: true });
        }
      }
    } catch { /* ignore parse errors */ }
  }

  return true;
}

function resolveLocalPluginSourceDir(localPluginSourceRoot, localDir) {
  const candidates = [
    join(localPluginSourceRoot, 'openclaw', localDir),
    join(localPluginSourceRoot, localDir),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'openclaw.plugin.json'))) ?? candidates[0];
}

// ── Main hook ────────────────────────────────────────────────────────────────

exports.OPENCLAW_ASAR_UNPACK = OPENCLAW_ASAR_UNPACK;
exports.packDirectoryToAsar = packDirectoryToAsar;
exports.validateAsarNativeUnpack = validateAsarNativeUnpack;
exports.ensureTargetSharpPackages = ensureTargetSharpPackages;
exports.ensureTargetClaudeSdkPackage = ensureTargetClaudeSdkPackage;

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName; // 'win32' | 'darwin' | 'linux'
  const arch = resolveArch(context.arch);

  

  let resourcesDir;
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    const appBundlePath = join(appOutDir, `${appName}.app`);
    const macosDir = join(appBundlePath, 'Contents', 'MacOS');
    resourcesDir = join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
    // 兼容旧版 updater：
    // 旧版会尝试启动 Contents/MacOS/S Claw，
    // 新版真实可执行文件为 Contents/MacOS/SClaw。
    const currentExecutable = join(macosDir, 'SClaw');
    const legacyExecutable = join(macosDir, 'S Claw');

    if (!existsSync(currentExecutable)) {
      throw new Error(
        `[after-pack] Missing macOS executable: ${currentExecutable}`,
      );
    }

    // 删除逻辑稍微简化，兼容意外留下的断链
    rmSync(legacyExecutable, { force: true });
    symlinkSync('SClaw', legacyExecutable);

    console.log(
      '[after-pack] Added legacy macOS executable alias: S Claw -> SClaw',
    );
  } else {
    resourcesDir = join(appOutDir, 'resources');
  }

  const buildOpenclawRoot = join(__dirname, '..', 'build', 'openclaw');
  const openclawRoot = join(resourcesDir, 'openclaw');
  const dest = join(openclawRoot, 'node_modules');
  const nodeModulesRoot = join(__dirname, '..', 'node_modules');
  const pluginsDestRoot = join(resourcesDir, 'openclaw-plugins');

  if (!existsSync(buildOpenclawRoot)) {
    console.warn('[after-pack] ⚠️  build/openclaw not found. Run bundle-openclaw first.');
    return;
  }

  
  if (existsSync(openclawRoot)) rmSync(openclawRoot, { recursive: true, force: true });
  cpSync(buildOpenclawRoot, openclawRoot, { recursive: true, dereference: true });

  const src = join(buildOpenclawRoot, 'node_modules');
  if (!existsSync(src)) {
    console.warn('[after-pack] ⚠️  build/openclaw/node_modules not found. Run bundle-openclaw first.');
    return;
  }

  if (!existsSync(dest)) {
    
    cpSync(src, dest, { recursive: true });
  } else {
    const depCount = readdirSync(src, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '.bin')
      .length;
    
  }

  // Patch broken modules whose CJS transpiled output sets module.exports = undefined,
  // causing TypeError in Node.js 22+ ESM interop.
  patchBrokenModules(dest);

  // 1.1 Bundle OpenClaw plugins directly from node_modules into packaged resources.
  //     This is intentionally done in afterPack (not extraResources) because:
  //     - electron-builder silently skips extraResources entries whose source
  //       directory doesn't exist (build/openclaw-plugins/ may not be pre-generated)
  //     - node_modules/ is excluded by .gitignore so the deps copy must be manual
  const BUNDLED_PLUGINS = [
    // { type: 'npm', npmName: '@soimy/dingtalk', pluginId: 'dingtalk' },
    // { type: 'npm', npmName: '@wecom/wecom-openclaw-plugin', pluginId: 'wecom' },
    // { type: 'npm', npmName: '@sliverp/qqbot', pluginId: 'qqbot' },
    { type: 'npm', npmName: '@tencent-weixin/openclaw-weixin', pluginId: 'openclaw-weixin' },
    { type: 'local', localDir: 'sto-dynamic-agent-route', pluginId: 'sto-dynamic-agent-route' },
    { type: 'local', localDir: 'sto-agent-telemetry', pluginId: 'sto-agent-telemetry' },
    { type: 'local', localDir: 'sto-scheduled-task-tool', pluginId: 'sto-scheduled-task-tool' },
    { type: 'local', localDir: 'sto-skill-call-monitor', pluginId: 'sto-skill-call-monitor' },
    { type: 'local', localDir: 'sto-media-understanding', pluginId: 'sto-media-understanding' },
    { type: 'local', localDir: 'sto-dingtalk-send-guard', pluginId: 'sto-dingtalk-send-guard' },
    { type: 'local', localDir: 'sto-workflow-tool', pluginId: 'sto-workflow-tool' },
    { type: 'local', localDir: 'sto-user-skill-tool', pluginId: 'sto-user-skill-tool' },
    { type: 'local', localDir: 'sto-browser-bridge', pluginId: 'sto-browser-bridge' },
  ];

  const localPluginSourceRoot = join(__dirname, '..', 'sto-plugin');
  const preBuildRoot = join(__dirname, '..', 'build', 'openclaw-plugins');
  const STO_TOOLKIT_DIR = 'sto-toolkit';

  mkdirSync(pluginsDestRoot, { recursive: true });
  for (const plugin of BUNDLED_PLUGINS) {
    const pluginDestDir = join(pluginsDestRoot, plugin.pluginId);
    let ok;

    if (plugin.type === 'local') {
      const preBuildDir = join(preBuildRoot, plugin.pluginId);
      const rawSourceDir = resolveLocalPluginSourceDir(localPluginSourceRoot, plugin.localDir);
      
      ok = bundleLocalPlugin(preBuildDir, rawSourceDir, nodeModulesRoot, pluginDestDir);
    } else {
      
      ok = bundlePlugin(nodeModulesRoot, plugin.npmName, pluginDestDir);
    }

    if (ok) {
      const pluginNM = join(pluginDestDir, 'node_modules');
      cleanupUnnecessaryFiles(pluginDestDir);
      if (existsSync(pluginNM)) {
        cleanupKoffi(pluginNM, platform, arch);
        cleanupNativePlatformPackages(pluginNM, platform, arch);
      }
      // Fix hardcoded plugin ID mismatches in compiled JS
      patchPluginIds(pluginDestDir, plugin.pluginId);
    }
  }

  // Nest sto-toolkit inside sto-workflow-tool (OpenClaw scans extensions/* as plugins).
  const workflowDestDir = join(pluginsDestRoot, 'sto-workflow-tool');
  const legacyToolkitSibling = join(pluginsDestRoot, STO_TOOLKIT_DIR);
  if (existsSync(legacyToolkitSibling)) {
    rmSync(normWin(legacyToolkitSibling), { recursive: true, force: true });
    
  }
  if (existsSync(join(workflowDestDir, 'openclaw.plugin.json'))) {
    const nestedToolkitDir = join(workflowDestDir, STO_TOOLKIT_DIR);
    const nestedPreBuild = join(preBuildRoot, 'sto-workflow-tool', STO_TOOLKIT_DIR);
    const toolkitSourceDir = join(localPluginSourceRoot, STO_TOOLKIT_DIR);
    const toolkitSource =
      existsSync(join(nestedPreBuild, 'index.ts'))
        ? nestedPreBuild
        : existsSync(join(toolkitSourceDir, 'index.ts'))
          ? toolkitSourceDir
          : null;
    if (toolkitSource) {
      
      if (existsSync(normWin(nestedToolkitDir))) rmSync(normWin(nestedToolkitDir), { recursive: true, force: true });
      mkdirSync(normWin(nestedToolkitDir), { recursive: true });
      cpSync(normWin(toolkitSource), normWin(nestedToolkitDir), {
        recursive: true,
        dereference: true,
        filter: (src) => {
          const name = basename(src);
          if (/\.(test|spec)\.(ts|js|mjs)$/.test(name)) return false;
          if (name === '__tests__' || name === 'node_modules') return false;
          return true;
        },
      });
      cleanupUnnecessaryFiles(nestedToolkitDir);
    } else {
      console.warn(`[after-pack] ⚠️  ${STO_TOOLKIT_DIR} not found; sto-workflow-tool may fail to load`);
    }
  }

  // 2. General cleanup on the full openclaw directory (not just node_modules)
  
  const removedRoot = cleanupUnnecessaryFiles(openclawRoot);
  

  // Install target @img/sharp before stripping host-platform native packages (cross-compile).
  ensureTargetSharpPackages(dest, platform, arch);

  // 3. Platform-specific: strip koffi non-target platform binaries
  const koffiRemoved = cleanupKoffi(dest, platform, arch);
  if (koffiRemoved > 0) {
    
  }

  // 4. Platform-specific: strip wrong-platform native packages
  const nativeRemoved = cleanupNativePlatformPackages(dest, platform, arch);
  if (nativeRemoved > 0) {
    
  }

  // 5. Remove @node-llama-cpp entirely (not needed, using Ollama/vLLM HTTP API instead)
  const llamaCppDir = join(dest, '@node-llama-cpp');
  if (existsSync(llamaCppDir)) {
    rmSync(llamaCppDir, { recursive: true, force: true });
    
  }

  // 5.1 Dedupe plugin node_modules against openclaw runtime (same name + version)
  const openclawPackageIndex = buildOpenclawPackageIndex(dest);
  let totalPluginDeduped = 0;
  for (const plugin of BUNDLED_PLUGINS) {
    const pluginDestDir = join(pluginsDestRoot, plugin.pluginId);
    if (!existsSync(pluginDestDir)) continue;
    totalPluginDeduped += dedupePluginNodeModules(pluginDestDir, openclawPackageIndex);
  }
  if (totalPluginDeduped > 0) {
    
  }

  // 6. Remove excluded OpenClaw built-in skills (not needed for StoClaw distribution)
  const EXCLUDED_SKILLS = [
    'apple-notes',
    'apple-reminders',
    'bear-notes',
    'blogwatcher',
    'blucli',
    'bluebubbles',
    'discord',
    'eightctl',
    'gemini',
    'gh-issues',
    'github',
    'gog',
    'nano-pdf',
    'wacli',
    'voice-call',
    'trello',
    'tmux',
    'summarize',
    'spotify-player',
    'songsee',
    'ordercli',
    'openhue',
    'openai-whisper-api',
    'openai-whisper',
    'notion',
    'imsg',
    'model-usage',
    'oracle',
  ];

  const openclawSkillsDir = join(openclawRoot, 'skills');
  if (existsSync(openclawSkillsDir)) {
    let removedSkills = 0;
    for (const slug of EXCLUDED_SKILLS) {
      const skillDir = join(openclawSkillsDir, slug);
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true, force: true });
        removedSkills++;
      }
    }
    if (removedSkills > 0) {
      
    }
  }

  // Also remove excluded skills from the dist/extensions bundled skills (if present)
  const openclawDistSkillsDir = join(openclawRoot, 'dist', 'skills');
  if (existsSync(openclawDistSkillsDir)) {
    let removedDistSkills = 0;
    for (const slug of EXCLUDED_SKILLS) {
      const skillDir = join(openclawDistSkillsDir, slug);
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true, force: true });
        removedDistSkills++;
      }
    }
    if (removedDistSkills > 0) {
      
    }
  }

  // 7. Validate + pack openclaw + plugins into ASAR archives to reduce NSIS file count.
  removeUnindexedBundledExtensions(openclawRoot);
  validateOpenclawBundleBeforeAsar(openclawRoot);
  

  const looseFileCount = countFilesRecursive(openclawRoot)
    + countFilesRecursive(pluginsDestRoot);
  

  await packDirectoryToAsar(openclawRoot, join(resourcesDir, 'openclaw.asar'), 'OpenClaw runtime');

  const hasPlugins = existsSync(pluginsDestRoot)
    && readdirSync(pluginsDestRoot).some((entry) => {
      try {
        return statSync(join(pluginsDestRoot, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  if (hasPlugins) {
    await packDirectoryToAsar(
      pluginsDestRoot,
      join(resourcesDir, 'openclaw-plugins.asar'),
      'OpenClaw plugins',
    );
  } else if (existsSync(pluginsDestRoot)) {
    rmSync(pluginsDestRoot, { recursive: true, force: true });
  }

  ensureAppRuntimePackages(resourcesDir, [
    'ajv-formats',
    { packageName: 'ajv', resolveFromPackageName: 'ajv-formats' },
    { packageName: 'fast-deep-equal', resolveFromPackageName: 'ajv' },
    'fast-json-stable-stringify',
    { packageName: 'fast-uri', resolveFromPackageName: 'ajv' },
    { packageName: 'json-schema-traverse', resolveFromPackageName: 'ajv' },
    { packageName: 'require-from-string', resolveFromPackageName: 'ajv' },
    'uri-js',
  ]);
  ensureTargetClaudeSdkPackage(resourcesDir, platform, arch);
  cleanupClaudeSdkPackages(resourcesDir, platform, arch);
  validateBundledClaudeSdk(resourcesDir, platform, arch);
};
