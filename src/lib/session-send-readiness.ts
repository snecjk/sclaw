type ReadinessOutcome = { error: unknown } | null;

const readinessBySessionKey = new Map<string, Promise<ReadinessOutcome>>();

function trackReadiness(setup: Promise<unknown>): Promise<ReadinessOutcome> {
  return setup.then<ReadinessOutcome, ReadinessOutcome>(
    () => null,
    (error) => ({ error }),
  );
}

/** Register asynchronous setup that must finish before the first chat.send. */
export function registerSessionSendReadiness(
  sessionKey: string,
  setup: Promise<unknown>,
): void {
  const key = sessionKey.trim();
  if (!key) return;
  const previous = readinessBySessionKey.get(key);
  const trackedSetup = trackReadiness(setup);
  const tracked = previous
    ? Promise.all([previous, trackedSetup]).then(([previousOutcome, setupOutcome]) => (
        previousOutcome ?? setupOutcome
      ))
    : trackedSetup;
  readinessBySessionKey.set(key, tracked);
}

export async function awaitSessionSendReadiness(sessionKey: string): Promise<void> {
  const key = sessionKey.trim();
  const tracked = readinessBySessionKey.get(key);
  if (!tracked) return;
  const outcome = await tracked;
  if (!outcome && readinessBySessionKey.get(key) === tracked) {
    readinessBySessionKey.delete(key);
  }
  if (outcome) throw outcome.error;
}

export function clearSessionSendReadiness(sessionKey: string): void {
  readinessBySessionKey.delete(sessionKey.trim());
}

export function clearSessionSendReadinessForTests(): void {
  readinessBySessionKey.clear();
}
