/**
 * Single entry for STO builtin OpenClaw tool results.
 * Gateway tool_result messages are filtered from chat UI — dispatch from handleChatEvent.
 */
import { toast } from 'sonner';
import {
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
import {
  ensureWorkflowCardsInMessages,
  getAssistantMessageText,
  messageHasWorkflowCardForRun,
} from '@/lib/workflow-card-injection';
import type { RawMessage } from '@/stores/chat/types';
import { isToolResultRole } from '@/stores/chat/helpers';
import { getExecutionByRunId, saveWorkflowRecord } from '@/stores/workflow-memory';

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

/** Patch visible messages when the target session is active. */
export function syncWorkflowCardsAfterToolDispatch(sessionKey: string): void {
  const chatState = useChatStore.getState();
  if (chatState.currentSessionKey !== sessionKey) return;
  const patched = ensureWorkflowCardsInMessages(
    chatState.messages,
    sessionKey,
    getAssistantMessageText,
  );
  if (patched !== chatState.messages) {
    useChatStore.setState({ messages: patched });
  }
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
    syncWorkflowCardsAfterToolDispatch(resolvedCtx.sessionKey);
    return true;
  }

  if (envelope?.type === 'dingtalk_share_picker_opened' && envelope.success) {
    toast.success(envelope.message ?? '已唤起钉钉选人发送页面');
    return true;
  }

  return false;
}

/**
 * Recover workflow runs from gateway history tool_result rows (filtered from chat UI).
 * Live streaming may not invoke dispatchBuiltinToolResult before the model's text reply.
 */
export async function absorbWorkflowExecutionStartedFromToolResults(
  rawMessages: RawMessage[],
  ctx: { sessionKey: string; agentId: string },
): Promise<void> {
  for (let i = rawMessages.length - 1; i >= 0; i -= 1) {
    const msg = rawMessages[i];
    if (!isToolResultRole(msg.role)) continue;

    const envelope = parseStoToolEnvelope(msg.content)
      ?? parseStoToolEnvelope(msg);
    if (envelope?.type !== 'workflow_execution_started' || !envelope.success) continue;

    const data = (envelope.data ?? {}) as WorkflowExecutionStartedData;
    if (!data.runId || !data.workflowId) continue;

    const chatState = useChatStore.getState();
    const alreadyTracked = Boolean(
      getExecutionByRunId(data.runId, ctx.sessionKey)
      || chatState.workflowCardStates[data.runId],
    );

    if (!alreadyTracked) {
      await applyWorkflowRunStarted({
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
        workflowId: data.workflowId,
        runId: data.runId,
        templateName: data.templateName ?? '工作流',
        presentation: 'patch_assistant',
        versionId: data.versionId ?? data.workflowVersionId,
      });
      return;
    }

    if (chatState.currentSessionKey === ctx.sessionKey) {
      const hasCard = chatState.messages.some((m) => messageHasWorkflowCardForRun(m, data.runId));
      if (!hasCard) {
        syncWorkflowCardsAfterToolDispatch(ctx.sessionKey);
      }
    }
    return;
  }
}

/** Test helper */
export function resetBuiltinToolDispatchDedupe(): void {
  processedToolResults.clear();
}
