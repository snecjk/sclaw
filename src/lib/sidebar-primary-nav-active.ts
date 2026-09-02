import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

export function resolveSidebarPrimaryNavActiveOverride({
  to,
  pathname,
  currentSessionKey,
  pendingProjectId,
}: {
  to: string;
  pathname: string;
  currentSessionKey: string | null;
  pendingProjectId: string | null;
}): boolean | undefined {
  if (to === '/my-tasks' && pathname.startsWith('/workflow')) return true;
  if (
    to === '/'
    && ((currentSessionKey && currentSessionKey !== DEFAULT_SESSION_KEY) || pendingProjectId)
  ) {
    return false;
  }
  return undefined;
}
