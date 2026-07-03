/**
 * Home landing ("新对话") intent — transient, not persisted.
 *
 * When the user explicitly opens the home hub, we must keep `agent:main:main`
 * instead of loadSessions redirecting to the most recent real session.
 */
let homeLandingIntent = false;

export function requestHomeLanding(): void {
  homeLandingIntent = true;
}

export function peekHomeLandingIntent(): boolean {
  return homeLandingIntent;
}

export function clearHomeLandingIntent(): void {
  homeLandingIntent = false;
}

/** True only for freshly created `agent:*:session-<ts>` keys with no activity yet. */
export function isAwaitingFirstSendTemporarySessionKey(
  sessionKey: string,
  context: {
    messageCount: number;
    sessionLastActivity: Record<string, number>;
    sessionLabels: Record<string, string>;
  },
): boolean {
  if (!/^agent:[^:]+:session-\d+/.test(sessionKey)) return false;
  return (
    context.messageCount === 0
    && !context.sessionLastActivity[sessionKey]
    && !context.sessionLabels[sessionKey]
  );
}
