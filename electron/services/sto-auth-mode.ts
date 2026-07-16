/**
 * Auth mode resolution: session identity vs AI resource identity.
 * HQ demo-as-site keeps session user (site) but AI resources from impersonationOrigin (HQ).
 */

import type { SsoUserInfo } from '../utils/auth-store';
import { getAuthState, getImpersonationOrigin, getStoToken } from '../utils/auth-store';
import {
  type AuthMode,
  resolveAuthModeFromState,
} from '../../shared/auth-mode-utils';
import { isSiteUser } from '../../shared/site-user-utils';
import { logger } from '../utils/logger';

export type { AuthMode };

export interface AiResourceContext {
  mode: AuthMode;
  sessionUser: SsoUserInfo;
  aiUser: SsoUserInfo;
  aiStoToken: string | null;
}

function isOriginStoTokenValid(origin: SsoUserInfo): boolean {
  const token = origin.stoToken?.trim();
  const expiresAt = origin.stoTokenExpiresAt;
  if (!token) return false;
  if (!expiresAt) return true;
  return new Date(expiresAt) > new Date();
}

export async function resolveAuthMode(): Promise<AuthMode | null> {
  const { user: sessionUser } = await getAuthState();
  const origin = await getImpersonationOrigin();
  return resolveAuthModeFromState(sessionUser, origin);
}

export async function resolveAiResourceContext(): Promise<AiResourceContext | null> {
  const { user: sessionUser } = await getAuthState();
  if (!sessionUser?.categoryCode) {
    return null;
  }

  const origin = await getImpersonationOrigin();
  const mode = resolveAuthModeFromState(sessionUser, origin);
  if (!mode) {
    return null;
  }

  if (mode === 'hq-demo-as-site') {
    if (!origin || !isOriginStoTokenValid(origin)) {
      logger.warn('[auth-mode] hq-demo-as-site but origin missing or token expired');
      return null;
    }
    return {
      mode,
      sessionUser,
      aiUser: origin,
      aiStoToken: origin.stoToken?.trim() ?? null,
    };
  }

  const sessionToken = await getStoToken();
  return {
    mode,
    sessionUser,
    aiUser: sessionUser,
    aiStoToken: sessionToken,
  };
}

/** Token for AI resource memory-center calls (HQ origin token when demo-as-site). */
export async function getAiResourceStoToken(): Promise<string | null> {
  const ctx = await resolveAiResourceContext();
  if (ctx?.aiStoToken) {
    return ctx.aiStoToken;
  }
  return getStoToken();
}

export async function isNativeSiteSession(): Promise<boolean> {
  const mode = await resolveAuthMode();
  return mode === 'native-site';
}

export async function isSessionSiteUser(user: SsoUserInfo | null): Promise<boolean> {
  if (!user?.categoryCode) return false;
  return isSiteUser(user.categoryCode);
}
