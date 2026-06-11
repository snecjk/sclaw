/**
 * Hub for STO builtin OpenClaw tool results (workflow, scheduled task, ...).
 */
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  extractToolResultText,
  parseStoToolEnvelope,
  type WorkflowCreatedData,
  type WorkflowExecutionStartedData,
  type WorkflowSchemaReadyData,
} from '@/lib/builtin-tool-envelope';
import { applyWorkflowRunStarted } from '@/lib/workflow-run-started';
import { useChatStore } from '@/stores/chat';
import { saveWorkflowRecord } from '@/stores/workflow-memory';
import type { NlExtractedValues } from '@/hooks/use-scheduled-task-tool-listener';

export type { NlExtractedValues };

export interface UseBuiltinToolListenerOptions {
  onScheduledTaskConfirmation?: (values: NlExtractedValues) => void;
}

function parseScheduledTaskFromLegacy(content: unknown): NlExtractedValues | null {
  const text = extractToolResultText(content);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as {
      type?: string;
      success?: boolean;
      extractedParams?: { name?: string; cronExpr?: string; description?: string };
    };
    if (parsed.type !== 'scheduled_task_confirmation' || parsed.success === false) return null;
    const params = parsed.extractedParams ?? {};
    if (!params.name || !params.cronExpr) return null;
    return {
      name: params.name,
      message: params.description,
      schedule: params.cronExpr,
    };
  } catch {
    return null;
  }
}

function handleWorkflowSchemaReady(data: WorkflowSchemaReadyData): void {
  if (!data.templateId || !data.schema) return;
  const chatState = useChatStore.getState();
  chatState.setPendingWorkflow({
    templateId: data.templateId,
    templateName: data.templateId,
    schemaHash: data.schemaHash,
    schema: data.schema,
    collectedInputs: {},
    frontendFormInserted: false,
    modelGuidanceSent: true,
  });
  console.log('[builtin-tool] workflow_schema_ready templateId=%s', data.templateId);
}

function handleWorkflowCreated(data: WorkflowCreatedData): void {
  if (!data.workflowId || !data.templateId) return;
  const sessionKey = useChatStore.getState().currentSessionKey;
  saveWorkflowRecord(sessionKey, {
    workflowId: data.workflowId,
    templateId: data.templateId,
    templateName: data.workflowName ?? data.templateId,
    schemaHash: data.schemaHash,
    collectedInputs: data.values ?? {},
    createdAt: Date.now(),
  });
  console.log('[builtin-tool] workflow_created workflowId=%s', data.workflowId);
}

async function handleWorkflowExecutionStarted(
  data: WorkflowExecutionStartedData,
): Promise<void> {
  const chatState = useChatStore.getState();
  if (!data.runId || !data.workflowId) {
    toast.error('工作流执行结果缺少 runId 或 workflowId');
    return;
  }
  console.log(
    '[builtin-tool] workflow_execution_started workflowId=%s runId=%s',
    data.workflowId,
    data.runId,
  );
  await applyWorkflowRunStarted({
    sessionKey: chatState.currentSessionKey,
    agentId: chatState.currentAgentId,
    workflowId: data.workflowId,
    runId: data.runId,
    templateName: data.templateName ?? '工作流',
  });
}

export function useBuiltinToolListener(options: UseBuiltinToolListenerOptions = {}): void {
  const { onScheduledTaskConfirmation } = options;
  const onScheduledTaskRef = useRef(onScheduledTaskConfirmation);
  onScheduledTaskRef.current = onScheduledTaskConfirmation;
  const processedRef = useRef<Set<string>>(new Set());

  const processMessage = useCallback(async (msg: {
    id?: string;
    toolCallId?: string;
    toolName?: string;
    content?: unknown;
  }) => {
    const msgId = msg.id || msg.toolCallId;
    if (msgId && processedRef.current.has(msgId)) return;
    if (msgId) processedRef.current.add(msgId);

    const envelope = parseStoToolEnvelope(msg.content);

    if (envelope?.type === 'workflow_schema_ready' && envelope.success) {
      handleWorkflowSchemaReady((envelope.data ?? {}) as WorkflowSchemaReadyData);
      return;
    }

    if (envelope?.type === 'workflow_created' && envelope.success) {
      handleWorkflowCreated((envelope.data ?? {}) as WorkflowCreatedData);
      return;
    }

    if (envelope?.type === 'workflow_execution_started' && envelope.success) {
      await handleWorkflowExecutionStarted(
        (envelope.data ?? {}) as WorkflowExecutionStartedData,
      );
      return;
    }

    if (
      msg.toolName === 'create_scheduled_task'
      || envelope?.type === 'scheduled_task_confirmation'
    ) {
      const values = parseScheduledTaskFromLegacy(msg.content);
      if (values && onScheduledTaskRef.current) {
        onScheduledTaskRef.current(values);
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribe = useChatStore.subscribe((state) => {
      const messages = state.messages;
      if (!messages?.length) return;

      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'toolresult') continue;
        const toolName = msg.toolName ?? '';
        const envelope = parseStoToolEnvelope(msg.content);
        const isWorkflow = envelope?.type && [
          'workflow_execution_started',
          'workflow_schema_ready',
          'workflow_created',
          'workflow_run_status',
        ].includes(envelope.type);
        const isScheduled =
          toolName === 'create_scheduled_task'
          || envelope?.type === 'scheduled_task_confirmation';
        if (!isWorkflow && !isScheduled) continue;

        void processMessage(msg);
        break;
      }
    });

    return unsubscribe;
  }, [processMessage]);
}
