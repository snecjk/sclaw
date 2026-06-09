/**
 * Workflow Completion Hook — listens for IPC status updates and triggers model summary.
 */
import { useEffect } from 'react';
import { deliverWorkflowCompletionIfNeeded } from '@/lib/workflow-completion-delivery';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { useChatStore } from '@/stores/chat';
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
    const handler = async (payload: unknown) => {
      const data = payload as WorkflowStatusPayload;
      if (data.sessionKey !== sessionKey) return;

      const chatState = useChatStore.getState();
      const currentState = chatState.workflowCardStates[data.runId];
      chatState.setWorkflowCardState(data.runId, {
        runId: data.runId,
        workflowId: data.workflowId ?? currentState?.workflowId ?? '',
        status: data.status,
        progress: data.progress ?? currentState?.progress ?? 0,
        steps: data.steps ?? currentState?.steps ?? [],
        result: data.result ?? currentState?.result,
        error: data.error ?? currentState?.error,
        startedAt: data.startedAt ?? currentState?.startedAt,
        completedAt: data.completedAt ?? currentState?.completedAt,
      });

      if (!isTerminalWorkflowRunStatus(data.status)) return;
      if (data.status !== 'completed' && data.status !== 'failed') return;

      await deliverWorkflowCompletionIfNeeded(data.runId, sessionKey, {
        runId: data.runId,
        workflowId: data.workflowId ?? currentState?.workflowId ?? '',
        status: data.status,
        progress: data.progress ?? 100,
        steps: data.steps ?? [],
        result: data.result,
        error: data.error,
        startedAt: data.startedAt ?? currentState?.startedAt,
        completedAt: data.completedAt ?? currentState?.completedAt,
      });
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
