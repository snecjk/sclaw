import { isVirtualTaskSessionKey } from '@/stores/chat/cron-session-utils';

export type SessionListEntry = {
  key: string;
  label?: string;
  displayName?: string;
  engineType?: 'claude' | 'openclaw';
  model?: string;
  updatedAt?: number;
};

/**
 * Keep locally-known virtual task/cron sessions until the backend list materializes them.
 * Without this, switching away from a freshly triggered run drops the session from the
 * sidebar because loadSessions only appended the *current* key before.
 */
export function appendPendingLocalVirtualTaskSessions<T extends SessionListEntry>(
  remoteSessions: T[],
  localSessions: T[],
  deletedKeys: ReadonlySet<string>,
): T[] {
  const remoteKeySet = new Set(remoteSessions.map((session) => session.key));
  const pending = localSessions.filter((session) => (
    !remoteKeySet.has(session.key)
    && !deletedKeys.has(session.key)
    && isVirtualTaskSessionKey(session.key)
  ));
  if (pending.length === 0) return remoteSessions;
  return [...remoteSessions, ...pending];
}
