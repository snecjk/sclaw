/** Resolve OpenClaw cron job agentId from description JSON metadata. */
export function resolveCronJobAgentId(description?: string | null): string {
  if (!description?.trim()) return 'main';
  try {
    const meta = JSON.parse(description) as { agentId?: unknown };
    if (typeof meta.agentId === 'string' && meta.agentId.trim()) {
      return meta.agentId.trim();
    }
  } catch {
    // ignore non-JSON descriptions
  }
  return 'main';
}

/**
 * Prefer a non-main dated cron key when the same jobId+date appears under multiple agents
 * (legacy twin from host placeholder defaulting to main).
 * When `preferredKey` is in the set (active/activating session), keep that key so the
 * sidebar spinner and `switchSession` target stay aligned.
 */
export function preferCronDatedSessionKey(
  keys: string[],
  preferredKey?: string | null,
): string | undefined {
  if (keys.length === 0) return undefined;
  if (preferredKey && keys.includes(preferredKey)) return preferredKey;
  if (keys.length === 1) return keys[0];

  const scored = keys.map((key) => {
    const parts = key.split(':');
    const agentId = parts[1] || 'main';
    return { key, agentId, nonMain: agentId !== 'main' };
  });
  const nonMain = scored.filter((entry) => entry.nonMain);
  const pool = nonMain.length > 0 ? nonMain : scored;
  return [...pool].sort((left, right) => right.key.localeCompare(left.key))[0]?.key;
}
