/**
 * Serializes post-authentication setup (SSO files, OpenClaw plugins, STO model/biz-agent sync).
 *
 * Startup (already logged in): run with skipGatewayRefresh BEFORE Gateway first boot so
 * OpenClaw starts once with final config — avoids post-start debouncedRestart.
 *
 * Login: write config to disk; reload only when models/biz-agents actually changed and Gateway
 * has been stable. Never restart during startup (prelaunch already wrote config).
 */

import type { GatewayManager } from '../gateway/manager';
import type { SsoUserInfo } from '../utils/auth-store';
import { getAuthState, getImpersonationOrigin, syncSsoAuthToOpenClaw } from '../utils/auth-store';
import { resolveAuthMode } from './sto-auth-mode';
import { syncStoPluginsToOpenClaw } from '../utils/openclaw-auth';
import { cleanupRetiredSkillsAndPlugins } from '../utils/retired-skills-cleanup';
import { logger } from '../utils/logger';
import { getStoModelSyncService, type StoSyncResult } from './providers/sto-model-sync';
import {
  getStoBizAgentSyncService,
  type StoBizAgentSyncResult,
} from './sto-biz-agent-sync';
import { syncClaudeDefaultContext } from './claude-context-sync';

export type AuthenticatedSetupSource = 'login' | 'startup' | 'account-switch';

export interface AuthenticatedSetupResult {
  stoSync: StoSyncResult;
  bizAgentSync: StoBizAgentSyncResult;
}

export type AuthenticatedSetupOptions = {
  gatewayManager?: GatewayManager | null;
  source: AuthenticatedSetupSource;
  /** When provided (login), writes SSO auth file before plugin/model sync. */
  user?: SsoUserInfo;
  /**
   * When true, only write config to disk — do not restart/reload Gateway.
   * Use before the first Gateway boot on cold start.
   */
  skipGatewayRefresh?: boolean;
  /**
   * When true and a Gateway refresh is needed, execute it immediately and wait
   * for the Gateway to reconnect before resolving. Used by the login route so
   * the renderer only navigates to home after the Gateway is settled.
   */
  awaitGatewayRefresh?: boolean;
};

const SKIP_STARTUP_AFTER_LOGIN_MS = 60_000;
const REFRESH_BATCH_DELAY_MS = 800;
const MIN_CONNECTED_BEFORE_RESTART_MS = 8_000;
/** Gateway must stay `running` this long before an awaited refresh is considered settled. */
const GATEWAY_SETTLE_STABLE_MS = 2_000;
/** Upper bound for an awaited refresh — login must never hang on a stuck Gateway. */
const GATEWAY_SETTLE_TIMEOUT_MS = 20_000;

export type PostAuthGatewayRefreshMode = 'none' | 'reload' | 'restart';

export function resolvePostAuthGatewayRefresh(params: {
  source: AuthenticatedSetupSource;
  skipGatewayRefresh?: boolean;
  needsGatewayRefresh: boolean;
  gatewayManager: GatewayManager;
  stoResult: StoSyncResult;
  bizResult: StoBizAgentSyncResult;
}): PostAuthGatewayRefreshMode {
  const { source, skipGatewayRefresh, needsGatewayRefresh, gatewayManager, stoResult, bizResult } =
    params;

  if (!needsGatewayRefresh || skipGatewayRefresh) {
    return 'none';
  }

  const forceRefresh = stoResult.needsForcedGatewayRefresh === true;
  const status = gatewayManager.getStatus();
  const connectedForMs = status.connectedAt
    ? Date.now() - status.connectedAt
    : Number.POSITIVE_INFINITY;

  if (source === 'login' || source === 'account-switch') {
    if (
      gatewayManager.isGatewayLifecycleSettling()
      || status.state === 'starting'
      || status.state === 'reconnecting'
      || status.state === 'stopped'
    ) {
      return 'none';
    }
    if (!forceRefresh && status.state === 'running' && connectedForMs < MIN_CONNECTED_BEFORE_RESTART_MS) {
      return 'none';
    }
    const modelsChanged = stoSyncChangedConfig(stoResult);
    const bizCreated = bizResult.created.length > 0;
    if (!forceRefresh && !modelsChanged && !bizCreated) {
      return 'none';
    }
    return 'reload';
  }

  return 'restart';
}

let setupGeneration = 0;
let setupTail: Promise<AuthenticatedSetupResult> = Promise.resolve(emptySetupResult());
let lastSetupResult: AuthenticatedSetupResult = emptySetupResult();
let lastLoginSetupAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshDelayTimer: ReturnType<typeof setTimeout> | null = null;

function emptySetupResult(): AuthenticatedSetupResult {
  return {
    stoSync: { created: [], deleted: [], updated: [], defaultSet: null },
    bizAgentSync: { created: [], skipped: [] },
  };
}

function stoSyncChangedConfig(result: StoSyncResult): boolean {
  return (
    result.created.length > 0
    || result.updated.length > 0
    || result.deleted.length > 0
    || result.defaultSet != null
    || result.needsForcedGatewayRefresh === true
  );
}

