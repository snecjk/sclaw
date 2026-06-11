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
  beginWorkflowRunSseTrace,
} from '@/lib/workflow-api';
import { invokeIpc } from '@/lib/api-client';
import { canStartWorkflow, useWorkflowsStore } from '@/stores/workflows';
import { useChatStore } from '@/stores/chat';
import { appendWorkflowStartedLocalTurn, buildWorkflowStartUserText } from '@/lib/workflow-local-turn';
import { saveWorkflowRecord, saveWorkflowExecution, updateWorkflowRunMetadata } from '@/stores/workflow-memory';
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
  console.log('[workflow-trace] sendWithWorkflow start templateId=%s text=%s', templateId, text);
  if (!canStartWorkflow()) {
    toast.error('当前会话已有过多执行中的工作流，请等待完成后再试');
    return false;
  }

  try {
    // 1. Fetch startup schema (use cache if available)
    console.log('[workflow-trace] sendWithWorkflow fetching schema templateId=%s', templateId);
    let cached = schemaCache.get(templateId);
    if (cached) {
      console.log(
        '[workflow-trace] sendWithWorkflow schema cache hit templateId=%s fields=%d steps=%d response=%s',
        templateId,
        cached.schema.fields.length,
        cached.schema.steps.length,
        JSON.stringify({ templateId, schemaHash: cached.schemaHash, schema: cached.schema }),
      );
    } else {
      const startup = await getStartupSchema(templateId);
      cached = { schema: startup.schema, schemaHash: startup.schemaHash };
      schemaCache.set(templateId, cached);
    }

    const { schema, schemaHash } = cached;
    console.log('[workflow-trace] sendWithWorkflow schema loaded fields=%d steps=%d', schema.fields.length, schema.steps.length);

    // 2. Get template name from store
    const templateName = useWorkflowsStore.getState().templates.find((t) => t.id === templateId)?.label ?? templateId;

    // 3. Build workflow context for AI model
    const workflowContext: import('@/stores/chat').WorkflowContextBlock = {
      type: 'workflow_context',
      templateId,
      templateName,
      schemaHash,
      fields: schema.fields
        .filter((f) => {
          const step = schema.steps.find((s) => s.id === f.group);
          return f.group === 'confirm' || (step && step.mode === 'confirm');
        })
        .map((f) => ({
          key: f.key,
          label: f.label,
          component: f.component,
          required: f.required,
          options: f.options?.map((o) => ({ value: String(o.value), label: o.label })),
          defaultValue: f.defaultValue,
        })),
    };

    // 4. Set pending workflow state (frontendFormInserted=false so model response triggers form).
    useChatStore.getState().setPendingWorkflow({
      templateId,
      templateName,
      schema,
      schemaHash,
      collectedInputs: {},
      frontendFormInserted: false,
      modelGuidanceSent: false,
    });

    // 5. Send user message to Gateway.
    // The model will process the workflow context and respond.
    // After the model responds, maybeAppendWorkflowParameterForm will inject the form.
    await sendMessage(text, null, null, workflowContext);
    useChatStore.getState().setPendingWorkflow({
      templateId,
      templateName,
      schema,
      schemaHash,
      collectedInputs: {},
      frontendFormInserted: false,
      modelGuidanceSent: true,
    });
    console.log('[workflow-trace] sendWithWorkflow sent message to Gateway, form will appear after model responds');

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[workflow-trace] sendWithWorkflow failed:', message);
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
    console.log(
      '[workflow-trace] createAndStartWorkflowDirect created workflowId=%s templateId=%s',
      created.workflowId,
      templateId,
    );

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

    const { schema } = cached;
    const userText = buildWorkflowStartUserText(schema, inputs);
    appendWorkflowStartedLocalTurn({
      userText,
      templateName,
      runId: run.runId,
    });

    await invokeIpc('workflow:startTracking', {
      runId: run.runId,
      workflowId: created.workflowId,
      sessionKey: context.sessionKey,
      agentId: context.agentId,
    });
    beginWorkflowRunSseTrace(run.runId);

    updateWorkflowRunMetadata(context.sessionKey, created.workflowId, {
      lastRunId: run.runId,
      lastStatus: 'running',
    });

    saveWorkflowExecution({
      sessionKey: context.sessionKey,
      workflowId: created.workflowId,
      runId: run.runId,
      templateId,
      templateName,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      collectedInputs: inputs,
      paramsSummary: userText,
    });

    useChatStore.getState().setWorkflowCardState(run.runId, {
      runId: run.runId,
      workflowId: created.workflowId,
      status: 'running',
      progress: 0,
      steps: [],
      startedAt: new Date().toISOString(),
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
  _sendMessage: (text: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
  originalText: string,
  _templateName?: string,
): Promise<boolean> {
  if (!canStartWorkflow()) {
    toast.error('当前会话已有过多执行中的工作流，请等待完成后再试');
    return false;
  }

  const idempotencyKey = `start-wf-${workflowId}-${Date.now()}`;
  console.log(
    '[workflow-trace] startExistingWorkflow workflowId=%s templateName=%s inputKeys=%o text=%s',
    workflowId,
    _templateName ?? '',
    Object.keys(inputs),
    originalText,
  );

  try {
    const run = await startWorkflow(workflowId, {
      inputs,
      idempotencyKey,
    });

    const displayName = _templateName ?? '工作流';
    const { applyWorkflowRunStarted } = await import('@/lib/workflow-run-started');
    return applyWorkflowRunStarted({
      sessionKey: context.sessionKey,
      agentId: context.agentId,
      workflowId,
      runId: run.runId,
      templateName: displayName,
      inputs,
      userText: originalText,
    });
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
  const pending = chatState.pendingWorkflow;

  const { isReExecutionIntent, isWorkflowStartIntent } = await import('@/hooks/use-workflow-intent');
  if (isReExecutionIntent(text) || (isWorkflowStartIntent(text) && !pending)) {
    return false;
  }

  if (!pending) return false;

  // Detect cancellation first
  const { isWorkflowCancelIntent } = await import('@/hooks/use-workflow-intent');
  if (isWorkflowCancelIntent(text)) {
    chatState.clearPendingWorkflow();
    return false; // let the message fall through to normal chat
  }

  // Detect confirmation / execution intent
  const { isImmediateExecutionIntent } = await import('@/hooks/use-workflow-intent');
  const isConfirmIntent =
    isImmediateExecutionIntent(text) ||
    /(?:确认|执行|开始|帮我执行|启动|运行|好|是的|可以|行|没问题|提交|保存)/i.test(text);
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

    console.log(
      '[workflow-trace] tryResolvePendingWorkflow → createAndStartWorkflowDirect templateId=%s text=%s',
      pending.templateId,
      text,
    );
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
  // Only after model guidance was sent — otherwise stale pending would skip the model entirely.
  if (hasSchemaFields && pending.modelGuidanceSent) {
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
      useChatStore.getState().setPendingWorkflow({
        ...pending,
        collectedInputs: inputs,
        frontendFormInserted: true,
      });
      return true;
    }
  }

  return false;
}

