const preparingSessions = new Set<string>();

/** Atomically reserves a session while readiness/context preparation is in flight. */
export function tryAcquireSendAttempt(sessionKey: string): boolean {
  if (preparingSessions.has(sessionKey)) return false;
  preparingSessions.add(sessionKey);
  return true;
}

export function releaseSendAttempt(sessionKey: string): void {
  preparingSessions.delete(sessionKey);
}

export function clearSendAttemptLocksForTests(): void {
  preparingSessions.clear();
}