function clearRefreshTimers(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (refreshDelayTimer) {
    clearTimeout(refreshDelayTimer);
    refreshDelayTimer = null;
  }
}

function schedulePostAuthGatewayRefresh(
  gatewayManager: GatewayManager,
  generation: number,
  logPrefix: string,
  mode: PostAuthGatewayRefreshMode,
  options?: { forceRefresh?: boolean },
): void {
  clearRefreshTimers();

  if (mode === 'none') {
    gatewayManager.cancelPendingGatewayRefresh();
    return;
  }

  const forceRefresh = options?.forceRefresh === true;

  const fireRefresh = () => {
    if (generation !== setupGeneration) {
      logger.info(`${logPrefix} Skip delayed Gateway ${mode} (superseded)`);
      return;
    }
    logger.info(`${logPrefix} Scheduling Gateway ${mode} after batched setup${forceRefresh ? ' (legacy repair)' : ''}`);
    if (mode === 'reload') {
      gatewayManager.debouncedReload(1500, { force: forceRefresh });
    } else {
      gatewayManager.debouncedRestart(1500);
    }
  };

  refreshTimer = setTimeout(() => {
    refreshTimer = null;

    if (generation !== setupGeneration) {
      logger.info(`${logPrefix} Skip Gateway ${mode} (superseded by newer setup)`);
      return;
    }

    if (gatewayManager.isGatewayLifecycleSettling()) {
      gatewayManager.cancelPendingGatewayRefresh();
      logger.info(`${logPrefix} Skip Gateway ${mode} (lifecycle still settling)`);
      return;
    }

    const state = gatewayManager.getStatus();
    if (state.state === 'stopped') {
      logger.info(`${logPrefix} Gateway stopped; skip ${mode} after batched setup`);
      return;
    }

    const connectedForMs = state.connectedAt
      ? Date.now() - state.connectedAt
      : Number.POSITIVE_INFINITY;

    if (!forceRefresh && connectedForMs < MIN_CONNECTED_BEFORE_RESTART_MS) {
      const waitMs = MIN_CONNECTED_BEFORE_RESTART_MS - connectedForMs + 200;
      logger.info(
        `${logPrefix} Delay Gateway ${mode} ${waitMs}ms (connected ${Math.round(connectedForMs)}ms ago)`,
      );
      refreshDelayTimer = setTimeout(fireRefresh, waitMs);
      return;
    }

    fireRefresh();
  }, REFRESH_BATCH_DELAY_MS);
}

