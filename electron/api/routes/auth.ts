/**
 * Auth API Routes
 * Handles SSO authentication endpoints for the Host API server.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { app } from 'electron';
import { getAuthState, setAuthUser, clearAuthUser, getSsoEnvironment, setSsoEnvironment, getStoToken, removeSsoAuthFromOpenClaw, getImpersonationOrigin, setImpersonationOrigin, clearImpersonationOrigin } from '../../utils/auth-store';
import type { SsoEnvironment, SsoUserInfo } from '../../utils/auth-store';
import { getBaseUrl, signOut } from '../../utils/sso-service';
import { SsoLoginManager } from '../../utils/sso-login';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { logger } from '../../utils/logger';
import { getStoModelSyncService } from '../../services/providers/sto-model-sync';
import { runAuthenticatedSetup } from '../../services/auth-setup-orchestrator';
import { runPendingInstallReport } from '../../services/client-update-platform';
import { activateUserWorkspace, getCurrentActiveUserCode, syncMountPointToUser } from '../../services/user-skill-workspace';
import { removeStoDynamicRoutePluginFromOpenClaw } from '../../utils/openclaw-auth';
import { loadSiteDepartmentTypes, loadClawInferenceRuntimeConfig, clearInferenceRuntimeConfigCache, fetchHqBalanceApplyUrl, DEFAULT_HQ_BALANCE_APPLY_URL } from '../../services/sto-apollo-config-service';
import { getClientSiteAccessService } from '../../services/client-site-access-service';
import type { ClientSiteAccessCheckResult } from '../../../shared/client-site-access';
import { syncClaudeDefaultContext } from '../../services/claude-context-sync';
import {
  fetchAccountSwitchOptions,
  switchAccountViaMemoryCenter,
} from '../../services/account-switch-service';
import { resolveAuthMode } from '../../services/sto-auth-mode';
import { getSclawHubClient } from '../../channels/hub-client';
import { ensureSclawHubConnected } from '../../channels/startup';

const ssoLoginManager = new SsoLoginManager();

/** 登录/切号后恢复钉钉 Hub WS（失败不阻塞主流程） */
function scheduleSclawHubReconnect(ctx: HostApiContext): void {
  void ensureSclawHubConnected(ctx.gatewayManager).catch((err) => {
    logger.warn('[auth] Sclaw Hub reconnect after login failed:', err);
  });
}

function disconnectSclawHubOnLogout(): void {
  try {
    getSclawHubClient().disconnect();
  } catch (err) {
    logger.warn('[auth] Sclaw Hub disconnect on logout failed:', err);
  }
}

const CLIENT_SITE_ACCESS_DENIED_MESSAGE = '您的所属组织无权使用 StoClaw';

async function loadInferenceRuntimeConfigBeforeSetup(): Promise<void> {
  try {
    await loadClawInferenceRuntimeConfig();
  } catch (err) {
    logger.warn('[auth] Inference runtime config load before setup failed:', err);
  }
}

function toAccessCheckPayload(result: ClientSiteAccessCheckResult) {
  const clientCode = result.clientCode;
  return {
    allowed: result.allowed,
    client_code: clientCode,
    clientCode,
    categoryCode: result.categoryCode ?? null,
    companyCode: result.companyCode ?? null,
    errCode: result.errCode,
    errMessage: result.errMessage,
  };
}

async function clearAuthAfterAccessDenied(): Promise<void> {
  await clearAuthUser();
  void removeSsoAuthFromOpenClaw();
  void removeStoDynamicRoutePluginFromOpenClaw();
}

/**
 * Heavy post-login work that can safely continue after the login response.
 * Critical STO provider/model sync is awaited in the login route so the first
 * model-page snapshot is already consistent when the renderer redirects.
 */
