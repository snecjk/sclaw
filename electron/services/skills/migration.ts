/**
 * One-time migration from OpenClaw-era skill layout into ~/.stoclaw/skills-store.
 * Also repairs v1 stores that duplicated the same slug into global + users.
 */
import fs from 'fs';
import path from 'path';
import {
  getOpenClawConfigDir,
  getOpenClawSkillsDir,
  getOpenClawUserBaseDir,
  getSkillsManifestPath,
  getSkillsStoreAgentSkillsDir,
  getSkillsStoreDir,
  getSkillsStoreGlobalDir,
  getSkillsStoreMigratedMarkerPath,
  getSkillsStoreUserSkillsDir,
  getOpenClawAgentSkillsDir,
} from '../../utils/paths';
import { logger } from '../../utils/logger';
import { safeRemoveDir } from '../../utils/fs-retry';
import { PREINSTALLED_MARKER_NAME } from './skill-manager';
import {
  ensureSkillsStoreDirs,
  removeSkillEntry,
  upsertSkillEntry,
  type SkillScope,
} from './canonical-store';
import { copyDir, readSkillMdDescription, readSkillMdVersion, readSkillName } from './skill-package';
import { getSkillManager } from './skill-manager';

/** Initial OpenClaw → skills-store copy. */
const INITIAL_MIGRATED_VERSION = 1;
/** Drop non-preinstalled global copies when any user already owns the slug. */
const DEDUPE_MIGRATED_VERSION = 2;

interface LegacyLockSkill {
  version?: string;
  source?: string;
  name?: string;
  description?: string;
  author?: string;
  versionSource?: string;
  installedAt?: string;
}

interface MigratedMarker {
  version?: number;
  migratedAt?: string;
  dedupedAt?: string;
}

