import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getAuthState } from '../../utils/auth-store';
import { resolveOpenIMCredentials } from '../../services/openim-credentials-service';
import {
  bootstrapOpenIMViaMain,
  getActiveOpenIMLogin,
  isOpenIMMainSDKReady,
} from '../../openim/init-main-sdk';
import { ensureOpenIMPaths } from '../../openim/paths';
import { logger } from '../../utils/logger';

function getOpenIMPlatformID(): number {
  if (process.platform === 'darwin') return 4;
  if (process.platform === 'win32') return 3;
  if (process.platform === 'linux') return 7;
  return 5;
}

export async function handleOpenIMRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/openim/credentials' && req.method === 'GET') {
    const auth = await getAuthState();
    if (!auth.isAuthenticated || !auth.user) {
      sendJson(res, 401, { success: false, error: '未登录' });
      return true;
    }

    try {
      // Prefer the token already logged into the native SDK.
      // Issuing a new get_user_token invalidates the previous ticket and kicks the session.
      const activeLogin = getActiveOpenIMLogin();
      const credentials = await resolveOpenIMCredentials(auth.user, {
        preferToken: activeLogin?.token,
        preferUserID: activeLogin?.userID,
      });
      if (!credentials) {
        sendJson(res, 200, { success: true, enabled: false });
        return true;
      }

      let imReady = false;
      let imStatus: number | null = null;
      let imError: string | undefined;

      if (!isOpenIMMainSDKReady()) {
        imError = 'OpenIM main SDK not ready';
        logger.warn('[OpenIM] credentials: main SDK not ready, skip bootstrap');
      } else {
        const paths = ensureOpenIMPaths(credentials.userID);
        const state = await bootstrapOpenIMViaMain({
          userID: credentials.userID,
          token: credentials.token,
          apiAddr: credentials.apiAddr,
          wsAddr: credentials.wsAddr,
          platformID: getOpenIMPlatformID(),
          dataDir: paths.dataDir,
          logFilePath: paths.logDir,
        });
        imReady = state.ready;
        imStatus = state.status;
        imError = state.error ?? undefined;
        logger.info(
          `[OpenIM] credentials bootstrap imReady=${String(imReady)} status=${String(imStatus)}`,
        );
      }

      sendJson(res, 200, {
        success: true,
        enabled: true,
        apiAddr: credentials.apiAddr,
        wsAddr: credentials.wsAddr,
        userID: credentials.userID,
        token: credentials.token,
        imReady,
        imStatus,
        imError,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[OpenIM] credentials fetch failed:', error);
      sendJson(res, 500, { success: false, error: message });
    }
    return true;
  }

  return false;
}
