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
import type { WorkflowSchema } from '@/types/workflow';

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

    // 4. Persist pending workflow state in chat store for later creation
    useChatStore.getState().setPendingWorkflow({
      templateId,
      templateName,
      schema,
      schemaHash,
    });

    // 5. Send enhanced message to the model (no workflowId/runId yet — creation happens after params are collected)
    await sendMessage(enhancedText, null, null);

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`工作流执行失败: ${message}`);
    return false;
  }
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
  sendMessage: (text: string, runId?: string | null, workflowId?: string | null) => Promise<void>,
  originalText: string,
): Promise<boolean> {
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
      startupPreset: buildStartupPreset(inputs, schemaHash),
      idempotencyKey: `create-wf-${templateId}-${Date.now()}`,
      sourceClient: 'stoclaw',
    });
    const run = await startWorkflow(created.workflow.id, {
      inputs,
      presetId: created.defaultPreset.id,
      idempotencyKey: `start-wf-${created.workflow.id}-${Date.now()}`,
    });
    await sendMessage(originalText, run.id, created.workflow.id);

    await invokeIpc('workflow:startTracking', {
      runId: run.id,
      workflowId: created.workflow.id,
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