function schedulePostLoginBackgroundWork(user: SsoUserInfo, ctx: HostApiContext): void {
  void (async () => {
    try {
      await syncClaudeDefaultContext();
    } catch (err) {
      logger.warn('[auth] Claude default context sync on login failed:', err);
    }

    try {
      const previousUserCode = await getCurrentActiveUserCode();
      const workspaceResult = await activateUserWorkspace(user.code);
      if (workspaceResult.userChanged && previousUserCode) {
        // Skill workspace mount is per userCode; HQ↔site switch always changes it.
        // Do NOT hard-restart here — auth-setup already schedules a coalesced reload
        // when provider/model config changed. A second restart races Windows startLock.
        logger.info(
          `[auth] User skill workspace switched ${previousUserCode} → ${user.code}; `
          + 'relying on auth-setup Gateway refresh (no extra restart)',
        );
        if (ctx.gatewayManager.getStatus().state === 'running') {
          ctx.gatewayManager.debouncedReload(2000);
        }
      }
    } catch (err) {
      logger.warn('[auth] Failed to activate user skill workspace on login:', err);
    }

    void loadSiteDepartmentTypes().catch((err) =>
      logger.warn('Post-login site department types load failed:', err),
    );

    try {
      const { autoInstallSaiCliIfNeeded } = await import('../../utils/sai-cli');
      await autoInstallSaiCliIfNeeded();
    } catch (err) {
      logger.warn('SAI CLI auto-install on login failed:', err);
    }
    void runPendingInstallReport(app.getVersion(), process.platform);
  })();
}

/**
 * Runtime preparation is deliberately decoupled from authentication completion.
 * Once access is validated and setAuthUser() returns, the renderer can safely
 * enter the application while this serialized setup continues in the background.
 */
