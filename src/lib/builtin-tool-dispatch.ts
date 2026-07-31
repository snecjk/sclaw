/**
 * Single entry for STO builtin OpenClaw tool results.
 * Gateway tool_result messages are filtered from chat UI — dispatch from handleChatEvent.
 */
import { toast } from 'sonner';
import {
  parseStoToolEnvelope,
  type WorkflowCreatedData,
  type WorkflowExecutionStartedData,
  type WorkflowRunStatusData,
  type WorkflowSchemaReadyData,
} from '@/lib/builtin-tool-envelope';
import { applyWorkflowRunStarted } from '@/lib/workflow-run-started';
import { useChatStore } from '@/stores/chat';
import {
  applyWorkflowSchemaReady,
} from '@/stores/chat/parameter-form-recovery';
import {
  saveWorkflowRecord,
} from '@/stores/workflow-memory';

export interface BuiltinToolResultMessage {
  id?: string;
  toolCallId?: string;
  toolName?: string;
  content?: unknown;
}

/** Session that produced the tool result (cron / background runs must not use currentSessionKey). */
export interface BuiltinToolDispatchContext {
  sessionKey: string;
  agentId: string;
}

function resolveDispatchContext(ctx?: BuiltinToolDispatchContext): BuiltinToolDispatchContext {
  const chatState = useChatStore.getState();
  return {
    sessionKey: ctx?.sessionKey ?? chatState.currentSessionKey,
    agentId: ctx?.agentId ?? chatState.currentAgentId,
  };
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
  ctx: BuiltinToolDispatchContext,
): Promise<void> {
  if (!data.runId || !data.workflowId) {
    toast.error('工作流执行结果缺少 runId 或 workflowId');
    return;
  }

  await applyWorkflowRunStarted({
    sessionKey: ctx.sessionKey,
    agentId: ctx.agentId,
    workflowId: data.workflowId,
    runId: data.runId,
    templateName: data.templateName ?? '工作流',
    presentation: 'patch_assistant',
    versionId: data.versionId ?? data.workflowVersionId,
  });
}

/** Status queries remain ordinary tool/model responses and never own a card. */
function handleWorkflowRunStatus(
  data: WorkflowRunStatusData,
  ctx: BuiltinToolDispatchContext,
): void {
  // A status query remains a normal tool/model response. It must not create,
  // move, or update a chat progress card in the querying session.
  void data;
  void ctx;
}

/**
 * Process a Gateway tool_result final message (workflow envelopes).
 * Returns true when the result was handled (workflow envelope).
 */
export async function dispatchBuiltinToolResult(
  msg: BuiltinToolResultMessage,
  ctx?: BuiltinToolDispatchContext,
): Promise<boolean> {
  const dedupeKey = messageDedupeKey(msg);
  if (dedupeKey) {
    if (processedToolResults.has(dedupeKey)) return false;
    processedToolResults.add(dedupeKey);
  }

  const resolvedCtx = resolveDispatchContext(ctx);
  const envelope = parseStoToolEnvelope(msg.content) ?? parseStoToolEnvelope(msg);

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
      resolvedCtx,
    );
    return true;
  }

  if (envelope?.type === 'workflow_run_status' && envelope.success) {
    handleWorkflowRunStatus(
      (envelope.data ?? {}) as WorkflowRunStatusData,
      resolvedCtx,
    );
    return true;
  }

  if (envelope?.type === 'dingtalk_share_picker_opened' && envelope.success) {
    toast.success(envelope.message ?? '已请求打开钉钉；如未登录，请先完成登录后继续选择发送对象');
    return true;
  }

  return false;
}

/** Test helper */
export function resetBuiltinToolDispatchDedupe(): void {
  processedToolResults.clear();
}
