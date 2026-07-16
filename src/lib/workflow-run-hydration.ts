/**
 * Hydrate workflow card state from the client-local runtime DB (workflow-runtime:getRun).
 * This is a one-shot initial fetch on session switch / app init / card mount. Active runs
 * do NOT need an explicit subscribe here — the runtime emits a 'workflow:status-update'
 * broadcast on every engine status transition, which the app-wide useWorkflowCompletion
 * listener merges into card state and finalizes on terminal. Terminal runs render once.
 */
import { getRunViaIpc, runToExecutionState } from '@/lib/workflow-api';
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
    state.result?.summary
    || (state.result?.artifacts && state.result.artifacts.length > 0),
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
    // gap3 hydration: client-local runs live in the renderer-side DB. Fetch the full
    // WorkflowRunResponse via the runtime IPC and map to UI execution state.
    const run = await getRunViaIpc(runId);
    if (!run) {
      console.warn('[workflow-trace] hydrateWorkflowRun failed runId=%s (getRun returned null)', runId);
      return;
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
