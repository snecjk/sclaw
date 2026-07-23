/**
 * Claude engine skill adapter: projects canonical store → ~/.stoclaw/.claude/skills.
 * Reuses content-hash + bridge-marker sync semantics from the former claude-skill-bridge.
 */
import { constants } from 'node:fs';
import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getClaudeSkillsDir } from '../../../utils/paths';
import { logger } from '../../../utils/logger';
import type {
  EngineSkillAdapter,
  EngineSkillContext,
  ReconcileResult,
  SkillPackage,
} from './engine-skill-adapter';

const BRIDGE_MARKER_FILE = '.stoclaw-claude-skill-bridge.json';
const BRIDGE_MARKER_SOURCE = 'stoclaw-openclaw-skills';

type BridgeMarker = {
  source?: string;
  slug?: string;
  scope?: SkillPackage['scope'];
  sourceDir?: string;
  syncedAt?: string;
  contentHash?: string;
};

type SkillDirectoryFingerprintCacheEntry = {
  contentHash: string;
  snapshotKey: string;
};

const skillDirectoryFingerprintCache = new Map<string, SkillDirectoryFingerprintCacheEntry>();

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readBridgeMarker(targetDir: string): Promise<boolean> {
  return fileExists(join(targetDir, BRIDGE_MARKER_FILE));
}

async function readBridgeMarkerPayload(targetDir: string): Promise<BridgeMarker | null> {
  const markerPath = join(targetDir, BRIDGE_MARKER_FILE);
  if (!(await fileExists(markerPath))) {
    return null;
  }
  try {
    const raw = await readFile(markerPath, 'utf-8');
    const parsed = JSON.parse(raw) as BridgeMarker;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    logger.warn(`Failed to read Claude skill bridge marker: ${markerPath}`, error);
    return null;
  }
}

async function writeBridgeMarker(targetDir: string, payload: Record<string, unknown>): Promise<void> {
  await writeFile(join(targetDir, BRIDGE_MARKER_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

async function buildSkillDirectorySnapshot(rootDir: string): Promise<string[]> {
  const snapshot: string[] = [];

  async function walk(currentDir: string, relativeDir = ''): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name === BRIDGE_MARKER_FILE) continue;
      const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        snapshot.push(`dir:${relativePath}`);
        await walk(fullPath, relativePath);
        continue;
      }

      const entryStat = await stat(fullPath);
      if (entry.isFile()) {
        snapshot.push(`file:${relativePath}:${entryStat.size}:${entryStat.mtimeMs}`);
        continue;
      }
      snapshot.push(`other:${relativePath}:${entryStat.size}:${entryStat.mtimeMs}`);
    }
  }

  await walk(rootDir);
  return snapshot;
}

async function hashSkillDirectory(rootDir: string): Promise<string> {
  const snapshot = await buildSkillDirectorySnapshot(rootDir);
  const snapshotKey = snapshot.join('\n');
  const cached = skillDirectoryFingerprintCache.get(rootDir);
  if (cached?.snapshotKey === snapshotKey) {
    return cached.contentHash;
  }

  const digest = createHash('sha1');
  for (const line of snapshot) {
    digest.update(line);
    digest.update('\n');
  }

  for (const line of snapshot) {
    if (!line.startsWith('file:')) continue;
    const relativePath = line.slice('file:'.length).split(':', 1)[0];
    const content = await readFile(join(rootDir, relativePath));
    digest.update(content);
    digest.update('\n');
  }

  const contentHash = digest.digest('hex');
  skillDirectoryFingerprintCache.set(rootDir, { contentHash, snapshotKey });
  return contentHash;
}

async function mirrorPackage(pkg: SkillPackage, targetDir: string): Promise<boolean> {
  const targetExists = await fileExists(targetDir);
  const managedByBridge = targetExists ? await readBridgeMarker(targetDir) : false;

  if (targetExists && !managedByBridge) {
    return false;
  }

  const sourceHash = await hashSkillDirectory(pkg.sourceDir);
  if (targetExists) {
    const marker = await readBridgeMarkerPayload(targetDir);
    const targetManifest = join(targetDir, 'SKILL.md');
    const isInSync = Boolean(
      marker
      && marker.source === BRIDGE_MARKER_SOURCE
      && marker.slug === pkg.slug
      && marker.scope === pkg.scope
      && marker.sourceDir === pkg.sourceDir
      && marker.contentHash === sourceHash
      && await fileExists(targetManifest),
    );
    if (isInSync) {
      return true;
    }
    await rm(targetDir, { recursive: true, force: true });
  }

  await cp(pkg.sourceDir, targetDir, { recursive: true, force: true });
  await writeBridgeMarker(targetDir, {
    source: BRIDGE_MARKER_SOURCE,
    slug: pkg.slug,
    scope: pkg.scope,
    sourceDir: pkg.sourceDir,
    contentHash: sourceHash,
    syncedAt: new Date().toISOString(),
  });
  return true;
}

