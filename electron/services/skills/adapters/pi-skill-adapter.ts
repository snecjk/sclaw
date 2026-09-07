import { constants } from 'node:fs';
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPiAgentSkillsDir, getPiSkillsDir } from '../../../utils/paths';
import { logger } from '../../../utils/logger';
import type {
  EngineSkillAdapter,
  EngineSkillContext,
  ReconcileResult,
  SkillPackage,
} from './engine-skill-adapter';

const PI_MANAGED_MARKER = '.stoclaw-pi-skill.json';

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isManagedProjection(targetDir: string): Promise<boolean> {
  return fileExists(join(targetDir, PI_MANAGED_MARKER));
}

type ProjectionResult = 'mirrored' | 'unchanged' | 'conflict';

async function projectSkill(pkg: SkillPackage, targetDir: string, force = false): Promise<ProjectionResult> {
  if (await fileExists(targetDir)) {
    if (!(await isManagedProjection(targetDir))) return 'conflict';
    if (!force) {
      try {
        const marker = JSON.parse(await readFile(join(targetDir, PI_MANAGED_MARKER), 'utf-8')) as Record<string, unknown>;
        if (
          marker.sourceDir === pkg.sourceDir
          && marker.version === pkg.version
          && await fileExists(join(targetDir, 'SKILL.md'))
        ) return 'unchanged';
      } catch {
        // Invalid managed marker: refresh the projection below.
      }
    }
    await rm(targetDir, { recursive: true, force: true });
  }
  await mkdir(targetDir, { recursive: true });
  await cp(pkg.sourceDir, targetDir, { recursive: true, force: true });
  await writeFile(join(targetDir, PI_MANAGED_MARKER), `${JSON.stringify({
    source: 'stoclaw-skills-store',
    slug: pkg.slug,
    scope: pkg.scope,
    sourceDir: pkg.sourceDir,
    version: pkg.version,
    syncedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf-8');
  return 'mirrored';
}

async function removeManagedProjection(targetDir: string): Promise<boolean> {
  if (!(await fileExists(targetDir)) || !(await isManagedProjection(targetDir))) return false;
  await rm(targetDir, { recursive: true, force: true });
  return true;
}

function targetRoot(pkg: SkillPackage, ctx: EngineSkillContext): string | null {
  if (pkg.scope !== 'agent') return getPiSkillsDir();
  const agentId = pkg.agentId || ctx.agentId;
  return agentId ? getPiAgentSkillsDir(agentId) : null;
}

async function reconcileRoot(root: string, desired: SkillPackage[]): Promise<ReconcileResult> {
  await mkdir(root, { recursive: true });
  const mirrored: string[] = [];
  const removed: string[] = [];
  const skippedConflicts: string[] = [];
  const desiredEnabled = desired.filter((pkg) => pkg.enabled);
  const desiredSlugs = new Set(desiredEnabled.map((pkg) => pkg.slug));

  for (const pkg of desiredEnabled) {
    if (!(await fileExists(join(pkg.sourceDir, 'SKILL.md')))) continue;
    const targetDir = join(root, pkg.slug);
    const projection = await projectSkill(pkg, targetDir);
    if (projection === 'mirrored') mirrored.push(pkg.slug);
    else if (projection === 'conflict') {
      skippedConflicts.push(pkg.slug);
      logger.warn('[pi-skill-adapter] unmanaged skill conflict', { targetDir, slug: pkg.slug });
    }
  }

  let entries: Array<import('node:fs').Dirent> = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // The root may disappear during shutdown or cleanup.
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || desiredSlugs.has(entry.name)) continue;
    if (await removeManagedProjection(join(root, entry.name))) removed.push(entry.name);
  }
  return { mirrored, removed, skippedConflicts };
}

export class PiSkillAdapter implements EngineSkillAdapter {
  readonly id = 'pi' as const;

  async applyInstall(pkg: SkillPackage, ctx: EngineSkillContext): Promise<void> {
    const root = targetRoot(pkg, ctx);
    if (!root) throw new Error('agent-scoped Pi skill install requires agentId');
    const targetDir = join(root, pkg.slug);
    if (!pkg.enabled) {
      await removeManagedProjection(targetDir);
      return;
    }
    await mkdir(root, { recursive: true });
    if (await projectSkill(pkg, targetDir, true) === 'conflict') {
      logger.warn('[pi-skill-adapter] skipping unmanaged skill conflict', { targetDir, slug: pkg.slug });
    }
  }

  async applyUninstall(slug: string, ctx: EngineSkillContext): Promise<void> {
    const roots = ctx.agentId
      ? [getPiAgentSkillsDir(ctx.agentId)]
      : [getPiSkillsDir()];
    for (const root of roots) await removeManagedProjection(join(root, slug));
  }

  async applyEnabled(slug: string, enabled: boolean, ctx: EngineSkillContext): Promise<void> {
    if (enabled) return;
    await this.applyUninstall(slug, ctx);
  }

  async reconcile(desired: SkillPackage[], ctx: EngineSkillContext): Promise<ReconcileResult> {
    const globalResult = await reconcileRoot(
      getPiSkillsDir(),
      desired.filter((pkg) => pkg.scope !== 'agent'),
    );
    if (!ctx.agentId) return globalResult;
    const agentResult = await reconcileRoot(
      getPiAgentSkillsDir(ctx.agentId),
      desired.filter((pkg) => pkg.scope === 'agent' && (!pkg.agentId || pkg.agentId === ctx.agentId)),
    );
    return {
      mirrored: [...globalResult.mirrored, ...agentResult.mirrored],
      removed: [...globalResult.removed, ...agentResult.removed],
      skippedConflicts: [...globalResult.skippedConflicts, ...agentResult.skippedConflicts],
    };
  }

  async cleanupOrphanProjections(): Promise<void> {
    const root = getPiSkillsDir();
    if (!(await fileExists(root))) return;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) await removeManagedProjection(join(root, entry.name));
    }
  }
}
