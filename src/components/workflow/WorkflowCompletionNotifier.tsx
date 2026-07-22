import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router-dom';
import { openWorkflowResult } from '@/lib/workflow-result-navigation';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { getExecutionByRunId, markCompletionNotificationDelivered } from '@/stores/workflow-memory';
import type { WorkflowRunStatus } from '@/types/workflow';

interface WorkflowStatusPayload {
  runId: string;
  sessionKey: string;
  status: WorkflowRunStatus;
  workflowId?: string;
  error?: string;
}

export function WorkflowCompletionNotifier() {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/sprite' || location.pathname === '/float-icon') return undefined;
    const openResult = (sessionKey: string, runId: string) => {
      navigate('/');
      openWorkflowResult(sessionKey, runId);
    };
    const onCompletionOpen = (payload: unknown) => {
      const data = payload as { sessionKey?: string; runId?: string };
      if (data.sessionKey && data.runId) openResult(data.sessionKey, data.runId);
    };
    const onStatus = (payload: unknown) => {
      const data = payload as WorkflowStatusPayload;
      if (!data?.runId || !data.sessionKey || !isTerminalWorkflowRunStatus(data.status)) return;
      if (data.status !== 'completed' && data.status !== 'failed') return;

      const execution = getExecutionByRunId(data.runId, data.sessionKey);
      if (execution?.completionNotificationDeliveredAt) return;
      markCompletionNotificationDelivered(data.sessionKey, data.runId);

      const completed = data.status === 'completed';
      const workflowName = execution?.templateName || data.workflowId || t('workflow.defaultName');
      const actionLabel = completed
        ? t('workflow.notificationViewResult')
        : t('workflow.notificationViewDetails');
      const show = completed ? toast.success : toast.error;
      show(completed ? t('workflow.notificationCompleted', { workflowName }) : t('workflow.notificationFailed', { workflowName }), {
        description: completed ? t('workflow.notificationCompletedDescription') : (data.error || t('workflow.notificationFailedDescription')),
        action: { label: actionLabel, onClick: () => openResult(data.sessionKey, data.runId) },
      });
    };

    const unsubscribeStatus = window.electron.ipcRenderer.on('workflow:status-update', onStatus);
    const unsubscribeOpen = window.electron.ipcRenderer.on('workflow:completion-open', onCompletionOpen);
    return () => {
      if (typeof unsubscribeStatus === 'function') unsubscribeStatus();
      if (typeof unsubscribeOpen === 'function') unsubscribeOpen();
    };
  }, [location.pathname, navigate, t]);

  return null;
}
