/**
 * Workflow Send Hook
 *
 * Aligned with Agent Workflow Client API v1.
 *
 * Flow:
 * 1. Fetch startup schema for the selected template
 * 2. Inject schema description into the user message context
 * 3. Send the enhanced message via Gateway chat.send
 * 4. The AI model reads the schema and guides the user to fill parameters
 *    naturally within the conversation
 * 5. When parameters are collected, the workflow is created & started
 */
import { toast } from 'sonner';
import {
  getStartupSchema,
  createWorkflow,
  startWorkflow,
} from '@/lib/workflow-api';
import { invokeIpc } from '@/lib/api-client';
import { canStartWorkflow, useWorkflowsStore } from '@/stores/workflows';
import { useChatStore } from '@/stores/chat';
import { saveWorkflowRecord, updateWorkflowRunMetadata } from '@/stores/workflow-memory';
import type { WorkflowSchema, WorkflowSchemaField } from '@/types/workflow';

export interface WorkflowSendContext {
  sessionKey: string;
  agentId: string;
}

/** Cached startup schema per template */
const schemaCache = new Map<string, { schema: WorkflowSchema; schemaHash: string }>();

/**
 * Phase 1: Send the user's message with workflow schema context so the AI
 * can guide parameter confirmation naturally. Does NOT create the workflow yet.
 */
export async function sendWithWorkflow(
  text: string,
  templateId: string,
  _context: WorkflowSendContext,
  sendMessage: (text: string, runId?: string | null, workflowId?: string | null, workflowContext?: unknown) => Promise<void>,
): Promise<boolean> {
  if (!canStartWorkflow()) {
    toast.error('当前会话已有过多执行中的工作流，请等待完成后再试');
    return false;
  }

  try {
    // 1. Fetch startup schema (use cache if available)
    let cached = schemaCache.get(templateId);
    if (!cached) {
      const startup = await getStartupSchema(templateId);
      cached = { schema: startup.schema, schemaHash: startup.schemaHash };
      schemaCache.set(templateId, cached);
    }

    const { schema, schemaHash } = cached;

    // 2. Get template name from store
    const templateName = useWorkflowsStore.getState().templates.find((t) => t.id === templateId)?.label ?? templateId;

    // 3. Build hidden workflow context for AI guidance
    const { buildWorkflowContextSummary } = await import('@/lib/workflow-form-utils');
    const workflowContext = buildWorkflowContextSummary(templateId, templateName, schemaHash, schema);

    // 4. Set pending workflow so subsequent user replies are interpreted as parameter input
    useChatStore.getState().setPendingWorkflow({
      templateId,
      templateName,
      schema,
      schemaHash,
      collectedInputs: {},
    });

    // 5. Send user message to Gateway with hidden workflow context.
    //    The AI will receive the context and generate natural language guidance.
    await sendMessage(text, null, null, workflowContext);

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`工作流准备失败: ${message}`);
    return false;
  }
}

/**
 * Phase 2: Create and start the workflow after parameters have been collected.
 * Handles both form submission and natural language parameter confirmation paths.
 */
export async function createAndStartWorkflowDirect(
  templateId: string,
  inputs: Record<string, unknown>,
  context: WorkflowSendContext,
  _sendMessage: (text: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
  _originalText: string,
): Promise<boolean> {
  if (!canStartWorkflow()) {
    toast.error('当前会话已有过多执行中的工作流，请等待完成后再试');
    return false;
  }

  try {
    // 1. Fetch startup schema (use cache if available)
    let cached = schemaCache.get(templateId);
    if (!cached) {
      const startup = await getStartupSchema(templateId);
      cached = { schema: startup.schema, schemaHash: startup.schemaHash };
      schemaCache.set(templateId, cached);
    }

    const { schemaHash } = cached;

    const { buildStartupPreset } = await import('@/lib/workflow-form-utils');

    const created = await createWorkflow({
      templateId,
      startup: buildStartupPreset(inputs, schemaHash),
      idempotencyKey: `create-wf-${templateId}-${Date.now()}`,
    });

    const templateName = useWorkflowsStore.getState().templates.find((t) => t.id === templateId)?.label ?? templateId;

    // Persist to local memory for later recovery (e.g. "帮我执行" next day)
    saveWorkflowRecord(context.sessionKey, {
      workflowId: created.workflowId,
      templateId,
      templateName,
      schemaHash,
      collectedInputs: inputs,
      createdAt: Date.now(),
    });

    const run = await startWorkflow(created.workflowId, {
      inputs,
      idempotencyKey: `start-wf-${created.workflowId}-${Date.now()}`,
    });

    // Insert assistant message with workflow_card locally
    const chatStore = useChatStore;
    const now = Date.now() / 1000;
    chatStore.setState((s) => ({
      messages: [
        ...s.messages,
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '参数已确认，正在分析并执行工作流...' },
            { type: 'workflow_card', runId: run.id, templateName },
          ],
          timestamp: now,
          id: crypto.randomUUID(),
        } as import('@/stores/chat').RawMessage,
      ],
    }));

    await invokeIpc('workflow:startTracking', {
      runId: run.id,
      workflowId: created.workflowId,
      sessionKey: context.sessionKey,
      agentId: context.agentId,
    });

    // Clear pending state
    useChatStore.getState().clearPendingWorkflow();

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[createAndStartWorkflowDirect] error', err);
    toast.error(`工作流启动失败: ${message}`);
    return false;
  }
}

