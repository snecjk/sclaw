type ReadinessOutcome = { error: unknown } | null;

const readinessBySessionKey = new Map<string, Promise<ReadinessOutcome>>();

/** Register asynchronous setup that must finish before the first chat.send. */
export function registerSessionSendReadiness(
  sessionKey: string,
  setup: Promise<unknown>,
): void {
  const key = sessionKey.trim();
  if (!key) return;
  const tracked = setup.then<ReadinessOutcome, ReadinessOutcome>(
    () => null,
    (error) => ({ error }),
  );
  readinessBySessionKey.set(key, tracked);
}

export async function awaitSessionSendReadiness(sessionKey: string): Promise<void> {
  const key = sessionKey.trim();
  const tracked = readinessBySessionKey.get(key);
  if (!tracked) return;
  const outcome = await tracked;
  if (readinessBySessionKey.get(key) === tracked) {
    readinessBySessionKey.delete(key);
  }
  if (outcome) throw outcome.error;
}

export function clearSessionSendReadinessForTests(): void {
  readinessBySessionKey.clear();
}
