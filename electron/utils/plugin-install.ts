/**
 * Shared OpenClaw Plugin Install Utilities
 *
 * Provides version-aware install/upgrade logic for bundled OpenClaw plugins
 * (DingTalk, WeCom, QQBot, WeChat).  Used both at app startup (to auto-upgrade
 * stale plugins) and when a user configures a channel.
 */
import { app } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  existsSync,
  cpSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  readlinkSync,
  lstatSync,
} from 'node:fs';
import { cp as cpAsync, mkdir as mkdirAsync, rm as rmAsync } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger';
import {
  getOpenClawConfigDir,
  getOpenClawDir,
  getBundledPluginSourceCandidates,
  getOpenClawNodeModulesPath,
} from './paths';

function isAsarPath(filePath: string): boolean {
  return /\.asar([\\/]|$)/.test(filePath);
}

function normalizeFsPathForWindows(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;
  // Electron's asar fs patch does not recognize \\?\-prefixed paths, so
  // asar-virtual paths must stay unprefixed (they are short anyway).
  if (isAsarPath(filePath)) return filePath;

  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}

function fsPath(filePath: string): string {
  return normalizeFsPathForWindows(filePath);
}

/**
 * Recursive copy that supports ASAR-virtual source paths.
 * Electron's patched fs cannot `cpSync` a directory out of an .asar archive
 * (it only creates empty directories), so we walk the tree with
 * readdirSync/readFileSync, which ARE asar-aware, and write real files out.
 */
function copyDirFromAsar(sourceDir: string, targetDir: string): void {
  mkdirSync(fsPath(targetDir), { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const src = join(sourceDir, entry.name);
    const dest = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirFromAsar(src, dest);
    } else if (entry.isFile()) {
      writeFileSync(fsPath(dest), readFileSync(src));
    }
  }
}

function copyPluginDir(sourceDir: string, targetDir: string): void {
  if (isAsarPath(sourceDir)) {
    copyDirFromAsar(sourceDir, targetDir);
    return;
  }
  cpSync(fsPath(sourceDir), fsPath(targetDir), { recursive: true, dereference: true });
}

function joinNodeModulePackage(root: string, packageName: string): string {
  return join(root, ...packageName.split('/'));
}

/** cpSync cannot extract trees from inside .asar; use asar-aware read/write instead. */
function copyPathFromSource(sourcePath: string, destPath: string): void {
  if (!existsSync(fsPath(sourcePath))) {
    throw new Error(`ENOENT: source missing at ${sourcePath}`);
  }

  const sourceStat = lstatSync(fsPath(sourcePath));

  if (sourceStat.isDirectory()) {
    if (existsSync(fsPath(destPath))) {
      rmSync(fsPath(destPath), { recursive: true, force: true });
    }
    if (isAsarPath(sourcePath)) {
      copyDirFromAsar(sourcePath, destPath);
      return;
    }
    mkdirSync(fsPath(path.dirname(destPath)), { recursive: true });
    cpSync(fsPath(sourcePath), fsPath(destPath), { recursive: true, dereference: true });
    return;
  }

  mkdirSync(fsPath(path.dirname(destPath)), { recursive: true });
  writeFileSync(fsPath(destPath), readFileSync(sourcePath));
}

function asErrnoException(error: unknown): NodeJS.ErrnoException | null {
  if (error && typeof error === 'object') {
    return error as NodeJS.ErrnoException;
  }
  return null;
}

function toErrorDiagnostic(error: unknown): { code?: string; name?: string; message: string } {
  const errno = asErrnoException(error);
  if (!errno) {
    return { message: String(error) };
  }

  return {
    code: typeof errno.code === 'string' ? errno.code : undefined,
    name: errno.name,
    message: errno.message || String(error),
  };
}

// ── Known plugin-ID corrections ─────────────────────────────────────────────
// Some npm packages ship with an openclaw.plugin.json whose "id" field
// doesn't match the ID the plugin code actually exports.  After copying we
// patch both the manifest AND the compiled JS so the Gateway accepts them.
const MANIFEST_ID_FIXES: Record<string, string> = {
  'wecom-openclaw-plugin': 'wecom',
};

/**
 * After a plugin has been copied to ~/.stoclaw/openclaw/extensions/<dir>, fix any
 * known manifest-ID mismatches so the Gateway can load the plugin.
 * Also patches package.json fields that the Gateway uses as "entry hints".
 */
