import { flushSync } from 'react-dom';
import type { NavigateFunction } from 'react-router-dom';

export function isMainChatHomePath(pathname: string): boolean {
  return pathname === '/';
}

/**
 * Open the main chat surface on home without using `/chat`.
 *
 * Any session-state side effect passed via `beforeNavigate` (e.g. switchSession,
 * newSession) is executed inside the same `flushSync` as the navigate, so React
 * commits both the session update and the route update in one go. This prevents
 * Sidebar from rendering an intermediate frame where `pathname === '/'` but
 * `currentSessionKey` still holds the old/default value, which caused the Home
 * nav item to flash orange briefly.
 */
export function navigateToMainChatHome(
  navigate: NavigateFunction,
  pathname: string,
  beforeNavigate?: () => void,
): void {
  if (isMainChatHomePath(pathname)) {
    beforeNavigate?.();
    return;
  }

  flushSync(() => {
    beforeNavigate?.();
    navigate('/');
  });
}
