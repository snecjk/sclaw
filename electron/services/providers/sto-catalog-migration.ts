/**
 * One-time / on-demand repair for legacy STO catalog state left by pre-flatten
 * versions (sto-model-* accounts, custom-sto in openclaw.json, incomplete sto).
 *
 * Triggered automatically before sto-model-sync when legacy residue is detected.
 */

import type { GatewayManager } from '../../gateway/manager';
import type { ProviderAccount } from '../../shared/providers/types';
import {
  getOpenClawProvidersConfig,
  removeProviderFromOpenClaw,
  saveProviderKeyToOpenClaw,
  setOpenClawDefaultModelWithOverride,
  updateAgentModelProvider,
} from '../../utils/openclaw-auth';
import { logger } from '../../utils/logger';
import { getProviderService } from './provider-service';
import { listProviderAccounts, providerAccountToConfig } from './provider-store';
import { getClawXProviderStore } from './store-instance';
import {
  syncDefaultProviderToRuntime,
  syncDeletedProviderToRuntime,
  syncSavedProviderToRuntime,
} from './provider-runtime-sync';
import { getProviderConfig } from '../../utils/provider-registry';
import {
  isStoCatalogReady,
  isStoInternalOpenClawKey,
  isLegacyStoOpenClawModelRef,
  extractOpenClawProviderModelIds,
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
  if (
    catalogModels.length > 0
    && openClawModelIds.length > 0
    && openClawModelIds.length < catalogModels.length
  ) {
    reasons.push('openclaw-sto-models-incomplete');
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

export type EnsureStoProviderStoreParams = {
  token: string;
  remoteModelIds: string[];
  expectedBaseUrl: string;
};

/**
 * Ensure the canonical `sto` ProviderAccount exists with metadata.customModels.
 * UI reads this store — openclaw.json alone is not enough.
 */
export async function ensureStoProviderStoreCatalog(
  params: EnsureStoProviderStoreParams,
): Promise<boolean> {
  const { token, remoteModelIds, expectedBaseUrl } = params;
  if (remoteModelIds.length === 0) {
    return false;
  }

  const providerService = getProviderService();
  const existing = (await listProviderAccounts()).find((a) => a.id === STO_CANONICAL_ACCOUNT_ID);
  const now = new Date().toISOString();

  if (!existing) {
    const account: ProviderAccount = {
      id: STO_CANONICAL_ACCOUNT_ID,
      vendorId: 'sto',
      label: 'STO AI',
      authMode: 'api_key',
      baseUrl: expectedBaseUrl,
      apiProtocol: 'openai-completions',
      model: remoteModelIds[0],
      enabled: true,
      isDefault: false,
      metadata: {
        managedBy: 'sto-auto-sync',
        customModels: remoteModelIds,
      },
      createdAt: now,
      updatedAt: now,
    };
    await providerService.createAccount(account, token);
    logger.info(`[sto-migration] Created sto provider store account with ${remoteModelIds.length} model(s)`);
    return true;
  }

  const currentModels = existing.metadata?.customModels ?? [];
  const needsUpdate =
    currentModels.length === 0
    || currentModels.length !== remoteModelIds.length
    || !remoteModelIds.every((id, i) => currentModels[i] === id)
    || existing.baseUrl !== expectedBaseUrl
    || !existing.enabled;

  if (!needsUpdate) {
    return false;
  }

  await providerService.updateAccount(
    STO_CANONICAL_ACCOUNT_ID,
    {
      baseUrl: expectedBaseUrl,
      enabled: true,
      model: existing.model && remoteModelIds.includes(existing.model)
        ? existing.model
        : remoteModelIds[0],
      metadata: {
        ...existing.metadata,
        managedBy: 'sto-auto-sync',
        customModels: remoteModelIds,
      },
      updatedAt: now,
    },
    token,
  );
  logger.info(`[sto-migration] Updated sto provider store catalog (${remoteModelIds.length} model(s))`);
  return true;
}

/**
 * Scrub legacy openclaw provider keys / primary without a remote fetch.
 * Safe to run on every Gateway pre-launch.
 */
export async function scrubLegacyStoOpenClawConfig(): Promise<boolean> {
  const { providers, defaultModel } = await getOpenClawProvidersConfig();
  const legacyProviderKeys = Object.keys(providers).filter(isLegacyOpenClawProviderKey);
  const legacyPrimary = Boolean(defaultModel && isLegacyStoOpenClawModelRef(defaultModel));

  if (legacyProviderKeys.length === 0 && !legacyPrimary) {
    return false;
  }

  logger.info(
    `[sto-migration] Scrubbing legacy openclaw STO config: keys=${legacyProviderKeys.join(',') || 'none'}, `
    + `legacyPrimary=${legacyPrimary}${defaultModel ? ` (${defaultModel})` : ''}`,
  );

  const keysToScrub = new Set<string>([
    ...OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB,
    ...legacyProviderKeys,
  ]);
  for (const key of keysToScrub) {
    try {
      await removeProviderFromOpenClaw(key);
    } catch (err) {
      logger.warn(`[sto-migration] Failed to scrub openclaw key "${key}":`, err);
    }
  }
  return true;
}

export type RepairOpenClawStoRuntimeParams = {
  token: string;
  remoteModelIds: string[];
  expectedBaseUrl: string;
  runtimeGateway?: GatewayManager;
};

/**
 * After a successful remote sync, scrub legacy openclaw keys (custom-sto) and
 * rewrite agents.defaults.model.primary to sto/* when needed.
 */
export async function repairOpenClawStoRuntimeAfterSync(
  params: RepairOpenClawStoRuntimeParams,
): Promise<boolean> {
  const { token, remoteModelIds, expectedBaseUrl, runtimeGateway } = params;
  if (remoteModelIds.length === 0) {
    return false;
  }

  const { providers, defaultModel } = await getOpenClawProvidersConfig();
  const legacyProviderKeys = Object.keys(providers).filter(isLegacyOpenClawProviderKey);
  const legacyPrimary = Boolean(defaultModel && isLegacyStoOpenClawModelRef(defaultModel));
  const stoOpenClaw = providers[STO_CANONICAL_ACCOUNT_ID];
  const openClawModelIds = extractOpenClawProviderModelIds(stoOpenClaw);
  const modelsIncomplete = openClawModelIds.length < remoteModelIds.length;
  const stoMissing = !stoOpenClaw;

  const needsRepair =
    legacyProviderKeys.length > 0
    || legacyPrimary
    || stoMissing
    || modelsIncomplete;

  if (!needsRepair) {
    return false;
  }

  logger.info(
    `[sto-migration] Repairing openclaw STO runtime: legacyKeys=${legacyProviderKeys.join(',') || 'none'}, `
    + `legacyPrimary=${legacyPrimary}${defaultModel ? ` (${defaultModel})` : ''}, `
    + `openClawModels=${openClawModelIds.length}/${remoteModelIds.length}`,
  );

  const keysToScrub = new Set<string>([
    ...OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB,
    ...legacyProviderKeys,
  ]);
  for (const key of keysToScrub) {
    try {
      await removeProviderFromOpenClaw(key);
    } catch (err) {
      logger.warn(`[sto-migration] Failed to scrub openclaw key "${key}":`, err);
    }
  }

  await ensureStoProviderStoreCatalog({ token, remoteModelIds, expectedBaseUrl });

  const stoAccount = (await listProviderAccounts()).find((a) => a.id === STO_CANONICAL_ACCOUNT_ID);
  if (stoAccount && isStoCatalogReady(stoAccount)) {
    await syncSavedProviderToRuntime(
      providerAccountToConfig(stoAccount),
      token,
      runtimeGateway,
    );
    await syncDefaultProviderToRuntime(STO_CANONICAL_ACCOUNT_ID, runtimeGateway);
    return true;
  }

  const stoMeta = getProviderConfig('sto');
  const defaultModelId = remoteModelIds[0]!;
  const modelRef = `sto/${defaultModelId}`;
  const fallbackModelRefs = remoteModelIds.slice(1).map((id) => `sto/${id}`);
  const modelEntries = remoteModelIds.map((id) => ({
    id,
    name: id,
    input: ['text', 'image'] as string[],
  }));

  await setOpenClawDefaultModelWithOverride(
    STO_CANONICAL_ACCOUNT_ID,
    modelRef,
    {
      baseUrl: expectedBaseUrl,
      api: stoMeta?.api ?? 'openai-completions',
      apiKeyEnv: stoMeta?.apiKeyEnv ?? 'STO_API_KEY',
      defaultModelInput: ['text', 'image'],
    },
    fallbackModelRefs,
  );
  await updateAgentModelProvider(STO_CANONICAL_ACCOUNT_ID, {
    baseUrl: expectedBaseUrl,
    api: stoMeta?.api ?? 'openai-completions',
    models: modelEntries,
    apiKey: token,
  });
  await saveProviderKeyToOpenClaw(STO_CANONICAL_ACCOUNT_ID, token);
  return true;
}
