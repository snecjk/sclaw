/**
 * SkillManager — engine-agnostic skill lifecycle orchestrator.
 * Canonical store is the transaction boundary; engine adapters are best-effort projections.
 */
import fs from 'fs';
import path from 'path';
import { readSkillMdFrontmatter } from '../../utils/skill-frontmatter';
import { logger } from '../../utils/logger';
import { safeRemoveDir } from '../../utils/fs-retry';
import { getCurrentActiveUserCode } from '../user-skill-workspace';
import {
  ensureSkillsStoreDirs,
  listDesiredPackages,
  removeSkillEntry,
  resolvePackageDir,
  upsertSkillEntry,
  type SkillManifestEntry,
  type SkillScope,
} from './canonical-store';
import {
  copyDir,
  createTempSkillPaths,
  downloadSkillZipToFile,
  ensureSkillFrontmatter,
  extractZip,
  promoteStagedSkillDir,
  resolveSkillDirFromStaging,
  slugFromFrontmatterName,
  validateSkillPackage,
} from './skill-package';
import {
  getEngineSkillAdapters,
  setEngineSkillAdapters,
  toSkillPackage,
  type EngineSkillContext,
  type EngineSkillId,
  type ReconcileResult,
  type SkillPackage,
} from './adapters/engine-skill-adapter';
import { OpenClawSkillAdapter } from './adapters/openclaw-skill-adapter';
import { ClaudeSkillAdapter } from './adapters/claude-skill-adapter';

export const PREINSTALLED_MARKER_NAME = '.stoclaw-preinstalled.json';
export const USER_UPLOAD_MARKER_NAME = '.stoclaw-user-upload.json';

export interface SkillInstallParams {
  slug: string;
  version?: string;
  force?: boolean;
  name?: string;
  description?: string;
  author?: string;
  agentId?: string;
  source?: string;
  enabled?: boolean;
}

export interface SkillUninstallParams {
  slug: string;
  agentId?: string;
}

let initialized = false;
const installLocks = new Map<string, Promise<void>>();

function ensureAdaptersRegistered(): void {
  if (initialized) return;
  // Allow tests / hosts to pre-register adapters before first use.
  if (getEngineSkillAdapters().length > 0) {
    initialized = true;
    return;
  }
  setEngineSkillAdapters([new OpenClawSkillAdapter(), new ClaudeSkillAdapter()]);
  initialized = true;
}

async function resolveContext(agentId?: string): Promise<EngineSkillContext> {
  const userCode = await getCurrentActiveUserCode();
  return { userCode, agentId };
}

function resolveScope(params: { agentId?: string; userCode: string | null }): {
  scope: SkillScope;
  userCode?: string;
  agentId?: string;
} {
  if (params.agentId) {
    return { scope: 'agent', agentId: params.agentId.trim().toLowerCase() };
  }
  if (params.userCode) {
    return { scope: 'user', userCode: params.userCode };
  }
  return { scope: 'global' };
}

async function fanOut(
  action: 'install' | 'uninstall' | 'enabled',
  payload: {
    pkg?: SkillPackage;
    slug?: string;
    enabled?: boolean;
  },
  ctx: EngineSkillContext,
  engines?: EngineSkillId[],
): Promise<void> {
  ensureAdaptersRegistered();
  const adapters = getEngineSkillAdapters(engines);
  for (const adapter of adapters) {
    try {
      if (action === 'install' && payload.pkg) {
        await adapter.applyInstall(payload.pkg, ctx);
      } else if (action === 'uninstall' && payload.slug) {
        await adapter.applyUninstall(payload.slug, ctx);
      } else if (action === 'enabled' && payload.slug && payload.enabled !== undefined) {
        await adapter.applyEnabled(payload.slug, payload.enabled, ctx);
        if (payload.enabled && payload.pkg) {
          await adapter.applyInstall(payload.pkg, ctx);
        }
      }
    } catch (error) {
      logger.warn(`[SkillManager] adapter ${adapter.id} ${action} failed`, {
        slug: payload.pkg?.slug || payload.slug,
        error,
      });
    }
  }
  for (const adapter of adapters) {
    if (adapter.onAfterBatch) {
      await adapter.onAfterBatch(ctx).catch((error) => {
        logger.warn(`[SkillManager] adapter ${adapter.id} onAfterBatch failed`, error);
      });
    }
  }
}

export class SkillManager {
  async install(params: SkillInstallParams): Promise<void> {
    while (installLocks.has(params.slug)) {
      await installLocks.get(params.slug);
    }
    const promise = this.doInstall(params);
    installLocks.set(params.slug, promise);
    try {
      await promise;
    } finally {
      installLocks.delete(params.slug);
    }
  }

