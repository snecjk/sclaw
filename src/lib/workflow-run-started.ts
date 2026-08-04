/**
 * Shared post-start UI for workflow runs (frontend API path or builtin tool result).
 */
import { toast } from 'sonner';
import { canStartWorkflow } from '@/stores/workflows';
import { useChatStore } from '@/stores/chat';
import {
  getSessionWorkflows,
  saveWorkflowExecution,
  updateWorkflowRunMetadata,
} from '@/stores/workflow-memory';
import { appendWorkflowSessionRecord } from '@/lib/workflow-session-record-client';

export type WorkflowRunPresentation = 'local_turn' | 'patch_assistant';

export interface ApplyWorkflowRunStartedOptions {
  sessionKey: string;
  agentId: string;
  workflowId: string;
  runId: string;
  templateName: string;
  inputs?: Record<string, unknown>;
  userText?: string;
  assistantText?: string;
  /** patch_assistant: attach card to model reply; local_turn: client-only turn (form submit). */
  presentation?: WorkflowRunPresentation;
  /** 钉定版本，落 WorkflowExecutionRecord.versionId（仅 startWorkflowLocal 路径可得）。 */
  versionId?: string | number;
}

/** After POST /workflows/{id}/start — card, tracker, memory (no Gateway send). */
export async function applyWorkflowRunStarted(
  options: ApplyWorkflowRunStartedOptions,
): Promise<boolean> {
  const {
    sessionKey,
    workflowId,
    runId,
    templateName,
    inputs = {},
    userText,
    presentation = 'local_turn',
    versionId,
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

  const startedAtMs = Date.now();

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
    createdAt: startedAtMs,
    updatedAt: startedAtMs,
    collectedInputs: inputs,
    paramsSummary: resolvedUserText,
    versionId,
  });

  if (presentation === 'local_turn' && wfRecord?.templateId) {
    appendWorkflowSessionRecord({
      phase: 'started',
      sessionKey,
      templateId: wfRecord.templateId,
      templateName,
      workflowId,
      runId,
      status: 'running',
      paramsSummary: resolvedUserText,
      collectedInputs: inputs,
    });
  }

  useChatStore.getState().clearPendingWorkflow(sessionKey);

  return true;
}
