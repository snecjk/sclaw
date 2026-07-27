import type { DesiredSkillPackage } from '../canonical-store';

export type EngineSkillId = 'openclaw' | 'claude';

export interface SkillPackage {
  slug: string;
  sourceDir: string;
  version: string;
  enabled: boolean;
  scope: 'global' | 'user' | 'agent';
  userCode?: string;
  agentId?: string;
  config?: {
    apiKey?: string;
    env?: Record<string, string>;
  };
  name?: string;
  description?: string;
  author?: string;
  source?: string;
}

export interface EngineSkillContext {
  userCode: string | null;
  agentId?: string;
}

export interface ReconcileResult {
  mirrored: string[];
  removed: string[];
  skippedConflicts: string[];
}

export interface EngineSkillAdapter {
  readonly id: EngineSkillId;
  applyInstall(pkg: SkillPackage, ctx: EngineSkillContext): Promise<void>;
  applyUninstall(slug: string, ctx: EngineSkillContext): Promise<void>;
  applyEnabled(slug: string, enabled: boolean, ctx: EngineSkillContext): Promise<void>;
  reconcile(desired: SkillPackage[], ctx: EngineSkillContext): Promise<ReconcileResult>;
  onAfterBatch?(ctx: EngineSkillContext): Promise<void>;
  /** Best-effort cleanup of this engine's managed projection roots. */
  cleanupOrphanProjections?(): Promise<void>;
}

export function toSkillPackage(desired: DesiredSkillPackage): SkillPackage {
  return {
    slug: desired.slug,
    sourceDir: desired.sourceDir,
    version: desired.version,
    enabled: desired.enabled,
    scope: desired.scope,
    userCode: desired.userCode,
    agentId: desired.agentId,
    config: desired.config,
    name: desired.name,
    description: desired.description,
    author: desired.author,
    source: desired.source,
  };
}

type GatewayReloader = {
  debouncedReload?: (opts?: { force?: boolean }) => void;
  reload?: (opts?: { force?: boolean }) => Promise<void>;
};

let registeredAdapters: EngineSkillAdapter[] = [];
let gatewayReloader: GatewayReloader | null = null;

export function setEngineSkillAdapters(adapters: EngineSkillAdapter[]): void {
  registeredAdapters = [...adapters];
}

export function getEngineSkillAdapters(filter?: EngineSkillId[]): EngineSkillAdapter[] {
  if (!filter || filter.length === 0) {
    return [...registeredAdapters];
  }
  const wanted = new Set(filter);
  return registeredAdapters.filter((adapter) => wanted.has(adapter.id));
}

export function setGatewayReloaderForSkills(reloader: GatewayReloader | null): void {
  gatewayReloader = reloader;
}

export async function notifyGatewayAfterSkillBatch(): Promise<void> {
  if (!gatewayReloader) return;
  try {
    if (typeof gatewayReloader.debouncedReload === 'function') {
      gatewayReloader.debouncedReload({ force: true });
      return;
    }
    if (typeof gatewayReloader.reload === 'function') {
      await gatewayReloader.reload({ force: true });
    }
  } catch {
    // best-effort
  }
}

/**
 * When an engine is removed from the registry, clean up its orphan projections.
 */
export async function cleanupRemovedEngineProjections(
  previousAdapters: EngineSkillAdapter[],
  nextAdapters: EngineSkillAdapter[],
): Promise<void> {
  const nextIds = new Set(nextAdapters.map((a) => a.id));
  for (const adapter of previousAdapters) {
    if (nextIds.has(adapter.id)) continue;
    if (adapter.cleanupOrphanProjections) {
      await adapter.cleanupOrphanProjections().catch(() => undefined);
    }
  }
}
