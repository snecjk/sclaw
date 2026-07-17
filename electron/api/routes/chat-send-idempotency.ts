type ChatSendResult = {
  success: boolean;
  result?: { runId?: string };
  error?: string;
};

type TrackedSend = {
  createdAt: number;
  promise: Promise<ChatSendResult>;
};

const ACCEPTED_SEND_TTL_MS = 10 * 60 * 1000;
const MAX_TRACKED_SENDS = 500;
const sends = new Map<string, TrackedSend>();

function prune(now: number): void {
  for (const [key, value] of sends) {
    if (now - value.createdAt > ACCEPTED_SEND_TTL_MS) sends.delete(key);
  }
  while (sends.size >= MAX_TRACKED_SENDS) {
    const oldest = sends.keys().next().value as string | undefined;
    if (!oldest) break;
    sends.delete(oldest);
  }
}

/** Coalesce concurrent/replayed renderer requests before either engine is invoked. */
export function runIdempotentChatSend(
  sessionKey: unknown,
  idempotencyKey: unknown,
  dispatch: () => Promise<ChatSendResult>,
): Promise<ChatSendResult> {
  const normalizedSessionKey = typeof sessionKey === 'string' ? sessionKey.trim() : '';
  const normalizedIdempotencyKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (!normalizedSessionKey || !normalizedIdempotencyKey) {
    return Promise.resolve({ success: false, error: 'sessionKey and idempotencyKey are required' });
  }

  const now = Date.now();
  prune(now);
  const key = `${normalizedSessionKey}\u0000${normalizedIdempotencyKey}`;
  const existing = sends.get(key);
  if (existing) return existing.promise;

  const promise = Promise.resolve().then(dispatch);
  sends.set(key, { createdAt: now, promise });
  void promise.then(
    (result) => {
      if (!result.success && sends.get(key)?.promise === promise) sends.delete(key);
    },
    () => {
      if (sends.get(key)?.promise === promise) sends.delete(key);
    },
  );
  return promise;
}

export function clearChatSendIdempotencyForTests(): void {
  sends.clear();
}