function readLockSkills(lockPath: string): Record<string, LegacyLockSkill> {
  if (!fs.existsSync(lockPath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as {
      skills?: Record<string, LegacyLockSkill>;
    };
    return data.skills || {};
  } catch {
    return {};
  }
}

function listSkillSlugs(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(baseDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}

function readMigratedMarker(): MigratedMarker | null {
  const markerPath = getSkillsStoreMigratedMarkerPath();
  if (!fs.existsSync(markerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as MigratedMarker;
  } catch {
    return null;
  }
}

function writeMigratedMarker(marker: MigratedMarker): void {
  fs.writeFileSync(
    getSkillsStoreMigratedMarkerPath(),
    `${JSON.stringify(marker, null, 2)}\n`,
    'utf-8',
  );
}

function getMarkerVersion(): number {
  const marker = readMigratedMarker();
  return Number(marker?.version) || 0;
}

/** Collect slugs present under any openclaw/users/{code}/skills(-disabled). */
export function collectLegacyUserSkillSlugs(): Set<string> {
  const slugs = new Set<string>();
  const usersRoot = path.join(getOpenClawConfigDir(), 'users');
  if (!fs.existsSync(usersRoot)) return slugs;

  for (const userEntry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
    if (!userEntry.isDirectory()) continue;
    const userCode = userEntry.name;
    for (const slug of listSkillSlugs(path.join(getOpenClawUserBaseDir(userCode), 'skills'))) {
      slugs.add(slug);
    }
    for (const slug of listSkillSlugs(path.join(getOpenClawUserBaseDir(userCode), 'skills-disabled'))) {
      slugs.add(slug);
    }
  }
  return slugs;
}

async function migrateSkillDir(params: {
  sourceDir: string;
  slug: string;
  scope: SkillScope;
  userCode?: string;
  agentId?: string;
  enabled: boolean;
  lockInfo?: LegacyLockSkill;
}): Promise<void> {
  const targetRoot = params.scope === 'user' && params.userCode
    ? getSkillsStoreUserSkillsDir(params.userCode)
    : params.scope === 'agent' && params.agentId
      ? getSkillsStoreAgentSkillsDir(params.agentId)
      : getSkillsStoreGlobalDir();
  const targetDir = path.join(targetRoot, params.slug);
  if (!fs.existsSync(targetDir)) {
    await copyDir(params.sourceDir, targetDir);
  }

  const isPreinstalled = fs.existsSync(path.join(params.sourceDir, PREINSTALLED_MARKER_NAME));
  const version = params.lockInfo?.version
    || readSkillMdVersion(params.sourceDir)
    || '1.0.0';

  await upsertSkillEntry({
    slug: params.slug,
    scope: params.scope,
    userCode: params.userCode,
    agentId: params.agentId,
    version,
    source: params.lockInfo?.source
      || (isPreinstalled
        ? 'stoclaw-preinstalled'
        : params.lockInfo
          ? 'sto-marketplace'
          : 'local'),
    name: params.lockInfo?.name || readSkillName(params.sourceDir) || undefined,
    description: params.lockInfo?.description || readSkillMdDescription(params.sourceDir) || undefined,
    author: params.lockInfo?.author,
    enabled: params.enabled,
    versionSource: params.lockInfo?.versionSource || 'directory-scan',
    installedAt: params.lockInfo?.installedAt,
  });
}

/**
 * True when skills-store initial migration + global/user dedupe are complete.
 */
export function isSkillsStoreMigrated(): boolean {
  return getMarkerVersion() >= DEDUPE_MIGRATED_VERSION;
}

/**
 * Remove non-preinstalled global packages that also exist under any user scope.
 * Returns number of global entries removed.
 */
export async function dedupeGlobalUserSkillDuplicates(): Promise<number> {
  const manifestPath = getSkillsManifestPath();
  if (!fs.existsSync(manifestPath)) return 0;

  let data: {
    global?: Record<string, { source?: string }>;
    users?: Record<string, Record<string, unknown>>;
  };
  try {
    data = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as typeof data;
  } catch (err) {
    logger.warn('[skills-migration] Failed to read manifest for dedupe:', err);
    return 0;
  }

  const userOwned = new Set<string>();
  for (const skills of Object.values(data.users || {})) {
    for (const slug of Object.keys(skills || {})) {
      userOwned.add(slug);
    }
  }

  const globalDir = getSkillsStoreGlobalDir();
  let removed = 0;

  for (const [slug, entry] of Object.entries(data.global || {})) {
    if (!userOwned.has(slug)) continue;

    const packageDir = path.join(globalDir, slug);
    const isPreinstalled =
      entry?.source === 'stoclaw-preinstalled'
      || fs.existsSync(path.join(packageDir, PREINSTALLED_MARKER_NAME));
    if (isPreinstalled) continue;

    await removeSkillEntry({ slug, scope: 'global' });
    if (fs.existsSync(packageDir)) {
      await safeRemoveDir(packageDir, { label: packageDir }).catch((error) => {
        logger.warn('[skills-migration] Failed to remove duplicate global skill dir', {
          slug,
          error,
        });
      });
    }
    removed += 1;
  }

  return removed;
}

async function runFullMigration(legacyUserSlugs: Set<string>): Promise<void> {
  await ensureSkillsStoreDirs();

  const globalSkillsDir = getOpenClawSkillsDir();
  const globalDisabledDir = path.join(getOpenClawConfigDir(), 'skills-disabled');
  const globalLock = readLockSkills(path.join(getOpenClawConfigDir(), '.clawhub', 'lock.json'));

  // Users first so ownership is clear before deciding global copies.
  const usersRoot = path.join(getOpenClawConfigDir(), 'users');
  if (fs.existsSync(usersRoot)) {
    for (const userEntry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
      if (!userEntry.isDirectory()) continue;
      const userCode = userEntry.name;
      const userSkillsDir = path.join(getOpenClawUserBaseDir(userCode), 'skills');
      const userDisabledDir = path.join(getOpenClawUserBaseDir(userCode), 'skills-disabled');
      const userLock = readLockSkills(
        path.join(getOpenClawUserBaseDir(userCode), '.clawhub', 'lock.json'),
      );

      for (const slug of listSkillSlugs(userSkillsDir)) {
        await migrateSkillDir({
          sourceDir: path.join(userSkillsDir, slug),
          slug,
          scope: 'user',
          userCode,
          enabled: true,
          lockInfo: userLock[slug] || globalLock[slug],
        });
      }
      for (const slug of listSkillSlugs(userDisabledDir)) {
        await migrateSkillDir({
          sourceDir: path.join(userDisabledDir, slug),
          slug,
          scope: 'user',
          userCode,
          enabled: false,
          lockInfo: userLock[slug] || globalLock[slug],
        });
      }
    }
  }

  for (const slug of listSkillSlugs(globalSkillsDir)) {
    const sourceDir = path.join(globalSkillsDir, slug);
    const isPreinstalled = fs.existsSync(path.join(sourceDir, PREINSTALLED_MARKER_NAME));
    // Non-preinstalled skills already owned by a user stay user-scoped only.
    if (!isPreinstalled && legacyUserSlugs.has(slug)) {
      continue;
    }
    await migrateSkillDir({
      sourceDir,
      slug,
      scope: 'global',
      enabled: true,
      lockInfo: globalLock[slug],
    });
  }

  for (const slug of listSkillSlugs(globalDisabledDir)) {
    const sourceDir = path.join(globalDisabledDir, slug);
    const isPreinstalled = fs.existsSync(path.join(sourceDir, PREINSTALLED_MARKER_NAME));
    if (!isPreinstalled && legacyUserSlugs.has(slug)) {
      continue;
    }
    await migrateSkillDir({
      sourceDir,
      slug,
      scope: 'global',
      enabled: false,
      lockInfo: globalLock[slug],
    });
  }

  const agentsRoot = path.join(getOpenClawConfigDir(), 'agents');
  if (fs.existsSync(agentsRoot)) {
    for (const agentEntry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const agentId = agentEntry.name;
      const agentSkillsDir = getOpenClawAgentSkillsDir(agentId);
      for (const slug of listSkillSlugs(agentSkillsDir)) {
        await migrateSkillDir({
          sourceDir: path.join(agentSkillsDir, slug),
          slug,
          scope: 'agent',
          agentId,
          enabled: true,
          lockInfo: globalLock[slug],
        });
      }
    }
  }
}

/**
 * Migrate legacy OpenClaw skill dirs into the neutral skills store, then
 * dedupe global vs user duplicates. Safe to call repeatedly.
 */
export async function migrateSkillsStoreIfNeeded(): Promise<{
  migrated: boolean;
  deduped: boolean;
}> {
  const version = getMarkerVersion();
  if (version >= DEDUPE_MIGRATED_VERSION) {
    return { migrated: false, deduped: false };
  }

  const storeDir = getSkillsStoreDir();
  const tempRoot = `${storeDir}.migrating-${Date.now()}`;
  let migrated = false;
  let deduped = false;

  try {
    if (version < INITIAL_MIGRATED_VERSION) {
      const finalExists = fs.existsSync(storeDir) && fs.existsSync(getSkillsManifestPath());
      if (!finalExists) {
        fs.mkdirSync(tempRoot, { recursive: true });
      }

      const legacyUserSlugs = collectLegacyUserSkillSlugs();
      await runFullMigration(legacyUserSlugs);
      migrated = true;
    }

    // Always run dedupe when below v2 (covers fresh migrate + existing v1 stores).
    const removed = await dedupeGlobalUserSkillDuplicates();
    deduped = removed > 0 || version < DEDUPE_MIGRATED_VERSION;

    writeMigratedMarker({
      version: DEDUPE_MIGRATED_VERSION,
      migratedAt: readMigratedMarker()?.migratedAt || new Date().toISOString(),
      dedupedAt: new Date().toISOString(),
    });

    if (migrated || removed > 0) {
      await getSkillManager().reconcile();
    }

    if (migrated) {
      logger.info('[skills-migration] migrated skills into neutral skills-store');
    }
    if (removed > 0) {
      logger.info('[skills-migration] removed duplicate global skills also owned by users', {
        removed,
      });
    }

    return { migrated, deduped };
  } catch (error) {
    logger.warn('[skills-migration] migration/dedupe failed; will retry on next launch', error);
    return { migrated: false, deduped: false };
  } finally {
    if (fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
