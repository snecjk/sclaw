/**
 * Shared post-start UI for workflow runs (frontend API path or builtin tool result).
 */
import { toast } from 'sonner';
import { invokeIpc } from '@/lib/api-client';
import { beginWorkflowRunSseTrace } from '@/lib/workflow-api';
import { appendWorkflowStartedLocalTurn } from '@/lib/workflow-local-turn';
import { canStartWorkflow } from '@/stores/workflows';
import { useChatStore } from '@/stores/chat';
import {
  getSessionWorkflows,
  saveWorkflowExecution,
  updateWorkflowRunMetadata,
} from '@/stores/workflow-memory';

export interface ApplyWorkflowRunStartedOptions {
  sessionKey: string;
  agentId: string;
  workflowId: string;
  runId: string;
  templateName: string;
  inputs?: Record<string, unknown>;
  userText?: string;
  assistantText?: string;
}

/** After POST /workflows/{id}/start — card, tracker, memory (no Gateway send). */
export async function applyWorkflowRunStarted(
  options: ApplyWorkflowRunStartedOptions,
): Promise<boolean> {
  const {
    sessionKey,
    agentId,
    workflowId,
    runId,
    templateName,
    inputs = {},
    userText,
    assistantText,
  } = options;

  if (!canStartWorkflow()) {
    toast.error('当前会话已有过多执行中的工作流，请等待完成后再试');
    return false;
  }

  const wfRecord = getSessionWorkflows(sessionKey).find((w) => w.workflowId === workflowId);
  let resolvedUserText = userText;
  if (!resolvedUserText) {
    if (wfRecord?.templateId) {
      const { buildWorkflowParamsSummary } = await import('@/lib/workflow-form-utils');
      resolvedUserText = await buildWorkflowParamsSummary(wfRecord.templateId, inputs);
    } else {
      resolvedUserText = `启动工作流「${templateName}」`;
    }
  }

  appendWorkflowStartedLocalTurn({
    userText: resolvedUserText,
    templateName,
    runId,
    assistantText: assistantText ?? `正在启动工作流「${templateName}」…`,
  });

  await invokeIpc('workflow:startTracking', {
    runId,
    workflowId,
    sessionKey,
    agentId,
  });
  beginWorkflowRunSseTrace(runId);

  updateWorkflowRunMetadata(sessionKey, workflowId, {
    lastRunId: runId,
    lastStatus: 'running',
  });

  saveWorkflowExecution({
    sessionKey,
    workflowId,
    runId,
    templateId: wfRecord?.templateId ?? '',
    templateName,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    collectedInputs: inputs,
    paramsSummary: resolvedUserText,
  });

  const chatStore = useChatStore.getState();
  chatStore.setWorkflowCardState(runId, {
    runId,
    workflowId,
    status: 'running',
    progress: 0,
    steps: [],
    startedAt: new Date().toISOString(),
  });
  chatStore.clearPendingWorkflow();

  return true;
}
