import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../route-utils';
import { validateSsoAuthLocalSession } from '../../services/sso-auth-local-session';
import { getAuthState } from '../../utils/auth-store';

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0]?.trim() ?? '' : value?.trim() ?? '';
}

export async function handleAppDevSsoAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== '/api/app-dev/sso-auth/bootstrap' || req.method !== 'POST') {
    return false;
  }

  const workspaceId = header(req, 'x-sto-sso-auth-workspace');
  const secret = header(req, 'x-sto-sso-auth-session');
  const session = validateSsoAuthLocalSession({ workspaceId, secret });
  if (!session) {
    sendJson(res, 403, { success: false, error: 'LOCAL_AUTH_SESSION_DENIED' });
    return true;
  }
  const auth = await getAuthState();
  const expiresAt = auth.user?.stoTokenExpiresAt
    ? Date.parse(auth.user.stoTokenExpiresAt)
    : Number.NaN;
  if (
    !auth.isAuthenticated
    || !auth.user?.stoToken
    || !Number.isFinite(expiresAt)
    || expiresAt <= Date.now()
  ) {
    sendJson(res, 401, { success: false, error: 'AUTH_REQUIRED' });
    return true;
  }

  sendJson(res, 200, {
    success: true,
    token: auth.user.stoToken,
    user: {
      userId: auth.user.id,
      userCode: auth.user.code || auth.user.empCode,
      userName: auth.user.realName || auth.user.userName,
    },
  });
  return true;
}
