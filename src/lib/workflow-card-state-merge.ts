import { resolveWorkflowStartedAt } from '@/lib/format-workflow-duration';
import type { WorkflowExecutionState } from '@/types/workflow';

/** Merge polled/hydrated run state without losing client-side track start time. */
export function mergeWorkflowCardState(
  previous: WorkflowExecutionState | undefined,
  incoming: WorkflowExecutionState,
  options?: { localStartedAtMs?: number },
): WorkflowExecutionState {
  const isIncomingActive = incoming.status === 'running' || incoming.status === 'waiting_approval' || incoming.status === 'waiting_input';
  const completedAt = isIncomingActive ? undefined : (incoming.completedAt ?? previous?.completedAt);
  const incomingStartedAt = previous?.startedAt && completedAt ? undefined : incoming.startedAt;
  const startedAt = resolveWorkflowStartedAt(
    previous?.startedAt,
    incomingStartedAt,
    options?.localStartedAtMs,
    completedAt,
  );

  return {
    ...previous,
    ...incoming,
    startedAt,
    completedAt,
    result: incoming.result ?? previous?.result,
    error: incoming.error ?? previous?.error,
    steps: incoming.steps?.length ? incoming.steps : (previous?.steps ?? []),
  };
}
