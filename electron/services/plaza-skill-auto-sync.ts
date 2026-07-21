/**
 * After plaza list local-state overlay, asynchronously install remote builtins
 * and force-update lagging installs. Does not replace local preinstall.
 */
import fs from 'fs';
import { logger } from '../utils/logger';
import { isRemoteVersionNewer } from '../utils/skill-version';
import { readPreinstalledManifestSlugs } from '../utils/skill-config';
import { getSkillsManifestPath } from '../utils/paths';
import { mapWithConcurrency } from './skill-plaza-cache';
import { getSkillManager } from './skills/skill-manager';
import { notifyGatewayAfterSkillBatch } from './skills/adapters/engine-skill-adapter';
import type { SkillSummary } from './skill-plaza-service';

const AUTO_SYNC_CONCURRENCY = 3;

export type PlazaAutoSyncAction = {
  slug: string;
  kind: 'force-update' | 'builtin-install';
  version?: string;
  name?: string;
  description?: string;
};

export type PlazaAutoSyncSkill = Pick<
  SkillSummary,
  | 'slug'
  | 'forceUpdate'
  | 'isBuiltin'
  | 'installed'
  | 'version'
  | 'installedVersion'
  | 'title'
  | 'description'
>;

const inFlight = new Set<string>();

/** Slugs whose manifest source is local preinstall (shared / bundled). */
export function readManifestPreinstalledSourceSlugs(): Set<string> {
  const slugs = new Set<string>();
  try {
    const manifestPath = getSkillsManifestPath();
    if (!fs.existsSync(manifestPath)) return slugs;
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      global?: Record<string, { source?: string }>;
      users?: Record<string, Record<string, { source?: string }>>;
    };
    for (const [slug, entry] of Object.entries(data.global || {})) {
      if (entry?.source === 'stoclaw-preinstalled') slugs.add(slug);
    }
    for (const userSkills of Object.values(data.users || {})) {
      for (const [slug, entry] of Object.entries(userSkills || {})) {
        if (entry?.source === 'stoclaw-preinstalled') slugs.add(slug);
      }
    }
  } catch (err) {
    logger.warn('[plaza-auto-sync] Failed to read preinstalled sources from manifest:', err);
  }
  return slugs;
}

function isProtectedPreinstall(
  slug: string,
  preinstalledManifestSlugs: Set<string>,
  preinstalledSourceSlugs: Set<string>,
): boolean {
  return preinstalledManifestSlugs.has(slug) || preinstalledSourceSlugs.has(slug);
}

/**
 * Pure candidate selection for unit tests.
 */
export function collectPlazaAutoSyncActions(
  skills: PlazaAutoSyncSkill[],
  options: {
    preinstalledManifestSlugs: Set<string>;
    preinstalledSourceSlugs?: Set<string>;
  },
): PlazaAutoSyncAction[] {
  const preinstalledSourceSlugs = options.preinstalledSourceSlugs ?? new Set<string>();
  const actions: PlazaAutoSyncAction[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    const slug = skill.slug?.trim();
    if (!slug || seen.has(slug)) continue;
    if (isProtectedPreinstall(slug, options.preinstalledManifestSlugs, preinstalledSourceSlugs)) {
      continue;
    }

    const meta = {
      version: skill.version,
      name: skill.title,
      description: skill.description,
    };

    if (
      skill.forceUpdate
      && skill.installed
      && skill.version
      && isRemoteVersionNewer(skill.version, skill.installedVersion)
    ) {
      seen.add(slug);
      actions.push({ slug, kind: 'force-update', ...meta });
      continue;
    }

    if (skill.isBuiltin && !skill.installed) {
      seen.add(slug);
      actions.push({ slug, kind: 'builtin-install', ...meta });
    }
  }

  return actions;
}

async function runPlazaSkillAutoSync(skills: PlazaAutoSyncSkill[]): Promise<void> {
  const preinstalledManifestSlugs = readPreinstalledManifestSlugs();
  const preinstalledSourceSlugs = readManifestPreinstalledSourceSlugs();
  const actions = collectPlazaAutoSyncActions(skills, {
    preinstalledManifestSlugs,
    preinstalledSourceSlugs,
  }).filter((action) => !inFlight.has(action.slug));

  if (actions.length === 0) return;

  for (const action of actions) {
    inFlight.add(action.slug);
  }

  try {
    const manager = getSkillManager();
    await mapWithConcurrency(actions, AUTO_SYNC_CONCURRENCY, async (action) => {
      try {
        await manager.install({
          slug: action.slug,
          version: action.version,
          force: action.kind === 'force-update',
          name: action.name,
          description: action.description,
          source: 'sto-marketplace',
        });
      } catch (error) {
        logger.warn('[plaza-auto-sync] auto install/update failed', {
          slug: action.slug,
          kind: action.kind,
          error,
        });
      }
    });

    await notifyGatewayAfterSkillBatch();
  } finally {
    for (const action of actions) {
      inFlight.delete(action.slug);
    }
  }
}

/** Fire-and-forget entry used by SkillPlazaService.getPlazaSkills. */
export function schedulePlazaSkillAutoSync(skills: PlazaAutoSyncSkill[]): void {
  void runPlazaSkillAutoSync(skills).catch((error) => {
    logger.warn('[plaza-auto-sync] schedule failed:', error);
  });
}
