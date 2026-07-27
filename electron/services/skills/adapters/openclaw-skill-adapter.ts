/**
 * OpenClaw engine skill adapter: projects canonical store → openclaw runtime dirs.
 *
 * Enabled skills are mirrored under openclaw/skills. Disabled skills are removed
 * from that directory (Claude-aligned); openclaw.json skills.entries.*.enabled
 * is updated accordingly. Legacy skills-disabled/ projections are cleaned up
 * but no longer used as an active disable target.
 */
import { access, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  getOpenClawAgentSkillsDir,
  getOpenClawConfigDir,
  getOpenClawSkillsDir,
} from '../../../utils/paths';
import { setSkillsEnabled, updateSkillConfig } from '../../../utils/skill-config';
import { logger } from '../../../utils/logger';
import { safeRemoveDir } from '../../../utils/fs-retry';
import {
  syncBaseAgentSkillInstall,
  syncBaseAgentSkillUninstall,
} from '../../project-agent-service';
import type {
  EngineSkillAdapter,
  EngineSkillContext,
  ReconcileResult,
  SkillPackage,
} from './engine-skill-adapter';
import { notifyGatewayAfterSkillBatch } from './engine-skill-adapter';

const OPENCLAW_MANAGED_MARKER = '.stoclaw-openclaw-skill-projection.json';

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Legacy StoClaw disable mirror; no longer written, only cleaned up. */
function getLegacyDisabledDir(): string {
  return join(getOpenClawConfigDir(), 'skills-disabled');
}

async function writeManagedMarker(targetDir: string, slug: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const markerPath = join(targetDir, OPENCLAW_MANAGED_MARKER);
  const payload = {
    source: 'stoclaw-skills-store',
    slug,
    syncedAt: new Date().toISOString(),
  };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(markerPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

async function isManagedProjection(targetDir: string): Promise<boolean> {
  return fileExists(join(targetDir, OPENCLAW_MANAGED_MARKER));
}

async function projectSkillToDir(pkg: SkillPackage, targetDir: string): Promise<void> {
  await mkdir(join(targetDir, '..'), { recursive: true });
  if (await fileExists(targetDir)) {
    await rm(targetDir, { recursive: true, force: true });
  }
  await cp(pkg.sourceDir, targetDir, { recursive: true, force: true });
  await writeManagedMarker(targetDir, pkg.slug);
}

async function removeManagedDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) return;
  if (!(await isManagedProjection(dir))) return;
  await safeRemoveDir(dir, { label: dir }).catch((error) => {
    logger.warn(`[openclaw-skill-adapter] failed to remove ${dir}`, error);
  });
}

async function removeSkillDirs(slug: string, agentId?: string): Promise<void> {
  const dirs = agentId
    ? [join(getOpenClawAgentSkillsDir(agentId), slug)]
    : [join(getOpenClawSkillsDir(), slug), join(getLegacyDisabledDir(), slug)];

  for (const dir of dirs) {
    if (await fileExists(dir)) {
      await safeRemoveDir(dir, { label: dir }).catch((error) => {
        logger.warn(`[openclaw-skill-adapter] failed to remove ${dir}`, error);
      });
    }
  }
}

/** Drop managed leftovers under the legacy skills-disabled tree. */
async function purgeLegacyDisabledProjections(): Promise<string[]> {
  const root = getLegacyDisabledDir();
  const removed: string[] = [];
  if (!(await fileExists(root))) return removed;

  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return removed;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const targetDir = join(root, entry.name);
    if (!(await isManagedProjection(targetDir))) continue;
    await safeRemoveDir(targetDir, { label: targetDir }).catch(() => undefined);
    removed.push(entry.name);
  }

  // Remove empty legacy root when nothing remains.
  try {
    const left = await readdir(root);
    if (left.length === 0) {
      await safeRemoveDir(root, { label: root }).catch(() => undefined);
    }
  } catch {
    // ignore
  }

  return removed;
}

export class OpenClawSkillAdapter implements EngineSkillAdapter {
  readonly id = 'openclaw' as const;

  async applyInstall(pkg: SkillPackage, ctx: EngineSkillContext): Promise<void> {
    if (pkg.scope === 'agent' || ctx.agentId) {
      const agentId = pkg.agentId || ctx.agentId;
      if (!agentId) {
        throw new Error('agent-scoped OpenClaw install requires agentId');
      }
      const targetDir = join(getOpenClawAgentSkillsDir(agentId), pkg.slug);
      await projectSkillToDir(pkg, targetDir);
      await syncBaseAgentSkillInstall(agentId, pkg.slug).catch((error) => {
        logger.warn('[openclaw-skill-adapter] failed to mirror agent skill install', {
          agentId,
          slug: pkg.slug,
          error,
        });
      });
      return;
    }

    const activeDir = join(getOpenClawSkillsDir(), pkg.slug);
    const legacyDisabledDir = join(getLegacyDisabledDir(), pkg.slug);

    if (pkg.enabled) {
      await removeManagedDir(legacyDisabledDir);
      await projectSkillToDir(pkg, activeDir);
    } else {
      // Disabled: keep out of Gateway's skills scan (same idea as Claude).
      if (await fileExists(activeDir)) {
        await safeRemoveDir(activeDir, { label: activeDir }).catch(() => undefined);
      }
      await removeManagedDir(legacyDisabledDir);
    }

    await setSkillsEnabled([pkg.slug], pkg.enabled).catch((error) => {
      logger.warn('[openclaw-skill-adapter] failed to set enabled flag', { slug: pkg.slug, error });
    });

    if (pkg.config) {
      await updateSkillConfig(pkg.slug, {
        apiKey: pkg.config.apiKey,
        env: pkg.config.env,
      }).catch((error) => {
        logger.warn('[openclaw-skill-adapter] failed to project skill config', {
          slug: pkg.slug,
          error,
        });
      });
    }
  }

