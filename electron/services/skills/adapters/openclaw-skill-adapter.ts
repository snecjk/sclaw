/**
 * OpenClaw engine skill adapter: projects canonical store → openclaw runtime dirs.
 */
import { access, cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
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

function getDisabledDir(): string {
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

async function removeSkillDirs(slug: string, agentId?: string): Promise<void> {
  const dirs = agentId
    ? [join(getOpenClawAgentSkillsDir(agentId), slug)]
    : [join(getOpenClawSkillsDir(), slug), join(getDisabledDir(), slug)];

  for (const dir of dirs) {
    if (await fileExists(dir)) {
      await safeRemoveDir(dir, { label: dir }).catch((error) => {
        logger.warn(`[openclaw-skill-adapter] failed to remove ${dir}`, error);
      });
    }
  }
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
    const disabledDir = join(getDisabledDir(), pkg.slug);
    if (pkg.enabled) {
      if (await fileExists(disabledDir)) {
        await safeRemoveDir(disabledDir, { label: disabledDir }).catch(() => undefined);
      }
      await projectSkillToDir(pkg, activeDir);
    } else {
      if (await fileExists(activeDir)) {
        await safeRemoveDir(activeDir, { label: activeDir }).catch(() => undefined);
      }
      await projectSkillToDir(pkg, disabledDir);
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
      // Agent-scoped skills do not use skills-disabled; enabled is config-only for now.
      await setSkillsEnabled([slug], enabled);
      return;
    }

    const activeDir = join(getOpenClawSkillsDir(), slug);
    const disabledRoot = getDisabledDir();
    const disabledDir = join(disabledRoot, slug);
    await mkdir(disabledRoot, { recursive: true });

    if (enabled) {
      if (await fileExists(disabledDir) && !(await fileExists(activeDir))) {
        await rename(disabledDir, activeDir);
      }
    } else if (await fileExists(activeDir) && !(await fileExists(disabledDir))) {
      await rename(activeDir, disabledDir);
    }

    await setSkillsEnabled([slug], enabled);
  }

  async reconcile(desired: SkillPackage[], ctx: EngineSkillContext): Promise<ReconcileResult> {
    const mirrored: string[] = [];
    const removed: string[] = [];
    const skippedConflicts: string[] = [];
    const desiredBySlug = new Map(desired.map((pkg) => [pkg.slug, pkg]));

    // Project agent-scoped and global/user packages appropriately.
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
        const disabledDir = join(getDisabledDir(), pkg.slug);

        if (pkg.enabled) {
          if (await fileExists(disabledDir) && (await isManagedProjection(disabledDir))) {
            await safeRemoveDir(disabledDir, { label: disabledDir }).catch(() => undefined);
          }
          if (await fileExists(activeDir) && !(await isManagedProjection(activeDir))) {
            skippedConflicts.push(pkg.slug);
            continue;
          }
          await projectSkillToDir(pkg, activeDir);
        } else {
          if (await fileExists(activeDir) && (await isManagedProjection(activeDir))) {
            await safeRemoveDir(activeDir, { label: activeDir }).catch(() => undefined);
          }
          if (await fileExists(disabledDir) && !(await isManagedProjection(disabledDir))) {
            skippedConflicts.push(pkg.slug);
            continue;
          }
          await projectSkillToDir(pkg, disabledDir);
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

    // Remove managed projections that are no longer desired (global mount only).
    for (const root of [getOpenClawSkillsDir(), getDisabledDir()]) {
      if (!(await fileExists(root))) continue;
      let entries: Array<import('node:fs').Dirent>;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (desiredBySlug.has(entry.name)) continue;
        const targetDir = join(root, entry.name);
        if (!(await isManagedProjection(targetDir))) continue;
        await safeRemoveDir(targetDir, { label: targetDir }).catch(() => undefined);
        removed.push(entry.name);
      }
    }

    return { mirrored, removed, skippedConflicts };
  }

  async onAfterBatch(_ctx: EngineSkillContext): Promise<void> {
    await notifyGatewayAfterSkillBatch();
  }

  async cleanupOrphanProjections(): Promise<void> {
    for (const root of [getOpenClawSkillsDir(), getDisabledDir()]) {
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
