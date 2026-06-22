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
  steps?: WorkflowExecutionState['steps'];
  workflowId?: string;
}

export function useWorkflowCompletion(sessionKey: string) {
  useEffect(() => {
    const pollTraceHandler = (payload: unknown) => {
      const data = payload as {
        runId: string;
        sessionKey: string;
        pollCount: number;
        apiStatus: string;
        uiStatus: string;
        data: unknown;
      };
      if (data.sessionKey !== sessionKey) return;
      
    };

    const unsubPollTrace = window.electron.ipcRenderer.on(
      'workflow:poll-trace',
      pollTraceHandler as (payload: unknown) => void,
    );

    const handler = async (payload: unknown) => {
      const data = payload as WorkflowStatusPayload;
      if (data.sessionKey !== sessionKey) return;

      

      const chatState = useChatStore.getState();
      const currentState = chatState.workflowCardStates[data.runId];
      const exec = getExecutionByRunId(data.runId, sessionKey);
      const incoming: WorkflowExecutionState = {
        runId: data.runId,
        workflowId: data.workflowId ?? currentState?.workflowId ?? '',
        status: data.status,
        progress: data.progress ?? currentState?.progress ?? 0,
        steps: data.steps ?? currentState?.steps ?? [],
        result: data.result ?? currentState?.result,
        error: data.error ?? currentState?.error,
        startedAt: data.startedAt ?? currentState?.startedAt,
        completedAt: data.completedAt ?? currentState?.completedAt,
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
      if (typeof unsubPollTrace === 'function') unsubPollTrace();
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [sessionKey]);
}