  async applyUninstall(slug: string, ctx: EngineSkillContext): Promise<void> {
    if (ctx.agentId) {
      await removeSkillDirs(slug, ctx.agentId);
      await syncBaseAgentSkillUninstall(ctx.agentId, slug).catch((error) => {
        logger.warn('[openclaw-skill-adapter] failed to mirror agent skill uninstall', {
          agentId: ctx.agentId,
          slug,
          error,
        });
      });
      return;
    }
    await removeSkillDirs(slug);
  }

  async applyEnabled(slug: string, enabled: boolean, ctx: EngineSkillContext): Promise<void> {
    if (ctx.agentId) {
      await setSkillsEnabled([slug], enabled);
      return;
    }

    const activeDir = join(getOpenClawSkillsDir(), slug);
    const legacyDisabledDir = join(getLegacyDisabledDir(), slug);

    if (enabled) {
      // Fresh projection comes from applyInstall (SkillManager fans out both).
      // Clear any legacy skills-disabled copy so it cannot shadow later.
      await removeManagedDir(legacyDisabledDir);
    } else if (await fileExists(activeDir)) {
      if (await isManagedProjection(activeDir)) {
        await safeRemoveDir(activeDir, { label: activeDir }).catch((error) => {
          logger.warn('[openclaw-skill-adapter] failed to remove disabled skill', {
            slug,
            error,
          });
        });
      }
      await removeManagedDir(legacyDisabledDir);
    } else {
      await removeManagedDir(legacyDisabledDir);
    }

    await setSkillsEnabled([slug], enabled);
  }

  async reconcile(desired: SkillPackage[], ctx: EngineSkillContext): Promise<ReconcileResult> {
    const mirrored: string[] = [];
    const removed: string[] = [];
    const skippedConflicts: string[] = [];
    const desiredBySlug = new Map(desired.map((pkg) => [pkg.slug, pkg]));

    for (const pkg of desired) {
      try {
        if (pkg.scope === 'agent') {
          const agentId = pkg.agentId || ctx.agentId;
          if (!agentId) continue;
          const targetDir = join(getOpenClawAgentSkillsDir(agentId), pkg.slug);
          if (!(await fileExists(join(pkg.sourceDir, 'SKILL.md')))) continue;
          await projectSkillToDir(pkg, targetDir);
          mirrored.push(pkg.slug);
          await syncBaseAgentSkillInstall(agentId, pkg.slug).catch(() => undefined);
          continue;
        }

        if (!(await fileExists(join(pkg.sourceDir, 'SKILL.md')))) continue;
        const activeDir = join(getOpenClawSkillsDir(), pkg.slug);
        const legacyDisabledDir = join(getLegacyDisabledDir(), pkg.slug);

        if (pkg.enabled) {
          await removeManagedDir(legacyDisabledDir);
          if (await fileExists(activeDir) && !(await isManagedProjection(activeDir))) {
            skippedConflicts.push(pkg.slug);
            continue;
          }
          await projectSkillToDir(pkg, activeDir);
        } else {
          if (await fileExists(activeDir) && (await isManagedProjection(activeDir))) {
            await safeRemoveDir(activeDir, { label: activeDir }).catch(() => undefined);
          } else if (await fileExists(activeDir) && !(await isManagedProjection(activeDir))) {
            skippedConflicts.push(pkg.slug);
            continue;
          }
          await removeManagedDir(legacyDisabledDir);
        }
        await setSkillsEnabled([pkg.slug], pkg.enabled).catch(() => undefined);
        mirrored.push(pkg.slug);
      } catch (error) {
        logger.warn('[openclaw-skill-adapter] reconcile failed for skill', {
          slug: pkg.slug,
          error,
        });
      }
    }

    // Remove managed projections under skills/ that are no longer desired,
    // or remain desired but disabled (should not stay on the Gateway scan path).
    const skillsRoot = getOpenClawSkillsDir();
    if (await fileExists(skillsRoot)) {
      let entries: Array<import('node:fs').Dirent>;
      try {
        entries = await readdir(skillsRoot, { withFileTypes: true });
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkg = desiredBySlug.get(entry.name);
        if (pkg?.enabled) continue;
        const targetDir = join(skillsRoot, entry.name);
        if (!(await isManagedProjection(targetDir))) continue;
        await safeRemoveDir(targetDir, { label: targetDir }).catch(() => undefined);
        removed.push(entry.name);
      }
    }

    const purgedLegacy = await purgeLegacyDisabledProjections();
    for (const slug of purgedLegacy) {
      if (!removed.includes(slug)) removed.push(slug);
    }

    return { mirrored, removed, skippedConflicts };
  }

  async onAfterBatch(_ctx: EngineSkillContext): Promise<void> {
    await notifyGatewayAfterSkillBatch();
  }

  async cleanupOrphanProjections(): Promise<void> {
    for (const root of [getOpenClawSkillsDir(), getLegacyDisabledDir()]) {
      if (!(await fileExists(root))) continue;
      let entries: Array<import('node:fs').Dirent>;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const targetDir = join(root, entry.name);
        if (!(await isManagedProjection(targetDir))) continue;
        await safeRemoveDir(targetDir, { label: targetDir }).catch(() => undefined);
      }
    }
  }
}

export function isOpenClawProjectionManaged(skillDir: string): boolean {
  return existsSync(join(skillDir, OPENCLAW_MANAGED_MARKER));
}
