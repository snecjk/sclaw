import { Notification, type BrowserWindow } from 'electron';
import type { WorkflowRunStatus } from '../../../shared/workflow-run-status';

export interface WorkflowCompletionNotificationPayload {
  runId: string;
  sessionKey: string;
  status: WorkflowRunStatus;
  workflowName?: string;
  summary?: string;
  error?: string;
}

const deliveredRunIds = new Set<string>();

export function isWorkflowCompletionStatus(status: WorkflowRunStatus): boolean {
  return status === 'completed' || status === 'failed';
}

export function shouldShowWorkflowSystemNotification(
  window: Pick<BrowserWindow, 'isFocused' | 'isMinimized' | 'isVisible'> | null,
): boolean {
  return !window || !window.isVisible() || window.isMinimized() || !window.isFocused();
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
  if (!isWorkflowCompletionStatus(payload.status) || deliveredRunIds.has(payload.runId)) return;
  deliveredRunIds.add(payload.runId);
  if (!shouldShowWorkflowSystemNotification(mainWindow)) return;
  if (!Notification.isSupported()) return;

  const message = buildWorkflowSystemNotification(payload);
  const notification = new Notification(message);
  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('workflow:completion-open', {
      runId: payload.runId,
      sessionKey: payload.sessionKey,
    });
  });
  notification.show();
}

export function resetWorkflowCompletionNotificationDedupeForTest(): void {
  deliveredRunIds.clear();
}
