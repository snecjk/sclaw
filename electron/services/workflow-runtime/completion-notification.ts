import type { BrowserWindow } from 'electron';
import type { WorkflowRunStatus } from '../../../shared/workflow-run-status';
import {
  notifyTaskResult,
  resetTaskResultNotificationDedupeForTest,
} from '../task-result-notification';

export interface WorkflowCompletionNotificationPayload {
  runId: string;
  sessionKey: string;
  status: WorkflowRunStatus;
  workflowName?: string;
  summary?: string;
  error?: string;
}

export function isWorkflowCompletionStatus(status: WorkflowRunStatus): boolean {
  return status === 'completed' || status === 'failed';
}

export function buildWorkflowSystemNotification(payload: WorkflowCompletionNotificationPayload): {
  title: string;
  body: string;
} {
  const name = payload.workflowName?.trim() || payload.runId;
  if (payload.status === 'completed') {
    const summary = payload.summary?.trim();
    return { title: '工作流已完成', body: summary || `「${name}」已完成，点击查看运行结果。` };
  }
  return {
    title: '工作流执行失败',
    body: payload.error?.trim() || `「${name}」执行失败，点击查看详情。`,
  };
}

/** Main-process native notification, deduped for the lifetime of the app. */
export function notifyWorkflowCompletion(
  mainWindow: BrowserWindow | null,
  payload: WorkflowCompletionNotificationPayload,
): void {
  if (!isWorkflowCompletionStatus(payload.status)) return;

  const message = buildWorkflowSystemNotification(payload);
  notifyTaskResult(mainWindow, {
    id: `workflow-result:${payload.runId}`,
    ...message,
    onClick: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('workflow:completion-open', {
        runId: payload.runId,
        sessionKey: payload.sessionKey,
      });
    },
  });
}

export function resetWorkflowCompletionNotificationDedupeForTest(): void {
  resetTaskResultNotificationDedupeForTest();
}
