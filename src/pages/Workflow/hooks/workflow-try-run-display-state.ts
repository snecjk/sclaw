import type { WorkflowTryRunState } from '@/lib/workflow-iframe-bridge';

export type WorkflowTryRunDisplayState = Extract<
  WorkflowTryRunState,
  'running' | 'cancelled' | 'failed' | 'completed'
>;

export function mapWorkflowRunStatusToTryRunState(
  status: string | null | undefined,
): WorkflowTryRunDisplayState | null {
  if (['pending', 'running', 'waiting_approval', 'waiting_input'].includes(status ?? '')) {
    return 'running';
  }
  if (status === 'cancelled') return 'cancelled';
  if (['failed', 'timeout', 'interrupted'].includes(status ?? '')) return 'failed';
  if (status === 'completed') return 'completed';
  return null;
}