/**
 * Start an already-created workflow (used for re-execution from memory).
 */
export async function startExistingWorkflow(
  workflowId: string,
  inputs: Record<string, unknown>,
  context: WorkflowSendContext,
  sendMessage: (text: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
  originalText: string,
  _templateName?: string,
): Promise<boolean> {
  if (!canStartWorkflow()) {
    toast.error('当前会话已有过多执行中的工作流，请等待完成后再试');
    return false;
  }

  try {
    const run = await startWorkflow(workflowId, {
      inputs,
      idempotencyKey: `start-wf-${workflowId}-${Date.now()}`,
    });

    await sendMessage(originalText, run.id, workflowId);

    await invokeIpc('workflow:startTracking', {
      runId: run.id,
      workflowId,
      sessionKey: context.sessionKey,
      agentId: context.agentId,
    });

    // Update memory with latest run metadata
    updateWorkflowRunMetadata(context.sessionKey, workflowId, {
      lastRunId: run.id,
      lastStatus: 'running',
    });

    // Clear pending state
    useChatStore.getState().clearPendingWorkflow();

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[startExistingWorkflow] error', err);
    toast.error(`工作流启动失败: ${message}`);
    return false;
  }
}

/**
 * Extract a field value from user text using extractPattern or option matching.
 */
function extractFieldValue(text: string, field: WorkflowSchemaField): unknown | undefined {
  if (!text) return undefined;

  // 1. Try extractPattern first
  if (field.extractable && field.extractPattern) {
    try {
      const match = text.match(new RegExp(field.extractPattern));
      if (match) {
        return match[1] ?? match[0];
      }
    } catch {
      // Invalid regex, ignore
    }
  }

  // 2. Fallback: option matching for select fields
  if (field.component === 'single_select' && field.options) {
    for (const opt of field.options) {
      if (text.includes(opt.value) || text.includes(opt.label)) {
        return opt.value;
      }
    }
  } else if (field.component === 'multi_select' && field.options) {
    const values: string[] = [];
    for (const opt of field.options) {
      if (text.includes(opt.value) || text.includes(opt.label)) {
        values.push(opt.value);
      }
    }
    if (values.length > 0) {
      return values;
    }
  } else if (field.component === 'editable_list') {
    const items = text.split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean);
    if (items.length > 0) {
      return items;
    }
  }

  return undefined;
}

/**
 * Scan message history to backfill missing parameters.
 */
function extractInputsFromHistory(
  fields: WorkflowSchemaField[],
  messages: Array<{ role?: string; content?: unknown }>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const inputs = { ...existing };
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = (msg.content as Array<{ type?: string; text?: string }>)
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
        .join('\n');
    }
    if (!text) continue;
    for (const field of fields) {
      if (inputs[field.key] !== undefined) continue;
      const value = extractFieldValue(text, field);
      if (value !== undefined) {
        inputs[field.key] = value;
      }
    }
  }
  return inputs;
}

/**
 * Try to resolve a pending workflow when the user sends a confirmation message.
 * Returns `true` if the message was handled as a workflow confirmation and
 * should not be sent through the normal chat flow.
 */
