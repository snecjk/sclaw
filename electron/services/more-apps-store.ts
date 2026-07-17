/**
 * More Apps registry persistence under ~/.stoclaw/more-apps/apps.json
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createEmptyMoreAppsRegistry,
  isMoreAppsRegistryEmpty,
  MORE_APPS_REGISTRY_VERSION,
  type MoreAppsExternalApp,
  type MoreAppsRegistry,
} from '../../shared/more-apps-registry';
import { getMoreAppsRegistryPath } from '../utils/paths';
import { logger } from '../utils/logger';

export type { MoreAppsExternalApp, MoreAppsRegistry };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeExternalApp(raw: unknown): MoreAppsExternalApp | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !url) return null;
  return {
    id,
    name: name || id,
    url,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    iconKey: typeof raw.iconKey === 'string' ? raw.iconKey : undefined,
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : undefined,
    tone: typeof raw.tone === 'string' ? raw.tone : undefined,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    hidden: typeof raw.hidden === 'boolean' ? raw.hidden : undefined,
    kind: raw.kind === 'builtin' || raw.kind === 'external' ? raw.kind : 'external',
    installed: typeof raw.installed === 'boolean' ? raw.installed : undefined,
    external: typeof raw.external === 'boolean' ? raw.external : true,
    official: typeof raw.official === 'boolean' ? raw.official : undefined,
    recommended: typeof raw.recommended === 'boolean' ? raw.recommended : undefined,
    badge: typeof raw.badge === 'string' ? raw.badge : undefined,
    recent: typeof raw.recent === 'string' ? raw.recent : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : undefined,
    order: typeof raw.order === 'number' ? raw.order : undefined,
  };
}

function normalizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Normalize unknown JSON into a registry document. Exported for unit tests. */
export function normalizeMoreAppsRegistry(raw: unknown): MoreAppsRegistry {
  if (!isRecord(raw)) {
    return createEmptyMoreAppsRegistry();
  }
  const externalApps = Array.isArray(raw.externalApps)
    ? raw.externalApps.map(normalizeExternalApp).filter((a): a is MoreAppsExternalApp => a !== null)
    : [];
  return {
    version: MORE_APPS_REGISTRY_VERSION,
    externalApps,
    installedIds: normalizeIdList(raw.installedIds),
    favoriteIds: normalizeIdList(raw.favoriteIds),
  };
}

function writeRegistryFile(filePath: string, registry: MoreAppsRegistry): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  const tmpPath = join(dir, `apps.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmpPath, payload, 'utf-8');
  renameSync(tmpPath, filePath);
}

export function readMoreAppsRegistry(filePath = getMoreAppsRegistryPath()): MoreAppsRegistry {
  try {
    if (!existsSync(filePath)) {
      return createEmptyMoreAppsRegistry();
    }
    const raw = readFileSync(filePath, 'utf-8');
    if (!raw.trim()) {
      return createEmptyMoreAppsRegistry();
    }
    return normalizeMoreAppsRegistry(JSON.parse(raw) as unknown);
  } catch (error) {
    logger.warn('[more-apps] failed to read registry, using empty:', error);
    return createEmptyMoreAppsRegistry();
  }
}

export function writeMoreAppsRegistry(
  registry: MoreAppsRegistry,
  filePath = getMoreAppsRegistryPath(),
): MoreAppsRegistry {
  const normalized = normalizeMoreAppsRegistry(registry);
  writeRegistryFile(filePath, normalized);
  return normalized;
}

export interface MoreAppsMigrateResult {
  migrated: boolean;
  registry: MoreAppsRegistry;
}

/**
 * Import legacy renderer localStorage payload when on-disk registry is empty.
 * Non-empty disk MUST NOT be overwritten.
 */
export function migrateMoreAppsRegistry(
  payload: unknown,
  filePath = getMoreAppsRegistryPath(),
): MoreAppsMigrateResult {
  const existing = readMoreAppsRegistry(filePath);
  if (!isMoreAppsRegistryEmpty(existing)) {
    return { migrated: false, registry: existing };
  }
  const incoming = normalizeMoreAppsRegistry(payload);
  if (isMoreAppsRegistryEmpty(incoming)) {
    return { migrated: false, registry: existing };
  }
  const written = writeMoreAppsRegistry(incoming, filePath);
  return { migrated: true, registry: written };
}
