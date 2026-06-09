#!/usr/bin/env zx

/**
 * bundle-openclaw-plugins.mjs
 *
 * Build a self-contained mirror of OpenClaw third-party plugins for packaging.
 * Current plugins:
 *   - @soimy/dingtalk -> build/openclaw-plugins/dingtalk
 *
 * The output plugin directory contains:
 *   - plugin source files (index.ts, openclaw.plugin.json, package.json, ...)
 *   - plugin runtime node_modules/ (flattened direct + transitive deps)
 */

import 'zx/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'build', 'openclaw-plugins');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const STO_PLUGIN_ROOT = path.join(ROOT, 'sto-plugin');
const CACHE_DIR = path.join(ROOT, '.download-cache', 'openclaw-plugins');
const CACHE_MANIFEST = path.join(CACHE_DIR, 'manifest.json');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Load or initialize cache manifest
function loadCacheManifest() {
  if (fs.existsSync(CACHE_MANIFEST)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_MANIFEST, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveCacheManifest(manifest) {
  fs.writeFileSync(CACHE_MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
}

// Check if cache is valid
function isCacheValid(cacheKey) {
  if (!cacheKey) return false;
  const manifest = loadCacheManifest();
  if (manifest.cacheKey !== cacheKey) return false;
  if (!fs.existsSync(manifest.cachePath)) return false;
  return true;
}

// Copy from cache to output
function copyFromCache(cachePath, outputPath) {
  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath, { recursive: true });
  }
  fs.cpSync(cachePath, outputPath, { recursive: true, dereference: true });
}

// Save output to cache
function saveToCache(outputPath, cacheKey) {
  const cachePath = path.join(CACHE_DIR, `plugins-${cacheKey}`);
  if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true });
  }
  fs.cpSync(outputPath, cachePath, { recursive: true, dereference: true });
  
  const manifest = loadCacheManifest();
  manifest.cacheKey = cacheKey;
  manifest.cachePath = cachePath;
  manifest.createdAt = new Date().toISOString();
  saveCacheManifest(manifest);
}

// On Windows, pnpm virtual store paths can exceed MAX_PATH (260 chars).
// Adding \\?\ prefix bypasses the limit for Win32 fs calls.
// Node.js 18.17+ also handles this transparently when LongPathsEnabled=1,
// but this is an extra safety net for build machines where the registry key
// may not be set yet.
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

const PLUGINS = [
  // { type: 'npm', npmName: '@soimy/dingtalk', pluginId: 'dingtalk' },
  // { type: 'npm', npmName: '@wecom/wecom-openclaw-plugin', pluginId: 'wecom' },
  // { type: 'npm', npmName: '@sliverp/qqbot', pluginId: 'qqbot' },
  { type: 'npm', npmName: '@tencent-weixin/openclaw-weixin', pluginId: 'openclaw-weixin' },
  { type: 'local', localDir: 'sto-dynamic-agent-route', pluginId: 'sto-dynamic-agent-route' },
  { type: 'local', localDir: 'sto-agent-telemetry', pluginId: 'sto-agent-telemetry' },
  { type: 'local', localDir: 'sto-scheduled-task-tool', pluginId: 'sto-scheduled-task-tool' },
  { type: 'local', localDir: 'sto-skill-call-monitor', pluginId: 'sto-skill-call-monitor' },
  { type: 'local', localDir: 'sto-dingtalk-send-guard', pluginId: 'sto-dingtalk-send-guard' },
];

// Filter for excluding test files and unnecessary dirs when copying local plugins.
function bundleCopyFilter(src) {
  const base = path.basename(src);
  if (/\.(test|spec)\.(ts|js|mjs)$/.test(base)) return false;
  if (base === '__tests__' || base === 'node_modules') return false;
  return true;
}

// Recursively hash all non-test source files in a local plugin directory.
// Files are sorted by relative path to ensure deterministic hashing.
function hashLocalPluginDir(pluginDir, hash) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (/\.(test|spec)\.(ts|js|mjs)$/.test(entry.name)) continue;
        files.push(fullPath);
      }
    }
  }
  walk(pluginDir);
  files.sort();
  for (const file of files) {
    const rel = path.relative(pluginDir, file);
    hash.update(rel + ':' + fs.readFileSync(file, 'utf8'));
  }
}

// Now define the hash function after PLUGINS is defined
function calculatePluginsHash() {
  try {
    const hash = createHash('sha256');
    
    for (const plugin of PLUGINS) {
      if (plugin.type === 'npm') {
        // npm plugins: use version from node_modules
        const pluginPkgPath = path.join(NODE_MODULES, ...plugin.npmName.split('/'), 'package.json');
        if (fs.existsSync(pluginPkgPath)) {
          const pluginPkg = JSON.parse(fs.readFileSync(pluginPkgPath, 'utf8'));
          hash.update(`npm:${plugin.npmName}@${pluginPkg.version || 'unknown'}`);
        }
      } else if (plugin.type === 'local') {
        // local plugins: hash all source file contents for change detection
        const pluginDir = path.join(STO_PLUGIN_ROOT, plugin.localDir);
        if (fs.existsSync(pluginDir)) {
          hash.update(`local:${plugin.pluginId}:`);
          hashLocalPluginDir(pluginDir, hash);
        }
      }
    }
    
    return hash.digest('hex').substring(0, 16);
  } catch {
    return null;
  }
}