export async function tryResolvePendingWorkflow(
  text: string,
  sendMessage: (msg: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
): Promise<boolean> {
  const chatState = useChatStore.getState();
  let pending = chatState.pendingWorkflow;

  // Memory-based recovery for re-execution intents like "执行刚才的" / "再跑一遍"
  if (!pending) {
    const { isReExecutionIntent } = await import('@/hooks/use-workflow-intent');
    if (isReExecutionIntent(text)) {
      const { getLatestWorkflow } = await import('@/stores/workflow-memory');
      const latest = getLatestWorkflow(chatState.currentSessionKey);
      if (latest) {
        // Check for expired memory (30 days)
        const ageMs = Date.now() - latest.createdAt;
        const RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
        if (ageMs > RECORD_TTL_MS) {
          toast.info('之前的工作流记录已过期（超过30天），请重新创建工作流');
          return false;
        }

        // Fetch the latest startup schema so parameter extraction / override works
        let restoredSchema: WorkflowSchema = { fields: [], steps: [], nodeId: '', enabled: false };
        let restoredSchemaHash = latest.schemaHash;
        try {
          const startup = await getStartupSchema(latest.templateId);
          restoredSchema = startup.schema;
          restoredSchemaHash = startup.schemaHash;
          schemaCache.set(latest.templateId, { schema: startup.schema, schemaHash: startup.schemaHash });
        } catch (err) {
          console.warn('[tryResolvePendingWorkflow] failed to fetch schema for remembered workflow:', err);
          toast.info('无法加载之前工作流的参数模板，将使用已保存的参数直接执行');
        }

        pending = {
          templateId: latest.templateId,
          templateName: latest.templateName,
          schemaHash: restoredSchemaHash,
          workflowId: latest.workflowId,
          collectedInputs: { ...(latest.collectedInputs ?? {}) },
          schema: restoredSchema,
        };
        chatState.setPendingWorkflow(pending);
      } else {
        toast.info('未找到可重新执行的工作流记录');
        return false;
      }
    }
  }

  if (!pending) return false;

  // Detect cancellation first
  const { isWorkflowCancelIntent } = await import('@/hooks/use-workflow-intent');
  if (isWorkflowCancelIntent(text)) {
    chatState.clearPendingWorkflow();
    return false; // let the message fall through to normal chat
  }

  // Detect confirmation / execution intent
  const isConfirmIntent = /(?:确认|执行|开始|帮我执行|启动|运行|好|是的|可以|行|没问题|提交|保存)/i.test(text);
  const isShortReply = text.length <= 10;

  // For re-execution from memory, attempt to extract parameter overrides from natural language
  let inputs: Record<string, unknown> = { ...(pending.collectedInputs ?? {}) };
  const hasSchemaFields = pending.schema.fields.length > 0;

  if (hasSchemaFields) {
    for (const field of pending.schema.fields) {
      const value = extractFieldValue(text, field);
      if (value !== undefined) {
        inputs[field.key] = value;
      }
    }
  }

  // If pending has a workflowId (from memory re-execution) and user confirms, execute directly
  if (pending.workflowId && (isConfirmIntent || isShortReply)) {
    // If we don't have schema fields but need to extract overrides, there's nothing to override;
    // just run with saved inputs.
    const ok = await startExistingWorkflow(
      pending.workflowId,
      inputs,
      { sessionKey: chatState.currentSessionKey, agentId: chatState.currentAgentId },
      sendMessage,
      text,
      pending.templateName,
    );
    return ok;
  }

  if (!hasSchemaFields) {
    // Restored from memory but no schema loaded yet, and user didn't confirm — fall through
    return false;
  }

  // Normal flow: parameter collection and execution
  const requiredFields = pending.schema.fields.filter((f) => f.required);
  let allRequiredFilled = requiredFields.every((f) => {
    if (inputs[f.key] !== undefined) return true;
    if (f.defaultValue !== undefined) return true;
    return false;
  });

  // If confirm intent (or short reply) but still missing params, try backfill from history
  if ((isConfirmIntent || isShortReply) && !allRequiredFilled) {
    const messages = chatState.messages;
    inputs = extractInputsFromHistory(pending.schema.fields, messages, inputs);
    allRequiredFilled = requiredFields.every((f) => {
      if (inputs[f.key] !== undefined) return true;
      if (f.defaultValue !== undefined) return true;
      return false;
    });
  }

  // Persist updated collected inputs
  useChatStore.getState().setPendingWorkflow({
    ...pending,
    collectedInputs: inputs,
  });

  const shouldExecute = allRequiredFilled && (isConfirmIntent || isShortReply);

  if (shouldExecute) {
    const mergedInputs = { ...inputs };
    for (const field of pending.schema.fields) {
      if (mergedInputs[field.key] === undefined && field.defaultValue !== undefined) {
        mergedInputs[field.key] = field.defaultValue;
      }
    }

    const ok = await createAndStartWorkflowDirect(
      pending.templateId,
      mergedInputs,
      { sessionKey: chatState.currentSessionKey, agentId: chatState.currentAgentId },
      sendMessage,
      text,
    );
    return ok;
  }

  // Not ready to execute yet: if we extracted any values, update the form by re-inserting
  // an assistant message with guidance + parameter_form. This gives the user feedback
  // on what was understood and what remains.
  if (hasSchemaFields) {
    const extractedAny = Object.keys(inputs).some((k) => inputs[k] !== pending?.collectedInputs?.[k]);
    if (extractedAny) {
      const { buildWorkflowFormConfig } = await import('@/lib/workflow-form-utils');
      const formConfig = buildWorkflowFormConfig(pending.schema, text, inputs);
      const formId = `workflow-form-${pending.templateId}-${Date.now()}`;
      const now = Date.now() / 1000;
      const { registerParameterFormHandler } = await import('@/components/parameter-form/form-handlers');
      useChatStore.setState((s) => ({
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content: [
              { type: 'text', text: `已识别到部分参数，请继续确认或补充剩余参数：` },
              {
                type: 'parameter_form',
                formId,
                formConfig,
                formContext: { source: 'workflow', sourceId: pending.templateId, schemaHash: pending.schemaHash },
              },
            ],
            timestamp: now,
            id: crypto.randomUUID(),
          } as import('@/stores/chat').RawMessage,
        ],
      }));
      registerParameterFormHandler(formId, async (values) => {
        const ok = await createAndStartWorkflowDirect(
          pending.templateId,
          values,
          { sessionKey: chatState.currentSessionKey, agentId: chatState.currentAgentId },
          sendMessage,
          text,
        );
        if (!ok) {
          console.error('[tryResolvePendingWorkflow] handler failed to start workflow');
        }
      });
      return true;
    }
  }

  return false;
}
