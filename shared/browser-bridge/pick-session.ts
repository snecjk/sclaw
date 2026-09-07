export type BridgeSessionPickInput = {
  sessionId: string;
  tabId: number;
  source?: string;
};

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
  if (options?.sessionId) {
    const exact = sessions.find((session) => session.sessionId === options.sessionId);
    if (exact) return exact;
    if (options.embedOnly || options.sessionId.startsWith('embed-')) return null;
  }

  if (options?.embedOnly) {
    return sessions.find((session) => isEmbedBridgeSession(session)) ?? null;
  }

  const extension = sessions.find((session) => !isEmbedBridgeSession(session));
  if (extension) return extension;
  return sessions[0] ?? null;
}
