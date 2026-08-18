/**
 * Single entry for STO builtin OpenClaw tool results.
 * Gateway tool_result messages are filtered from chat UI and dispatched from canonical runtime effects.
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

const MAX_PROCESSED_TOOL_RESULTS = 2_000;
const processedToolResults = new Map<string, true>();

function messageDedupeKey(msg: BuiltinToolResultMessage): string | null {
  return msg.id || msg.toolCallId || null;
}

function stableSerialize(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(',')}}`;
}

function envelopeRevision(value: unknown): string {
  const input = stableSerialize(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function rememberProcessedResult(key: string): void {
  processedToolResults.delete(key);
  processedToolResults.set(key, true);
  while (processedToolResults.size > MAX_PROCESSED_TOOL_RESULTS) {
    const oldest = processedToolResults.keys().next().value as string | undefined;
    if (!oldest) break;
    processedToolResults.delete(oldest);
  }
}

function handleWorkflowSchemaReady(data: WorkflowSchemaReadyData, ctx: BuiltinToolDispatchContext): boolean {
  if (!data.templateId || !data.schemaHash || !data.schema) return false;
  applyWorkflowSchemaReady(data, ctx.sessionKey);
  return true;
}

function handleWorkflowCreated(data: WorkflowCreatedData, ctx: BuiltinToolDispatchContext): boolean {
  if (!data.workflowId || !data.templateId) return false;
  saveWorkflowRecord(ctx.sessionKey, {
    workflowId: data.workflowId,
    templateId: data.templateId,
    templateName: data.workflowName ?? data.templateId,
    schemaHash: data.schemaHash,
    collectedInputs: data.values ?? {},
    createdAt: Date.now(),
  });
  return true;
}

async function handleWorkflowExecutionStarted(
  data: WorkflowExecutionStartedData,
  ctx: BuiltinToolDispatchContext,
): Promise<boolean> {
  if (!data.runId || !data.workflowId) {
    toast.error('工作流执行结果缺少 runId 或 workflowId');
    return false;
  }

  return applyWorkflowRunStarted({
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
  const resolvedCtx = resolveDispatchContext(ctx);
  const envelope = parseStoToolEnvelope(msg.content) ?? parseStoToolEnvelope(msg);
  if (!envelope?.success) return false;
  const recognized = [
    'workflow_schema_ready',
    'workflow_created',
    'workflow_execution_started',
    'workflow_run_status',
    'dingtalk_share_picker_opened',
  ].includes(envelope.type);
  if (!recognized) return false;
  const rawDedupeKey = messageDedupeKey(msg);
  const dedupeKey = rawDedupeKey
    ? `${resolvedCtx.sessionKey}:${rawDedupeKey}:${envelope.type}:${envelopeRevision(envelope.data)}`
    : null;
  if (dedupeKey && processedToolResults.has(dedupeKey)) return false;

  let handled = false;

  if (envelope.type === 'workflow_schema_ready') {
    handled = handleWorkflowSchemaReady((envelope.data ?? {}) as WorkflowSchemaReadyData, resolvedCtx);
  }

  if (envelope.type === 'workflow_created') {
    handled = handleWorkflowCreated((envelope.data ?? {}) as WorkflowCreatedData, resolvedCtx);
  }

  if (envelope.type === 'workflow_execution_started') {
    handled = await handleWorkflowExecutionStarted(
      (envelope.data ?? {}) as WorkflowExecutionStartedData,
      resolvedCtx,
    );
  }

  if (envelope.type === 'workflow_run_status') {
    handleWorkflowRunStatus(
      (envelope.data ?? {}) as WorkflowRunStatusData,
      resolvedCtx,
    );
    handled = true;
  }

  if (envelope.type === 'dingtalk_share_picker_opened') {
    toast.success(envelope.message ?? '已请求打开钉钉；如未登录，请先完成登录后继续选择发送对象');
    handled = true;
  }

  if (handled && dedupeKey) rememberProcessedResult(dedupeKey);
  return handled;
}

/** Test helper */
export function resetBuiltinToolDispatchDedupe(): void {
  processedToolResults.clear();
}
