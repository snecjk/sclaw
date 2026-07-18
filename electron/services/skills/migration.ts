/**
 * One-time migration from OpenClaw-era skill layout into ~/.stoclaw/skills-store.
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
import { PREINSTALLED_MARKER_NAME } from './skill-manager';
import { ensureSkillsStoreDirs, upsertSkillEntry, type SkillScope } from './canonical-store';
import { copyDir, readSkillMdDescription, readSkillMdVersion, readSkillName } from './skill-package';
import { getSkillManager } from './skill-manager';

const MIGRATED_VERSION = 1;

interface LegacyLockSkill {
  version?: string;
  source?: string;
  name?: string;
  description?: string;
  author?: string;
  versionSource?: string;
  installedAt?: string;
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

export function isSkillsStoreMigrated(): boolean {
  const markerPath = getSkillsStoreMigratedMarkerPath();
  if (!fs.existsSync(markerPath)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as { version?: number };
    return Number(raw.version) >= MIGRATED_VERSION;
  } catch {
    return false;
  }
}

/**
 * Migrate legacy OpenClaw skill dirs into the neutral skills store.
 * Safe to call repeatedly: skips when `.migrated` marker exists.
 */
export async function migrateSkillsStoreIfNeeded(): Promise<{ migrated: boolean }> {
  if (isSkillsStoreMigrated()) {
    return { migrated: false };
  }

  const storeDir = getSkillsStoreDir();
  const tempRoot = `${storeDir}.migrating-${Date.now()}`;
  const finalExists = fs.existsSync(storeDir) && fs.existsSync(getSkillsManifestPath());

  try {
    if (!finalExists) {
      fs.mkdirSync(tempRoot, { recursive: true });
      // Point getters still use final path; write into final after building via canonical APIs.
    }

    await ensureSkillsStoreDirs();

    const globalSkillsDir = getOpenClawSkillsDir();
    const globalDisabledDir = path.join(getOpenClawConfigDir(), 'skills-disabled');
    const globalLock = readLockSkills(path.join(getOpenClawConfigDir(), '.clawhub', 'lock.json'));

    for (const slug of listSkillSlugs(globalSkillsDir)) {
      const sourceDir = path.join(globalSkillsDir, slug);
      const isPreinstalled = fs.existsSync(path.join(sourceDir, PREINSTALLED_MARKER_NAME));
      await migrateSkillDir({
        sourceDir,
        slug,
        scope: isPreinstalled ? 'global' : 'global',
        enabled: true,
        lockInfo: globalLock[slug],
      });
      // Non-preinstalled global mount skills are also recorded; user-scoped copies win later.
      if (!isPreinstalled) {
        // Keep as global for now; user copies below will upsert user scope.
      }
    }

    for (const slug of listSkillSlugs(globalDisabledDir)) {
      await migrateSkillDir({
        sourceDir: path.join(globalDisabledDir, slug),
        slug,
        scope: 'global',
        enabled: false,
        lockInfo: globalLock[slug],
      });
    }

    // Per-user workspaces
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

    // Agent-scoped skills
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

    fs.writeFileSync(
      getSkillsStoreMigratedMarkerPath(),
      `${JSON.stringify({ version: MIGRATED_VERSION, migratedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf-8',
    );

    // Rebuild engine projections from canonical store.
    await getSkillManager().reconcile();

    logger.info('[skills-migration] migrated skills into neutral skills-store');
    return { migrated: true };
  } catch (error) {
    logger.warn('[skills-migration] migration failed; will retry on next launch', error);
    // Do not write .migrated on failure.
    return { migrated: false };
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
