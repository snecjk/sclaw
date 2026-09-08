import type { ChatSession } from './types';

export function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

export function getAgentIdFromSessionKey(sessionKey: string): string {
  if (sessionKey.startsWith('pi:')) return sessionKey.split(':')[1] || 'main';
  if (!sessionKey.startsWith('agent:')) return 'main';
  return sessionKey.split(':')[1] || 'main';
}

export function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((session) => session.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : null;
}

export function getCanonicalPrefixFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : null;
}

export function buildFallbackMainSessionKey(agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:main`;
}

export function createTemporaryAgentSessionKey(
  agentId: string,
  now = Date.now(),
  engineType: 'openclaw' | 'claude' | 'pi' = 'openclaw',
): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  if (engineType === 'pi') return `pi:${normalizeAgentId(agentId)}:${suffix}`;
  return `agent:${normalizeAgentId(agentId)}:session-${now}-${suffix}`;
}

export function isTemporaryAgentSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:session-\d+/.test(sessionKey) || /^pi:[^:]+:[^:]+$/.test(sessionKey);
}

export function clearSessionEntryFromMap<T extends Record<string, unknown>>(
  entries: T,
  sessionKey: string,
): T {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => key !== sessionKey)) as T;
}
