/**
 * Workflow Send Hook
 *
 * Orchestrates the workflow form → create → start → track flow.
 * Aligned with Agent Workflow Client API v1.
 */
import { toast } from 'sonner';
import { showForm } from '@/lib/form-api';
import { buildWorkflowFormConfig, buildStartupPreset, buildWorkflowValues } from '@/lib/workflow-form-utils';
import {
  getStartupSchema,
  createWorkflow,
  startWorkflow,
} from '@/lib/workflow-api';
import { invokeIpc } from '@/lib/api-client';
import { canStartWorkflow } from '@/stores/workflows';
import type { WorkflowSchema } from '@/types/workflow';

export interface WorkflowSendContext {
  sessionKey: string;
  agentId: string;
}

/** Cached startup schema per template */
const schemaCache = new Map<string, { schema: WorkflowSchema; schemaHash: string }>();

export async function sendWithWorkflow(
  text: string,
  templateId: string,
  context: WorkflowSendContext,
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

    // 2. Check if any confirm-mode steps require a form
    const hasConfirm = schema.steps.some((s) => s.mode === 'confirm');

    let inputs: Record<string, unknown> = {};

    if (hasConfirm) {
      const formConfig = buildWorkflowFormConfig(schema, text);
      const response = await showForm(formConfig, {
        source: 'workflow',
        sourceId: templateId,
      });

      if (response.cancelled) {
        return false;
      }

      inputs = buildWorkflowValues(response.values ?? {}, schema.fields);
    } else {
      // Auto mode: try to extract from user text
      for (const field of schema.fields) {
        if (field.extractable && field.extractPattern && text) {
          try {
            const match = text.match(new RegExp(field.extractPattern));
            if (match) {
              inputs[field.key] = match[1] ?? match[0];
            }
          } catch {
            // Invalid regex, ignore
          }
        }
      }
    }

    // 3. Create workflow with startup preset
    const created = await createWorkflow({
      templateId,
      startupPreset: buildStartupPreset(inputs, schemaHash),
      idempotencyKey: `create-wf-${templateId}-${Date.now()}`,
      sourceClient: 'stoclaw',
    });

    // 4. Start workflow
    const run = await startWorkflow(created.workflow.id, {
      inputs,
      presetId: created.defaultPreset.id,
      idempotencyKey: `start-wf-${created.workflow.id}-${Date.now()}`,
    });

    // 5. Send message via Gateway with runId and workflowId
    await sendMessage(text, run.id, created.workflow.id);

    // 6. Start tracking
    await invokeIpc('workflow:startTracking', {
      runId: run.id,
      workflowId: created.workflow.id,
      sessionKey: context.sessionKey,
      agentId: context.agentId,
    });

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`工作流执行失败: ${message}`);
    return false;
  }
}