export class ClaudeSkillAdapter implements EngineSkillAdapter {
  readonly id = 'claude' as const;

  async applyInstall(pkg: SkillPackage, _ctx: EngineSkillContext): Promise<void> {
    if (!pkg.enabled) {
      await this.applyUninstall(pkg.slug, _ctx);
      return;
    }
    const targetRoot = getClaudeSkillsDir();
    await mkdir(targetRoot, { recursive: true });
    const targetDir = join(targetRoot, pkg.slug);
    const ok = await mirrorPackage(pkg, targetDir);
    if (!ok) {
      logger.warn(`Skipping Claude skill install for ${pkg.slug}: unmanaged conflict`, { targetDir });
    }
  }

  async applyUninstall(slug: string, _ctx: EngineSkillContext): Promise<void> {
    const targetDir = join(getClaudeSkillsDir(), slug);
    if (!(await fileExists(targetDir))) return;
    const managed = await readBridgeMarker(targetDir);
    if (!managed) {
      logger.warn(`Skipping Claude skill uninstall for ${slug}: unmanaged conflict`, { targetDir });
      return;
    }
    await rm(targetDir, { recursive: true, force: true });
  }

  async applyEnabled(slug: string, enabled: boolean, ctx: EngineSkillContext): Promise<void> {
    if (!enabled) {
      await this.applyUninstall(slug, ctx);
    }
    // Enabling requires the package source; SkillManager will call applyInstall after setEnabled.
  }

  async reconcile(desired: SkillPackage[], _ctx: EngineSkillContext): Promise<ReconcileResult> {
    const targetRoot = getClaudeSkillsDir();
    await mkdir(targetRoot, { recursive: true });

    const mirrored: string[] = [];
    const removed: string[] = [];
    const skippedConflicts: string[] = [];
    const desiredEnabled = desired.filter((pkg) => pkg.enabled);
    const desiredSlugs = new Set(desiredEnabled.map((pkg) => pkg.slug));

    for (const pkg of desiredEnabled) {
      if (!(await fileExists(join(pkg.sourceDir, 'SKILL.md')))) continue;
      const targetDir = join(targetRoot, pkg.slug);
      const targetExists = await fileExists(targetDir);
      const managedByBridge = targetExists ? await readBridgeMarker(targetDir) : false;

      if (targetExists && !managedByBridge) {
        skippedConflicts.push(pkg.slug);
        logger.warn(`Skipping Claude skill bridge for ${pkg.slug}: target already exists and is not bridge-managed`, {
          targetDir,
        });
        continue;
      }

      const beforeHash = targetExists
        ? (await readBridgeMarkerPayload(targetDir))?.contentHash
        : undefined;
      await mirrorPackage(pkg, targetDir);
      const afterHash = (await readBridgeMarkerPayload(targetDir))?.contentHash;
      if (beforeHash !== afterHash || !targetExists) {
        mirrored.push(pkg.slug);
      }
    }

    let targetEntries: Array<import('node:fs').Dirent>;
    try {
      targetEntries = await readdir(targetRoot, { withFileTypes: true });
    } catch {
      targetEntries = [];
    }

    for (const entry of targetEntries) {
      if (!entry.isDirectory()) continue;
      const targetDir = join(targetRoot, entry.name);
      const managedByBridge = await readBridgeMarker(targetDir);
      if (!managedByBridge) continue;
      if (desiredSlugs.has(entry.name)) continue;
      await rm(targetDir, { recursive: true, force: true });
      removed.push(entry.name);
    }

    return { mirrored, removed, skippedConflicts };
  }

  async cleanupOrphanProjections(): Promise<void> {
    const targetRoot = getClaudeSkillsDir();
    if (!(await fileExists(targetRoot))) return;
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await readdir(targetRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const targetDir = join(targetRoot, entry.name);
      if (!(await readBridgeMarker(targetDir))) continue;
      await rm(targetDir, { recursive: true, force: true });
    }
  }
}
