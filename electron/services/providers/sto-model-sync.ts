/**
 * STO Model Auto-Sync Service
 *
 * Fetches the model list from the STO AI-Memory API (OpenAI-compatible
 * /v1/models endpoint) and maintains a single ProviderAccount (id='sto',
 * vendorId='sto') whose metadata.customModels stays in sync with the
 * remote catalog.
 */

import type { GatewayManager } from '../../gateway/manager';
import type { ProviderAccount } from '../../shared/providers/types';
import type { SsoEnvironment, SsoUserInfo } from '../../utils/auth-store';
import { getProviderService } from './provider-service';
import { listProviderAccounts, getDefaultProviderAccountId } from './provider-store';
import { providerAccountToConfig } from './provider-store';
import { storeApiKey, getApiKey } from '../../utils/secure-storage';
import {
  syncSavedProviderToRuntime,
  syncDeletedProviderToRuntime,
  syncDefaultProviderToRuntime,
  syncProviderApiKeyToRuntime,
} from './provider-runtime-sync';
import { logger } from '../../utils/logger';
import { getOpenClawProvidersConfig, removeProviderFromOpenClaw } from '../../utils/openclaw-auth';
import {
  extractOpenClawProviderModelIds,
  isLegacyStoOpenClawModelRef,
  OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB,
  shouldDeleteStaleStoPlaceholder,
  STO_CANONICAL_ACCOUNT_ID,
  isStoCatalogReady,
} from './sto-placeholder-utils';
import {
  detectStoCatalogLegacyState,
  markStoCatalogMigrationComplete,
  preMigrateStoCatalogPlaceholders,
} from './sto-catalog-migration';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STO_ACCOUNT_ID = STO_CANONICAL_ACCOUNT_ID;

/** Legacy prefix used before the single-account refactor. */
const STO_LEGACY_ACCOUNT_ID_PREFIX = 'sto-model-';

const STO_DOMAINS: Record<string, string> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn/agent',
  'pre-release': 'https://pre-baseinfo-aimemory.sto.cn/agent',
  'local': 'http://127.0.0.1:7001/agent',
};
const STO_DOMAIN_DEFAULT = 'https://baseinfo-aimemory.sto.cn/agent';

const SYNC_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

function inferenceHeadersEqual(
  current: Record<string, string> | undefined,
  expected: Record<string, string>,
): boolean {
  const currentKeys = Object.keys(current ?? {});
  const expectedKeys = Object.keys(expected);
  if (currentKeys.length !== expectedKeys.length) {
    return false;
  }
  return expectedKeys.every((key) => (current ?? {})[key] === expected[key]);
}

