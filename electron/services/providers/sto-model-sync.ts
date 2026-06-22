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
import type { SsoUserInfo } from '../../utils/auth-store';
import { removeProviderFromOpenClaw } from '../../utils/openclaw-auth';
import {
  OPENCLAW_STO_PLACEHOLDER_KEYS_TO_SCRUB,
  shouldDeleteStaleStoPlaceholder,
  STO_CANONICAL_ACCOUNT_ID,
} from './sto-placeholder-utils';
import crypto from 'crypto';



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

    // Step 2 — Get user code for secret header
    const { getAuthState } = await import('../../utils/auth-store');
    const authState = await getAuthState();
    const userCode = authState.user?.code || '';
    if (!userCode) {
      result.error = 'no-user-code';
      return result;
    }
    const secretHeader = crypto.createHash('md5').update(userCode).digest('hex');

    // Step 3 — Fetch remote models and supplier domain via strategy (零 if/else，自动适配网点/非网点)
    const { resolveStrategy } = await import('../sto-sk-strategy');
    const strategy = await resolveStrategy(authState.user);
    let remoteModels: StoRemoteModel[];
    let supplierDomain: string;
    try {
      if (!strategy || !authState.user) {
        throw new Error('No strategy or user available');
      }
      const models = await strategy.getUserModels(authState.user);
      remoteModels = (models ?? []).map((id) => ({ id, name: id }));
      supplierDomain = await strategy.getSupplierDomain();
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

    // Step 3 — Delete stale STO placeholder accounts (legacy sto-model-*, custom-sto, etc.)
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

    // Step 4 — Create or update the single STO account
    const existingAccount = allAccounts.find((a) => a.id === STO_ACCOUNT_ID);
    const expectedBaseUrl = `${supplierDomain}/v1`;
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
        headers: {
          secret: secretHeader,
        },
        metadata: {
          managedBy: 'sto-auto-sync',
          customModels: remoteModelIds,
        },
        createdAt: now,
        updatedAt: now,
      };

      try {
        await providerService.createAccount(account, sk);
        await syncSavedProviderToRuntime(
          providerAccountToConfig(account),
          sk,
          runtimeGateway,
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
      const headersChanged = existingAccount.headers?.secret !== secretHeader;

      if (modelsChanged || baseUrlChanged || currentModelRemoved || headersChanged || !existingAccount.enabled) {
        const patch: Partial<ProviderAccount> = {
          baseUrl: expectedBaseUrl,
          enabled: true,
          headers: { secret: secretHeader },
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
          await providerService.updateAccount(STO_ACCOUNT_ID, patch, sk);
          const updatedAccount = {
            ...existingAccount,
            ...patch,
            id: STO_ACCOUNT_ID,
          };
          await syncSavedProviderToRuntime(
            providerAccountToConfig(updatedAccount),
            sk,
            runtimeGateway,
          );
          result.updated.push(STO_ACCOUNT_ID);
        } catch (err) {
          logger.warn(`[sto-sync] Failed to update STO account:`, err);
        }
      } else {
        // No config change — just make sure the API key (SK) is current
        try {
          const currentKey = await getApiKey(STO_ACCOUNT_ID);
          if (currentKey !== sk) {
            await storeApiKey(STO_ACCOUNT_ID, sk);
            await syncProviderApiKeyToRuntime('sto', STO_ACCOUNT_ID, sk);
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
          runtimeGateway,
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

  async cleanupOnLogout(userOverride?: SsoUserInfo | null): Promise<void> {
    this.stopPeriodicSync();

    // Clear user SK
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
