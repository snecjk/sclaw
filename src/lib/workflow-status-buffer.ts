import type { WorkflowExecutionState } from '@/types/workflow';

/**
 * Holds session-less IPC updates until the matching workflow tool result
 * registers the run in the renderer. Entries are consumed exactly once.
 */
const pendingStatusUpdates = new Map<string, WorkflowExecutionState>();

export function bufferWorkflowStatusUpdate(update: WorkflowExecutionState): void {
  pendingStatusUpdates.set(update.runId, update);
}

export function consumeBufferedWorkflowStatusUpdate(
  runId: string,
): WorkflowExecutionState | undefined {
  const update = pendingStatusUpdates.get(runId);
  pendingStatusUpdates.delete(runId);
  return update;
}