function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function listPackages(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!fs.existsSync(nDir)) return result;

  for (const entry of fs.readdirSync(nDir)) {
    if (entry === '.bin') continue;
    // Use original (non-normWin) path so callers can call
    // getVirtualStoreNodeModules() on fullPath correctly.
    const entryPath = path.join(nodeModulesDir, entry);

    if (entry.startsWith('@')) {
      let scopeEntries = [];
      try {
        scopeEntries = fs.readdirSync(normWin(entryPath));
      } catch {
        continue;
      }
      for (const sub of scopeEntries) {
        result.push({
          name: `${entry}/${sub}`,
          fullPath: path.join(entryPath, sub),
        });
      }
    } else {
      result.push({ name: entry, fullPath: entryPath });
    }
  }
  return result;
}

/**
 * Collect transitive dependencies from pnpm virtual store using BFS,
 * then copy them flattened into outputDir/node_modules/.
 * Shared by both npm and local plugin bundlers.
 */
function collectAndCopyTransitiveDeps(realPluginPath, pluginName, outputDir) {
  const collected = new Map();
  const queue = [];
  const rootVirtualNM = getVirtualStoreNodeModules(realPluginPath);
  if (!rootVirtualNM) {
    return { copiedCount: 0, skippedDupes: 0 };
  }
  queue.push({ nodeModulesDir: rootVirtualNM, skipPkg: pluginName });

  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  const SKIP_SCOPES = ['@types/'];
  try {
    const pluginPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch { /* ignore */ }

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    for (const { name, fullPath } of listPackages(nodeModulesDir)) {
      if (name === skipPkg) continue;
      if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some((s) => name.startsWith(s))) continue;

      let realPath;
      try {
        realPath = fs.realpathSync(fullPath);
      } catch {
        continue;
      }
      if (collected.has(realPath)) continue;
      collected.set(realPath, name);

      const depVirtualNM = getVirtualStoreNodeModules(realPath);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  const outputNodeModules = path.join(outputDir, 'node_modules');
  fs.mkdirSync(outputNodeModules, { recursive: true });

  let copiedCount = 0;
  let skippedDupes = 0;
  const copiedNames = new Set();

  for (const [realPath, pkgName] of collected) {
    if (copiedNames.has(pkgName)) {
      skippedDupes++;
      continue;
    }
    copiedNames.add(pkgName);

    const dest = path.join(outputNodeModules, pkgName);
    try {
      fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
      fs.cpSync(normWin(realPath), normWin(dest), { recursive: true, dereference: true });
      copiedCount++;
    } catch (err) {
      echo`   ⚠️  Skipped ${pkgName}: ${err.message}`;
    }
  }

  return { copiedCount, skippedDupes };
}

function bundleOnePlugin({ npmName, pluginId }) {
  const pkgPath = path.join(NODE_MODULES, ...npmName.split('/'));
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing dependency "${npmName}". Run pnpm install first.`);
  }

  const realPluginPath = fs.realpathSync(pkgPath);
  const outputDir = path.join(OUTPUT_ROOT, pluginId);

  echo`📦 Bundling npm plugin ${npmName} -> ${outputDir}`;

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // 1) Copy plugin package itself
  fs.cpSync(realPluginPath, outputDir, { recursive: true, dereference: true });

  // 2) Collect and copy transitive deps
  const rootVirtualNM = getVirtualStoreNodeModules(realPluginPath);
  if (!rootVirtualNM) {
    throw new Error(`Cannot resolve virtual store node_modules for ${npmName}`);
  }
  const { copiedCount, skippedDupes } = collectAndCopyTransitiveDeps(realPluginPath, npmName, outputDir);

  const manifestPath = path.join(outputDir, 'openclaw.plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing openclaw.plugin.json in bundled plugin output: ${pluginId}`);
  }

  // 3) Patch plugin ID mismatch
  patchPluginId(outputDir, pluginId);

  echo`   ✅ ${pluginId}: copied ${copiedCount} deps (skipped dupes: ${skippedDupes})`;
}

/**
 * Bundle a local plugin from sto-plugin/<localDir>/ into the output directory.
 * Copies source files (excluding tests), and if the plugin has npm dependencies,
 * resolves them from the project's node_modules via the same BFS logic.
 */