  private async doInstall(params: SkillInstallParams): Promise<void> {
    await ensureSkillsStoreDirs();
    const ctx = await resolveContext(params.agentId);
    const scopeInfo = resolveScope({ agentId: params.agentId, userCode: ctx.userCode });
    const targetDir = resolvePackageDir({
      slug: params.slug,
      scope: scopeInfo.scope,
      userCode: scopeInfo.userCode,
      agentId: scopeInfo.agentId,
    });

    const { zipPath, stagingDir } = createTempSkillPaths(params.slug);
    let stagingActive = false;
    try {
      await downloadSkillZipToFile(params.slug, zipPath);
      fs.mkdirSync(stagingDir, { recursive: true });
      stagingActive = true;
      await extractZip(zipPath, stagingDir);
      ensureSkillFrontmatter(stagingDir, params.slug, {
        name: params.name,
        description: params.description,
      });

      await promoteStagedSkillDir(stagingDir, targetDir, Boolean(params.force));
      stagingActive = false;

      const entry = await upsertSkillEntry({
        slug: params.slug,
        scope: scopeInfo.scope,
        userCode: scopeInfo.userCode,
        agentId: scopeInfo.agentId,
        version: params.version || '1.0.0',
        source: params.source || 'sto-marketplace',
        name: params.name,
        description: params.description,
        author: params.author,
        enabled: params.enabled !== false,
        versionSource: 'install',
      });

      const pkg = toSkillPackage({
        slug: entry.slug,
        sourceDir: targetDir,
        version: entry.version,
        enabled: entry.enabled,
        scope: entry.scope,
        userCode: entry.userCode,
        agentId: entry.agentId,
        config: entry.config,
        name: entry.name,
        description: entry.description,
        author: entry.author,
        source: entry.source,
      });
      await fanOut('install', { pkg }, ctx);
    } finally {
      if (stagingActive && fs.existsSync(stagingDir)) {
        await safeRemoveDir(stagingDir, { label: stagingDir }).catch(() => {});
      }
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
    }
  }

  async uninstall(params: SkillUninstallParams): Promise<void> {
    const ctx = await resolveContext(params.agentId);
    const scopeInfo = resolveScope({ agentId: params.agentId, userCode: ctx.userCode });
    const targetDir = resolvePackageDir({
      slug: params.slug,
      scope: scopeInfo.scope,
      userCode: scopeInfo.userCode,
      agentId: scopeInfo.agentId,
    });

    if (fs.existsSync(targetDir)) {
      await safeRemoveDir(targetDir, { label: targetDir });
    }
    await removeSkillEntry({
      slug: params.slug,
      scope: scopeInfo.scope,
      userCode: scopeInfo.userCode,
      agentId: scopeInfo.agentId,
    });

    await fanOut('uninstall', { slug: params.slug }, { ...ctx, agentId: params.agentId });
  }

  async setEnabled(slug: string, enabled: boolean, agentId?: string): Promise<void> {
    const ctx = await resolveContext(agentId);
    const scopeInfo = resolveScope({ agentId, userCode: ctx.userCode });
    const existingKey = {
      slug,
      scope: scopeInfo.scope,
      userCode: scopeInfo.userCode,
      agentId: scopeInfo.agentId,
    };

    // Prefer matching an existing entry across scopes when toggling from plaza (user/global).
    const { getSkillEntry } = await import('./canonical-store');
    let entry =
      (await getSkillEntry(existingKey))
      || (ctx.userCode
        ? await getSkillEntry({ slug, scope: 'user', userCode: ctx.userCode })
        : null)
      || (await getSkillEntry({ slug, scope: 'global' }));

    if (!entry) {
      entry = await upsertSkillEntry({
        slug,
        scope: scopeInfo.scope,
        userCode: scopeInfo.userCode,
        agentId: scopeInfo.agentId,
        version: '1.0.0',
        source: 'local',
        enabled,
      });
    } else {
      entry = await upsertSkillEntry({
        ...entry,
        enabled,
      });
    }

    const pkg = toSkillPackage({
      slug: entry.slug,
      sourceDir: resolvePackageDir(entry),
      version: entry.version,
      enabled: entry.enabled,
      scope: entry.scope,
      userCode: entry.userCode,
      agentId: entry.agentId,
      config: entry.config,
      name: entry.name,
      description: entry.description,
      author: entry.author,
      source: entry.source,
    });
    await fanOut('enabled', { slug, enabled, pkg }, ctx);
  }