async function waitForGatewaySettled(gatewayManager: GatewayManager): Promise<boolean> {
  const deadline = Date.now() + GATEWAY_SETTLE_TIMEOUT_MS;
  let stableSince: number | null = null;
  while (Date.now() < deadline) {
    const status = gatewayManager.getStatus();
    if (status.state === 'running' && !gatewayManager.isGatewayLifecycleSettling()) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= GATEWAY_SETTLE_STABLE_MS) {
        return true;
      }
    } else {
      stableSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/**
 * Execute the post-auth Gateway refresh inline (no debounce) and block until the
 * Gateway is running and stable again. Never throws — login must not fail because
 * a refresh went sideways; worst case we return after GATEWAY_SETTLE_TIMEOUT_MS.
 */
async function runPostAuthGatewayRefreshInline(
  gatewayManager: GatewayManager,
  logPrefix: string,
  mode: Exclude<PostAuthGatewayRefreshMode, 'none'>,
  options?: { forceRefresh?: boolean },
): Promise<void> {
  clearRefreshTimers();
  gatewayManager.cancelPendingGatewayRefresh();

  const startedAt = Date.now();
  logger.info(`${logPrefix} Running Gateway ${mode} inline (login waits for settle)`);
  try {
    if (mode === 'reload') {
      await gatewayManager.reload({ force: options?.forceRefresh === true });
    } else {
      await gatewayManager.restart();
    }
    const settled = await waitForGatewaySettled(gatewayManager);
    logger.info(
      `${logPrefix} Inline Gateway ${mode} ${settled ? 'settled' : 'did not settle before timeout'} `
      + `after ${Date.now() - startedAt}ms`,
    );
  } catch (err) {
    logger.warn(`${logPrefix} Inline Gateway ${mode} failed:`, err);
  }
}

async function runSetup(
  options: AuthenticatedSetupOptions,
  generation: number,
): Promise<AuthenticatedSetupResult> {
  const { gatewayManager, source, user, skipGatewayRefresh, awaitGatewayRefresh } = options;
  const logPrefix = `[auth-setup:${source}${skipGatewayRefresh ? ':prelaunch' : ''}]`;

  const userToSync = user ?? (await getAuthState()).user;
  if (userToSync) {
    await syncSsoAuthToOpenClaw(userToSync);
  }

  try {
    await syncClaudeDefaultContext();
  } catch (err) {
    logger.warn(`${logPrefix} Claude default context sync failed:`, err);
  }

  let needsGatewayRefresh = false;

  try {
    await cleanupRetiredSkillsAndPlugins();
    const wrotePlugins = await syncStoPluginsToOpenClaw();
    if (wrotePlugins) {
      logger.info(`${logPrefix} Wrote STO plugins config to openclaw.json`);
    } else {
      logger.debug(`${logPrefix} STO plugins config unchanged; skip openclaw.json write`);
    }
  } catch (err) {
    logger.warn(`${logPrefix} STO plugins config failed:`, err);
  }

  try {
    const { loadClawInferenceRuntimeConfig } = await import('./sto-apollo-config-service');
    await loadClawInferenceRuntimeConfig();
  } catch (err) {
    logger.warn(`${logPrefix} Inference runtime Apollo config load failed:`, err);
  }

  // ===== 登录后静默获取用户 SK（强制走主租户全链路，不读旧 tenant 缓存） =====
  try {
    const { getUserSk, clearUserSk } = await import('./user-sk-service');
    if (source === 'login' && userToSync) {
      const mode = await resolveAuthMode();
      if (mode === 'hq-demo-as-site') {
        const origin = await getImpersonationOrigin();
        if (origin) {
          await clearUserSk(origin);
        }
        await getUserSk(true);
      } else {
        await clearUserSk(userToSync);
        await getUserSk(true);
      }
    } else {
      await getUserSk();
    }
  } catch {
    // 静默失败，sto-model-sync 会处理无 SK 的情况
  }
  // ========================================

  const stoSync = getStoModelSyncService();
  if (gatewayManager) {
    stoSync.setGatewayManager(gatewayManager);
  }

  const stoResult = await stoSync.syncModels({ deferGatewayRefresh: true });
  if (stoSyncChangedConfig(stoResult)) {
    needsGatewayRefresh = true;
  }

  const bizAgentSync = getStoBizAgentSyncService();
  if (gatewayManager) {
    bizAgentSync.setGatewayManager(gatewayManager);
  }

  const bizResult = await bizAgentSync.syncAgents({ deferGatewayRefresh: true });
  if (bizResult.created.length > 0) {
    needsGatewayRefresh = true;
  }

  const refreshMode =
    gatewayManager && generation === setupGeneration
      ? resolvePostAuthGatewayRefresh({
        source,
        skipGatewayRefresh,
        needsGatewayRefresh,
        gatewayManager,
        stoResult,
        bizResult,
      })
      : 'none';

  if (refreshMode !== 'none' && gatewayManager) {
    if (awaitGatewayRefresh) {
      await runPostAuthGatewayRefreshInline(
        gatewayManager,
        logPrefix,
        refreshMode,
        { forceRefresh: stoResult.needsForcedGatewayRefresh === true },
      );
    } else {
      schedulePostAuthGatewayRefresh(
        gatewayManager,
        generation,
        logPrefix,
        refreshMode,
        { forceRefresh: stoResult.needsForcedGatewayRefresh === true },
      );
    }
  } else if ((source === 'login' || source === 'account-switch') && gatewayManager) {
    gatewayManager.cancelPendingGatewayRefresh();
  }

  if (needsGatewayRefresh && skipGatewayRefresh) {
    logger.info(`${logPrefix} Config synced to disk; Gateway will load it on next start`);
  } else if (needsGatewayRefresh && generation !== setupGeneration) {
    logger.info(`${logPrefix} Config updated but skip Gateway refresh (stale generation)`);
  } else if (needsGatewayRefresh && refreshMode === 'none' && (source === 'login' || source === 'account-switch')) {
    logger.info(`${logPrefix} Config synced to disk; skip Gateway refresh on ${source}`);
  }

  logger.info(
    `${logPrefix} Completed: sto created=${stoResult.created.length} updated=${stoResult.updated.length} `
    + `biz created=${bizResult.created.length} gatewayRefresh=${refreshMode}`,
  );

  return { stoSync: stoResult, bizAgentSync: bizResult };
}

/**
 * Run full authenticated setup. Callers are serialized; only the latest generation
 * may schedule a Gateway restart (unless skipGatewayRefresh).
 */
export function runAuthenticatedSetup(
  options: AuthenticatedSetupOptions,
): Promise<AuthenticatedSetupResult> {
  const generation = ++setupGeneration;

  const task = setupTail.then(async () => {
    if (
      options.source === 'startup'
      && !options.skipGatewayRefresh
      && lastLoginSetupAt > 0
      && Date.now() - lastLoginSetupAt < SKIP_STARTUP_AFTER_LOGIN_MS
    ) {
      logger.info('[auth-setup:startup] Skipping setup (login setup completed recently)');
      return lastSetupResult;
    }

    if (options.source === 'login' || options.source === 'account-switch') {
      lastLoginSetupAt = Date.now();
    }

    const result = await runSetup(options, generation);
    lastSetupResult = result;
    return result;
  });

  setupTail = task.catch((err) => {
    logger.warn(`[auth-setup:${options.source}] Setup failed:`, err);
    return lastSetupResult;
  });

  return task;
}
