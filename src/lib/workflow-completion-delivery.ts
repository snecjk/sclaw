/**
 * Finalize workflow runs when they reach a terminal state.
 * Results render on WorkflowCard directly — no extra Gateway sendMessage round-trip.
 */
import { getWorkflowRun, runToExecutionState } from '@/lib/workflow-api';
import { mergeWorkflowCardState } from '@/lib/workflow-card-state-merge';
import { WORKFLOW_COMPLETE_TAG } from '@/lib/workflow-context';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { useChatStore, type RawMessage } from '@/stores/chat';
import {
  getExecutionByRunId,
  markCompletionSummaryDelivered,
  patchWorkflowExecution,
  updateWorkflowRunMetadata,
} from '@/stores/workflow-memory';
import type { WorkflowExecutionState } from '@/types/workflow';

const deliveryInFlight = new Set<string>();

export function messagesHasCompletionSummary(
  messages: RawMessage[],
  runId: string,
): boolean {
  return messages.some((m) => {
    if (m.role !== 'user') return false;
    const text = typeof m.content === 'string' ? m.content : '';
    return text.includes(WORKFLOW_COMPLETE_TAG) && text.includes(runId);
  });
}

/** Hydrate card + mark delivered when a run completes; WorkflowCard shows summary/artifacts. */
export async function deliverWorkflowCompletionIfNeeded(
  runId: string,
  sessionKey: string,
  prefetchedState?: WorkflowExecutionState,
): Promise<void> {
  if (deliveryInFlight.has(runId)) return;

  const chatState = useChatStore.getState();
  if (chatState.currentSessionKey !== sessionKey) return;

  const exec = getExecutionByRunId(runId, sessionKey);
  if (exec?.completionSummaryDelivered) return;
  if (messagesHasCompletionSummary(chatState.messages, runId)) {
    markCompletionSummaryDelivered(sessionKey, runId);
    return;
  }

  deliveryInFlight.add(runId);
  try {
    let state = prefetchedState;
    let workflowId = state?.workflowId ?? exec?.workflowId ?? '';

    if (!state || !isTerminalWorkflowRunStatus(state.status)) {
      const run = await getWorkflowRun(runId);
      state = runToExecutionState(run);
      workflowId = run.workflowId;
    }

    if (!state || !isTerminalWorkflowRunStatus(state.status)) return;
    if (state.status !== 'completed' && state.status !== 'failed') return;

    const previous = useChatStore.getState().workflowCardStates[runId];
    const merged = mergeWorkflowCardState(previous, state, {
      localStartedAtMs: exec?.createdAt,
    });

    chatState.setWorkflowCardState(runId, merged);
    patchWorkflowExecution(sessionKey, runId, {
      status: merged.status,
      updatedAt: Date.now(),
    });

    markCompletionSummaryDelivered(sessionKey, runId);
    if (workflowId) {
      updateWorkflowRunMetadata(sessionKey, workflowId, {
        lastRunId: runId,
        lastStatus: merged.status,
        completedAt: Date.now(),
      });
    }
  } catch (err) {
    console.error('[workflow-completion-delivery] failed:', err);
  } finally {
    deliveryInFlight.delete(runId);
  }
}
