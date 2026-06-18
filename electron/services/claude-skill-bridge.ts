import { constants } from 'node:fs';
import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readOpenClawConfig } from '../utils/channel-config';
import { getClawXConfigDir, getOpenClawAgentSkillsDir, getOpenClawSkillsDir } from '../utils/paths';
import { logger } from '../utils/logger';

const BRIDGE_MARKER_FILE = '.stoclaw-claude-skill-bridge.json';
const BRIDGE_MARKER_SOURCE = 'stoclaw-openclaw-skills';

type OpenClawConfig = {
  skills?: {
    entries?: Record<string, {
      enabled?: boolean;
    }>;
  };
};

type SkillSource = {
  slug: string;
  sourceDir: string;
  scope: 'global' | 'agent';
};

type BridgeMarker = {
  source?: string;
  slug?: string;
  scope?: SkillSource['scope'];
  sourceDir?: string;
  syncedAt?: string;
  contentHash?: string;
};

type SkillDirectoryFingerprintCacheEntry = {
  contentHash: string;
  snapshotKey: string;
};

const skillDirectoryFingerprintCache = new Map<string, SkillDirectoryFingerprintCacheEntry>();

function getClaudeBridgeSkillsDir(): string {
  return join(getClawXConfigDir(), '.claude', 'skills');
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listSkillDirectories(baseDir: string, scope: SkillSource['scope']): Promise<SkillSource[]> {
  if (!(await fileExists(baseDir))) {
    return [];
  }

  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    logger.warn(`Failed to read Claude skill bridge source directory: ${baseDir}`, error);
    return [];
  }

  const results: SkillSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceDir = join(baseDir, entry.name);
    const skillManifest = join(sourceDir, 'SKILL.md');
    if (!(await fileExists(skillManifest))) continue;
    results.push({
      slug: entry.name,
      sourceDir,
      scope,
    });
  }
  return results;
}

function isSkillEnabled(config: OpenClawConfig, slug: string): boolean {
  return config.skills?.entries?.[slug]?.enabled !== false;
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
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
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
      if (entry.name === BRIDGE_MARKER_FILE) {
        continue;
      }

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
    if (!line.startsWith('file:')) {
      continue;
    }

    const relativePath = line.slice('file:'.length).split(':', 1)[0];
    const content = await readFile(join(rootDir, relativePath));
    digest.update(content);
    digest.update('\n');
  }

  const contentHash = digest.digest('hex');
  skillDirectoryFingerprintCache.set(rootDir, {
    contentHash,
    snapshotKey,
  });
  return contentHash;
}

export async function syncClaudeSkillsForAgent(
  agentId: string,
  _workspacePath: string,
): Promise<{ mirrored: string[]; skippedConflicts: string[] }> {
  const targetRoot = getClaudeBridgeSkillsDir();
  await mkdir(targetRoot, { recursive: true });

  const config = await readOpenClawConfig() as OpenClawConfig;
  const globalSkills = await listSkillDirectories(getOpenClawSkillsDir(), 'global');
  const agentSkills = await listSkillDirectories(getOpenClawAgentSkillsDir(agentId), 'agent');

  const desiredSkills = new Map<string, SkillSource>();
  for (const skill of globalSkills) {
    if (isSkillEnabled(config, skill.slug)) {
      desiredSkills.set(skill.slug, skill);
    }
  }
  for (const skill of agentSkills) {
    if (isSkillEnabled(config, skill.slug)) {
      desiredSkills.set(skill.slug, skill);
    }
  }

  const mirrored: string[] = [];
  const skippedConflicts: string[] = [];

  for (const [slug, skill] of desiredSkills) {
    const targetDir = join(targetRoot, slug);
    const targetExists = await fileExists(targetDir);
    const managedByBridge = targetExists ? await readBridgeMarker(targetDir) : false;

    if (targetExists && !managedByBridge) {
      skippedConflicts.push(slug);
      logger.warn(`Skipping Claude skill bridge for ${slug}: target already exists and is not bridge-managed`, { targetDir });
      continue;
    }

    const sourceHash = await hashSkillDirectory(skill.sourceDir);
    if (targetExists) {
      const marker = await readBridgeMarkerPayload(targetDir);
      const targetManifest = join(targetDir, 'SKILL.md');
      const isInSync = Boolean(
        marker
        && marker.source === BRIDGE_MARKER_SOURCE
        && marker.slug === slug
        && marker.scope === skill.scope
        && marker.sourceDir === skill.sourceDir
        && marker.contentHash === sourceHash
        && await fileExists(targetManifest),
      );
      if (isInSync) {
        continue;
      }

      await rm(targetDir, { recursive: true, force: true });
    }

    await cp(skill.sourceDir, targetDir, { recursive: true, force: true });
    await writeBridgeMarker(targetDir, {
      source: BRIDGE_MARKER_SOURCE,
      slug,
      scope: skill.scope,
      sourceDir: skill.sourceDir,
      contentHash: sourceHash,
      syncedAt: new Date().toISOString(),
    });
    mirrored.push(slug);
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
    if (desiredSkills.has(entry.name)) continue;
    await rm(targetDir, { recursive: true, force: true });
  }

  return { mirrored, skippedConflicts };
}

export async function listClaudeBridgedSkillNames(_workspacePath: string): Promise<string[]> {
  const targetRoot = getClaudeBridgeSkillsDir();
  if (!(await fileExists(targetRoot))) {
    return [];
  }

  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await readdir(targetRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const targetDir = join(targetRoot, entry.name);
    const skillManifest = join(targetDir, 'SKILL.md');
    if (!(await fileExists(skillManifest))) continue;
    results.push(entry.name);
  }

  return results.sort((left, right) => left.localeCompare(right));
}
