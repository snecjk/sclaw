import { resolveWorkflowStartedAt } from '@/lib/format-workflow-duration';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import type { WorkflowExecutionState } from '@/types/workflow';

/** Merge polled/hydrated run state without losing client-side track start time. */
export function mergeWorkflowCardState(
  previous: WorkflowExecutionState | undefined,
  incoming: WorkflowExecutionState,
  options?: { localStartedAtMs?: number },
): WorkflowExecutionState {
  // Status updates are delivered from an asynchronous main-process bridge and
  // can arrive out of order. Once a run is terminal, an older active snapshot
  // must never turn the card back into a progress card.
  const preserveTerminalStatus = Boolean(
    previous
    && isTerminalWorkflowRunStatus(previous.status)
    && !isTerminalWorkflowRunStatus(incoming.status),
  );
  const effectiveIncoming = preserveTerminalStatus
    ? { ...incoming, status: previous!.status, progress: previous!.progress }
    : {
      ...incoming,
      // A history snapshot can lag behind a live IPC update; do not move a
      // visible progress bar backwards while the run remains active.
      progress: Math.max(previous?.progress ?? 0, incoming.progress),
    };
  const isIncomingActive = effectiveIncoming.status === 'running' || effectiveIncoming.status === 'waiting_approval' || effectiveIncoming.status === 'waiting_input';
  const completedAt = isIncomingActive ? undefined : (effectiveIncoming.completedAt ?? previous?.completedAt);
  const incomingStartedAt = previous?.startedAt && completedAt ? undefined : effectiveIncoming.startedAt;
  const startedAt = resolveWorkflowStartedAt(
    previous?.startedAt,
    incomingStartedAt,
    options?.localStartedAtMs,
    completedAt,
  );

  return {
    ...previous,
    ...effectiveIncoming,
    startedAt,
    completedAt,
    result: effectiveIncoming.result ?? previous?.result,
    error: effectiveIncoming.error ?? previous?.error,
    steps: effectiveIncoming.steps?.length ? effectiveIncoming.steps : (previous?.steps ?? []),
  };
}