function bundleOneLocalPlugin({ localDir, pluginId }) {
  const sourceDir = path.join(STO_PLUGIN_ROOT, localDir);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Local plugin directory not found: ${sourceDir}`);
  }
  if (!fs.existsSync(path.join(sourceDir, 'openclaw.plugin.json'))) {
    throw new Error(`Missing openclaw.plugin.json in local plugin: ${sourceDir}`);
  }

  const outputDir = path.join(OUTPUT_ROOT, pluginId);

  echo`📦 Bundling local plugin ${localDir} -> ${outputDir}`;

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // 1) Copy plugin source files (excluding test files and node_modules)
  fs.cpSync(sourceDir, outputDir, { recursive: true, filter: bundleCopyFilter });

  // 2) If the plugin has npm dependencies, resolve and copy them
  let copiedCount = 0;
  let skippedDupes = 0;
  try {
    const pluginPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
    const deps = Object.keys(pluginPkg.dependencies || {});
    if (deps.length > 0) {
      for (const depName of deps) {
        const depPath = path.join(NODE_MODULES, ...depName.split('/'));
        if (!fs.existsSync(depPath)) {
          echo`   ⚠️  Dependency "${depName}" not found in root node_modules, skipping`;
          continue;
        }
        const realDepPath = fs.realpathSync(depPath);
        const result = collectAndCopyTransitiveDeps(realDepPath, depName, outputDir);
        copiedCount += result.copiedCount;
        skippedDupes += result.skippedDupes;

        // Also copy the dependency itself
        const destNM = path.join(outputDir, 'node_modules', depName);
        if (!fs.existsSync(destNM)) {
          try {
            fs.mkdirSync(normWin(path.dirname(destNM)), { recursive: true });
            fs.cpSync(normWin(realDepPath), normWin(destNM), { recursive: true, dereference: true });
            copiedCount++;
          } catch (err) {
            echo`   ⚠️  Skipped ${depName}: ${err.message}`;
          }
        }
      }
    }
  } catch { /* no package.json or parse error — skip deps */ }

  // 3) Patch plugin ID mismatch (if applicable)
  patchPluginId(outputDir, pluginId);

  echo`   ✅ ${pluginId}: local plugin bundled${copiedCount > 0 ? `, copied ${copiedCount} deps (skipped dupes: ${skippedDupes})` : ' (no deps)'}`;
}

/**
 * Patch plugin entry JS files so the exported `id` matches openclaw.plugin.json.
 * Some plugins (e.g. wecom) ship with a hardcoded ID in their compiled output
 * that differs from the manifest, causing a Gateway "plugin id mismatch" error.
 */
function patchPluginId(pluginDir, expectedId) {
  const manifestPath = path.join(pluginDir, 'openclaw.plugin.json');
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifestId = manifest.id;
  if (manifestId !== expectedId) {
    echo`   ⚠️  Manifest ID "${manifestId}" doesn't match expected "${expectedId}", skipping patch`;
    return;
  }

  // Read the package.json to find the main entry point
  const pkgJsonPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const entryFiles = [pkg.main, pkg.module].filter(Boolean);

  // Known ID mismatches to patch.  Keys are the wrong ID found in compiled JS,
  // values are the correct ID (must match openclaw.plugin.json).
  const ID_FIXES = {
    'wecom-openclaw-plugin': 'wecom',
  };

  for (const entry of entryFiles) {
    const entryPath = path.join(pluginDir, entry);
    if (!fs.existsSync(entryPath)) continue;

    let content = fs.readFileSync(entryPath, 'utf8');
    let patched = false;

    for (const [wrongId, correctId] of Object.entries(ID_FIXES)) {
      if (correctId !== expectedId) continue;
      // Replace  id: "wecom-openclaw-plugin"  or  id: 'wecom-openclaw-plugin'
      const pattern = new RegExp(`(\\bid\\s*:\\s*)(["'])${wrongId.replace(/-/g, '\\-')}\\2`, 'g');
      const replaced = content.replace(pattern, `$1$2${correctId}$2`);
      if (replaced !== content) {
        content = replaced;
        patched = true;
        echo`   🩹 Patching plugin ID in ${entry}: "${wrongId}" → "${correctId}"`;
      }
    }

    if (patched) {
      fs.writeFileSync(entryPath, content, 'utf8');
    }
  }
}

echo`📦 Bundling OpenClaw plugin mirrors...`;

// Check cache first
const cacheKey = calculatePluginsHash();
if (isCacheValid(cacheKey)) {
  const manifest = loadCacheManifest();
  echo`   📦 Using cached plugins bundle (key: ${cacheKey})`;
  copyFromCache(manifest.cachePath, OUTPUT_ROOT);
  echo`✅ Plugin mirrors ready (from cache): ${OUTPUT_ROOT}`;
  process.exit(0);
}

fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

for (const plugin of PLUGINS) {
  if (plugin.type === 'local') {
    bundleOneLocalPlugin(plugin);
  } else {
    bundleOnePlugin(plugin);
  }
}

// Save to cache for future builds
if (cacheKey) {
  echo`💾 Saving plugins bundle to cache...`;
  saveToCache(OUTPUT_ROOT, cacheKey);
  echo`   ✅ Cache saved (key: ${cacheKey})`;
}

echo`✅ Plugin mirrors ready: ${OUTPUT_ROOT}`;
