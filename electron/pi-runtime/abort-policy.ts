export interface PiAbortableRun {
  activeRunId?: string;
  settledRunId?: string;
  streamingAssistant?: unknown;
  session: { abort(): Promise<void> };
}

/**
 * Signal Pi immediately and acknowledge the abort before waiting for the
 * official session to become idle. The returned promise still settles only
 * after Pi has unwound the active model/tool operation, so the per-session
 * worker queue continues to prevent a follow-up prompt from racing it.
 */
export async function abortPiActiveRun(
  entry: PiAbortableRun | undefined,
  callbacks: {
    emitAborted(runId: string): void;
    respond(aborted: boolean, runId?: string): void;
  },
): Promise<boolean> {
  const runId = entry?.activeRunId;
  if (!entry || !runId) {
    callbacks.respond(false);
    return false;
  }

  entry.activeRunId = undefined;
  entry.settledRunId = undefined;
  entry.streamingAssistant = undefined;

  // AgentSession.abort() synchronously calls agent.abort() before its first
  // await, then waits for idle. Keep that settlement off the RPC critical path.
  const settlement = entry.session.abort().catch(() => undefined);
  callbacks.emitAborted(runId);
  callbacks.respond(true, runId);
  await settlement;
  return true;
}
