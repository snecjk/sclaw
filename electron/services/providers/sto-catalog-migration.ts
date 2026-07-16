/**
 * One-time / on-demand repair for legacy STO catalog state left by pre-flatten
 * versions (sto-model-* accounts, custom-sto in openclaw.json, incomplete sto).
 *
 * Triggered automatically before sto-model-sync when legacy residue is detected.
 */

import type { GatewayManager } from '../../gateway/manager';
import type { ProviderAccount } from '../../shared/providers/types';
import { getOpenClawProvidersConfig, removeProviderFromOpenClaw } from '../../utils/openclaw-auth';
import { logger } from '../../utils/logger';
import { getProviderService } from './provider-service';
import { listProviderAccounts, providerAccountToConfig } from './provider-store';
import { getClawXProviderStore } from './store-instance';
import { syncDeletedProviderToRuntime } from './provider-runtime-sync';
import {
  extractOpenClawProviderModelIds,
  isLegacyStoOpenClawModelRef,
  isStoCatalogReady,
  isStoInternalOpenClawKey,
  OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB,
  shouldDeleteStaleStoPlaceholder,
  STO_CANONICAL_ACCOUNT_ID,
} from './sto-placeholder-utils';

/** Bump when STO catalog storage / openclaw layout changes require repair. */
export const STO_CATALOG_MIGRATION_VERSION = 2;

const STO_LEGACY_OPENCLAW_KEY_PREFIX = 'sto-model-';

export type StoCatalogLegacyState = {
  needsMigration: boolean;
  reasons: string[];
};

export async function getStoCatalogMigrationVersion(): Promise<number> {
  const store = await getClawXProviderStore();
  return Number(store.get('stoCatalogMigrationVersion') ?? 0);
}

export async function markStoCatalogMigrationComplete(): Promise<void> {
  const store = await getClawXProviderStore();
  store.set('stoCatalogMigrationVersion', STO_CATALOG_MIGRATION_VERSION);
}

function isLegacyOpenClawProviderKey(key: string): boolean {
  // Plugin-owned provider written by syncStoPluginsToOpenClaw. It is "internal"
  // for UI/import (hidden) but must NOT be scrubbed — otherwise every login
  // re-adds it, migration deletes it, and OpenClaw hard-restarts twice.
  if (key === 'sto-dynamic-agent-route') return false;
  if (isStoInternalOpenClawKey(key)) return true;
  if (key.startsWith(STO_LEGACY_OPENCLAW_KEY_PREFIX)) return true;
  return false;
}

/**
 * Detect residue from old STO multi-account / non-flatten installs.
 */
export async function detectStoCatalogLegacyState(): Promise<StoCatalogLegacyState> {
  const reasons: string[] = [];

  const migrationVersion = await getStoCatalogMigrationVersion();
  if (migrationVersion < STO_CATALOG_MIGRATION_VERSION) {
    reasons.push('migration-version-pending');
  }

  const accounts = await listProviderAccounts();
  for (const account of accounts) {
    if (shouldDeleteStaleStoPlaceholder(account)) {
      reasons.push(`stale-account:${account.id}`);
    }
  }

  const canonical = accounts.find((a) => a.id === STO_CANONICAL_ACCOUNT_ID);
  if (canonical && !isStoCatalogReady(canonical)) {
    reasons.push('incomplete-sto-account');
  }

  const { providers, defaultModel } = await getOpenClawProvidersConfig();
  for (const key of Object.keys(providers)) {
    if (isLegacyOpenClawProviderKey(key)) {
      reasons.push(`openclaw-key:${key}`);
    }
  }

  if (defaultModel && isLegacyStoOpenClawModelRef(defaultModel)) {
    reasons.push('legacy-primary-model-ref');
  }

  const stoOpenClaw = providers[STO_CANONICAL_ACCOUNT_ID];
  const openClawModelIds = extractOpenClawProviderModelIds(stoOpenClaw);
  const catalogModels = canonical?.metadata?.customModels ?? [];
  if (catalogModels.length > 0) {
    if (!stoOpenClaw || openClawModelIds.length === 0) {
      reasons.push('openclaw-sto-missing');
    } else if (openClawModelIds.length < catalogModels.length) {
      reasons.push('openclaw-sto-models-incomplete');
    }
  }

  return {
    needsMigration: reasons.length > 0,
    reasons,
  };
}

export type StoCatalogPreMigrateResult = {
  deletedAccountIds: string[];
  scrubbedOpenClawKeys: string[];
};

/**
 * Scrub legacy openclaw keys and delete stale provider accounts before remote sync.
 * Does not touch the canonical `sto` account — sync updates that in place.
 */
export async function preMigrateStoCatalogPlaceholders(
  runtimeGateway?: GatewayManager,
): Promise<StoCatalogPreMigrateResult> {
  const deletedAccountIds: string[] = [];
  const scrubbedOpenClawKeys: string[] = [];
  const providerService = getProviderService();

  const accounts = await listProviderAccounts();
  const staleAccounts = accounts.filter(shouldDeleteStaleStoPlaceholder);
  for (const account of staleAccounts) {
    try {
      const config = providerAccountToConfig(account);
      await providerService.deleteAccount(account.id);
      await syncDeletedProviderToRuntime(config, account.id, runtimeGateway);
      deletedAccountIds.push(account.id);
    } catch (err) {
      logger.warn(`[sto-migration] Failed to delete stale account ${account.id}:`, err);
    }
  }

  const { providers } = await getOpenClawProvidersConfig();
  const keysToScrub = new Set<string>(OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB);
  for (const key of Object.keys(providers)) {
    if (isLegacyOpenClawProviderKey(key)) {
      keysToScrub.add(key);
    }
  }

  for (const key of keysToScrub) {
    if (!(key in providers)) continue;
    try {
      await removeProviderFromOpenClaw(key);
      scrubbedOpenClawKeys.push(key);
      logger.info(`[sto-migration] Scrubbed openclaw.json provider key "${key}"`);
    } catch (err) {
      logger.warn(`[sto-migration] Failed to scrub openclaw key "${key}":`, err);
    }
  }

  if (deletedAccountIds.length > 0 || scrubbedOpenClawKeys.length > 0) {
    logger.info(
      `[sto-migration] Pre-migrate: deletedAccounts=${deletedAccountIds.length} scrubbedKeys=${scrubbedOpenClawKeys.length}`,
    );
  }

  return { deletedAccountIds, scrubbedOpenClawKeys };
}

export function accountNeedsStoCatalogRepair(account: ProviderAccount): boolean {
  return shouldDeleteStaleStoPlaceholder(account)
    || (account.id === STO_CANONICAL_ACCOUNT_ID && !isStoCatalogReady(account));
}
