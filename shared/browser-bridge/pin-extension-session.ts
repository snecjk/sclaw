import type { BrowserBridgeSession } from './types';

type PinnableSession = Pick<BrowserBridgeSession, 'sessionId' | 'tabId'> & {
  source?: BrowserBridgeSession['source'];
  url?: string;
  title?: string;
};

/** Chrome Side Panel / desktop bridge_* must pin a real extension tab, never embed. */
export function pinWebBridgeExtensionSession<T extends PinnableSession>(
  sessions: T[],
  tabId?: number,
): T | null {
  const extensionSessions = sessions.filter((session) => session.source !== 'embed');
  if (typeof tabId === 'number' && Number.isFinite(tabId)) {
    const match = extensionSessions.find((session) => session.tabId === tabId);
    if (match) return match;
  }
  return extensionSessions[0] ?? null;
}
