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

const STO_ACCOUNT_ID = 'sto';

/** Legacy prefix used before the single-account refactor. */
const STO_LEGACY_ACCOUNT_ID_PREFIX = 'sto-model-';

const STO_DOMAINS: Record<string, string> = {
  'daily-external': 'https://baseinfo-aimemory-test.sto.cn/agent',
  'pre-release': 'https://pre-baseinfo-aimemory.sto.cn/agent',
};
const STO_DOMAIN_DEFAULT = 'https://baseinfo-aimemory.sto.cn';

/** Standard OpenAI-compatible model list path. */
const STO_MODEL_LIST_PATH = '/v1/models';

const SYNC_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

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

  static isStoManagedAccount(account: ProviderAccount): boolean {
    return (
      account.id === STO_ACCOUNT_ID ||
      account.id.startsWith(STO_LEGACY_ACCOUNT_ID_PREFIX)
    );
  }

  // -- Remote fetch --------------------------------------------------------

  /**
   * Fetch model list from the STO API using standard OpenAI /v1/models
   * endpoint. Sends both stotoken header and Authorization: Bearer for
   * compatibility.
   */
  async fetchRemoteModels(
    domain: string,
    token: string,
  ): Promise<StoRemoteModel[]> {
    const url = `${domain}${STO_MODEL_LIST_PATH}`;
    logger.info(`[sto-sync] Fetching remote models: url=${url}`);

    const response = await fetch(url, {
      headers: {
        stotoken: token,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `STO model list request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      data?: StoRemoteModel[];
      models?: StoRemoteModel[];
    };

    // Support both OpenAI standard format { data: [...] } and legacy { models: [...] }
    return data.data ?? data.models ?? [];
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

    // Step 1 — Auth preconditions: get stotoken from SSO state
    const token = await getStoToken();
    if (!token) {
      result.error = 'no-token';
      return result;
    }

    const env = await getSsoEnvironment();
    const domain = StoModelSyncService.resolveDomain(env);

    // Step 2 — Fetch remote models via OpenAI-compatible /v1/models
    let remoteModels: StoRemoteModel[];
    try {
      remoteModels = await this.fetchRemoteModels(domain, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[sto-sync] Failed to fetch remote models: ${message}`);
      result.error = `fetch-failed: ${message}`;
      return result;
    }

    const remoteModelIds = remoteModels.map((m) => m.id);

    if (remoteModelIds.length === 0) {
      logger.info('[sto-sync] Remote model list is empty, skipping sync');
      return result;
    }

    const providerService = getProviderService();
    const allAccounts = await listProviderAccounts();

    // Step 3 — Migrate legacy sto-model-* accounts (one-time)
    const legacyAccounts = allAccounts.filter((a) =>
      a.id.startsWith(STO_LEGACY_ACCOUNT_ID_PREFIX),
    );

    let legacyDefaultWasSto = false;
    if (legacyAccounts.length > 0) {
      const currentDefault = await getDefaultProviderAccountId();
      legacyDefaultWasSto = Boolean(
        currentDefault && currentDefault.startsWith(STO_LEGACY_ACCOUNT_ID_PREFIX),
      );

      for (const account of legacyAccounts) {
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
            `[sto-sync] Failed to delete legacy account ${account.id}:`,
            err,
          );
        }
      }
      logger.info(
        `[sto-sync] Migrated ${legacyAccounts.length} legacy sto-model-* account(s)`,
      );
    }

    // Step 4 — Create or update the single STO account
    const existingAccount = allAccounts.find((a) => a.id === STO_ACCOUNT_ID);
    const expectedBaseUrl = `${domain}/v1`;
    const now = new Date().toISOString();

    if (!existingAccount) {
      // Create new single STO account
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
        metadata: {
          managedBy: 'sto-auto-sync',
          customModels: remoteModelIds,
        },
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
        result.created.push(STO_ACCOUNT_ID);
      } catch (err) {
        logger.warn(`[sto-sync] Failed to create STO account:`, err);
      }
    } else {
      // Check if existing account needs updating
      const currentModels = existingAccount.metadata?.customModels ?? [];
      const modelsChanged =
        currentModels.length !== remoteModelIds.length ||
        !remoteModelIds.every((id, i) => currentModels[i] === id);
      const baseUrlChanged = existingAccount.baseUrl !== expectedBaseUrl;
      const currentModelRemoved =
        existingAccount.model && !remoteModelIds.includes(existingAccount.model);

      if (modelsChanged || baseUrlChanged || currentModelRemoved || !existingAccount.enabled) {
        const patch: Partial<ProviderAccount> = {
          baseUrl: expectedBaseUrl,
          enabled: true,
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
          await providerService.updateAccount(STO_ACCOUNT_ID, patch, token);
          const updatedAccount = {
            ...existingAccount,
            ...patch,
            id: STO_ACCOUNT_ID,
          };
          await syncSavedProviderToRuntime(
            providerAccountToConfig(updatedAccount),
            token,
            this.gatewayManager ?? undefined,
          );
          result.updated.push(STO_ACCOUNT_ID);
        } catch (err) {
          logger.warn(`[sto-sync] Failed to update STO account:`, err);
        }
      } else {
        // No config change — just make sure the API key (stotoken) is current
        try {
          const currentKey = await getApiKey(STO_ACCOUNT_ID);
          if (currentKey !== token) {
            await storeApiKey(STO_ACCOUNT_ID, token);
            await syncProviderApiKeyToRuntime('sto', STO_ACCOUNT_ID, token);
            result.updated.push(STO_ACCOUNT_ID);
          }
        } catch (err) {
          logger.warn(`[sto-sync] Failed to update API key:`, err);
        }
      }
    }

    // Step 5 — Set default provider if needed
    const currentDefault = await getDefaultProviderAccountId();
    const needsNewDefault =
      !currentDefault || legacyDefaultWasSto;

    if (needsNewDefault) {
      try {
        await providerService.setDefaultAccount(STO_ACCOUNT_ID);
        await syncDefaultProviderToRuntime(
          STO_ACCOUNT_ID,
          this.gatewayManager ?? undefined,
        );
        result.defaultSet = STO_ACCOUNT_ID;
      } catch (err) {
        logger.warn(`[sto-sync] Failed to set default account:`, err);
      }
    }

    logger.info(
      `[sto-sync] Sync completed: created=${result.created.length}, deleted=${result.deleted.length}, updated=${result.updated.length}, models=${remoteModelIds.length}, default=${result.defaultSet ?? '(unchanged)'}`,
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
