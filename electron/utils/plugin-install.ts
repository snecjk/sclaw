/**
 * Shared OpenClaw Plugin Install Utilities
 *
 * Provides version-aware install/upgrade logic for bundled OpenClaw plugins
 * (DingTalk, WeCom, QQBot, WeChat).  Used both at app startup (to auto-upgrade
 * stale plugins) and when a user configures a channel.
 */
import { app } from 'electron';
import path from 'node:path';
import { existsSync, cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { cp as cpAsync, mkdir as mkdirAsync, rm as rmAsync } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger';
import { getOpenClawConfigDir, getBundledPluginSourceCandidates } from './paths';

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

// ── Local plugin directory mapping ───────────────────────────────────────────
// Maps plugin dir names to their source directory under sto-plugin/.

const LOCAL_PLUGIN_DIRS: Record<string, string> = {
  'sto-dynamic-agent-route': 'sto-dynamic-agent-route',
  'sto-agent-telemetry': 'sto-agent-telemetry',
  'sto-scheduled-task-tool': 'sto-scheduled-task-tool',
  'sto-workflow-tool': 'sto-workflow-tool',
  'sto-skill-call-monitor': 'sto-skill-call-monitor',
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

/** Shared library copied beside workflow-tool for ../sto-toolkit imports at runtime. */
const STO_TOOLKIT_DIR = 'sto-toolkit';

function pickStoToolkitSourceDir(): string | undefined {
  const candidates = [
    ...getBundledPluginSourceCandidates(STO_TOOLKIT_DIR),
    join(process.cwd(), 'sto-plugin', STO_TOOLKIT_DIR),
    join(app.getAppPath(), 'sto-plugin', STO_TOOLKIT_DIR),
  ];
  for (const dir of candidates) {
    if (existsSync(fsPath(join(dir, 'index.ts')))) return dir;
  }
  return undefined;
}

/** Runtime deps not declared in plugin package.json — copied from app node_modules. */
const WORKFLOW_TOOL_RUNTIME_DEPS = ['@sinclair/typebox'] as const;

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

function copyWorkflowToolRuntimeDeps(workflowPluginDir: string): void {
  const nodeModuleRoots = [
    join(process.cwd(), 'node_modules'),
    join(app.getAppPath(), 'node_modules'),
  ];
  const outputNM = join(workflowPluginDir, 'node_modules');
  mkdirSync(fsPath(outputNM), { recursive: true });

  for (const depName of WORKFLOW_TOOL_RUNTIME_DEPS) {
    const dest = join(outputNM, depName);
    if (existsSync(fsPath(dest))) continue;

    let copied = false;
    for (const root of nodeModuleRoots) {
      const src = join(root, depName);
      if (!existsSync(fsPath(src))) continue;
      try {
        mkdirSync(fsPath(path.dirname(dest)), { recursive: true });
        cpSync(fsPath(src), fsPath(dest), { recursive: true, dereference: true });
        copied = true;
        logger.info(`[plugin] Copied runtime dep ${depName} for sto-workflow-tool`);
        break;
      } catch (error) {
        logger.warn(`[plugin] Failed to copy ${depName} from ${src}:`, error);
      }
    }
    if (!copied) {
      logger.warn(`[plugin] Runtime dep ${depName} not found; sto-workflow-tool may fail to load`);
    }
  }
}

const STO_WORKFLOW_DEV_SYNC_FILES = ['index.ts', 'api.ts', 'workflow-params.ts', 'workflow-search.ts', 'openclaw.plugin.json', 'package.json'] as const;

/** Dev-only: keep ~/.stoclaw extension in sync with sto-plugin sources without a version bump. */
function syncStoWorkflowToolDevSources(candidateSources: string[]): void {
  if (app.isPackaged) return;
  const sourceDir = pickPluginSourceDir('sto-workflow-tool', candidateSources);
  if (!sourceDir) return;

  const targetDir = join(getOpenClawConfigDir(), 'extensions', 'sto-workflow-tool');
  if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) return;

  for (const file of STO_WORKFLOW_DEV_SYNC_FILES) {
    const src = join(sourceDir, file);
    if (!existsSync(fsPath(src))) continue;
    cpSync(fsPath(src), fsPath(join(targetDir, file)), { force: true });
  }
  logger.info(`[plugin] Synced sto-workflow-tool dev sources from ${sourceDir}`);
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
    copyWorkflowToolRuntimeDeps(workflowPluginDir);
  } catch (error) {
    logger.warn(`[plugin] Failed to install ${STO_TOOLKIT_DIR}:`, error);
  }
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

/** 在 bundled / build / sto-plugin 等候选源中选版本最高且可用的目录。 */
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
  ranked.sort((left, right) => comparePluginVersions(right.version, left.version));
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
      if (pluginDirName === 'sto-workflow-tool') ensureStoToolkitLibraryInstalled();
      return { installed: true }; // no bundled source to compare, keep existing
    }
    const installedVersion = readPluginVersion(targetPkgJson);
    const sourceVersion = readPluginVersion(join(sourceDir, 'package.json'));
    if (!sourceVersion || !installedVersion || sourceVersion === installedVersion) {
      if (pluginDirName === 'sto-workflow-tool') ensureStoToolkitLibraryInstalled();
      return { installed: true }; // same version or unable to compare
    }
    // Version differs — fall through to overwrite install
    logger.info(
      `[plugin] Upgrading ${pluginLabel} plugin: ${installedVersion} → ${sourceVersion}`,
    );
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
        if (pluginDirName === 'sto-workflow-tool') {
          ensureStoToolkitLibraryInstalled();
        }
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
                if (pluginDirName === 'sto-workflow-tool') {
                  ensureStoToolkitLibraryInstalled();
                }
                return { installed: true };
              }
            } catch (err) {
              logger.warn(
                `[plugin] Failed to install ${pluginLabel} from local sto-plugin source`,
                toErrorDiagnostic(err),
              );
            }
          } else if (existsSync(fsPath(targetManifest))) {
            if (pluginDirName === 'sto-workflow-tool') {
              ensureStoToolkitLibraryInstalled();
            }
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

export function ensureStoSkillCallMonitorPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'sto-skill-call-monitor',
    buildCandidateSources('sto-skill-call-monitor'),
    'STO Skill Call Monitor',
  );
}

export function ensureStoDingTalkSendGuardPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'sto-dingtalk-send-guard',
    buildCandidateSources('sto-dingtalk-send-guard'),
    'STO DingTalk Send Guard',
  );
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
  { fn: ensureStoSkillCallMonitorPluginInstalled, label: 'STO Skill Call Monitor' },
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

  // Keep dev behavior unchanged (including node_modules fallback) by
  // delegating to the existing sync implementation outside packaged mode.
  if (!app.isPackaged) {
    return ensurePluginInstalled(pluginDirName, candidateSources, pluginLabel);
  }

  if (existsSync(fsPath(targetManifest))) {
    if (!sourceDir) return { installed: true };
    const installedVersion = readPluginVersion(targetPkgJson);
    const sourceVersion = readPluginVersion(join(sourceDir, 'package.json'));
    if (!sourceVersion || !installedVersion || sourceVersion === installedVersion) {
      return { installed: true };
    }
    logger.info(
      `[plugin] Upgrading ${pluginLabel} plugin: ${installedVersion} → ${sourceVersion}`,
    );
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
      if (pluginDirName === 'sto-workflow-tool') {
        ensureStoToolkitLibraryInstalled();
      }
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
    { dirName: 'sto-skill-call-monitor', label: 'STO Skill Call Monitor' },
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

  // Async path bypasses ensureStoWorkflowToolPluginInstalled wrapper — always sync toolkit.
  ensureStoToolkitLibraryInstalled();
}
