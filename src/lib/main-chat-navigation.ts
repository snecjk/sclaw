import { flushSync } from 'react-dom';
import type { NavigateFunction } from 'react-router-dom';

export function isMainChatHomePath(pathname: string): boolean {
  return pathname === '/';
}

/**
 * Open the main chat surface on home without using `/chat`.
 *
 * We flush pending React updates before navigating so that session state
 * changes (e.g. switchSession) are committed before the route changes to `/`.
 * This prevents Sidebar from rendering an intermediate frame where
 * `pathname === '/'` but `currentSessionKey` still holds the old/default value,
 * which caused the Home nav item to flash orange briefly.
 */
export function navigateToMainChatHome(navigate: NavigateFunction, pathname: string): void {
  if (!isMainChatHomePath(pathname)) {
    flushSync(() => {});
    navigate('/');
  }
}
