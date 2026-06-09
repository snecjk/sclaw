/**
 * Hydrate workflow card state from GET /agent/v1/runs/{runId}.
 * Active runs resume Main-process polling; terminal runs render once without SSE/polling.
 */
import { invokeIpc } from '@/lib/api-client';
import { fetchWorkflowStatus, beginWorkflowRunSseTrace } from '@/lib/workflow-api';
import { isActiveWorkflowRunStatus, isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { deliverWorkflowCompletionIfNeeded } from '@/lib/workflow-completion-delivery';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { getExecutionByRunId, listSessionExecutions, updateExecutionStatus } from '@/stores/workflow-memory';
import type { ContentBlock } from '@/stores/chat/types';

const hydrateInFlight = new Set<string>();
const hydratedTerminal = new Set<string>();

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
  if (hydrateInFlight.has(runId) || hydratedTerminal.has(runId)) return;

  hydrateInFlight.add(runId);
  try {
    console.log('[workflow-trace] hydrateWorkflowRun start runId=%s sessionKey=%s', runId, ctx.sessionKey);
    const state = await fetchWorkflowStatus(runId);
    if (!state) {
      console.warn('[workflow-trace] hydrateWorkflowRun failed runId=%s (GET run returned null)', runId);
      return;
    }

    if (useChatStore.getState().currentSessionKey !== ctx.sessionKey) return;

    useChatStore.getState().setWorkflowCardState(runId, state);
    updateExecutionStatus(runId, state.status, ctx.sessionKey);

    if (isActiveWorkflowRunStatus(state.status)) {
      const exec = getExecutionByRunId(runId, ctx.sessionKey);
      const workflowId = state.workflowId || exec?.workflowId;
      if (!workflowId) {
        console.warn(
          '[workflow-trace] hydrateWorkflowRun skip startTracking runId=%s reason=missing workflowId apiStatus=%s',
          runId,
          state.status,
        );
        return;
      }

      console.log(
        '[workflow-trace] hydrateWorkflowRun startTracking runId=%s workflowId=%s uiStatus=%s',
        runId,
        workflowId,
        state.status,
      );
      await invokeIpc('workflow:startTracking', {
        runId,
        workflowId,
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
      });
      beginWorkflowRunSseTrace(runId);
      return;
    }

    hydratedTerminal.add(runId);
    await invokeIpc('workflow:stopTracking', { runId }).catch(() => {});
    if (isTerminalWorkflowRunStatus(state.status)) {
      void deliverWorkflowCompletionIfNeeded(runId, ctx.sessionKey, state);
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
