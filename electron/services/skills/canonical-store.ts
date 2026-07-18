/**
 * Canonical skills store: engine-agnostic source of truth for skill packages + metadata.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { withConfigLock } from '../../utils/config-mutex';
import {
  getOpenClawConfigDir,
  getSkillsManifestPath,
  getSkillsStoreAgentSkillsDir,
  getSkillsStoreDir,
  getSkillsStoreGlobalDir,
  getSkillsStoreUserSkillsDir,
} from '../../utils/paths';
import { logger } from '../../utils/logger';

export type SkillScope = 'global' | 'user' | 'agent';

export interface SkillManifestEntry {
  slug: string;
  scope: SkillScope;
  userCode?: string;
  agentId?: string;
  version: string;
  source: string;
  name?: string;
  title?: string;
  description?: string;
  author?: string;
  enabled: boolean;
  config?: {
    apiKey?: string;
    env?: Record<string, string>;
  };
  installedAt?: string;
  versionSource?: string;
}

export interface SkillEntryKey {
  slug: string;
  scope: SkillScope;
  userCode?: string;
  agentId?: string;
}

export interface DesiredSkillPackage {
  slug: string;
  sourceDir: string;
  version: string;
  enabled: boolean;
  scope: SkillScope;
  userCode?: string;
  agentId?: string;
  config?: SkillManifestEntry['config'];
  name?: string;
  description?: string;
  author?: string;
  source: string;
}

interface SkillsManifestFile {
  version: 1;
  global: Record<string, SkillManifestEntry>;
  users: Record<string, Record<string, SkillManifestEntry>>;
  agents: Record<string, Record<string, SkillManifestEntry>>;
}

function emptyManifest(): SkillsManifestFile {
  return {
    version: 1,
    global: {},
    users: {},
    agents: {},
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readManifestUnlocked(): Promise<SkillsManifestFile> {
  const manifestPath = getSkillsManifestPath();
  if (!(await fileExists(manifestPath))) {
    return emptyManifest();
  }
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SkillsManifestFile>;
    return {
      version: 1,
      global: parsed.global && typeof parsed.global === 'object' ? parsed.global : {},
      users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
      agents: parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {},
    };
  } catch (error) {
    logger.warn('[canonical-store] failed to read manifest.json:', error);
    return emptyManifest();
  }
}

async function writeManifestUnlocked(manifest: SkillsManifestFile): Promise<void> {
  const storeDir = getSkillsStoreDir();
  await mkdir(storeDir, { recursive: true });
  const manifestPath = getSkillsManifestPath();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

function normalizeKey(key: SkillEntryKey): SkillEntryKey {
  const slug = key.slug.trim();
  if (key.scope === 'user') {
    const userCode = (key.userCode ?? '').trim();
    if (!userCode) {
      throw new Error('user-scoped skill entry requires userCode');
    }
    return { slug, scope: 'user', userCode };
  }
  if (key.scope === 'agent') {
    const agentId = (key.agentId ?? '').trim().toLowerCase() || 'main';
    return { slug, scope: 'agent', agentId };
  }
  return { slug, scope: 'global' };
}

export function resolvePackageDir(entry: SkillEntryKey): string {
  const key = normalizeKey(entry);
  if (key.scope === 'user') {
    return join(getSkillsStoreUserSkillsDir(key.userCode!), key.slug);
  }
  if (key.scope === 'agent') {
    return join(getSkillsStoreAgentSkillsDir(key.agentId!), key.slug);
  }
  return join(getSkillsStoreGlobalDir(), key.slug);
}

export async function getSkillEntry(key: SkillEntryKey): Promise<SkillManifestEntry | null> {
  const normalized = normalizeKey(key);
  const manifest = await readManifestUnlocked();
  if (normalized.scope === 'global') {
    return manifest.global[normalized.slug] ?? null;
  }
  if (normalized.scope === 'user') {
    return manifest.users[normalized.userCode!]?.[normalized.slug] ?? null;
  }
  return manifest.agents[normalized.agentId!]?.[normalized.slug] ?? null;
}

export async function upsertSkillEntry(
  entry: SkillManifestEntry,
): Promise<SkillManifestEntry> {
  const key = normalizeKey(entry);
  return withConfigLock(async () => {
    const manifest = await readManifestUnlocked();
    const existing = getSkillEntryFromManifest(manifest, key);
    const next: SkillManifestEntry = {
      ...existing,
      ...entry,
      slug: key.slug,
      scope: key.scope,
      userCode: key.userCode,
      agentId: key.agentId,
      enabled: entry.enabled ?? existing?.enabled ?? true,
      installedAt: existing?.installedAt || entry.installedAt || new Date().toISOString(),
    };

    if (key.scope === 'global') {
      manifest.global[key.slug] = next;
    } else if (key.scope === 'user') {
      if (!manifest.users[key.userCode!]) {
        manifest.users[key.userCode!] = {};
      }
      manifest.users[key.userCode!][key.slug] = next;
    } else {
      if (!manifest.agents[key.agentId!]) {
        manifest.agents[key.agentId!] = {};
      }
      manifest.agents[key.agentId!][key.slug] = next;
    }

    await writeManifestUnlocked(manifest);
    return next;
  });
}

export async function removeSkillEntry(key: SkillEntryKey): Promise<void> {
  const normalized = normalizeKey(key);
  await withConfigLock(async () => {
    const manifest = await readManifestUnlocked();
    if (normalized.scope === 'global') {
      delete manifest.global[normalized.slug];
    } else if (normalized.scope === 'user') {
      if (manifest.users[normalized.userCode!]) {
        delete manifest.users[normalized.userCode!][normalized.slug];
        if (Object.keys(manifest.users[normalized.userCode!]).length === 0) {
          delete manifest.users[normalized.userCode!];
        }
      }
    } else if (manifest.agents[normalized.agentId!]) {
      delete manifest.agents[normalized.agentId!][normalized.slug];
      if (Object.keys(manifest.agents[normalized.agentId!]).length === 0) {
        delete manifest.agents[normalized.agentId!];
      }
    }
    await writeManifestUnlocked(manifest);
  });
}

function getSkillEntryFromManifest(
  manifest: SkillsManifestFile,
  key: SkillEntryKey,
): SkillManifestEntry | null {
  if (key.scope === 'global') {
    return manifest.global[key.slug] ?? null;
  }
  if (key.scope === 'user') {
    return manifest.users[key.userCode!]?.[key.slug] ?? null;
  }
  return manifest.agents[key.agentId!]?.[key.slug] ?? null;
}

export async function listDesiredPackages(ctx: {
  userCode: string | null;
  agentId?: string;
}): Promise<DesiredSkillPackage[]> {
  const manifest = await readManifestUnlocked();
  const bySlug = new Map<string, DesiredSkillPackage>();

  const pushEntry = (entry: SkillManifestEntry) => {
    if (entry.enabled === false) {
      // Disabled skills still belong in desired set so adapters can project disable state.
      // Consumers that only want enabled can filter.
    }
    const sourceDir = resolvePackageDir(entry);
    bySlug.set(entry.slug, {
      slug: entry.slug,
      sourceDir,
      version: entry.version,
      enabled: entry.enabled !== false,
      scope: entry.scope,
      userCode: entry.userCode,
      agentId: entry.agentId,
      config: entry.config,
      name: entry.name,
      description: entry.description,
      author: entry.author,
      source: entry.source,
    });
  };

  for (const entry of Object.values(manifest.global)) {
    pushEntry(entry);
  }

  if (ctx.userCode) {
    const userEntries = manifest.users[ctx.userCode] || {};
    for (const entry of Object.values(userEntries)) {
      pushEntry(entry);
    }
  }

  if (ctx.agentId) {
    const agentId = ctx.agentId.trim().toLowerCase() || 'main';
    const agentEntries = manifest.agents[agentId] || {};
    for (const entry of Object.values(agentEntries)) {
      // Agent overrides global/user on slug collision.
      pushEntry(entry);
    }
  }

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function listAllManifestEntries(): Promise<SkillManifestEntry[]> {
  const manifest = await readManifestUnlocked();
  const results: SkillManifestEntry[] = [];
  results.push(...Object.values(manifest.global));
  for (const userMap of Object.values(manifest.users)) {
    results.push(...Object.values(userMap));
  }
  for (const agentMap of Object.values(manifest.agents)) {
    results.push(...Object.values(agentMap));
  }
  return results;
}

export interface LegacyLockFallback {
  version?: string;
  source?: string;
  name?: string;
  description?: string;
  author?: string;
  versionSource?: string;
  installedAt?: string;
}

/**
 * Read a single skill's metadata from the legacy OpenClaw lock.json when manifest is absent.
 */
export async function readLegacyLockFallback(slug: string): Promise<LegacyLockFallback | null> {
  const lockFile = join(getOpenClawConfigDir(), '.clawhub', 'lock.json');
  if (!(await fileExists(lockFile))) {
    return null;
  }
  try {
    const raw = await readFile(lockFile, 'utf-8');
    const data = JSON.parse(raw) as { skills?: Record<string, LegacyLockFallback> };
    return data.skills?.[slug] ?? null;
  } catch (error) {
    logger.warn('[canonical-store] failed to read legacy lock.json:', error);
    return null;
  }
}

export async function ensureSkillsStoreDirs(): Promise<void> {
  await mkdir(getSkillsStoreDir(), { recursive: true });
  await mkdir(getSkillsStoreGlobalDir(), { recursive: true });
}