export function fixupPluginManifest(targetDir: string): void {
  // 1. Fix openclaw.plugin.json id
  const manifestPath = join(targetDir, 'openclaw.plugin.json');
  try {
    const raw = readFileSync(fsPath(manifestPath), 'utf-8');
    const manifest = JSON.parse(raw);
    const oldId = manifest.id as string | undefined;
    if (oldId && MANIFEST_ID_FIXES[oldId]) {
      const newId = MANIFEST_ID_FIXES[oldId];
      manifest.id = newId;
      writeFileSync(fsPath(manifestPath), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      logger.info(`[plugin] Fixed manifest ID: ${oldId} → ${newId}`);
    }
  } catch {
    // manifest may not exist yet — ignore
  }

  // 2. Fix package.json fields that Gateway uses as "entry hints"
  const pkgPath = join(targetDir, 'package.json');
  try {
    const raw = readFileSync(fsPath(pkgPath), 'utf-8');
    const pkg = JSON.parse(raw);
    let modified = false;

    // Check if the package name contains a legacy ID that needs fixing
    for (const [oldId, newId] of Object.entries(MANIFEST_ID_FIXES)) {
      if (typeof pkg.name === 'string' && pkg.name.includes(oldId)) {
        pkg.name = pkg.name.replace(oldId, newId);
        modified = true;
      }
      const install = pkg.openclaw?.install;
      if (install) {
        if (typeof install.npmSpec === 'string' && install.npmSpec.includes(oldId)) {
          install.npmSpec = install.npmSpec.replace(oldId, newId);
          modified = true;
        }
        if (typeof install.localPath === 'string' && install.localPath.includes(oldId)) {
          install.localPath = install.localPath.replace(oldId, newId);
          modified = true;
        }
      }
    }

    if (modified) {
      writeFileSync(fsPath(pkgPath), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      logger.info(`[plugin] Fixed package.json entry hints in ${targetDir}`);
    }
  } catch {
    // ignore
  }

  // 3. Fix hardcoded plugin IDs in compiled JS entry files.
  //    The Gateway validates that the JS export's `id` matches the manifest.
  patchPluginEntryIds(targetDir);
}

/**
 * Patch the compiled JS entry files so the hardcoded `id` field in the
 * plugin export matches the manifest.  Without this, the Gateway rejects
 * the plugin with "plugin id mismatch".
 */
function patchPluginEntryIds(targetDir: string): void {
  const pkgPath = join(targetDir, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(fsPath(pkgPath), 'utf-8'));
  } catch {
    return;
  }

  const entryFiles = [pkg.main, pkg.module].filter(Boolean) as string[];

  for (const entry of entryFiles) {
    const entryPath = join(targetDir, entry);
    if (!existsSync(fsPath(entryPath))) continue;

    let content: string;
    try {
      content = readFileSync(fsPath(entryPath), 'utf-8');
    } catch {
      continue;
    }

    let patched = false;
    for (const [wrongId, correctId] of Object.entries(MANIFEST_ID_FIXES)) {
      // Match patterns like:  id: "wecom-openclaw-plugin"  or  id: 'wecom-openclaw-plugin'
      const escapedWrongId = wrongId.replace(/-/g, '\\-');
      const pattern = new RegExp(`(\\bid\\s*:\\s*)(["'])${escapedWrongId}\\2`, 'g');
      const replaced = content.replace(pattern, `$1$2${correctId}$2`);
      if (replaced !== content) {
        content = replaced;
        patched = true;
        logger.info(`[plugin] Patched plugin ID in ${entry}: "${wrongId}" → "${correctId}"`);
      }
    }

    if (patched) {
      writeFileSync(fsPath(entryPath), content, 'utf-8');
    }
  }
}

// ── Plugin npm name mapping ──────────────────────────────────────────────────

const PLUGIN_NPM_NAMES: Record<string, string> = {
  // dingtalk: '@soimy/dingtalk',
  // wecom: '@wecom/wecom-openclaw-plugin',
  // qqbot: '@sliverp/qqbot',
  'openclaw-weixin': '@tencent-weixin/openclaw-weixin',
};

/** npm channel plugins copied to ~/.stoclaw; need openclaw peer + bundled runtime deps. */
const CHANNEL_NPM_PLUGIN_DIR_NAMES = new Set(Object.keys(PLUGIN_NPM_NAMES));

// ── Local plugin directory mapping ───────────────────────────────────────────
// Maps plugin dir names to their source directory under sto-plugin/.

const LOCAL_PLUGIN_DIRS: Record<string, string> = {
  'sto-dynamic-agent-route': 'sto-dynamic-agent-route',
  'sto-agent-telemetry': 'sto-agent-telemetry',
  'sto-scheduled-task-tool': 'sto-scheduled-task-tool',
  'sto-workflow-tool': 'sto-workflow-tool',
  'sto-user-skill-tool': 'sto-user-skill-tool',
  'sto-browser-bridge': 'sto-browser-bridge',
  'sto-skill-call-monitor': 'sto-skill-call-monitor',
  'sto-media-understanding': 'sto-media-understanding',
  'sto-dingtalk-send-guard': 'sto-dingtalk-send-guard',
};

function getLocalPluginSourceCandidates(localDir: string): string[] {
  return [
    join(process.cwd(), 'sto-plugin', 'openclaw', localDir),
    join(app.getAppPath(), 'sto-plugin', 'openclaw', localDir),
    join(process.cwd(), 'sto-plugin', localDir),
    join(app.getAppPath(), 'sto-plugin', localDir),
  ];
}

/**
 * Shared library nested inside consumer plugins (sto-workflow-tool / sto-browser-bridge).
 * OpenClaw scans extensions/* as plugins, so sto-toolkit cannot be a sibling extension.
 */
const STO_TOOLKIT_DIR = 'sto-toolkit';

function pickStoToolkitSourceDir(): string | undefined {
  const workflowBundledDirs = getBundledPluginSourceCandidates('sto-workflow-tool');
  const bridgeBundledDirs = getBundledPluginSourceCandidates('sto-browser-bridge');
  const installedWorkflowPluginDir = join(getOpenClawConfigDir(), 'extensions', 'sto-workflow-tool');
  const installedBridgePluginDir = join(getOpenClawConfigDir(), 'extensions', 'sto-browser-bridge');
  const candidates = [
    ...getBundledPluginSourceCandidates(STO_TOOLKIT_DIR),
    ...workflowBundledDirs.map((dir) => join(dir, STO_TOOLKIT_DIR)),
    ...bridgeBundledDirs.map((dir) => join(dir, STO_TOOLKIT_DIR)),
    join(installedWorkflowPluginDir, STO_TOOLKIT_DIR),
    join(installedBridgePluginDir, STO_TOOLKIT_DIR),
    join(process.cwd(), 'sto-plugin', STO_TOOLKIT_DIR),
    join(app.getAppPath(), 'sto-plugin', STO_TOOLKIT_DIR),
  ];
  for (const dir of candidates) {
    if (existsSync(fsPath(join(dir, 'index.ts')))) return dir;
  }
  return undefined;
}

/** Runtime deps not declared in plugin package.json — copied from app node_modules. */
const PLUGIN_RUNTIME_DEPS: Record<string, readonly string[]> = {
  'sto-workflow-tool': ['@sinclair/typebox'],
  'sto-scheduled-task-tool': ['@sinclair/typebox'],
  'sto-browser-bridge': ['@sinclair/typebox'],
  'sto-user-skill-tool': ['@sinclair/typebox'],
};

function pluginRuntimeDepNodeModuleRoots(): string[] {
  const roots = [
    join(process.cwd(), 'node_modules'),
    join(app.getAppPath(), 'node_modules'),
  ];
  if (app.isPackaged) {
    roots.push(join(process.resourcesPath, 'node_modules'));
    roots.push(join(getOpenClawDir(), 'node_modules'));
  }
  const openclawNodeModules = getOpenClawNodeModulesPath();
  if (openclawNodeModules) {
    const delimiter = process.platform === 'win32' ? ';' : ':';
    for (const entry of openclawNodeModules.split(delimiter)) {
      if (entry.trim()) roots.push(entry.trim());
    }
  }
  return [...new Set(roots)];
}

function copyPluginRuntimeDeps(pluginDirName: string, pluginDir: string): void {
  const depNames = PLUGIN_RUNTIME_DEPS[pluginDirName];
  if (!depNames?.length) return;

  const nodeModuleRoots = pluginRuntimeDepNodeModuleRoots();
  const outputNM = join(pluginDir, 'node_modules');
  mkdirSync(fsPath(outputNM), { recursive: true });

  for (const depName of depNames) {
    const dest = joinNodeModulePackage(outputNM, depName);
    if (existsSync(fsPath(join(dest, 'package.json')))) continue;

    let copied = false;
    for (const root of nodeModuleRoots) {
      const src = joinNodeModulePackage(root, depName);
      if (!existsSync(fsPath(join(src, 'package.json'))) && !existsSync(fsPath(src))) continue;
      try {
        copyPathFromSource(src, dest);
        copied = true;
        logger.info(`[plugin] Copied runtime dep ${depName} for ${pluginDirName}`);
        break;
      } catch (error) {
        logger.warn(`[plugin] Failed to copy ${depName} from ${src}:`, error);
      }
    }
    if (!copied) {
      logger.warn(`[plugin] Runtime dep ${depName} not found; ${pluginDirName} may fail to load`);
    }
  }
}

function removeLegacyStoToolkitExtensionSibling(): void {
  const legacySibling = join(getOpenClawConfigDir(), 'extensions', STO_TOOLKIT_DIR);
  if (!existsSync(fsPath(legacySibling))) return;
  try {
    rmSync(fsPath(legacySibling), { recursive: true, force: true });
    logger.info(`[plugin] Removed legacy extensions/${STO_TOOLKIT_DIR} (not an OpenClaw plugin)`);
  } catch (error) {
    logger.warn(`[plugin] Failed to remove legacy extensions/${STO_TOOLKIT_DIR}:`, error);
  }
}

const STO_WORKFLOW_DEV_SYNC_FILES = ['index.ts', 'api.ts', 'openclaw-sdk.ts', 'typebox-shim.ts', 'workflow-params.ts', 'workflow-search.ts', 'openclaw.plugin.json', 'package.json'] as const;

/** Reinstall bundled plugin when these files differ even if package.json version is unchanged. */
const PLUGIN_CONTENT_SYNC_FILES: Record<string, readonly string[]> = {
  'sto-dingtalk-send-guard': [
    'shared/dingtalk-send/dws-send-text.ts',
    'shared/dingtalk-prompts/dingtalk-mention-context.ts',
    'index.ts',
    'dingtalk-send-guard.ts',
    'openclaw.plugin.json',
  ],
  'sto-dynamic-agent-route': [
    'index.ts',
    'shared/retired-skills.ts',
    'shared/workspace-paths.ts',
  ],
};

const STO_DYNAMIC_ROUTE_RETIRED_SKILLS_REL = 'shared/retired-skills.ts';
const STO_DYNAMIC_ROUTE_WORKSPACE_PATHS_REL = 'shared/workspace-paths.ts';

function hashFileContent(filePath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(fsPath(filePath))).digest('hex');
  } catch {
    return null;
  }
}