export function schedulePostLoginInitialization(
  user: SsoUserInfo,
  ctx: HostApiContext,
): void {
  const startedAt = Date.now();
  logger.info(`[auth] Post-login initialization scheduled for user=${user.code}`);

  void (async () => {
    try {
      await loadInferenceRuntimeConfigBeforeSetup();
      const setupResult = await runAuthenticatedSetup({
        user,
        gatewayManager: ctx.gatewayManager,
        source: 'login',
        awaitGatewayRefresh: true,
      });
      logger.info(
        `[auth] Post-login initialization completed for user=${user.code} `
        + `in ${Date.now() - startedAt}ms (models created=${setupResult.stoSync.created.length} `
        + `updated=${setupResult.stoSync.updated.length})`,
      );
    } catch (err) {
      logger.warn(
        `[auth] Post-login initialization failed for user=${user.code} after ${Date.now() - startedAt}ms:`,
        err,
      );
    } finally {
      schedulePostLoginBackgroundWork(user, ctx);
    }
  })();
}

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  // GET /api/auth/status — return current auth state
  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    try {
      const state = await getAuthState();
      // If marked as authenticated but stoToken is expired, auto-clear to force re-login.
      // This handles the case where the app is reinstalled and the old auth data (userData
      // directory) persists across uninstall, leaving an expired token in the store.
      if (state.isAuthenticated) {
        const token = await getStoToken();
        if (!token) {
          await clearAuthAfterAccessDenied();
          logger.info('Auth status: stoToken expired or missing, clearing auth state to force re-login');
          sendJson(res, 200, {
            isAuthenticated: false,
            user: null,
            ssoEnvironment: state.ssoEnvironment,
          });
          return true;
        }

        const accessCheck = await getClientSiteAccessService().checkAccess(token);
        if (!accessCheck.allowed) {
          await clearAuthAfterAccessDenied();
          logger.info(
            '[auth] Client site access denied on status check: category=%s company=%s err=%s',
            accessCheck.categoryCode,
            accessCheck.companyCode,
            accessCheck.errMessage,
          );
          sendJson(res, 200, {
            isAuthenticated: false,
            user: null,
            ssoEnvironment: state.ssoEnvironment,
            accessDenied: true,
            error: accessCheck.errMessage || CLIENT_SITE_ACCESS_DENIED_MESSAGE,
            accessCheck: toAccessCheckPayload(accessCheck),
          });
          return true;
        }
      }
      sendJson(res, 200, {
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        ssoEnvironment: state.ssoEnvironment,
        impersonationOrigin: await getImpersonationOrigin(),
        authMode: await resolveAuthMode(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // POST /api/auth/login — trigger SSO login flow
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ environment?: SsoEnvironment }>(req);
      const env = body.environment || (await getSsoEnvironment());

      if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) {
        sendJson(res, 500, { success: false, error: 'Main window is not available' });
        return true;
      }

      const user = await ssoLoginManager.startLogin(env, ctx.mainWindow);

      const accessCheck = await getClientSiteAccessService().checkAccess(user.stoToken ?? '');
      if (!accessCheck.allowed) {
        logger.info(
          '[auth] Client site access denied on login: user=%s category=%s company=%s err=%s',
          user.code,
          accessCheck.categoryCode,
          accessCheck.companyCode,
          accessCheck.errMessage,
        );
        sendJson(res, 200, {
          success: false,
          accessDenied: true,
          error: accessCheck.errMessage || CLIENT_SITE_ACCESS_DENIED_MESSAGE,
          accessCheck: toAccessCheckPayload(accessCheck),
        });
        return true;
      }

      await setAuthUser(user);

      const stoSyncService = getStoModelSyncService();
      if (ctx.gatewayManager) {
        stoSyncService.setGatewayManager(ctx.gatewayManager);
      }

      stoSyncService.startPeriodicSync();
      scheduleSclawHubReconnect(ctx);
      schedulePostLoginInitialization(user, ctx);

      sendJson(res, 200, {
        success: true,
        user,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SSO_LOGIN_CANCELLED') {
        sendJson(res, 200, { success: false, cancelled: true, error: 'Login cancelled' });
      } else {
        logger.error('SSO login failed:', error);
        sendJson(res, 500, { success: false, error: message });
      }
    }
    return true;
  }

  // POST /api/auth/logout — sign out
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    // Pre-skills-store only: persist mount-point skills back to openclaw/users.
    // After migration, canonical state is skills-store — skip so logout does not
    // resurrect the legacy users tree.
    try {
      const { isSkillsStoreMigrated } = await import('../../services/skills/migration');
      if (!isSkillsStoreMigrated()) {
        const activeUserCode = await getCurrentActiveUserCode();
        if (activeUserCode) {
          await syncMountPointToUser(activeUserCode);
          logger.info(`[auth] Saved mount point to user ${activeUserCode} before logout`);
        }
      }
    } catch (err) {
      logger.warn('[auth] Failed to persist skills to user workspace on logout:', err);
    }

    try {
      const state = await getAuthState();

      // Best-effort SSO server sign out
      if (state.user?.openId) {
        const env = state.ssoEnvironment;
        const baseUrl = getBaseUrl(env);
        await signOut(baseUrl, state.user.openId);
      }

      // 先清理 STO 模型/SK 缓存（需要 user 信息），再清除登录态
      try {
        await getStoModelSyncService().cleanupOnLogout(state.user);
      } catch (err) {
        logger.warn('STO model cleanup on logout failed:', err);
      }

      await clearAuthUser();
      clearInferenceRuntimeConfigCache();
      disconnectSclawHubOnLogout();
      void removeSsoAuthFromOpenClaw();
      void removeStoDynamicRoutePluginFromOpenClaw().catch((err) =>
        logger.warn('STO dynamic route plugin cleanup on logout failed:', err),
      );

      sendJson(res, 200, { success: true });
    } catch {
      // 错误路径也尽量先清 SK（user 可能仍在 store 中）
      try {
        await getStoModelSyncService().cleanupOnLogout();
      } catch {
        // ignore
      }

      // Always clear local auth even if SSO signOut fails
      await clearAuthUser().catch(() => {});
      clearInferenceRuntimeConfigCache();
      disconnectSclawHubOnLogout();
      void removeSsoAuthFromOpenClaw();
      void removeStoDynamicRoutePluginFromOpenClaw().catch(() => {});

      sendJson(res, 200, { success: true });
    }
    return true;
  }

  // PUT /api/auth/environment — update SSO environment
  if (url.pathname === '/api/auth/environment' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ environment: SsoEnvironment }>(req);
      if (!body.environment) {
        sendJson(res, 400, { success: false, error: 'Missing environment field' });
        return true;
      }
      await setSsoEnvironment(body.environment);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // GET /api/auth/hq-balance-apply-url — 非网点余额申请外链（实时拉 Apollo）
  if (url.pathname === '/api/auth/hq-balance-apply-url' && req.method === 'GET') {
    try {
      const result = await fetchHqBalanceApplyUrl();
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      logger.warn('[auth] HQ balance apply url fetch failed:', error);
      sendJson(res, 200, { success: true, url: DEFAULT_HQ_BALANCE_APPLY_URL, source: 'fallback' });
    }
    return true;
  }

  // GET /api/auth/site-department-types — 返回 Apollo 配置中的网点类别列表
  if (url.pathname === '/api/auth/site-department-types' && req.method === 'GET') {
    try {
      const types = await loadSiteDepartmentTypes();
      sendJson(res, 200, { success: true, types: Array.from(types) });
    } catch (error) {
      logger.warn('Site department types fetch failed:', error);
      sendJson(res, 200, { success: false, types: [] });
    }
    return true;
  }

  // POST /api/auth/session/commit — 将切换后的用户写入主进程与 sso-auth.json
  if (url.pathname === '/api/auth/session/commit' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        user?: SsoUserInfo;
        impersonationOrigin?: SsoUserInfo | null;
      }>(req);
      if (!body.user?.stoToken) {
        sendJson(res, 400, { success: false, error: '缺少 user 或 stoToken' });
        return true;
      }

      if (body.impersonationOrigin) {
        await setImpersonationOrigin(body.impersonationOrigin);
      } else if (body.impersonationOrigin === null) {
        await clearImpersonationOrigin();
      }

      await setAuthUser(body.user);

      const stoSyncService = getStoModelSyncService();
      if (ctx.gatewayManager) {
        stoSyncService.setGatewayManager(ctx.gatewayManager);
      }

      await loadInferenceRuntimeConfigBeforeSetup();

      let setupResult: AuthenticatedSetupResult | undefined;
      try {
        setupResult = await runAuthenticatedSetup({
          user: body.user,
          gatewayManager: ctx.gatewayManager,
          source: 'login',
          awaitGatewayRefresh: true,
        });
      } catch (err) {
        logger.warn('[auth] Post session commit authenticated setup failed:', err);
      }

      schedulePostLoginBackgroundWork(body.user, ctx);
      scheduleSclawHubReconnect(ctx);

      sendJson(res, 200, {
        success: true,
        user: body.user,
        impersonationOrigin: await getImpersonationOrigin(),
        stoSync: setupResult?.stoSync,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[auth] session commit failed:', error);
      sendJson(res, 500, { success: false, error: message });
    }
    return true;
  }

  // GET /api/auth/account-switch/options — 可切换网点列表
  if (url.pathname === '/api/auth/account-switch/options' && req.method === 'GET') {
    try {
      const token = await getStoToken();
      if (!token) {
        sendJson(res, 200, { success: true, options: [], originUserCode: null });
        return true;
      }
      const result = await fetchAccountSwitchOptions(token);
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      logger.warn('[auth] account switch options failed:', error);
      sendJson(res, 200, { success: false, options: [], originUserCode: null });
    }
    return true;
  }

  // POST /api/auth/account-switch — 切换为网点账号
  if (url.pathname === '/api/auth/account-switch' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ targetCode?: string }>(req);
      const targetCode = body.targetCode?.trim();
      if (!targetCode) {
        sendJson(res, 400, { success: false, error: '缺少 targetCode' });
        return true;
      }

      const state = await getAuthState();
      const token = await getStoToken();
      if (!state.isAuthenticated || !state.user || !token) {
        sendJson(res, 401, { success: false, error: '未登录' });
        return true;
      }

      const existingOrigin = await getImpersonationOrigin();

      if (!existingOrigin) {
        await setImpersonationOrigin(state.user);
      }

      const newUser = await switchAccountViaMemoryCenter(token, targetCode);

      const accessCheck = await getClientSiteAccessService().checkAccess(newUser.stoToken ?? '');
      if (!accessCheck.allowed) {
        if (!existingOrigin) {
          await clearImpersonationOrigin();
        }
        sendJson(res, 200, {
          success: false,
          error: accessCheck.errMessage || CLIENT_SITE_ACCESS_DENIED_MESSAGE,
          accessCheck: toAccessCheckPayload(accessCheck),
        });
        return true;
      }

      await setAuthUser(newUser);

      const stoSyncService = getStoModelSyncService();
      if (ctx.gatewayManager) {
        stoSyncService.setGatewayManager(ctx.gatewayManager);
      }

      await loadInferenceRuntimeConfigBeforeSetup();

      let setupResult: AuthenticatedSetupResult | undefined;
      try {
        setupResult = await runAuthenticatedSetup({
          user: newUser,
          gatewayManager: ctx.gatewayManager,
          // Account switch is not a cold login: avoid blocking the HTTP response on a
          // Windows full Gateway restart (reload→restart). Config is written to disk;
          // refresh is scheduled async and coalesced with skill-workspace reload.
          source: 'account-switch',
          awaitGatewayRefresh: false,
        });
      } catch (err) {
        logger.warn('[auth] Post account-switch authenticated setup failed:', err);
      }

      schedulePostLoginBackgroundWork(newUser, ctx);
      scheduleSclawHubReconnect(ctx);

      sendJson(res, 200, {
        success: true,
        user: newUser,
        impersonationOrigin: await getImpersonationOrigin(),
        stoSync: setupResult?.stoSync,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[auth] account switch failed:', error);
      sendJson(res, 500, { success: false, error: message });
    }
    return true;
  }

  // POST /api/auth/account-switch/back — 切回总部原账号（纯本地恢复）
  if (url.pathname === '/api/auth/account-switch/back' && req.method === 'POST') {
    try {
      const origin = await getImpersonationOrigin();
      if (!origin?.stoToken) {
        sendJson(res, 400, { success: false, error: '没有可恢复的总部账号' });
        return true;
      }

      await setAuthUser(origin);
      await clearImpersonationOrigin();

      const stoSyncService = getStoModelSyncService();
      if (ctx.gatewayManager) {
        stoSyncService.setGatewayManager(ctx.gatewayManager);
      }

      await loadInferenceRuntimeConfigBeforeSetup();

      let setupResult: AuthenticatedSetupResult | undefined;
      try {
        setupResult = await runAuthenticatedSetup({
          user: origin,
          gatewayManager: ctx.gatewayManager,
          source: 'account-switch',
          awaitGatewayRefresh: false,
        });
      } catch (err) {
        logger.warn('[auth] Post account-switch-back authenticated setup failed:', err);
      }

      schedulePostLoginBackgroundWork(origin, ctx);
      scheduleSclawHubReconnect(ctx);

      sendJson(res, 200, {
        success: true,
        user: origin,
        impersonationOrigin: null,
        stoSync: setupResult?.stoSync,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[auth] account switch back failed:', error);
      sendJson(res, 500, { success: false, error: message });
    }
    return true;
  }

  return false;
}
