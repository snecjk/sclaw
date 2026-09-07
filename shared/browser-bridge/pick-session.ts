export type BridgeSessionPickInput = {
  sessionId: string;
  tabId: number;
  source?: string;
};

/** Models invent these instead of omitting sessionId. They are not real sessions. */
const PLACEHOLDER_SESSION_ID = /^(auto|none|null|undefined|current|default)$/i;

export function normalizeBridgeSessionId(sessionId: string | undefined): string | undefined {
  const trimmed = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!trimmed || PLACEHOLDER_SESSION_ID.test(trimmed)) return undefined;
  return trimmed;
}

export const EMPTY_BRIDGE_SESSIONS_HINT =
  '当前没有已连接的 Chrome 扩展会话。不要再调用 list_sessions。下一步：bridge_navigate 打开目标 URL，省略 sessionId（不要传 auto），系统会建立扩展会话。';

export function formatBridgeSessionList<T>(sessions: T[]): {
  sessions: T[];
  actionHint: string;
} {
  if (sessions.length === 0) {
    return { sessions: [], actionHint: EMPTY_BRIDGE_SESSIONS_HINT };
  }
  return {
    sessions,
    actionHint: '已有桥接会话。后续 bridge_* 使用这里的 sessionId，或省略 sessionId。不要反复 list_sessions。',
  };
}

export function isEmbedBridgeSession(session: BridgeSessionPickInput): boolean {
  return session.source === 'embed'
    || session.tabId < 0
    || session.sessionId.startsWith('embed-');
}

/**
 * Default: prefer Chrome extension (borrowed tab).
 * App-plaza embed must pass sessionId / embedOnly — never steal the user's Chrome tab.
 */
export function pickBridgeSession<T extends BridgeSessionPickInput>(
  sessions: T[],
  options?: { sessionId?: string; embedOnly?: boolean },
): T | null {
  const sessionId = normalizeBridgeSessionId(options?.sessionId);
  if (sessionId) {
    const exact = sessions.find((session) => session.sessionId === sessionId);
    if (exact) return exact;
    if (options?.embedOnly || sessionId.startsWith('embed-')) return null;
  }

  if (options?.embedOnly) {
    return sessions.find((session) => isEmbedBridgeSession(session)) ?? null;
  }

  const extension = sessions.find((session) => !isEmbedBridgeSession(session));
  if (extension) return extension;
  return sessions[0] ?? null;
}
