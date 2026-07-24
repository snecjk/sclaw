/**
 * Hydrate workflow card state from the client-local runtime DB, with the workflow API as
 * a fallback for a status-query card whose local snapshot is not available yet.
 */
import { getRunViaIpc, getWorkflowRun, runToExecutionState } from '@/lib/workflow-api';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { mergeWorkflowCardState } from '@/lib/workflow-card-state-merge';
import { deliverWorkflowCompletionIfNeeded } from '@/lib/workflow-completion-delivery';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { getExecutionByRunId, listSessionExecutions, updateExecutionStatus } from '@/stores/workflow-memory';
import type { ContentBlock } from '@/stores/chat/types';

const hydrateInFlight = new Set<string>();
const hydratedTerminal = new Set<string>();

function hasTerminalCardDetails(runId: string): boolean {
  const state = useChatStore.getState().workflowCardStates[runId];
  if (!state || !isTerminalWorkflowRunStatus(state.status)) return false;
  return Boolean(
    state.result?.artifacts && state.result.artifacts.length > 0,
  );
}

export function collectWorkflowRunIds(messages: RawMessage[]): string[] {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === 'workflow_card' && block.runId) {
        ids.add(block.runId);
      }
    }
  }
  return [...ids];
}

export async function hydrateWorkflowRun(
  runId: string,
  ctx: { sessionKey: string; agentId: string },
): Promise<void> {
  if (hydrateInFlight.has(runId)) return;
  // Session switch restores a minimal card state (status only). Re-fetch details even if
  // this run was hydrated earlier in the same app session.
  if (hydratedTerminal.has(runId) && hasTerminalCardDetails(runId)) return;

  hydrateInFlight.add(runId);
  try {
    // Prefer the client-local snapshot. A queried run can arrive before that snapshot
    // is visible (or be owned by another client), so use the status API to keep the
    // conversation progress bar moving instead of leaving it at its initial value.
    let run = await getRunViaIpc(runId);
    if (!run) {
      try {
        run = await getWorkflowRun(runId);
      } catch (error) {
        console.warn('[workflow-trace] hydrateWorkflowRun failed runId=%s (local and API snapshots unavailable)', runId, error);
        return;
      }
    }

    if (useChatStore.getState().currentSessionKey !== ctx.sessionKey) return;

    const previous = useChatStore.getState().workflowCardStates[runId];
    const exec = getExecutionByRunId(runId, ctx.sessionKey);
    const state = runToExecutionState(run);
    const merged = mergeWorkflowCardState(previous, state, { localStartedAtMs: exec?.createdAt });
    useChatStore.getState().setWorkflowCardState(runId, merged);
    updateExecutionStatus(runId, state.status, ctx.sessionKey);

    // Active runs: no explicit subscribe needed. The client-local runtime emits a
    // 'workflow:status-update' broadcast on every engine status transition; the
    // useWorkflowCompletion listener (mounted app-wide) merges those into card state
    // and finalizes terminal runs. Hydration's job is the one-shot initial fetch only.
    if (isTerminalWorkflowRunStatus(state.status)) {
      hydratedTerminal.add(runId);
      // Pass prefetched terminal state so delivery skips its own HTTP fetch fallback.
      void deliverWorkflowCompletionIfNeeded(runId, ctx.sessionKey, merged);
    }
  } finally {
    hydrateInFlight.delete(runId);
  }
}

export async function hydrateSessionWorkflowCards(
  messages: RawMessage[],
  ctx: { sessionKey: string; agentId: string },
): Promise<void> {
  const runIds = new Set(collectWorkflowRunIds(messages));
  for (const exec of listSessionExecutions(ctx.sessionKey)) {
    runIds.add(exec.runId);
  }
  await Promise.all([...runIds].map((runId) => hydrateWorkflowRun(runId, ctx)));
}
