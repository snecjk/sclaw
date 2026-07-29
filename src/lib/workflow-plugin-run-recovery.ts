import type { WorkflowRunResponse } from '@/types/workflow';

const RUN_ID_MENTION = /\b(run_[\w-]+)\b/gi;

/** Select the last runId named by the model in its visible reply. */
export function getLastWorkflowRunIdMention(text: string): string | null {
  const matches = [...text.matchAll(RUN_ID_MENTION)];
  return matches.length > 0 ? matches[matches.length - 1]![1] : null;
}

/** Never bind a visible runId to the current chat unless its local record agrees. */
export function workflowRunMatchesMention(
  run: WorkflowRunResponse,
  mentionedWorkflowId: string | undefined,
): boolean {
  return !mentionedWorkflowId || run.workflowId === mentionedWorkflowId;
}