  async uploadSkill(filePath: string): Promise<{ slug: string }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Path not found: ${filePath}`);
    }

    await ensureSkillsStoreDirs();
    const ctx = await resolveContext();
    const scopeInfo = resolveScope({ userCode: ctx.userCode });
    const workDir = path.dirname(createTempSkillPaths('upload').stagingDir);
    const stagingDir = path.join(workDir, `.tmp-skill-upload-staging-${Date.now()}`);
    let stagingActive = false;

    try {
      fs.mkdirSync(stagingDir, { recursive: true });
      stagingActive = true;

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
          fs.cpSync(
            path.join(filePath, entry.name),
            path.join(stagingDir, entry.name),
            { recursive: true, force: true },
          );
        }
      } else if (path.basename(filePath).toLowerCase() === 'skill.md') {
        fs.copyFileSync(filePath, path.join(stagingDir, 'SKILL.md'));
      } else {
        const { extractZip: unifiedExtractZip } = await import('../../utils/zip-extract');
        await unifiedExtractZip(filePath, stagingDir);
      }

      validateSkillPackage(stagingDir);
      const skillDir = resolveSkillDirFromStaging(stagingDir);
      const fm = readSkillMdFrontmatter(skillDir);
      const rawName = fm?.name?.trim();
      if (!rawName) {
        throw new Error('SKILL.md frontmatter 中未找到 name 字段，无法确定技能标识');
      }
      const slug = slugFromFrontmatterName(rawName);
      ensureSkillFrontmatter(skillDir, slug, {
        name: fm?.name,
        description: fm?.description,
      });

      const targetDir = resolvePackageDir({
        slug,
        scope: scopeInfo.scope,
        userCode: scopeInfo.userCode,
        agentId: scopeInfo.agentId,
      });
      await promoteStagedSkillDir(skillDir, targetDir, true);
      stagingActive = false;

      const markerPayload = {
        source: 'user-upload',
        slug,
        uploadedAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(targetDir, USER_UPLOAD_MARKER_NAME),
        `${JSON.stringify(markerPayload, null, 2)}\n`,
        'utf-8',
      );

      const entry = await upsertSkillEntry({
        slug,
        scope: scopeInfo.scope,
        userCode: scopeInfo.userCode,
        agentId: scopeInfo.agentId,
        version: fm?.version || '1.0.0',
        source: 'user-upload',
        name: fm?.name,
        description: fm?.description,
        enabled: true,
        versionSource: 'install',
      });

      const pkg = toSkillPackage({
        slug: entry.slug,
        sourceDir: targetDir,
        version: entry.version,
        enabled: true,
        scope: entry.scope,
        userCode: entry.userCode,
        agentId: entry.agentId,
        name: entry.name,
        description: entry.description,
        source: entry.source,
      });
      await fanOut('install', { pkg }, ctx);
      return { slug };
    } finally {
      if (stagingActive && fs.existsSync(stagingDir)) {
        await safeRemoveDir(stagingDir, { label: stagingDir }).catch(() => {});
      }
    }
  }

  /**
   * Install a local directory into the canonical store (used by preinstalled skills).
   */
  async installFromLocalDir(params: {
    slug: string;
    sourceDir: string;
    version: string;
    source: string;
    enabled?: boolean;
    scope?: SkillScope;
    name?: string;
    description?: string;
    markerName?: string;
    markerPayload?: Record<string, unknown>;
  }): Promise<void> {
    await ensureSkillsStoreDirs();
    const ctx = await resolveContext();
    const scope = params.scope || 'global';
    const targetDir = resolvePackageDir({
      slug: params.slug,
      scope,
      userCode: scope === 'user' ? ctx.userCode || undefined : undefined,
    });

    await copyDir(params.sourceDir, targetDir);
    if (params.markerName && params.markerPayload) {
      fs.writeFileSync(
        path.join(targetDir, params.markerName),
        `${JSON.stringify(params.markerPayload, null, 2)}\n`,
        'utf-8',
      );
    }

    const entry = await upsertSkillEntry({
      slug: params.slug,
      scope,
      userCode: scope === 'user' ? ctx.userCode || undefined : undefined,
      version: params.version,
      source: params.source,
      name: params.name,
      description: params.description,
      enabled: params.enabled !== false,
      versionSource: 'install',
    });

    const pkg = toSkillPackage({
      slug: entry.slug,
      sourceDir: targetDir,
      version: entry.version,
      enabled: entry.enabled,
      scope: entry.scope,
      userCode: entry.userCode,
      config: entry.config,
      name: entry.name,
      description: entry.description,
      source: entry.source,
    });
    await fanOut('install', { pkg }, ctx);
  }

  async reconcile(
    ctx?: Partial<EngineSkillContext>,
    engines?: EngineSkillId[],
  ): Promise<Record<EngineSkillId, ReconcileResult>> {
    ensureAdaptersRegistered();
    const userCode = ctx?.userCode !== undefined
      ? ctx.userCode
      : await getCurrentActiveUserCode();
    const fullCtx: EngineSkillContext = {
      userCode,
      agentId: ctx?.agentId,
    };
    const desired = (await listDesiredPackages(fullCtx)).map(toSkillPackage);
    const adapters = getEngineSkillAdapters(engines);
    const results = {} as Record<EngineSkillId, ReconcileResult>;

    for (const adapter of adapters) {
      try {
        results[adapter.id] = await adapter.reconcile(desired, fullCtx);
      } catch (error) {
        logger.warn(`[SkillManager] reconcile failed for ${adapter.id}`, error);
        results[adapter.id] = { mirrored: [], removed: [], skippedConflicts: [] };
      }
    }

    for (const adapter of adapters) {
      if (adapter.onAfterBatch) {
        await adapter.onAfterBatch(fullCtx).catch(() => undefined);
      }
    }

    return results;
  }
}

let singleton: SkillManager | null = null;

export function getSkillManager(): SkillManager {
  if (!singleton) {
    ensureAdaptersRegistered();
    singleton = new SkillManager();
  }
  return singleton;
}

/** @internal test helper */
export function resetSkillManagerForTests(): void {
  singleton = null;
  initialized = false;
  installLocks.clear();
}

export type { SkillManifestEntry };
