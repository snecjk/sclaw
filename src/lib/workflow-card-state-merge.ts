import { resolveWorkflowStartedAt } from '@/lib/format-workflow-duration';
import type { WorkflowExecutionState } from '@/types/workflow';

/** Merge polled/hydrated run state without losing client-side track start time. */
export function mergeWorkflowCardState(
  previous: WorkflowExecutionState | undefined,
  incoming: WorkflowExecutionState,
  options?: { localStartedAtMs?: number },
): WorkflowExecutionState {
  const completedAt = incoming.completedAt ?? previous?.completedAt;
  const startedAt = resolveWorkflowStartedAt(
    previous?.startedAt,
    incoming.startedAt,
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
