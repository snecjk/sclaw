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
import type { WorkflowSchema, WorkflowSchemaField } from '@/types/workflow';

export interface WorkflowSendContext {
  sessionKey: string;
  agentId: string;
}

/** Cached startup schema per template */
const schemaCache = new Map<string, { schema: WorkflowSchema; schemaHash: string }>();

function buildSchemaPrompt(schema: WorkflowSchema): string {
  const lines = schema.fields.map((f) => {
    const req = f.required ? '（必填）' : '（可选）';
    const desc = f.description ? `：${f.description}` : '';
    let typeHint = '';
    if (f.component === 'file') typeHint = '【请上传文件】';
    else if (f.component === 'single_select') {
      typeHint = `【单选：${f.options?.map((o) => `${o.label}(${o.value})`).join(' / ') || '无'}】`;
    }
    else if (f.component === 'multi_select') {
      typeHint = `【多选：${f.options?.map((o) => `${o.label}(${o.value})`).join(' / ') || '无'}】`;
    }
    else if (f.component === 'date') typeHint = '【日期格式】';
    else if (f.component === 'editable_list') {
      const defaultStr = f.defaultValue ? `，默认：${Array.isArray(f.defaultValue) ? f.defaultValue.join('、') : String(f.defaultValue)}` : '';
      typeHint = `【可编辑列表${defaultStr}】`;
    }
    const defaultStr = f.defaultValue && !f.component.includes('select') && !f.component.includes('list') ? `，默认值：${JSON.stringify(f.defaultValue)}` : '';
    return `- **${f.label}**（键：\`${f.key}\`）${req}${desc}${typeHint}${defaultStr}`;
  });
  return lines.join('\n');
}

/**
 * Enhance user message with workflow schema so the model can guide
 * parameter collection within the conversation.
 */
function enhanceMessage(text: string, templateName: string, schema: WorkflowSchema): string {
  const schemaDesc = buildSchemaPrompt(schema);
  const stepInfo = schema.steps.map((s, i) => `${i + 1}. ${s.title}`).join('，');
  return `${text}\n\n【工作流：${templateName}】\n\n该工作流包含 ${schema.steps.length} 个步骤：${stepInfo}\n\n请依次引导用户提供以下参数：\n${schemaDesc}\n\n引导规则：\n1. 每次只问一个步骤的参数\n2. 等用户回复后再问下一个\n3. 所有必填参数收集完毕后，回复"✅ 参数已收集完成，即将为您执行【${templateName}】工作流"\n4. 如果用户回复包含"确认"、"执行"、"开始"等词，且所有必填参数已填写，则执行工作流`;
}

export async function sendWithWorkflow(
  text: string,
  templateId: string,
  _context: WorkflowSendContext,
  sendMessage: (text: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
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

    // 3. Enhance message with schema context
    const enhancedText = enhanceMessage(text, templateName, schema);
    console.log('[sendWithWorkflow] enhancedText=', enhancedText);

    // 4. Persist pending workflow state in chat store for later creation & start
    useChatStore.getState().setPendingWorkflow({
      templateId,
      templateName,
      schema,
      schemaHash,
      collectedInputs: {},
    });

    // 5. Send enhanced message to the model (workflow creation happens after params are collected)
    await sendMessage(enhancedText, null, null);

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`工作流创建失败: ${message}`);
    return false;
  }
}

/**
 * Create and start a workflow directly on first selection
 * (skips the parameter guidance phase).
 */
export async function createAndStartWorkflowDirect(
  templateId: string,
  inputs: Record<string, unknown>,
  context: WorkflowSendContext,
  sendMessage: (text: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
  originalText: string,
): Promise<boolean> {
  console.log('[createAndStartWorkflowDirect] called templateId=', templateId, 'inputs=', inputs);
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
    const run = await startWorkflow(created.workflowId, {
      inputs,
      idempotencyKey: `start-wf-${created.workflowId}-${Date.now()}`,
    });
    await sendMessage(originalText, run.id, created.workflowId);

    await invokeIpc('workflow:startTracking', {
      runId: run.id,
      workflowId: created.workflowId,
      sessionKey: context.sessionKey,
      agentId: context.agentId,
    });

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[createAndStartWorkflowDirect] error', err);
    toast.error(`工作流启动失败: ${message}`);
    return false;
  }
}

/**
 * Start an already-created workflow (used when createWorkflow was called earlier in sendWithWorkflow).
 */
