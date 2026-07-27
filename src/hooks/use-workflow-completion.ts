/**
 * Workflow Completion Hook — listens for IPC status updates and finalizes WorkflowCard.
 */
import { useEffect } from 'react';
import { deliverWorkflowCompletionIfNeeded } from '@/lib/workflow-completion-delivery';
import { mergeWorkflowCardState } from '@/lib/workflow-card-state-merge';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { useChatStore } from '@/stores/chat';
import { getExecutionByRunId } from '@/stores/workflow-memory';
import type { WorkflowExecutionState } from '@/types/workflow';

interface WorkflowStatusPayload {
  runId: string;
  sessionKey: string;
  status: WorkflowExecutionState['status'];
  result?: WorkflowExecutionState['result'];
  error?: string;
  startedAt?: string;
  completedAt?: string;
  progress?: number;
  currentNodeId?: string;
  attempt?: number;
  steps?: WorkflowExecutionState['steps'];
  workflowId?: string;
  /** 暂停态目标节点（waiting_approval/waiting_input）——gap2 emit 桥透传。 */
  waitingNodeId?: string | null;
}

export function shouldAcceptWorkflowStatusUpdate(
  payloadSessionKey: string,
  currentSessionKey: string,
  sessionOwnsRun: boolean,
): boolean {
  return payloadSessionKey === currentSessionKey || (payloadSessionKey === '' && sessionOwnsRun);
}

export function useWorkflowCompletion(sessionKey: string) {
  useEffect(() => {
    const handler = async (payload: unknown) => {
      const data = payload as WorkflowStatusPayload;
      const chatState = useChatStore.getState();
      const currentState = chatState.workflowCardStates[data.runId];
      const exec = getExecutionByRunId(data.runId, sessionKey);
      // Legacy tool starts go through the local host route without a renderer
      // sessionKey. Accept an empty-key broadcast only when this session already
      // owns the runId; never let it update unrelated conversation cards.
      if (!shouldAcceptWorkflowStatusUpdate(data.sessionKey, sessionKey, Boolean(exec))) return;
      const incoming: WorkflowExecutionState = {
        runId: data.runId,
        workflowId: data.workflowId ?? currentState?.workflowId ?? '',
        status: data.status,
        progress: data.progress ?? currentState?.progress ?? 0,
        currentStep: data.currentNodeId ?? currentState?.currentStep,
        steps: data.steps ?? currentState?.steps ?? [],
        result: data.result ?? currentState?.result,
        error: data.error ?? currentState?.error,
        startedAt: data.startedAt ?? currentState?.startedAt,
        completedAt: data.completedAt ?? currentState?.completedAt,
        waitingNodeId: data.waitingNodeId ?? currentState?.waitingNodeId ?? null,
      };
      chatState.setWorkflowCardState(
        data.runId,
        mergeWorkflowCardState(currentState, incoming, { localStartedAtMs: exec?.createdAt }),
      );

      if (!isTerminalWorkflowRunStatus(data.status)) return;
      if (data.status !== 'completed' && data.status !== 'failed') return;

      await deliverWorkflowCompletionIfNeeded(data.runId, sessionKey, incoming);
    };

    const unsubscribe = window.electron.ipcRenderer.on(
      'workflow:status-update',
      handler as (payload: unknown) => void,
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [sessionKey]);
}
