/**
 * STO Model Auto-Sync Service
 *
 * Fetches the model list from the STO AI-Memory API and reconciles
 * local ProviderAccount records so they stay in sync with the remote
 * catalog.  Each STO model is stored as an independent custom
 * ProviderAccount whose id starts with STO_ACCOUNT_ID_PREFIX.
 */

import type { GatewayManager } from '../../gateway/manager';
import type { ProviderAccount } from '../../shared/providers/types';
import type { SsoEnvironment } from '../../utils/auth-store';
import { getStoToken, getSsoEnvironment } from '../../utils/auth-store';
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STO_ACCOUNT_ID_PREFIX = 'sto-model-';

const STO_DOMAINS: Record<string, string> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn',
};
const STO_DOMAIN_DEFAULT = 'https://baseinfo-aimemory.sto.cn';

const STO_MODEL_LIST_PATH = '/agent/v1/models/list';
/** The runtime appends /chat/completions for openai-completions protocol. */
const STO_COMPLETIONS_BASE_PATH = '/agent/v1/models';

const SYNC_INTERVAL_MS = 20 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoRemoteModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
}

export interface StoSyncResult {
  created: string[];
  deleted: string[];
  updated: string[];
  defaultSet: string | null;
  error?: string;
}

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

  static buildAccountId(modelId: string): string {
    return `${STO_ACCOUNT_ID_PREFIX}${modelId}`;
  }

  static isStoManagedAccount(account: ProviderAccount): boolean {
    return account.id.startsWith(STO_ACCOUNT_ID_PREFIX);
  }

  /** Check if local account config differs from remote model info */
  static needsConfigUpdate(
    account: ProviderAccount,
    remoteModel: StoRemoteModel,
    domain: string,
  ): boolean {
    const expectedBaseUrl = `${domain}${STO_COMPLETIONS_BASE_PATH}`;
    return (
      account.label !== remoteModel.name ||
      account.baseUrl !== expectedBaseUrl ||
      account.model !== remoteModel.id ||
      account.enabled !== true
    );
  }

  // -- Remote fetch --------------------------------------------------------

  async fetchRemoteModels(
    domain: string,
    token: string,
  ): Promise<StoRemoteModel[]> {
    const url = `${domain}${STO_MODEL_LIST_PATH}`;
    logger.info(`[sto-sync] Fetch sto remote models: url=${url}, stotoken:\n${token}`);
    const response = await fetch(url, {
      headers: { stotoken: token },
    });

    if (!response.ok) {
      throw new Error(
        `STO model list request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { models?: StoRemoteModel[] };
    return data.models ?? [];
  }

  // -- Core sync -----------------------------------------------------------

  /**
   * Run a full reconciliation cycle.  Safe to call concurrently — if a sync
   * is already in progress the caller gets the same promise back.
   */
  async syncModels(): Promise<StoSyncResult> {
    if (this.currentSync) {
      return this.currentSync;
    }
    this.currentSync = this.doSync();
    try {
      return await this.currentSync;
    } finally {
      this.currentSync = null;
    }
  }

  private async doSync(): Promise<StoSyncResult> {
    const result: StoSyncResult = {
      created: [],
      deleted: [],
      updated: [],
      defaultSet: null,
    };

    // Step 1 — Auth preconditions
    const token = await getStoToken();
    if (!token) {
      result.error = 'no-token';
      return result;
    }

    const env = await getSsoEnvironment();
    const domain = StoModelSyncService.resolveDomain(env);

    // Step 2 — Fetch remote models
    let remoteModels: StoRemoteModel[];
    try {
      remoteModels = await this.fetchRemoteModels(domain, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[sto-sync] Failed to fetch remote models: ${message}`);
      result.error = `fetch-failed: ${message}`;
      return result;
    }

    const remoteMap = new Map(
      remoteModels.map((m) => [StoModelSyncService.buildAccountId(m.id), m]),
    );

    // Step 3 — Load local STO accounts
    const allAccounts = await listProviderAccounts();
    const localStoAccounts = allAccounts.filter((a) =>
      StoModelSyncService.isStoManagedAccount(a),
    );
    const localMap = new Map(localStoAccounts.map((a) => [a.id, a]));

    // Step 4 — Diff
    const toCreate: StoRemoteModel[] = [];
    const toDelete: ProviderAccount[] = [];
    const toUpdateConfig: { account: ProviderAccount; model: StoRemoteModel }[] = [];
    const toCheckApiKey: ProviderAccount[] = [];

    for (const [accountId, model] of remoteMap) {
      const localAccount = localMap.get(accountId);
      if (localAccount) {
        if (StoModelSyncService.needsConfigUpdate(localAccount, model, domain)) {
          toUpdateConfig.push({ account: localAccount, model });
        } else {
          toCheckApiKey.push(localAccount);
        }
      } else {
        toCreate.push(model);
      }
    }

    for (const [accountId, account] of localMap) {
      if (!remoteMap.has(accountId)) {
        toDelete.push(account);
      }
    }

    const providerService = getProviderService();
    const now = new Date().toISOString();

    // Step 5 — Create new accounts
    for (const model of toCreate) {
      const accountId = StoModelSyncService.buildAccountId(model.id);
      const account: ProviderAccount = {
        id: accountId,
        vendorId: 'custom',
        label: model.name,
        authMode: 'api_key',
        baseUrl: `${domain}${STO_COMPLETIONS_BASE_PATH}`,
        apiProtocol: 'openai-completions',
        model: model.id,
        enabled: true,
        isDefault: false,
        metadata: { managedBy: 'sto-auto-sync' },
        createdAt: now,
        updatedAt: now,
      };

      try {
        await providerService.createAccount(account, token);
        await syncSavedProviderToRuntime(
          providerAccountToConfig(account),
          token,
          this.gatewayManager ?? undefined,
        );
        result.created.push(accountId);
      } catch (err) {
        logger.warn(`[sto-sync] Failed to create account ${accountId}:`, err);
      }
    }

    // Step 6 — Delete removed accounts
    for (const account of toDelete) {
      try {
        const config = providerAccountToConfig(account);
        await providerService.deleteAccount(account.id);
        await syncDeletedProviderToRuntime(
          config,
          account.id,
          this.gatewayManager ?? undefined,
        );
        result.deleted.push(account.id);
      } catch (err) {
        logger.warn(
          `[sto-sync] Failed to delete account ${account.id}:`,
          err,
        );
      }
    }

    // Step 7 — Update accounts with config changes
    for (const { account, model } of toUpdateConfig) {
      try {
        const updatedAccount: ProviderAccount = {
          ...account,
          label: model.name,
          baseUrl: `${domain}${STO_COMPLETIONS_BASE_PATH}`,
          model: model.id,
          enabled: true,
          updatedAt: new Date().toISOString(),
        };
        await providerService.updateAccount(updatedAccount);
        await storeApiKey(account.id, token);
        await syncSavedProviderToRuntime(
          providerAccountToConfig(updatedAccount),
          token,
          this.gatewayManager ?? undefined,
        );
        result.updated.push(account.id);
      } catch (err) {
        logger.warn(
          `[sto-sync] Failed to update account ${account.id}:`,
          err,
        );
      }
    }

    // Step 8 — Update API key only if changed
    for (const account of toCheckApiKey) {
      try {
        const currentKey = await getApiKey(account.id);
        if (currentKey !== token) {
          await storeApiKey(account.id, token);
          await syncProviderApiKeyToRuntime(account.vendorId, account.id, token);
          result.updated.push(account.id);
        }
      } catch (err) {
        logger.warn(
          `[sto-sync] Failed to update API key for ${account.id}:`,
          err,
        );
      }
    }

    // Step 9 — Set default if needed
    const deletedIds = new Set(result.deleted);
    const currentDefault = await getDefaultProviderAccountId();
    const needsNewDefault =
      !currentDefault || deletedIds.has(currentDefault);

    if (needsNewDefault) {
      // Pick the first STO model from the remote list (preserves server order)
      const firstModel = remoteModels[0];
      if (firstModel) {
        const firstAccountId = StoModelSyncService.buildAccountId(
          firstModel.id,
        );
        try {
          await providerService.setDefaultAccount(firstAccountId);
          await syncDefaultProviderToRuntime(
            firstAccountId,
            this.gatewayManager ?? undefined,
          );
          result.defaultSet = firstAccountId;
        } catch (err) {
          logger.warn(
            `[sto-sync] Failed to set default account ${firstAccountId}:`,
            err,
          );
        }
      }
    }

    logger.info(
      `[sto-sync] Sync completed: created=${result.created.length}, deleted=${result.deleted.length}, updated=${result.updated.length}, default=${result.defaultSet ?? '(unchanged)'}`,
    );

    return result;
  }

  // -- Periodic sync -------------------------------------------------------

  startPeriodicSync(): void {
    if (this.syncTimer) {
      return; // already running
    }
    this.syncTimer = setInterval(() => {
      void this.syncModels().catch((err) => {
        logger.warn('[sto-sync] Periodic sync failed:', err);
      });
    }, SYNC_INTERVAL_MS);

    // Allow Node to exit even if the timer is active
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

  async cleanupOnLogout(): Promise<void> {
    this.stopPeriodicSync();

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

    if (stoAccounts.length > 0) {
      logger.info(
        `[sto-sync] Cleaned up ${stoAccounts.length} STO model account(s) on logout`,
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