export async function startExistingWorkflow(
  workflowId: string,
  inputs: Record<string, unknown>,
  context: WorkflowSendContext,
  sendMessage: (text: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
  originalText: string,
): Promise<boolean> {
  console.log('[startExistingWorkflow] called workflowId=', workflowId, 'inputs=', inputs);
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
  const pending = chatState.pendingWorkflow;
  console.log('[tryResolvePendingWorkflow] pending=', pending ? pending.templateId : null, 'text=', text);
  if (!pending) return false;

  // Start with previously collected inputs
  let inputs: Record<string, unknown> = { ...(pending.collectedInputs ?? {}) };
  // Try to extract parameters from current user text
  for (const field of pending.schema.fields) {
    if (inputs[field.key] !== undefined) continue;
    const value = extractFieldValue(text, field);
    if (value !== undefined) {
      inputs[field.key] = value;
    }
  }

  // Detect confirmation / execution intent
  const isConfirmIntent = /(?:确认|执行|开始|帮我执行|启动|运行|好|是的|可以|行|没问题|提交|保存)/i.test(text);
  // Also treat short replies as confirm intent when all params are already filled
  const isShortReply = text.length <= 10;

  // Check required fields, considering defaults
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
    console.log('[tryResolvePendingWorkflow] backfilled from history inputs=', inputs, 'allRequiredFilled=', allRequiredFilled);
  }

  // Persist updated collected inputs
  useChatStore.getState().setPendingWorkflow({
    ...pending,
    collectedInputs: inputs,
  });

  const shouldExecute = allRequiredFilled && (isConfirmIntent || isShortReply);
  console.log('[tryResolvePendingWorkflow] inputs=', inputs, 'allRequiredFilled=', allRequiredFilled, 'isConfirmIntent=', isConfirmIntent, 'isShortReply=', isShortReply, 'shouldExecute=', shouldExecute, 'workflowId=', pending.workflowId);
  if (shouldExecute) {
    const mergedInputs = { ...inputs };
    for (const field of pending.schema.fields) {
      if (mergedInputs[field.key] === undefined && field.defaultValue !== undefined) {
        mergedInputs[field.key] = field.defaultValue;
      }
    }

    // If workflowId already exists (created in sendWithWorkflow), just start it
    if (pending.workflowId) {
      console.log('[tryResolvePendingWorkflow] workflow already created, calling startWorkflow only');
      const ok = await startExistingWorkflow(
        pending.workflowId,
        mergedInputs,
        { sessionKey: chatState.currentSessionKey, agentId: chatState.currentAgentId },
        sendMessage,
        text,
      );
      console.log('[tryResolvePendingWorkflow] result=', ok);
      return ok;
    }

    // Fallback: create and start (legacy path)
    console.log('[tryResolvePendingWorkflow] calling createAndStartWorkflow');
    const ok = await createAndStartWorkflow(
      pending.templateId,
      mergedInputs,
      { sessionKey: chatState.currentSessionKey, agentId: chatState.currentAgentId },
      sendMessage,
      text,
    );
    console.log('[tryResolvePendingWorkflow] result=', ok);
    return ok;
  }
  return false;
}

/**
 * Create and start a workflow after parameters have been collected
 * in the conversation. This is meant to be called later (e.g. when
 * the user confirms or when the model signals params are ready).
 */
export async function createAndStartWorkflow(
  templateId: string,
  inputs: Record<string, unknown>,
  context: WorkflowSendContext,
  _sendMessage: (text: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
  originalText: string,
): Promise<boolean> {
  console.log('[createAndStartWorkflow] called templateId=', templateId, 'inputs=', inputs);
  try {
    const cached = schemaCache.get(templateId);
    if (!cached) {
      toast.error('工作流 schema 已过期，请重新选择工作流');
      return false;
    }

    const { schemaHash } = cached;

    const { buildStartupPreset } = await import('@/lib/workflow-form-utils');

    const created = await createWorkflow({
      templateId,
      startup: buildStartupPreset(inputs, schemaHash),
      idempotencyKey: `create-wf-${templateId}-${Date.now()}`,
    });
    const run = await startWorkflow(created.workflowId, {
      inputs,
      idempotencyKey: `start-wf-${created.workflowId}-${Date.now()}`,
    });

    // Insert user message + assistant workflow card locally instead of sending
    // to Gateway (which would trigger the AI to execute via sai-cli again).
    const chatStore = useChatStore;
    const pending = chatStore.getState().pendingWorkflow;
    const templateName = pending?.templateName ?? '工作流';
    const now = Date.now() / 1000;
    chatStore.setState((s) => ({
      messages: [
        ...s.messages,
        {
          role: 'user',
          content: originalText,
          timestamp: now,
          id: crypto.randomUUID(),
        } as import('@/stores/chat').RawMessage,
        {
          role: 'assistant',
          content: [
            { type: 'text', text: `✅ 已确认参数并启动【${templateName}】工作流` },
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
    console.error('[createAndStartWorkflow] error', err);
    toast.error(`工作流启动失败: ${message}`);
    return false;
  }
}
