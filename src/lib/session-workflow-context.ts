/**
 * Resolve workflowId for the current chat session from local memory and messages.
 *
 * workflowId sources (in priority order):
 * 1. stoclaw:session-workflows localStorage (set after createWorkflow)
 * 2. workflow_card blocks → workflowCardStates[runId].workflowId
 * 3. User/assistant message text containing "工作流 ID: wf_xxx"
 */
import { getLatestWorkflow, getSessionWorkflows } from '@/stores/workflow-memory';
import type { RawMessage, ContentBlock } from '@/stores/chat/types';
import type { WorkflowExecutionState } from '@/types/workflow';
import { extractText } from '@/pages/Chat/message-utils';

const WORKFLOW_ID_TEXT = /工作流\s*ID[：:]\s*(wf_[\w-]+)/i;

function extractWorkflowCards(messages: RawMessage[]): string[] {
  const runIds: string[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === 'workflow_card' && block.runId) {
        runIds.push(block.runId);
      }
    }
  }
  return runIds;
}

export function resolveSessionWorkflowId(
  sessionKey: string,
  messages: RawMessage[],
  workflowCardStates: Record<string, WorkflowExecutionState>,
): string | null {
  const latest = getLatestWorkflow(sessionKey);
  if (latest?.workflowId) return latest.workflowId;

  for (const runId of extractWorkflowCards(messages)) {
    const state = workflowCardStates[runId];
    if (state?.workflowId) return state.workflowId;
  }

  for (const msg of messages) {
    const text = extractText(msg);
    const match = text.match(WORKFLOW_ID_TEXT);
    if (match?.[1]) return match[1];
  }

  const workflows = getSessionWorkflows(sessionKey);
  return workflows[0]?.workflowId ?? null;
}

/**
 * True when the session has evidence that a workflow was started (not merely drafted).
 */
export function hasWorkflowExecutionEvidence(
  sessionKey: string,
  messages: RawMessage[],
  workflowCardStates: Record<string, WorkflowExecutionState>,
): boolean {
  const workflows = getSessionWorkflows(sessionKey);
  if (workflows.some((w) => w.lastRunId)) return true;

  if (extractWorkflowCards(messages).length > 0) return true;

  return Object.values(workflowCardStates).some((s) => Boolean(s.workflowId && s.runId));
}

/**
 * Show workflow preview tab only when artifacts may belong to a workflow run.
 */
export function shouldShowWorkflowPreviewTab(
  sessionKey: string,
  messages: RawMessage[],
  workflowCardStates: Record<string, WorkflowExecutionState>,
): boolean {
  const workflowId = resolveSessionWorkflowId(sessionKey, messages, workflowCardStates);
  if (!workflowId) return false;
  return hasWorkflowExecutionEvidence(sessionKey, messages, workflowCardStates);
}