async function broadcastStoModelsSynced(payload: {
  fallbackModel?: string;
  catalogChanged: boolean;
  agentsRemapped: number;
}): Promise<void> {
  try {
    const { BrowserWindow } = await import('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('sto:models-synced', payload);
      }
    }
  } catch (err) {
    logger.warn('[sto-sync] Failed to broadcast sto:models-synced:', err);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoRemoteModel {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
}

export interface StoSyncResult {
  created: string[];
  deleted: string[];
  updated: string[];
  defaultSet: string | null;
  error?: string;
  /** True when legacy STO catalog residue was repaired during this sync. */
  legacyRepaired?: boolean;
  /** When true, caller should force one gateway reload (bypass login 8s skip). */
  needsForcedGatewayRefresh?: boolean;
  /** Latest STO workspace default model after sync (for UI toolbar remap). */
  fallbackModel?: string;
  /** True when customModels / default / agent bindings changed — renderer should refresh. */
  notifyUi?: boolean;
  agentsRemapped?: number;
}

export type StoSyncOptions = {
  /** When true, skip per-step Gateway reload; caller should reload once after batching. */
  deferGatewayRefresh?: boolean;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class StoModelSyncService {
  private gatewayManager: GatewayManager | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private currentSync: Promise<StoSyncResult> | null = null;

  // -- Injection -----------------------------------------------------------

  setGatewayManager(gm: GatewayManager): void {
    this.gatewayManager = gm;
  }

  // -- Static helpers ------------------------------------------------------

  static resolveDomain(env: SsoEnvironment): string {
    return STO_DOMAINS[env] ?? STO_DOMAIN_DEFAULT;
  }

  static isStoManagedAccount(account: ProviderAccount): boolean {
    return (
      account.id === STO_ACCOUNT_ID ||
      account.id.startsWith(STO_LEGACY_ACCOUNT_ID_PREFIX)
    );
  }

  // -- Core sync -----------------------------------------------------------

  /**
   * Run a full reconciliation cycle.  Safe to call concurrently — if a sync
   * is already in progress the caller gets the same promise back.
   */
  async syncModels(options?: StoSyncOptions): Promise<StoSyncResult> {
    if (this.currentSync) {
      return this.currentSync;
    }
    this.currentSync = this.doSync(options);
    try {
      return await this.currentSync;
    } finally {
      this.currentSync = null;
    }
  }

  private async doSync(options?: StoSyncOptions): Promise<StoSyncResult> {
    const runtimeGateway = options?.deferGatewayRefresh
      ? undefined
      : (this.gatewayManager ?? undefined);
    const result: StoSyncResult = {
      created: [],
      deleted: [],
      updated: [],
      defaultSet: null,
    };

    // Step 1 — Get user SK
    const { getUserSk } = await import('../user-sk-service');
    const sk = await getUserSk();
    if (!sk) {
      result.error = 'no-sk';
      return result;
    }

    // Step 2 — Resolve strategy for inference key/headers
    const { getAuthState } = await import('../../utils/auth-store');
    const authState = await getAuthState();
    const { resolveStrategy } = await import('../sto-sk-strategy');
    const strategy = await resolveStrategy(authState.user);
    if (!strategy || !authState.user) {
      result.error = 'no-strategy';
      return result;
    }

    const inferenceSk = await strategy.formatInferenceApiKey(authState.user, sk);
    const inferenceHeaders = await strategy.getInferenceHeaders(authState.user);

    const legacyState = await detectStoCatalogLegacyState();
    if (legacyState.needsMigration) {
      logger.info(
        `[sto-sync] Legacy STO catalog detected (${legacyState.reasons.join(', ')}); running pre-migration`,
      );
      const preMigrate = await preMigrateStoCatalogPlaceholders(runtimeGateway);
      result.deleted.push(...preMigrate.deletedAccountIds);
    }

    // Step 3 — Fetch remote models and supplier domain via strategy (网点/非网点)
    let remoteModels: StoRemoteModel[];
    let supplierDomain: string;
    try {
      const models = await strategy.getUserModels(authState.user);
      remoteModels = (models ?? []).map((id) => ({ id, name: id }));
      supplierDomain = await strategy.getSupplierDomain();
      logger.info(
        `[sto-sync] Inference portal domain applied: domain=${supplierDomain}, baseUrl=${supplierDomain}/v1`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[sto-sync] Failed to fetch remote models or domain via strategy: ${message}`);
      result.error = `fetch-failed: ${message}`;
      return result;
    }

    const remoteModelIds = remoteModels.map((m) => m.id);

    if (remoteModelIds.length === 0) {
      logger.warn('[sto-sync] Remote model list is empty');
      result.error = 'empty-model-list';
      return result;
    }

    const providerService = getProviderService();
    const allAccounts = await listProviderAccounts();

    // Step 4 — Delete stale STO placeholder accounts (legacy sto-model-*, custom-sto, etc.)
    const staleAccounts = allAccounts.filter(shouldDeleteStaleStoPlaceholder);

    let legacyDefaultWasSto = false;
    if (staleAccounts.length > 0) {
      const currentDefault = await getDefaultProviderAccountId();
      legacyDefaultWasSto = staleAccounts.some((account) => account.id === currentDefault);

      for (const account of staleAccounts) {
        try {
          const config = providerAccountToConfig(account);
          await providerService.deleteAccount(account.id);
          await syncDeletedProviderToRuntime(
            config,
            account.id,
            runtimeGateway,
          );
          result.deleted.push(account.id);
        } catch (err) {
          logger.warn(
            `[sto-sync] Failed to delete stale placeholder account ${account.id}:`,
            err,
          );
        }
      }
      logger.info(
        `[sto-sync] Removed ${staleAccounts.length} stale STO placeholder account(s)`,
      );
    }

    for (const openClawKey of OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB) {
      try {
        await removeProviderFromOpenClaw(openClawKey);
        logger.info(`[sto-sync] Scrubbed stale openclaw.json provider key "${openClawKey}"`);
      } catch (err) {
        logger.warn(`[sto-sync] Failed to scrub openclaw provider "${openClawKey}":`, err);
      }
    }

    // Step 5 — Create or update the single STO account
    const existingAccount = allAccounts.find((a) => a.id === STO_ACCOUNT_ID);
    const expectedBaseUrl = `${supplierDomain}/v1`;
    const now = new Date().toISOString();

    if (!existingAccount) {
      const account: ProviderAccount = {
        id: STO_ACCOUNT_ID,
        vendorId: 'sto',
        label: 'STO AI',
        authMode: 'api_key',
        baseUrl: expectedBaseUrl,
        apiProtocol: 'openai-completions',
        model: remoteModelIds[0],
        enabled: true,
        isDefault: false,
        headers: inferenceHeaders,
        metadata: {
          managedBy: 'sto-auto-sync',
          customModels: remoteModelIds,
        },
        createdAt: now,
        updatedAt: now,
      };

      try {
        await providerService.createAccount(account, inferenceSk);
        await syncSavedProviderToRuntime(
          providerAccountToConfig(account),
          inferenceSk,
          runtimeGateway,
        );
        result.created.push(STO_ACCOUNT_ID);
      } catch (err) {
        logger.warn(`[sto-sync] Failed to create STO account:`, err);
      }
    } else {
      const currentModels = existingAccount.metadata?.customModels ?? [];
      const modelsChanged =
        currentModels.length !== remoteModelIds.length ||
        !remoteModelIds.every((id, i) => currentModels[i] === id);
      const baseUrlChanged = existingAccount.baseUrl !== expectedBaseUrl;
      const currentModelRemoved =
        existingAccount.model && !remoteModelIds.includes(existingAccount.model);
      const headersChanged = !inferenceHeadersEqual(existingAccount.headers, inferenceHeaders);
      const vendorIdNeedsNormalize = existingAccount.vendorId !== 'sto';

      if (
        modelsChanged
        || baseUrlChanged
        || currentModelRemoved
        || headersChanged
        || !existingAccount.enabled
        || vendorIdNeedsNormalize
      ) {
        const patch: Partial<ProviderAccount> = {
          vendorId: 'sto',
          baseUrl: expectedBaseUrl,
          enabled: true,
          headers: inferenceHeaders,
          metadata: {
            ...existingAccount.metadata,
            managedBy: 'sto-auto-sync',
            customModels: remoteModelIds,
          },
          updatedAt: now,
        };

        if (currentModelRemoved) {
          patch.model = remoteModelIds[0];
        }

        try {
          await providerService.updateAccount(STO_ACCOUNT_ID, patch, inferenceSk);
          const updatedAccount = {
            ...existingAccount,
            ...patch,
            id: STO_ACCOUNT_ID,
            vendorId: 'sto' as const,
          };
          await syncSavedProviderToRuntime(
            providerAccountToConfig(updatedAccount),
            inferenceSk,
            runtimeGateway,
          );
          result.updated.push(STO_ACCOUNT_ID);

          // Default model was delisted: refresh OpenClaw agents.defaults.model even when
          // the default account is already `sto` (setDefaultAccount below is a no-op then).
          if (currentModelRemoved) {
            const defaultId = await getDefaultProviderAccountId();
            if (!defaultId || defaultId === STO_ACCOUNT_ID) {
              try {
                await syncDefaultProviderToRuntime(STO_ACCOUNT_ID, runtimeGateway);
                result.defaultSet = STO_ACCOUNT_ID;
                logger.info(
                  `[sto-sync] Remapped workspace default model to ${remoteModelIds[0]} after catalog delist`,
                );
              } catch (err) {
                logger.warn('[sto-sync] Failed to refresh OpenClaw default after model delist:', err);
              }
            }
          }
        } catch (err) {
          logger.warn(`[sto-sync] Failed to update STO account:`, err);
        }
      } else {
        try {
          const currentKey = await getApiKey(STO_ACCOUNT_ID);
          if (currentKey !== inferenceSk) {
            await storeApiKey(STO_ACCOUNT_ID, inferenceSk);
            await syncProviderApiKeyToRuntime('sto', STO_ACCOUNT_ID, inferenceSk);
            result.updated.push(STO_ACCOUNT_ID);
          }
        } catch (err) {
          logger.warn(`[sto-sync] Failed to update API key:`, err);
        }
      }
    }

    // Step 5b — Provider store may be ready while openclaw.json still has legacy residue
    await this.ensureStoCatalogMirroredToOpenClaw(inferenceSk, runtimeGateway, result);

    // Step 6 — Set default provider if needed
    const currentDefault = await getDefaultProviderAccountId();
    const needsNewDefault =
      !currentDefault || legacyDefaultWasSto;

    if (needsNewDefault) {
      try {
        await providerService.setDefaultAccount(STO_ACCOUNT_ID);
        await syncDefaultProviderToRuntime(
          STO_ACCOUNT_ID,
          runtimeGateway,
        );
        result.defaultSet = STO_ACCOUNT_ID;
      } catch (err) {
        logger.warn(`[sto-sync] Failed to set default account:`, err);
      }
    }

    if (legacyState.needsMigration) {
      const postRepairState = await detectStoCatalogLegacyState();
      if (!postRepairState.needsMigration) {
        await markStoCatalogMigrationComplete();
        result.legacyRepaired = true;
        if (
          result.created.length > 0
          || result.updated.length > 0
          || result.deleted.length > 0
          || result.defaultSet != null
        ) {
          result.needsForcedGatewayRefresh = true;
        }
        logger.info('[sto-sync] Legacy STO catalog migration marked complete');
      } else {
        logger.warn(
          `[sto-sync] Legacy STO catalog still pending after sync (${postRepairState.reasons.join(', ')})`,
        );
      }
    }

    // Step 7 — Remap agent preferred / OpenClaw list models that left the catalog
    const refreshedAccounts = await listProviderAccounts();
    const stoAccount = refreshedAccounts.find((account) => account.id === STO_ACCOUNT_ID);
    const fallbackModel = (stoAccount?.model?.trim() || remoteModelIds[0] || '').trim();
    result.fallbackModel = fallbackModel || undefined;

    const previousCatalog = existingAccount?.metadata?.customModels ?? [];
    const catalogChanged =
      previousCatalog.length !== remoteModelIds.length
      || !remoteModelIds.every((id, i) => previousCatalog[i] === id)
      || Boolean(
        existingAccount?.model
        && stoAccount?.model
        && existingAccount.model !== stoAccount.model,
      );

    if (fallbackModel) {
      try {
        const { remapDelistedAgentModels } = await import('../../utils/agent-config');
        const remapped = await remapDelistedAgentModels({
          catalogIds: remoteModelIds,
          previousCatalogIds: previousCatalog,
          fallbackModel,
          fallbackAccountId: STO_ACCOUNT_ID,
        });
        result.agentsRemapped = remapped.preferredRemapped + remapped.openclawRemapped;
      } catch (err) {
        logger.warn('[sto-sync] Failed to remap delisted agent models:', err);
      }
    }

    result.notifyUi = Boolean(
      result.created.length > 0
      || result.updated.length > 0
      || result.deleted.length > 0
      || result.defaultSet != null
      || catalogChanged
      || (result.agentsRemapped ?? 0) > 0,
    );

    if (result.notifyUi) {
      await broadcastStoModelsSynced({
        fallbackModel: result.fallbackModel,
        catalogChanged,
        agentsRemapped: result.agentsRemapped ?? 0,
      });
    }

    logger.info(
      `[sto-sync] Sync completed: created=${result.created.length}, deleted=${result.deleted.length}, updated=${result.updated.length}, models=${remoteModelIds.length}, default=${result.defaultSet ?? '(unchanged)'}, agentsRemapped=${result.agentsRemapped ?? 0}, legacyRepaired=${result.legacyRepaired ?? false}`,
    );

    return result;
  }

  /**
   * When the provider store has a ready STO catalog but openclaw.json is stale
   * (missing sto, incomplete models[], or legacy custom-sto primary), mirror runtime.
   */
  private async ensureStoCatalogMirroredToOpenClaw(
    sk: string,
    runtimeGateway: GatewayManager | undefined,
    result: StoSyncResult,
  ): Promise<void> {
    const refreshedAccounts = await listProviderAccounts();
    const stoAccount = refreshedAccounts.find((a) => a.id === STO_ACCOUNT_ID);
    if (!stoAccount || !isStoCatalogReady(stoAccount)) {
      return;
    }

    const catalogModels = stoAccount.metadata?.customModels ?? [];
    const { providers, defaultModel } = await getOpenClawProvidersConfig();
    const openClawModelIds = extractOpenClawProviderModelIds(providers[STO_ACCOUNT_ID]);
    const stoMissingFromOpenClaw = !providers[STO_ACCOUNT_ID];
    const openClawModelsIncomplete =
      catalogModels.length > 0 && openClawModelIds.length < catalogModels.length;
    const legacyPrimary = Boolean(defaultModel && isLegacyStoOpenClawModelRef(defaultModel));

    if (!stoMissingFromOpenClaw && !openClawModelsIncomplete && !legacyPrimary) {
      return;
    }

    logger.info(
      `[sto-sync] Repairing openclaw STO runtime: missing=${stoMissingFromOpenClaw}, `
      + `incompleteModels=${openClawModelsIncomplete} (${openClawModelIds.length}/${catalogModels.length}), `
      + `legacyPrimary=${legacyPrimary}${defaultModel ? ` (${defaultModel})` : ''}`,
    );

    try {
      await syncSavedProviderToRuntime(
        providerAccountToConfig(stoAccount),
        sk,
        runtimeGateway,
      );
      if (!result.updated.includes(STO_ACCOUNT_ID)) {
        result.updated.push(STO_ACCOUNT_ID);
      }
    } catch (err) {
      logger.warn('[sto-sync] Failed to mirror STO catalog to openclaw.json:', err);
      return;
    }

    if (legacyPrimary || stoMissingFromOpenClaw || openClawModelsIncomplete) {
      try {
        await syncDefaultProviderToRuntime(STO_ACCOUNT_ID, runtimeGateway);
        if (!result.defaultSet) {
          result.defaultSet = STO_ACCOUNT_ID;
        }
      } catch (err) {
        logger.warn('[sto-sync] Failed to repair STO default model in openclaw.json:', err);
      }
    }
  }

  // -- Periodic sync -------------------------------------------------------

  startPeriodicSync(): void {
    if (this.syncTimer) {
      return;
    }
    this.syncTimer = setInterval(() => {
      void this.syncModels().catch((err) => {
        logger.warn('[sto-sync] Periodic sync failed:', err);
      });
    }, SYNC_INTERVAL_MS);

    if (typeof this.syncTimer === 'object' && 'unref' in this.syncTimer) {
      this.syncTimer.unref();
    }
  }

  stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // -- Logout cleanup ------------------------------------------------------

  async cleanupOnLogout(userOverride?: SsoUserInfo | null): Promise<void> {
    this.stopPeriodicSync();

    const { clearUserSk } = await import('../user-sk-service');
    await clearUserSk(userOverride);

    const accounts = await listProviderAccounts();
    const stoAccounts = accounts.filter((a) =>
      StoModelSyncService.isStoManagedAccount(a),
    );

    const providerService = getProviderService();
    for (const account of stoAccounts) {
      try {
        const config = providerAccountToConfig(account);
        await providerService.deleteAccount(account.id);
        await syncDeletedProviderToRuntime(
          config,
          account.id,
          this.gatewayManager ?? undefined,
        );
      } catch (err) {
        logger.warn(
          `[sto-sync] Failed to delete account ${account.id} on logout:`,
          err,
        );
      }
    }

    for (const legacyKey of OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB) {
      try {
        await removeProviderFromOpenClaw(legacyKey);
        logger.info(`[sto-sync] Scrubbed legacy openclaw provider "${legacyKey}" on logout`);
      } catch (err) {
        logger.warn(`[sto-sync] Failed to scrub legacy openclaw provider "${legacyKey}" on logout:`, err);
      }
    }

    if (stoAccounts.length > 0) {
      logger.info(
        `[sto-sync] Cleaned up ${stoAccounts.length} STO account(s) on logout`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: StoModelSyncService | null = null;

export function getStoModelSyncService(): StoModelSyncService {
  if (!instance) {
    instance = new StoModelSyncService();
  }
  return instance;
}