function pluginBundledContentMatches(
  pluginDirName: string,
  sourceDir: string,
  targetDir: string,
): boolean {
  const files = PLUGIN_CONTENT_SYNC_FILES[pluginDirName];
  if (!files?.length) return true;

  for (const rel of files) {
    const srcHash = hashFileContent(join(sourceDir, rel));
    const dstHash = hashFileContent(join(targetDir, rel));
    if (!srcHash || !dstHash || srcHash !== dstHash) return false;
  }
  return true;
}

function readPluginDependencies(targetDir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(fsPath(join(targetDir, 'package.json')), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    return pkg.dependencies || {};
  } catch {
    return {};
  }
}

/** True when installed satisfies common npm ranges (^ / ~ / exact). */
function dependencyVersionSatisfied(installed: string, range: string): boolean {
  const trimmed = range.trim();
  if (!trimmed || trimmed === '*' || trimmed === 'latest') return true;

  if (trimmed.startsWith('^')) {
    const base = trimmed.slice(1);
    const baseMajor = parseInt(base.split(/[.+-]/)[0] ?? '', 10) || 0;
    const installedMajor = parseInt(installed.split(/[.+-]/)[0] ?? '', 10) || 0;
    if (installedMajor !== baseMajor) return false;
    return comparePluginVersions(installed, base) >= 0;
  }

  if (trimmed.startsWith('~')) {
    const base = trimmed.slice(1);
    const baseParts = base.split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
    const installedParts = installed.split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
    if (installedParts[0] !== baseParts[0] || installedParts[1] !== baseParts[1]) return false;
    return comparePluginVersions(installed, base) >= 0;
  }

  return comparePluginVersions(installed, trimmed) >= 0;
}

function channelPluginDepNodeModuleRoots(pluginDirName: string, bundledSource?: string): string[] {
  const roots: string[] = [];

  if (bundledSource) {
    roots.push(join(bundledSource, 'node_modules'));
  }
  for (const candidate of getBundledPluginSourceCandidates(pluginDirName)) {
    roots.push(join(candidate, 'node_modules'));
  }

  roots.push(join(getOpenClawDir(), 'node_modules'));
  const openclawNodeModules = getOpenClawNodeModulesPath();
  if (openclawNodeModules) {
    const delimiter = process.platform === 'win32' ? ';' : ':';
    for (const entry of openclawNodeModules.split(delimiter)) {
      if (entry.trim()) roots.push(entry.trim());
    }
  }

  if (!app.isPackaged) {
    roots.push(join(process.cwd(), 'build', 'openclaw-plugins', pluginDirName, 'node_modules'));
    const npmName = PLUGIN_NPM_NAMES[pluginDirName];
    if (npmName) {
      roots.push(join(process.cwd(), 'node_modules', ...npmName.split('/'), 'node_modules'));
    }
    roots.push(join(process.cwd(), 'node_modules'));
  }

  return [...new Set(roots.filter((root) => existsSync(fsPath(root))))];
}

function openClawSymlinkType(targetPath: string): 'dir' | 'file' | 'junction' {
  if (targetPath.endsWith('.asar')) return 'file';
  if (process.platform === 'win32') return 'junction';
  return 'dir';
}

/** Shared materialized openclaw package for packaged ASAR hosts (one copy for all channel plugins). */
function getOpenClawMaterializedPeerDir(): string {
  return join(getOpenClawConfigDir(), 'runtime', 'openclaw');
}

/**
 * Dist chunks import many packages from openclaw/node_modules (not just tslog).
 * Validate a representative set so incomplete materializations are refreshed.
 */
const OPENCLAW_PEER_RUNTIME_SENTINELS = ['tslog', 'json5', 'chalk'] as const;

function openClawPeerLinkIsValid(linkPath: string, expectedTarget: string): boolean {
  if (!existsSync(fsPath(linkPath))) return false;
  try {
    const stat = lstatSync(fsPath(linkPath));
    if (!stat.isSymbolicLink()) return false;
    const target = readlinkSync(fsPath(linkPath));
    const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
    const expected = fsPath(expectedTarget);
    return fsPath(resolved) === expected || realpathSync(fsPath(resolved)) === realpathSync(expected);
  } catch {
    return false;
  }
}

function openClawMaterializedPackageHasRuntimeDeps(openclawPkgPath: string): boolean {
  return OPENCLAW_PEER_RUNTIME_SENTINELS.every((depName) =>
    existsSync(fsPath(join(openclawPkgPath, 'node_modules', depName, 'package.json'))),
  );
}

function openClawPeerCoreLayoutPresent(openclawPkgPath: string): boolean {
  return existsSync(fsPath(join(openclawPkgPath, 'package.json')))
    && existsSync(fsPath(join(openclawPkgPath, 'openclaw.mjs')))
    && existsSync(fsPath(join(openclawPkgPath, 'dist/plugin-sdk/channel-config-schema.js')));
}

function openClawPeerPackageIsValid(openclawPkgPath: string, openclawRoot: string): boolean {
  if (!existsSync(fsPath(openclawPkgPath))) return false;

  const expectedLinkTarget = openclawRoot.endsWith('.asar')
    ? getOpenClawMaterializedPeerDir()
    : openclawRoot;

  try {
    const stat = lstatSync(fsPath(openclawPkgPath));
    if (stat.isSymbolicLink()) {
      if (!openClawPeerLinkIsValid(openclawPkgPath, expectedLinkTarget)) return false;
      // Symlink to a materialized runtime must still resolve a complete package.
      if (openclawRoot.endsWith('.asar')) {
        return openClawPeerCoreLayoutPresent(expectedLinkTarget)
          && openClawMaterializedPackageHasRuntimeDeps(expectedLinkTarget);
      }
      return true;
    }
    if (!stat.isDirectory()) return false;
  } catch {
    return false;
  }

  // Real directory peer (legacy in-plugin materialize / incomplete copy).
  if (!openClawPeerCoreLayoutPresent(openclawPkgPath)) return false;
  return openClawMaterializedPackageHasRuntimeDeps(openclawPkgPath);
}

function materializeOpenClawPeerFromAsar(openclawAsar: string, destRoot: string): void {
  if (existsSync(fsPath(destRoot))) {
    rmSync(fsPath(destRoot), { recursive: true, force: true });
  }
  mkdirSync(fsPath(destRoot), { recursive: true });
  for (const rel of ['package.json', 'openclaw.mjs'] as const) {
    const src = join(openclawAsar, rel);
    if (existsSync(fsPath(src))) {
      writeFileSync(fsPath(join(destRoot, rel)), readFileSync(src));
    }
  }
  const distSrc = join(openclawAsar, 'dist');
  if (existsSync(fsPath(distSrc))) {
    copyDirFromAsar(distSrc, join(destRoot, 'dist'));
  }
  // Dist chunks import the full runtime graph (tslog, json5, chalk, ...), not a single package.
  const nodeModulesSrc = join(openclawAsar, 'node_modules');
  if (existsSync(fsPath(nodeModulesSrc))) {
    copyDirFromAsar(nodeModulesSrc, join(destRoot, 'node_modules'));
  }
}

function ensureSharedOpenClawMaterializedPeer(openclawAsar: string): string {
  const sharedDir = getOpenClawMaterializedPeerDir();
  const runtimeVersion = readPluginVersion(join(openclawAsar, 'package.json'));
  const installedVersion = readPluginVersion(join(sharedDir, 'package.json'));
  const complete = openClawPeerCoreLayoutPresent(sharedDir)
    && openClawMaterializedPackageHasRuntimeDeps(sharedDir)
    && (!runtimeVersion || installedVersion === runtimeVersion);

  if (complete) return sharedDir;

  materializeOpenClawPeerFromAsar(openclawAsar, sharedDir);
  if (!openClawMaterializedPackageHasRuntimeDeps(sharedDir)) {
    throw new Error(
      `Materialized openclaw peer missing runtime deps (${OPENCLAW_PEER_RUNTIME_SENTINELS.join(', ')}) at ${sharedDir}`,
    );
  }
  logger.info(`[plugin] Materialized shared openclaw runtime at ${sharedDir} from ${openclawAsar}`);
  return sharedDir;
}

