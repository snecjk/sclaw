import type { NavigateFunction } from 'react-router-dom';

export function isMainChatHomePath(pathname: string): boolean {
  return pathname === '/';
}

/** Open the main chat surface on home without using `/chat`. */
export function navigateToMainChatHome(navigate: NavigateFunction, pathname: string): void {
  if (!isMainChatHomePath(pathname)) {
    navigate('/');
  }
}
