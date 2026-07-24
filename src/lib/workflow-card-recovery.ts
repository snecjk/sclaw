import type { LocalWorkflowRunSummary } from '@/lib/workflow-api';

function isActiveLocalRun(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'pending'
    || normalized === 'running'
    || normalized === 'waiting_approval'
    || normalized === 'waiting_input';
}

/** Local summaries are newest-first; prefer the newest run that is still active. */
export function selectWorkflowRunForCard(
  runs: LocalWorkflowRunSummary[],
): LocalWorkflowRunSummary | undefined {
  return runs.find((run) => isActiveLocalRun(run.status)) ?? runs[0];
}