function linkOpenClawPeerIntoPlugin(pluginDir: string, openclawTarget: string): void {
  const targetNM = join(pluginDir, 'node_modules');
  const openclawPkgPath = join(targetNM, 'openclaw');
  mkdirSync(fsPath(targetNM), { recursive: true });

  if (openClawPeerLinkIsValid(openclawPkgPath, openclawTarget)) return;

  if (existsSync(fsPath(openclawPkgPath))) {
    rmSync(fsPath(openclawPkgPath), { recursive: true, force: true });
  }

  symlinkSync(openclawTarget, fsPath(openclawPkgPath), openClawSymlinkType(openclawTarget));
  logger.info(`[plugin] Linked openclaw peer dep into ${pluginDir} -> ${openclawTarget}`);
}

/** Channel plugins live outside the openclaw tree; they must resolve openclaw/* locally. */
export function channelPluginRuntimeLayoutComplete(pluginDirName: string, targetDir: string): boolean {
  if (!CHANNEL_NPM_PLUGIN_DIR_NAMES.has(pluginDirName)) return true;
  if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) return false;

  const openclawRoot = getOpenClawDir();
  const openclawPkgPath = join(targetDir, 'node_modules', 'openclaw');
  if (!openClawPeerPackageIsValid(openclawPkgPath, openclawRoot)) return false;

  for (const [depName, depRange] of Object.entries(readPluginDependencies(targetDir))) {
    if (depName === 'openclaw') continue;
    const depPkgJson = join(joinNodeModulePackage(join(targetDir, 'node_modules'), depName), 'package.json');
    const installedVersion = readPluginVersion(depPkgJson);
    if (!installedVersion || !dependencyVersionSatisfied(installedVersion, depRange)) {
      return false;
    }
  }
  return true;
}

function copyChannelPluginDependency(
  depName: string,
  depRange: string,
  targetNM: string,
  roots: readonly string[],
): void {
  const dest = joinNodeModulePackage(targetNM, depName);
  const installedVersion = readPluginVersion(join(dest, 'package.json'));
  if (installedVersion && dependencyVersionSatisfied(installedVersion, depRange)) {
    return;
  }

  if (existsSync(fsPath(dest))) {
    rmSync(fsPath(dest), { recursive: true, force: true });
  }

  for (const root of roots) {
    const src = joinNodeModulePackage(root, depName);
    const srcVersion = readPluginVersion(join(src, 'package.json'));
    if (!srcVersion || !dependencyVersionSatisfied(srcVersion, depRange)) continue;
    try {
      copyPathFromSource(src, dest);
      logger.info(`[plugin] Copied channel runtime dep ${depName}@${srcVersion} from ${src}`);
      return;
    } catch (error) {
      logger.warn(`[plugin] Failed to copy ${depName} from ${src}:`, error);
    }
  }

  logger.warn(`[plugin] Channel runtime dep ${depName} (${depRange}) not found in bundled/openclaw roots`);
}

function ensureChannelPluginRuntimeLayout(pluginDirName: string, sourceDir?: string): void {
  if (!CHANNEL_NPM_PLUGIN_DIR_NAMES.has(pluginDirName)) return;

  const targetDir = join(getOpenClawConfigDir(), 'extensions', pluginDirName);
  if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) return;

  ensureOpenClawPeerIntoPlugin(targetDir);

  const resolvedSource = sourceDir
    ?? pickPluginSourceDir(pluginDirName, getBundledPluginSourceCandidates(pluginDirName));
  const depRoots = channelPluginDepNodeModuleRoots(pluginDirName, resolvedSource);
  const targetNM = join(targetDir, 'node_modules');
  mkdirSync(fsPath(targetNM), { recursive: true });

  for (const [depName, depRange] of Object.entries(readPluginDependencies(targetDir))) {
    if (depName === 'openclaw') continue;
    copyChannelPluginDependency(depName, depRange, targetNM, depRoots);
  }
}

function ensureOpenClawPeerIntoPlugin(pluginDir: string): void {
  const openclawRoot = getOpenClawDir();
  if (!existsSync(fsPath(join(openclawRoot, 'package.json')))) {
    logger.warn(`[plugin] Cannot install openclaw peer dep; package root missing at ${openclawRoot}`);
    return;
  }

  const openclawPkgPath = join(pluginDir, 'node_modules', 'openclaw');
  if (openClawPeerPackageIsValid(openclawPkgPath, openclawRoot)) {
    return;
  }

  try {
    if (openclawRoot.endsWith('.asar')) {
      const sharedDir = ensureSharedOpenClawMaterializedPeer(openclawRoot);
      linkOpenClawPeerIntoPlugin(pluginDir, sharedDir);
      return;
    }
    linkOpenClawPeerIntoPlugin(pluginDir, openclawRoot);
  } catch (error) {
    logger.warn(`[plugin] Failed to install openclaw peer dep into ${pluginDir}:`, error);
  }
}

function shouldRefreshInstalledPlugin(
  pluginDirName: string,
  sourceDir: string,
  targetDir: string,
  installedVersion: string | null,
  sourceVersion: string | null,
): boolean {
  if (!sourceVersion || !installedVersion) return false;
  if (sourceVersion !== installedVersion) return true;
  if (!channelPluginRuntimeLayoutComplete(pluginDirName, targetDir)) return true;
  return !pluginBundledContentMatches(pluginDirName, sourceDir, targetDir);
}

function ensurePluginRuntimeDeps(pluginDirName: string): void {
  const targetDir = join(getOpenClawConfigDir(), 'extensions', pluginDirName);
  if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) return;
  copyPluginRuntimeDeps(pluginDirName, targetDir);
}

/** Dev-only: 整目录同步 sto-plugin → ~/.stoclaw/extensions（避免 build 镜像半迁移布局）。 */
function syncStoDingTalkSendGuardDevSources(_candidateSources: string[]): void {
  if (app.isPackaged) return;

  const sourceDir = getLocalPluginSourceCandidates('sto-dingtalk-send-guard').find((dir) =>
    existsSync(fsPath(join(dir, 'openclaw.plugin.json'))),
  );
  if (!sourceDir) return;

  const targetDir = join(getOpenClawConfigDir(), 'extensions', 'sto-dingtalk-send-guard');
  if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) return;

  for (const entry of readdirSync(fsPath(sourceDir), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const src = join(sourceDir, entry.name);
    const dest = join(targetDir, entry.name);
    cpSync(fsPath(src), fsPath(dest), { recursive: true, force: true });
  }
  logger.info(`[plugin] Synced sto-dingtalk-send-guard dev sources (full) from ${sourceDir}`);
}

/** Resolve the source of truth for the development workflow extension. */
export function resolveStoWorkflowToolDevSyncSource(candidateSources: string[]): string | undefined {
  return getLocalPluginSourceCandidates('sto-workflow-tool').find(
    (candidate) => existsSync(fsPath(join(candidate, 'openclaw.plugin.json'))),
  ) ?? pickPluginSourceDir('sto-workflow-tool', candidateSources);
}

/** Dev-only: keep ~/.stoclaw extension in sync with sto-plugin sources without a version bump. */
function syncStoWorkflowToolDevSources(candidateSources: string[]): void {
  if (app.isPackaged) return;
  // Dev runs must copy the checked-out plugin source even when a bundled copy
  // has the same package version. `pickPluginSourceDir` ranks equal versions
  // by candidate order, which otherwise leaves ~/.stoclaw on stale code.
  const sourceDir = resolveStoWorkflowToolDevSyncSource(candidateSources);
  if (!sourceDir) return;

  const targetDir = join(getOpenClawConfigDir(), 'extensions', 'sto-workflow-tool');
  if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) return;

  for (const file of STO_WORKFLOW_DEV_SYNC_FILES) {
    const src = join(sourceDir, file);
    if (!existsSync(fsPath(src))) continue;
    cpSync(fsPath(src), fsPath(join(targetDir, file)), { force: true });
  }
  logger.info(`[plugin] Synced sto-workflow-tool dev sources source=${sourceDir} target=${targetDir}`);
}

