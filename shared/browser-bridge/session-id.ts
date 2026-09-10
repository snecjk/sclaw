/** Parse Chrome tab id from extension session ids (`ext-123` or `ext-123-<uuid>`). */
export function parseChromeTabIdFromBridgeSessionId(sessionId: string): number | null {
  const match = /^ext-(\d+)/.exec(sessionId.trim());
  if (!match) return null;
  const tabId = Number(match[1]);
  return Number.isFinite(tabId) ? tabId : null;
}
