/**
 * Auth API Routes
 * Handles SSO authentication endpoints for the Host API server.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { app } from 'electron';
import { getAuthState, setAuthUser, clearAuthUser, getSsoEnvironment, setSsoEnvironment, getStoToken, removeSsoAuthFromOpenClaw } from '../../utils/auth-store';
import type { SsoEnvironment, SsoUserInfo } from '../../utils/auth-store';
import { getBaseUrl, signOut } from '../../utils/sso-service';
import { SsoLoginManager } from '../../utils/sso-login';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { logger } from '../../utils/logger';
import { getStoModelSyncService } from '../../services/providers/sto-model-sync';
import { runAuthenticatedSetup } from '../../services/auth-setup-orchestrator';
import { runPendingInstallReport } from '../../services/client-update-platform';
import { activateUserWorkspace, getCurrentActiveUserCode } from '../../services/user-skill-workspace';
import { removeStoDynamicRoutePluginFromOpenClaw } from '../../utils/openclaw-auth';
import { getStoPolicyReportApiHost } from '../../../shared/env-config';
import { computeCrmWeekReportSurfaceAllowed } from '../../../shared/crm-week-report-policy';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { loadSiteDepartmentTypes } from '../../services/sto-apollo-config-service';
import { getClientSiteAccessService } from '../../services/client-site-access-service';
import type { ClientSiteAccessCheckResult } from '../../../shared/client-site-access';

const ssoLoginManager = new SsoLoginManager();

const CLIENT_SITE_ACCESS_DENIED_MESSAGE = '您的所属组织无权使用 StoClaw';

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
 * Heavy post-login work (skill workspace sync, SAI CLI, model/biz-agent setup).
 * Runs in the background so POST /api/auth/login can return immediately after SSO.
 */
function schedulePostLoginBackgroundWork(user: SsoUserInfo, ctx: HostApiContext): void {
  void (async () => {
    try {
      const previousUserCode = await getCurrentActiveUserCode();
      const workspaceResult = await activateUserWorkspace(user.code);
      if (workspaceResult.userChanged && previousUserCode) {
        logger.info(`[auth] User changed from ${previousUserCode} to ${user.code}, restarting Gateway`);
        await ctx.gatewayManager.restart();
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

    try {
      await runAuthenticatedSetup({
        user,
        gatewayManager: ctx.gatewayManager,
        source: 'login',
      });
    } catch (err) {
      logger.warn('[auth] Post-login authenticated setup failed:', err);
    }

    void runPendingInstallReport(app.getVersion(), process.platform);
  })();
}

const CRM_WEEK_REPORT_POLICY_PATH =
  '/sto-policy/api/v1/base/getReportAuthUserIgnoreLogin?reportType=POLICY_CRM_WEEK_REPORT';

const CRM_POLICY_FETCH_TIMEOUT_MS = 15_000;

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

      getStoModelSyncService().startPeriodicSync();
      schedulePostLoginBackgroundWork(user, ctx);

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
    try {
      const state = await getAuthState();

      // Best-effort SSO server sign out
      if (state.user?.openId) {
        const env = state.ssoEnvironment;
        const baseUrl = getBaseUrl(env);
        await signOut(baseUrl, state.user.openId);
      }

      await clearAuthUser();
      void removeSsoAuthFromOpenClaw();
      void removeStoDynamicRoutePluginFromOpenClaw().catch((err) =>
        logger.warn('STO dynamic route plugin cleanup on logout failed:', err),
      );

      // Cleanup STO models and stop periodic sync (fire-and-forget)
      const stoSyncLogout = getStoModelSyncService();
      void stoSyncLogout.cleanupOnLogout().catch((err) =>
        logger.warn('STO model cleanup on logout failed:', err),
      );

      sendJson(res, 200, { success: true });
    } catch {
      // Always clear local auth even if SSO signOut fails
      await clearAuthUser().catch(() => {});
      void removeSsoAuthFromOpenClaw();
      void removeStoDynamicRoutePluginFromOpenClaw().catch(() => {});

      // Best-effort STO cleanup on error path too
      void getStoModelSyncService().cleanupOnLogout().catch(() => {});

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

  // GET /api/auth/crm-week-report-policy — CRM 周报策略白名单（Main 代理，fail-closed）
  if (url.pathname === '/api/auth/crm-week-report-policy' && req.method === 'GET') {
    try {
      const state = await getAuthState();
      if (!state.isAuthenticated || !state.user?.userName?.trim()) {
        sendJson(res, 200, { allowed: false });
        return true;
      }

      const host = getStoPolicyReportApiHost();
      const policyUrl = `https://${host}${CRM_WEEK_REPORT_POLICY_PATH}`;
      const signal = AbortSignal.timeout(CRM_POLICY_FETCH_TIMEOUT_MS);

      const response = await proxyAwareFetch(policyUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });

      if (!response.ok) {
        logger.warn(`CRM week report policy: HTTP ${response.status} (host ${host})`);
        sendJson(res, 200, { allowed: false });
        return true;
      }

      let json: unknown;
      try {
        json = await response.json() as unknown;
      } catch {
        logger.warn('CRM week report policy: response body is not valid JSON');
        sendJson(res, 200, { allowed: false });
        return true;
      }

      const allowed = computeCrmWeekReportSurfaceAllowed(
        state.user.code,
        state.user.userName,
        json,
      );
      sendJson(res, 200, { allowed });
    } catch (error) {
      logger.warn('CRM week report policy fetch failed:', error);
      sendJson(res, 200, { allowed: false });
    }
    return true;
  }

  return false;
}
