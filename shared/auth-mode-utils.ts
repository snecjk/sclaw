/**
 * Shared auth-mode helpers for session vs AI resource identity.
 * Used by Main process and Renderer.
 */

import { isSiteUser } from './site-user-utils';

export type AuthMode = 'native-hq' | 'native-site' | 'hq-demo-as-site';

export interface ImpersonationOriginLike {
  stoToken?: string;
  categoryCode?: string;
}

export function isHqDemoAsSite(impersonationOrigin: unknown): boolean {
  return impersonationOrigin != null && typeof impersonationOrigin === 'object';
}

/** Session-facing site check (sidebar, home surfaces). */
export function resolveSessionIsSite(categoryCode: string | null | undefined): boolean {
  return isSiteUser(categoryCode);
}

/**
 * AI-resource site check (Models quota UI, SK strategy hints in renderer).
 * Demo-as-site uses HQ AI resources → false.
 */
export function resolveAiResourceIsSite(
  categoryCode: string | null | undefined,
  impersonationOrigin: unknown,
): boolean {
  if (isHqDemoAsSite(impersonationOrigin)) {
    return false;
  }
  return isSiteUser(categoryCode);
}

export function resolveAuthModeFromState(
  sessionUser: { categoryCode?: string } | null | undefined,
  impersonationOrigin: unknown,
): AuthMode | null {
  if (!sessionUser?.categoryCode) {
    return null;
  }
  if (isHqDemoAsSite(impersonationOrigin)) {
    return 'hq-demo-as-site';
  }
  return isSiteUser(sessionUser.categoryCode) ? 'native-site' : 'native-hq';
}