function ensureStoToolkitLibraryInstalled(): void {
  const workflowPluginDir = join(getOpenClawConfigDir(), 'extensions', 'sto-workflow-tool');
  const workflowManifest = join(workflowPluginDir, 'openclaw.plugin.json');
  if (!existsSync(fsPath(workflowManifest))) return;

  removeLegacyStoToolkitExtensionSibling();

  const targetDir = join(workflowPluginDir, STO_TOOLKIT_DIR);
  const sourceDir = pickStoToolkitSourceDir();
  if (!sourceDir) {
    logger.warn(`[plugin] ${STO_TOOLKIT_DIR} source not found; sto-workflow-tool may fail to load`);
    return;
  }
  try {
    rmSync(fsPath(targetDir), { recursive: true, force: true });
    copyPluginDir(sourceDir, targetDir);
    logger.info(`[plugin] Installed ${STO_TOOLKIT_DIR} into sto-workflow-tool from ${sourceDir}`);
    copyPluginRuntimeDeps('sto-workflow-tool', workflowPluginDir);
  } catch (error) {
    logger.warn(`[plugin] Failed to install ${STO_TOOLKIT_DIR}:`, error);
  }
}

function ensureStoBrowserBridgeToolkitInstalled(): void {
  const pluginDir = join(getOpenClawConfigDir(), 'extensions', 'sto-browser-bridge');
  const manifest = join(pluginDir, 'openclaw.plugin.json');
  if (!existsSync(fsPath(manifest))) return;

  const targetDir = join(pluginDir, STO_TOOLKIT_DIR);
  const sourceDir = pickStoToolkitSourceDir();
  if (!sourceDir) {
    logger.warn(`[plugin] ${STO_TOOLKIT_DIR} source not found; sto-browser-bridge may fail to load`);
    return;
  }
  try {
    rmSync(fsPath(targetDir), { recursive: true, force: true });
    copyPluginDir(sourceDir, targetDir);
    logger.info(`[plugin] Installed ${STO_TOOLKIT_DIR} into sto-browser-bridge from ${sourceDir}`);
    copyPluginRuntimeDeps('sto-browser-bridge', pluginDir);
  } catch (error) {
    logger.warn(`[plugin] Failed to install ${STO_TOOLKIT_DIR} for sto-browser-bridge:`, error);
  }
}

function resolveRetiredSkillsSourcePaths(pluginDirName: string): string[] {
  // Prefer the plugin-local / bundled self-contained copy so install targets
  // match what PLUGIN_CONTENT_SYNC_FILES hashes against (not root shared/).
  const candidates = [
    join(process.cwd(), 'sto-plugin', 'openclaw', pluginDirName, STO_DYNAMIC_ROUTE_RETIRED_SKILLS_REL),
    join(app.getAppPath(), 'sto-plugin', 'openclaw', pluginDirName, STO_DYNAMIC_ROUTE_RETIRED_SKILLS_REL),
    join(process.cwd(), 'shared', 'retired-skills.ts'),
    join(app.getAppPath(), 'shared', 'retired-skills.ts'),
  ];
  const bundled = pickPluginSourceDir(pluginDirName, buildCandidateSources(pluginDirName));
  if (bundled) {
    candidates.unshift(join(bundled, STO_DYNAMIC_ROUTE_RETIRED_SKILLS_REL));
  }
  return candidates;
}

function resolveWorkspacePathsSourcePaths(pluginDirName: string): string[] {
  // Prefer the plugin-local / bundled self-contained copy so install targets
  // match what PLUGIN_CONTENT_SYNC_FILES hashes against (not root shared/).
  const candidates = [
    join(process.cwd(), 'sto-plugin', 'openclaw', pluginDirName, STO_DYNAMIC_ROUTE_WORKSPACE_PATHS_REL),
    join(app.getAppPath(), 'sto-plugin', 'openclaw', pluginDirName, STO_DYNAMIC_ROUTE_WORKSPACE_PATHS_REL),
    join(process.cwd(), 'shared', 'workspace-paths.ts'),
    join(app.getAppPath(), 'shared', 'workspace-paths.ts'),
  ];
  const bundled = pickPluginSourceDir(pluginDirName, buildCandidateSources(pluginDirName));
  if (bundled) {
    candidates.unshift(join(bundled, STO_DYNAMIC_ROUTE_WORKSPACE_PATHS_REL));
  }
  return candidates;
}

/**
 * Ensure a self-contained shared file exists under the installed extension.
 * Copies when missing, or when content drifts from the preferred source
 * (so already-broken installs heal without a full plugin wipe).
 */
function ensureStoDynamicRouteSharedFile(
  targetDir: string,
  relativePath: string,
  sourcePaths: string[],
): void {
  const dest = join(targetDir, relativePath);
  const destHash = hashFileContent(dest);

  for (const source of sourcePaths) {
    if (!existsSync(fsPath(source))) continue;
    const srcHash = hashFileContent(source);
    if (!srcHash) continue;
    if (destHash === srcHash) return;

    mkdirSync(fsPath(join(targetDir, 'shared')), { recursive: true });
    cpSync(fsPath(source), fsPath(dest), { force: true });
    logger.info(
      `[plugin] ${destHash ? 'Updated' : 'Backfilled'} sto-dynamic-agent-route ${relativePath} from ${source}`,
    );
    return;
  }

  if (!destHash) {
    logger.warn(
      `[plugin] Missing sto-dynamic-agent-route ${relativePath}; plugin may fail to load`,
    );
  }
}

function ensureStoDynamicRouteSharedFiles(targetDir: string): void {
  ensureStoDynamicRouteSharedFile(
    targetDir,
    STO_DYNAMIC_ROUTE_RETIRED_SKILLS_REL,
    resolveRetiredSkillsSourcePaths('sto-dynamic-agent-route'),
  );
}

function ensureStoDynamicRouteWorkspacePathsFiles(targetDir: string): void {
  ensureStoDynamicRouteSharedFile(
    targetDir,
    STO_DYNAMIC_ROUTE_WORKSPACE_PATHS_REL,
    resolveWorkspacePathsSourcePaths('sto-dynamic-agent-route'),
  );
}

function afterStoPluginInstall(pluginDirName: string, sourceDir?: string): void {
  if (pluginDirName === 'sto-workflow-tool') {
    ensureStoToolkitLibraryInstalled();
  }
  if (pluginDirName === 'sto-browser-bridge') {
    ensureStoBrowserBridgeToolkitInstalled();
  }
  if (pluginDirName === 'sto-dynamic-agent-route') {
    const targetDir = join(getOpenClawConfigDir(), 'extensions', pluginDirName);
    ensureStoDynamicRouteSharedFiles(targetDir);
    ensureStoDynamicRouteWorkspacePathsFiles(targetDir);
  }
  if (pluginDirName === 'sto-user-skill-tool') {
    const targetDir = join(getOpenClawConfigDir(), 'extensions', pluginDirName);
    ensureStoDynamicRouteSharedFile(
      targetDir,
      'user-skill-write-guard.ts',
      [
        join(process.cwd(), 'sto-plugin', 'openclaw', 'sto-user-skill-tool', 'user-skill-write-guard.ts'),
        join(process.cwd(), 'shared', 'user-skill-write-guard.ts'),
        join(app.getAppPath(), 'shared', 'user-skill-write-guard.ts'),
      ],
    );
  }
  if (PLUGIN_RUNTIME_DEPS[pluginDirName]) {
    ensurePluginRuntimeDeps(pluginDirName);
  }
  ensureChannelPluginRuntimeLayout(pluginDirName, sourceDir);
}

// ── Version helper ───────────────────────────────────────────────────────────

function readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(fsPath(pkgJsonPath), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function comparePluginVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
  const pb = b.split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** Dev 模式下 sto-plugin/openclaw 本地源（优先于 build/openclaw-plugins 镜像）。 */
function isLocalStoOpenClawPluginSourceDir(pluginDirName: string, dir: string): boolean {
  const normalized = fsPath(dir);
  for (const localDir of getLocalPluginSourceCandidates(LOCAL_PLUGIN_DIRS[pluginDirName] ?? pluginDirName)) {
    if (normalized === fsPath(localDir)) return true;
  }
  return false;
}

/** 在 bundled / build / sto-plugin 等候选源中选版本最高且可用的目录。Dev 下同版本优先 sto-plugin。 */
function pickPluginSourceDir(
  pluginDirName: string,
  candidateSources: string[],
): string | undefined {
  const ranked: Array<{ dir: string; version: string }> = [];

  for (const dir of candidateSources) {
    if (!existsSync(fsPath(join(dir, 'openclaw.plugin.json')))) continue;
    const version = readPluginVersion(join(dir, 'package.json'));
    if (version) ranked.push({ dir, version });
  }

  if (!app.isPackaged) {
    const localDir = LOCAL_PLUGIN_DIRS[pluginDirName];
    if (localDir) {
      for (const localSourceDir of getLocalPluginSourceCandidates(localDir)) {
        if (existsSync(fsPath(join(localSourceDir, 'openclaw.plugin.json')))) {
          const version = readPluginVersion(join(localSourceDir, 'package.json'));
          if (version) ranked.push({ dir: localSourceDir, version });
        }
      }
    }
  }

  if (ranked.length === 0) return undefined;
  ranked.sort((left, right) => {
    const byVersion = comparePluginVersions(right.version, left.version);
    if (byVersion !== 0) return byVersion;
    // build/openclaw-plugins 镜像常滞后于 sto-plugin；同版本时 dev 优先本地源码。
    if (!app.isPackaged) {
      const leftLocal = isLocalStoOpenClawPluginSourceDir(pluginDirName, left.dir);
      const rightLocal = isLocalStoOpenClawPluginSourceDir(pluginDirName, right.dir);
      if (leftLocal !== rightLocal) return leftLocal ? -1 : 1;
    }
    return 0;
  });
  return ranked[0].dir;
}

// ── pnpm-aware node_modules copy helpers ─────────────────────────────────────

/** Walk up from a path until we find a parent named node_modules. */
function findParentNodeModules(startPath: string): string | null {
  let dir = startPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/** List packages inside a node_modules dir (handles @scoped packages). */
function listPackagesInDir(nodeModulesDir: string): Array<{ name: string; fullPath: string }> {
  const result: Array<{ name: string; fullPath: string }> = [];
  if (!existsSync(fsPath(nodeModulesDir))) return result;
  const SKIP = new Set(['.bin', '.package-lock.json', '.modules.yaml', '.pnpm']);
  for (const entry of readdirSync(fsPath(nodeModulesDir), { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIP.has(entry.name)) continue;
    const entryPath = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith('@')) {
      try {
        for (const sub of readdirSync(fsPath(entryPath))) {
          result.push({ name: `${entry.name}/${sub}`, fullPath: join(entryPath, sub) });
        }
      } catch { /* ignore */ }
    } else {
      result.push({ name: entry.name, fullPath: entryPath });
    }
  }
  return result;
}

/**
 * Copy a plugin from a pnpm node_modules location, including its
 * transitive runtime dependencies (replicates bundle-openclaw-plugins.mjs
 * logic).
 */
export function copyPluginFromNodeModules(npmPkgPath: string, targetDir: string, npmName: string): void {
  let realPath: string;
  try {
    realPath = realpathSync(fsPath(npmPkgPath));
  } catch {
    throw new Error(`Cannot resolve real path for ${npmPkgPath}`);
  }

  // 1. Copy plugin package itself
  rmSync(fsPath(targetDir), { recursive: true, force: true });
  mkdirSync(fsPath(targetDir), { recursive: true });
  cpSync(fsPath(realPath), fsPath(targetDir), { recursive: true, dereference: true });

  // 2. Collect transitive deps from pnpm virtual store
  const rootVirtualNM = findParentNodeModules(realPath);
  if (!rootVirtualNM) {
    logger.warn(`[plugin] Cannot find virtual store node_modules for ${npmName}, plugin may lack deps`);
    return;
  }

  // Read peer deps to skip (they're provided by the host gateway)
  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  try {
    const pluginPkg = JSON.parse(readFileSync(fsPath(join(targetDir, 'package.json')), 'utf-8'));
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch { /* ignore */ }

  const collected = new Map<string, string>(); // realPath → packageName
  const queue: Array<{ nodeModulesDir: string; skipPkg: string }> = [
    { nodeModulesDir: rootVirtualNM, skipPkg: npmName },
  ];

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift()!;
    for (const { name, fullPath } of listPackagesInDir(nodeModulesDir)) {
      if (name === skipPkg) continue;
      if (SKIP_PACKAGES.has(name) || name.startsWith('@types/')) continue;
      let depRealPath: string;
      try {
        depRealPath = realpathSync(fsPath(fullPath));
      } catch { continue; }
      if (collected.has(depRealPath)) continue;
      collected.set(depRealPath, name);
      const depVirtualNM = findParentNodeModules(depRealPath);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  // 3. Copy flattened deps into targetDir/node_modules/
  const outputNM = join(targetDir, 'node_modules');
  mkdirSync(fsPath(outputNM), { recursive: true });
  const copiedNames = new Set<string>();
  for (const [depRealPath, pkgName] of collected) {
    if (copiedNames.has(pkgName)) continue;
    copiedNames.add(pkgName);
    const dest = join(outputNM, pkgName);
    try {
      mkdirSync(fsPath(path.dirname(dest)), { recursive: true });
      cpSync(fsPath(depRealPath), fsPath(dest), { recursive: true, dereference: true });
    } catch { /* skip individual dep failures */ }
  }

  logger.info(`[plugin] Copied ${copiedNames.size} deps for ${npmName}`);
}

// ── Core install / upgrade logic ─────────────────────────────────────────────

export function ensurePluginInstalled(
  pluginDirName: string,
  candidateSources: string[],
  pluginLabel: string,
): { installed: boolean; warning?: string } {
  const targetDir = join(getOpenClawConfigDir(), 'extensions', pluginDirName);
  const targetManifest = join(targetDir, 'openclaw.plugin.json');
  const targetPkgJson = join(targetDir, 'package.json');

  const sourceDir = pickPluginSourceDir(pluginDirName, candidateSources);

  // If already installed, check whether an upgrade is available
  if (existsSync(fsPath(targetManifest))) {
    if (!sourceDir) {
      afterStoPluginInstall(pluginDirName);
      return { installed: true }; // no bundled source to compare, keep existing
    }
    const installedVersion = readPluginVersion(targetPkgJson);
    const sourceVersion = readPluginVersion(join(sourceDir, 'package.json'));
    if (!shouldRefreshInstalledPlugin(pluginDirName, sourceDir, targetDir, installedVersion, sourceVersion)) {
      afterStoPluginInstall(pluginDirName, sourceDir);
      return { installed: true }; // same version/content or unable to compare
    }
    if (sourceVersion && installedVersion && sourceVersion === installedVersion) {
      const refreshReason = !channelPluginRuntimeLayoutComplete(pluginDirName, targetDir)
        ? 'runtime layout incomplete'
        : 'bundled content changed';
      logger.info(
        `[plugin] Refreshing ${pluginLabel} plugin: ${refreshReason} (version ${installedVersion})`,
      );
    } else {
      // Version differs — fall through to overwrite install
      logger.info(
        `[plugin] Upgrading ${pluginLabel} plugin: ${installedVersion} → ${sourceVersion}`,
      );
    }
  }

  // Fresh install or upgrade — try bundled/build sources first
  if (sourceDir) {
    const extensionsRoot = join(getOpenClawConfigDir(), 'extensions');
    const attempts: Array<{ attempt: number; code?: string; name?: string; message: string }> = [];
    const maxAttempts = process.platform === 'win32' ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        mkdirSync(fsPath(extensionsRoot), { recursive: true });
        rmSync(fsPath(targetDir), { recursive: true, force: true });
        copyPluginDir(sourceDir, targetDir);
        if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) {
          return { installed: false, warning: `Failed to install ${pluginLabel} plugin mirror (manifest missing).` };
        }
        fixupPluginManifest(targetDir);
        afterStoPluginInstall(pluginDirName, sourceDir);
        logger.info(`Installed ${pluginLabel} plugin from bundled mirror: ${sourceDir}`);
        return { installed: true };
      } catch (error) {
        const diagnostic = toErrorDiagnostic(error);
        attempts.push({ attempt, ...diagnostic });
        if (attempt < maxAttempts) {
          try {
            rmSync(fsPath(targetDir), { recursive: true, force: true });
          } catch {
            // Ignore cleanup failures before retry.
          }
        }
      }
    }

    logger.warn(
      `[plugin] Bundled mirror install failed for ${pluginLabel}`,
      {
        pluginDirName,
        pluginLabel,
        sourceDir,
        targetDir,
        platform: process.platform,
        attempts,
      },
    );

    return { installed: false, warning: `Failed to install bundled ${pluginLabel} plugin mirror` };
  }

  // Dev mode fallback: copy from node_modules with pnpm-aware dep resolution
  if (!app.isPackaged) {
    const npmName = PLUGIN_NPM_NAMES[pluginDirName];
    if (npmName) {
      const npmPkgPath = join(process.cwd(), 'node_modules', ...npmName.split('/'));
      if (existsSync(fsPath(join(npmPkgPath, 'openclaw.plugin.json')))) {
        const installedVersion = existsSync(fsPath(targetPkgJson)) ? readPluginVersion(targetPkgJson) : null;
        const sourceVersion = readPluginVersion(join(npmPkgPath, 'package.json'));
        if (sourceVersion && (!installedVersion || sourceVersion !== installedVersion)) {
          logger.info(
            `[plugin] ${installedVersion ? 'Upgrading' : 'Installing'} ${pluginLabel} plugin` +
            `${installedVersion ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (dev/node_modules)`,
          );
          try {
            mkdirSync(fsPath(join(getOpenClawConfigDir(), 'extensions')), { recursive: true });
            copyPluginFromNodeModules(npmPkgPath, targetDir, npmName);
            fixupPluginManifest(targetDir);
            if (existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) {
              afterStoPluginInstall(pluginDirName, npmPkgPath);
              return { installed: true };
            }
          } catch (err) {
            logger.warn(
              `[plugin] Failed to install ${pluginLabel} plugin from node_modules`,
              {
                pluginDirName,
                pluginLabel,
                npmName,
                npmPkgPath,
                targetDir,
                platform: process.platform,
                ...toErrorDiagnostic(err),
              },
            );
          }
        } else if (existsSync(fsPath(targetManifest))) {
          afterStoPluginInstall(pluginDirName, npmPkgPath);
          return { installed: true }; // same version, already installed
        }
      }
    }

    // Dev mode fallback for local plugins: copy from sto-plugin/ directory
    const localDir = LOCAL_PLUGIN_DIRS[pluginDirName];
    if (localDir) {
      for (const localSourceDir of getLocalPluginSourceCandidates(localDir)) {
        if (existsSync(fsPath(join(localSourceDir, 'openclaw.plugin.json')))) {
          const installedVersion = existsSync(fsPath(targetPkgJson)) ? readPluginVersion(targetPkgJson) : null;
          const sourceVersion = readPluginVersion(join(localSourceDir, 'package.json'));
          if (sourceVersion && (!installedVersion || sourceVersion !== installedVersion)) {
            logger.info(
              `[plugin] ${installedVersion ? 'Upgrading' : 'Installing'} ${pluginLabel} plugin: ` +
              `${installedVersion ? `${installedVersion} → ${sourceVersion}` : sourceVersion} (dev/local sto-plugin source)`,
            );
            try {
              mkdirSync(fsPath(join(getOpenClawConfigDir(), 'extensions')), { recursive: true });
              rmSync(fsPath(targetDir), { recursive: true, force: true });
              cpSync(fsPath(localSourceDir), fsPath(targetDir), {
                recursive: true,
                filter: (src: string) => {
                  const base = path.basename(src);
                  if (/\.(test|spec)\.(ts|js)$/.test(base)) return false;
                  if (base === '__tests__' || base === 'node_modules') return false;
                  return true;
                },
              });
              fixupPluginManifest(targetDir);
              if (existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) {
                afterStoPluginInstall(pluginDirName, localSourceDir);
                return { installed: true };
              }
            } catch (err) {
              logger.warn(
                `[plugin] Failed to install ${pluginLabel} from local sto-plugin source`,
                toErrorDiagnostic(err),
              );
            }
          } else if (existsSync(fsPath(targetManifest))) {
            afterStoPluginInstall(pluginDirName, localSourceDir);
            return { installed: true }; // same version, already installed
          }
        }
      }
    }
  }

  return {
    installed: false,
    warning: `Bundled ${pluginLabel} plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
  };
}

// ── Candidate source path builder ────────────────────────────────────────────

export function buildCandidateSources(pluginDirName: string): string[] {
  return getBundledPluginSourceCandidates(pluginDirName);
}

// ── Per-channel plugin helpers ───────────────────────────────────────────────

export function ensureDingTalkPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('dingtalk', buildCandidateSources('dingtalk'), 'DingTalk');
}

export function ensureWeComPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('wecom', buildCandidateSources('wecom'), 'WeCom');
}

export function ensureQQBotPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('qqbot', buildCandidateSources('qqbot'), 'QQ Bot');
}

export function ensureWeChatPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('openclaw-weixin', buildCandidateSources('openclaw-weixin'), 'WeChat');
}

export function ensureStoDynamicRoutePluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'sto-dynamic-agent-route',
    buildCandidateSources('sto-dynamic-agent-route'),
    'STO Dynamic Route',
  );
}

export function ensureStoAgentTelemetryPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'sto-agent-telemetry',
    buildCandidateSources('sto-agent-telemetry'),
    'STO Agent Telemetry',
  );
}

export function ensureStoScheduledTaskToolPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'sto-scheduled-task-tool',
    buildCandidateSources('sto-scheduled-task-tool'),
    'STO Scheduled Task Tool',
  );
}

export function ensureStoWorkflowToolPluginInstalled(): { installed: boolean; warning?: string } {
  const candidateSources = buildCandidateSources('sto-workflow-tool');
  const result = ensurePluginInstalled(
    'sto-workflow-tool',
    candidateSources,
    'STO Workflow Tool',
  );
  if (result.installed) {
    syncStoWorkflowToolDevSources(candidateSources);
    ensureStoToolkitLibraryInstalled();
  }
  return result;
}

export function ensureStoUserSkillToolPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'sto-user-skill-tool',
    buildCandidateSources('sto-user-skill-tool'),
    'STO User Skill Tool',
  );
}

export function ensureStoBrowserBridgePluginInstalled(): { installed: boolean; warning?: string } {
  const result = ensurePluginInstalled(
    'sto-browser-bridge',
    buildCandidateSources('sto-browser-bridge'),
    'STO Browser Bridge',
  );
  if (result.installed) {
    ensureStoBrowserBridgeToolkitInstalled();
  }
  return result;
}

export function ensureStoSkillCallMonitorPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'sto-skill-call-monitor',
    buildCandidateSources('sto-skill-call-monitor'),
    'STO Skill Call Monitor',
  );
}

export function ensureStoMediaUnderstandingPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'sto-media-understanding',
    buildCandidateSources('sto-media-understanding'),
    'STO Media Understanding',
  );
}

export function ensureStoDingTalkSendGuardPluginInstalled(): { installed: boolean; warning?: string } {
  const candidateSources = buildCandidateSources('sto-dingtalk-send-guard');
  const result = ensurePluginInstalled(
    'sto-dingtalk-send-guard',
    candidateSources,
    'STO DingTalk Send Guard',
  );
  if (result.installed) {
    syncStoDingTalkSendGuardDevSources(candidateSources);
  }
  return result;
}

// ── Bulk startup installer ───────────────────────────────────────────────────

/**
 * All bundled plugins, in the same order as after-pack.cjs BUNDLED_PLUGINS.
 */
const ALL_BUNDLED_PLUGINS = [
  // { fn: ensureDingTalkPluginInstalled, label: 'DingTalk' },
  { fn: ensureWeComPluginInstalled, label: 'WeCom' },
  { fn: ensureQQBotPluginInstalled, label: 'QQ Bot' },
  { fn: ensureWeChatPluginInstalled, label: 'WeChat' },
  { fn: ensureStoDynamicRoutePluginInstalled, label: 'STO Dynamic Route' },
  { fn: ensureStoAgentTelemetryPluginInstalled, label: 'STO Agent Telemetry' },
  { fn: ensureStoScheduledTaskToolPluginInstalled, label: 'STO Scheduled Task Tool' },
  { fn: ensureStoWorkflowToolPluginInstalled, label: 'STO Workflow Tool' },
  { fn: ensureStoUserSkillToolPluginInstalled, label: 'STO User Skill Tool' },
  { fn: ensureStoBrowserBridgePluginInstalled, label: 'STO Browser Bridge' },
  { fn: ensureStoSkillCallMonitorPluginInstalled, label: 'STO Skill Call Monitor' },
  { fn: ensureStoMediaUnderstandingPluginInstalled, label: 'STO Media Understanding' },
  { fn: ensureStoDingTalkSendGuardPluginInstalled, label: 'STO DingTalk Send Guard' },
] as const;

async function ensurePluginInstalledAsync(
  pluginDirName: string,
  candidateSources: string[],
  pluginLabel: string,
): Promise<{ installed: boolean; warning?: string }> {
  const targetDir = join(getOpenClawConfigDir(), 'extensions', pluginDirName);
  const targetManifest = join(targetDir, 'openclaw.plugin.json');
  const targetPkgJson = join(targetDir, 'package.json');
  const sourceDir = pickPluginSourceDir(pluginDirName, candidateSources);

  // Development startup used to call the generic installer here. That bypassed
  // `syncStoWorkflowToolDevSources`, leaving the Gateway on an older
  // ~/.stoclaw extension even though the Electron source had changed. Use the
  // workflow-specific installer so its checked-out source is always mirrored
  // before Gateway starts.
  if (!app.isPackaged) {
    if (pluginDirName === 'sto-workflow-tool') {
      return ensureStoWorkflowToolPluginInstalled();
    }
    return ensurePluginInstalled(pluginDirName, candidateSources, pluginLabel);
  }

  if (existsSync(fsPath(targetManifest))) {
    if (!sourceDir) {
      afterStoPluginInstall(pluginDirName);
      return { installed: true };
    }
    const installedVersion = readPluginVersion(targetPkgJson);
    const sourceVersion = readPluginVersion(join(sourceDir, 'package.json'));
    if (!shouldRefreshInstalledPlugin(pluginDirName, sourceDir, targetDir, installedVersion, sourceVersion)) {
      afterStoPluginInstall(pluginDirName, sourceDir);
      return { installed: true };
    }
    if (sourceVersion && installedVersion && sourceVersion === installedVersion) {
      const refreshReason = !channelPluginRuntimeLayoutComplete(pluginDirName, targetDir)
        ? 'runtime layout incomplete'
        : 'bundled content changed';
      logger.info(
        `[plugin] Refreshing ${pluginLabel} plugin: ${refreshReason} (version ${installedVersion})`,
      );
    } else {
      logger.info(
        `[plugin] Upgrading ${pluginLabel} plugin: ${installedVersion} → ${sourceVersion}`,
      );
    }
  }

  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled ${pluginLabel} plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
    };
  }

  const extensionsRoot = join(getOpenClawConfigDir(), 'extensions');
  const attempts: Array<{ attempt: number; code?: string; name?: string; message: string }> = [];
  const maxAttempts = process.platform === 'win32' ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await mkdirAsync(fsPath(extensionsRoot), { recursive: true });
      await rmAsync(fsPath(targetDir), { recursive: true, force: true });
      if (isAsarPath(sourceDir)) {
        copyDirFromAsar(sourceDir, targetDir);
      } else {
        await cpAsync(fsPath(sourceDir), fsPath(targetDir), { recursive: true, force: true });
      }
      if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) {
        return { installed: false, warning: `Failed to install ${pluginLabel} plugin mirror (manifest missing).` };
      }
      fixupPluginManifest(targetDir);
      afterStoPluginInstall(pluginDirName, sourceDir);
      logger.info(`Installed ${pluginLabel} plugin from bundled mirror (async): ${sourceDir}`);
      return { installed: true };
    } catch (error) {
      const diagnostic = toErrorDiagnostic(error);
      attempts.push({ attempt, ...diagnostic });
      if (attempt < maxAttempts) {
        try {
          await rmAsync(fsPath(targetDir), { recursive: true, force: true });
        } catch {
          // Ignore cleanup failures before retry.
        }
      }
    }
  }

  logger.warn(
    `[plugin] Async bundled mirror install failed for ${pluginLabel}`,
    {
      pluginDirName,
      pluginLabel,
      sourceDir,
      targetDir,
      platform: process.platform,
      attempts,
    },
  );

  return { installed: false, warning: `Failed to install bundled ${pluginLabel} plugin mirror` };
}

/**
 * Ensure all bundled OpenClaw plugins are installed/upgraded in
 * `~/.stoclaw/openclaw/extensions/`.  Designed to be called once at app startup
 * as a fire-and-forget task — errors are logged but never thrown.
 */
export async function ensureAllBundledPluginsInstalled(): Promise<void> {
  for (const { fn, label } of ALL_BUNDLED_PLUGINS) {
    try {
      const result = fn();
      if (result.warning) {
        logger.warn(`[plugin] ${label}: ${result.warning}`);
      }
    } catch (error) {
      logger.warn(`[plugin] Failed to install/upgrade ${label} plugin:`, error);
    }
  }
}

/**
 * Async variant for startup paths where we want heavy file copies to run on
 * fs worker threads instead of blocking the Electron main thread.
 */
export async function ensureAllBundledPluginsInstalledAsync(): Promise<void> {
  const pluginSpecs = [
    // { dirName: 'dingtalk', label: 'DingTalk' },
    { dirName: 'wecom', label: 'WeCom' },
    { dirName: 'qqbot', label: 'QQ Bot' },
    { dirName: 'openclaw-weixin', label: 'WeChat' },
    { dirName: 'sto-dynamic-agent-route', label: 'STO Dynamic Route' },
    { dirName: 'sto-agent-telemetry', label: 'STO Agent Telemetry' },
    { dirName: 'sto-scheduled-task-tool', label: 'STO Scheduled Task Tool' },
    { dirName: 'sto-workflow-tool', label: 'STO Workflow Tool' },
    { dirName: 'sto-user-skill-tool', label: 'STO User Skill Tool' },
    { dirName: 'sto-browser-bridge', label: 'STO Browser Bridge' },
    { dirName: 'sto-skill-call-monitor', label: 'STO Skill Call Monitor' },
    { dirName: 'sto-media-understanding', label: 'STO Media Understanding' },
    { dirName: 'sto-dingtalk-send-guard', label: 'STO DingTalk Send Guard' },
  ] as const;

  for (const { dirName, label } of pluginSpecs) {
    try {
      const result = await ensurePluginInstalledAsync(dirName, buildCandidateSources(dirName), label);
      if (result.warning) {
        logger.warn(`[plugin] ${label}: ${result.warning}`);
      }
    } catch (error) {
      logger.warn(`[plugin] Failed to install/upgrade ${label} plugin (async):`, error);
    }
  }
}
