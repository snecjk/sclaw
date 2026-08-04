import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router-dom';
import { openWorkflowResult } from '@/lib/workflow-result-navigation';
import { getRunViaIpc, runToExecutionState } from '@/lib/workflow-api';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { getExecutionByRunId, markCompletionNotificationDelivered } from '@/stores/workflow-memory';
import type { WorkflowRunResponse, WorkflowRunStatus } from '@/types/workflow';
import { TestRunDrawer } from '@/pages/WorkflowDesigner/components/test-run-drawer';

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
  const [detail, setDetail] = useState<{
    open: boolean;
    runId: string | null;
    sessionKey: string;
    workflowName: string | null;
    run: WorkflowRunResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    open: false,
    runId: null,
    sessionKey: '',
    workflowName: null,
    run: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (location.pathname === '/sprite' || location.pathname === '/float-icon') return undefined;
    const openDetails = async (sessionKey: string, runId: string, workflowName?: string) => {
      setDetail({
        open: true,
        runId,
        sessionKey,
        workflowName: workflowName ?? null,
        run: null,
        loading: true,
        error: null,
      });
      try {
        const run = await getRunViaIpc(runId, 'detail');
        setDetail((current) => current.runId === runId ? {
          ...current,
          workflowName: current.workflowName ?? run?.workflowId ?? null,
          run,
          loading: false,
          error: run ? null : t('workflow.notificationRunNotFound'),
        } : current);
      } catch (error) {
        setDetail((current) => current.runId === runId ? {
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : t('workflow.notificationRunLoadFailed'),
        } : current);
      }
    };
    const onCompletionOpen = (payload: unknown) => {
      const data = payload as { sessionKey?: string; runId?: string };
      if (data.sessionKey && data.runId) void openDetails(data.sessionKey, data.runId);
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
        action: { label: actionLabel, onClick: () => void openDetails(data.sessionKey, data.runId, workflowName) },
      });
    };

    const unsubscribeStatus = window.electron.ipcRenderer.on('workflow:status-update', onStatus);
    const unsubscribeOpen = window.electron.ipcRenderer.on('workflow:completion-open', onCompletionOpen);
    return () => {
      if (typeof unsubscribeStatus === 'function') unsubscribeStatus();
      if (typeof unsubscribeOpen === 'function') unsubscribeOpen();
    };
  }, [location.pathname, navigate, t]);

  const canReturnToConversation = detail.run?.triggerType === 'chat' && Boolean(detail.sessionKey);
  const executionState = detail.run ? runToExecutionState(detail.run) : null;

  return (
    <TestRunDrawer
      variant="detail"
      open={detail.open}
      workflowName={detail.workflowName}
      runId={detail.runId}
      run={detail.run}
      executionState={executionState}
      workflowVersion={detail.run?.workflowVersion}
      isStarting={detail.loading}
      isCancelling={false}
      isRunActive={false}
      isDraftSnapshot={false}
      launchError={detail.error}
      onClose={() => setDetail((current) => ({ ...current, open: false }))}
      onReturnToConversation={canReturnToConversation ? () => {
        setDetail((current) => ({ ...current, open: false }));
        navigate('/');
        openWorkflowResult(detail.sessionKey, detail.runId!);
      } : undefined}
      returnToConversationLabel={t('workflow.notificationBackToConversation')}
    />
  );
}
