/**
 * Single entry for STO builtin OpenClaw tool results.
 * Gateway tool_result messages are filtered from chat UI — dispatch from handleChatEvent.
 */
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
import {
  applyWorkflowSchemaReady,
} from '@/stores/chat/parameter-form-recovery';
import { saveWorkflowRecord } from '@/stores/workflow-memory';

export interface BuiltinToolResultMessage {
  id?: string;
  toolCallId?: string;
  toolName?: string;
  content?: unknown;
}

export type ScheduledTaskConfirmationValues = {
  name: string;
  message?: string;
  schedule: string;
};

let scheduledTaskConfirmationHandler: ((values: ScheduledTaskConfirmationValues) => void) | undefined;

/** Registered by useBuiltinToolListener (Home NL scheduled-task modal). */
export function registerScheduledTaskConfirmationHandler(
  handler: ((values: ScheduledTaskConfirmationValues) => void) | undefined,
): void {
  scheduledTaskConfirmationHandler = handler;
}

const processedToolResults = new Set<string>();

function messageDedupeKey(msg: BuiltinToolResultMessage): string | null {
  return msg.id || msg.toolCallId || null;
}

function handleWorkflowSchemaReady(data: WorkflowSchemaReadyData): void {
  applyWorkflowSchemaReady(data);
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
  
}

async function handleWorkflowExecutionStarted(
  data: WorkflowExecutionStartedData,
): Promise<void> {
  const chatState = useChatStore.getState();
  if (!data.runId || !data.workflowId) {
    toast.error('工作流执行结果缺少 runId 或 workflowId');
    return;
  }
  
  await applyWorkflowRunStarted({
    sessionKey: chatState.currentSessionKey,
    agentId: chatState.currentAgentId,
    workflowId: data.workflowId,
    runId: data.runId,
    templateName: data.templateName ?? '工作流',
    presentation: 'patch_assistant',
  });
}

/** Parse legacy scheduled_task_confirmation envelope for UI callback. */
function parseScheduledTaskConfirmation(content: unknown): {
  name: string;
  message?: string;
  schedule: string;
} | null {
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

/**
 * Process a Gateway tool_result final message (workflow + scheduled task).
 * Returns true when the result was handled (workflow envelope or scheduled task).
 */
export async function dispatchBuiltinToolResult(
  msg: BuiltinToolResultMessage,
): Promise<boolean> {
  const dedupeKey = messageDedupeKey(msg);
  if (dedupeKey) {
    if (processedToolResults.has(dedupeKey)) return false;
    processedToolResults.add(dedupeKey);
  }

  const envelope = parseStoToolEnvelope(msg.content);

  if (envelope?.type === 'workflow_schema_ready' && envelope.success) {
    handleWorkflowSchemaReady((envelope.data ?? {}) as WorkflowSchemaReadyData);
    return true;
  }

  if (envelope?.type === 'workflow_created' && envelope.success) {
    handleWorkflowCreated((envelope.data ?? {}) as WorkflowCreatedData);
    return true;
  }

  if (envelope?.type === 'workflow_execution_started' && envelope.success) {
    await handleWorkflowExecutionStarted(
      (envelope.data ?? {}) as WorkflowExecutionStartedData,
    );
    return true;
  }

  if (
    msg.toolName === 'create_scheduled_task'
    || envelope?.type === 'scheduled_task_confirmation'
  ) {
    const values = parseScheduledTaskConfirmation(msg.content);
    if (values && scheduledTaskConfirmationHandler) {
      scheduledTaskConfirmationHandler(values);
      return true;
    }
  }

  return false;
}

/** Test helper */
export function resetBuiltinToolDispatchDedupe(): void {
  processedToolResults.clear();
}
