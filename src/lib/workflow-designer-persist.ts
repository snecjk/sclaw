/**
 * Persist a new workflow draft (first save).
 * Agent API creates an instance from a system template, then PUT saves the graph.
 */
import { definitionToSavePayload } from '@/lib/workflow-designer-adapter';
import { createWorkflow, getStartupSchema, listWorkflowTemplates, saveWorkflowDefinition } from '@/lib/workflow-api';
import { buildStartupPreset } from '@/lib/workflow-form-utils';
import type { WorkflowDefinition } from '@/pages/WorkflowDesigner/types';
import type { WorkflowSchema, WorkflowTemplateSearchItem } from '@/types/workflow';

const DESIGNER_TEMPLATE_ID_HINTS = ['blank', 'designer', 'empty', 'custom'];
const DESIGNER_TEMPLATE_LABEL_HINTS = [/空白/, /自定义/, /设计器/, /designer/i, /blank/i];

function scoreDesignerTemplate(item: WorkflowTemplateSearchItem): number {
  const id = item.id.toLowerCase();
  let score = 0;
  if (DESIGNER_TEMPLATE_ID_HINTS.some((hint) => id.includes(hint))) score += 100;
  if (item.nodeCount === 0) score += 50;
  if (item.label && DESIGNER_TEMPLATE_LABEL_HINTS.some((pattern) => pattern.test(item.label))) {
    score += 80;
  }
  return score;
}

function buildDefaultStartupValues(schema: WorkflowSchema): Record<string, unknown> {
  if (!schema.enabled) return {};
  const values: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue;
      continue;
    }
    if (field.required && field.options?.length) {
      values[field.key] =
        field.component === 'multi_select' ? [field.options[0].value] : field.options[0].value;
    }
  }
  return values;
}

function canSatisfySchema(schema: WorkflowSchema): boolean {
  if (!schema.enabled) return true;
  for (const field of schema.fields) {
    if (!field.required) continue;
    if (field.defaultValue !== undefined) continue;
    if (field.options?.length) continue;
    return false;
  }
  return true;
}

function hasRequiredStartupValues(schema: WorkflowSchema, values: Record<string, unknown>): boolean {
  return schema.fields.every((field) => {
    if (!field.required) return true;
    const value = values[field.key];
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
}

async function tryResolveTemplate(
  item: WorkflowTemplateSearchItem,
): Promise<{ templateId: string; schemaHash: string; values: Record<string, unknown> } | null> {
  try {
    const startup = await getStartupSchema(item.id);
    if (!canSatisfySchema(startup.schema)) return null;
    const values = buildDefaultStartupValues(startup.schema);
    if (!hasRequiredStartupValues(startup.schema, values)) return null;
    return { templateId: item.id, schemaHash: startup.schemaHash, values };
  } catch {
    return null;
  }
}

async function resolveCreateTemplate(): Promise<{
  templateId: string;
  schemaHash: string;
  values: Record<string, unknown>;
}> {
  const { items } = await listWorkflowTemplates({ pageSize: 100 });
  if (items.length === 0) {
    throw new Error('未找到可用的工作流模板，无法保存新工作流。');
  }

  const candidates = [...items].sort((a, b) => scoreDesignerTemplate(b) - scoreDesignerTemplate(a)).slice(0, 15);
  const results = await Promise.all(candidates.map((item) => tryResolveTemplate(item)));
  const resolved = results.find((r) => r !== null);
  if (!resolved) {
    throw new Error('未找到可用于创建的工作流模板（需无必填启动参数或具备默认值）。');
  }
  return resolved;
}

/** First-time save: create backend instance, then PUT graph definition. */
export async function persistNewWorkflow(workflow: WorkflowDefinition): Promise<WorkflowDefinition> {
  const resolved = await resolveCreateTemplate();
  const created = await createWorkflow({
    templateId: resolved.templateId,
    displayName: workflow.name.trim() || undefined,
    startup: buildStartupPreset(resolved.values, resolved.schemaHash),
    idempotencyKey: `designer-save-${Date.now()}`,
  });

  return saveWorkflowDefinition(created.workflowId, {
    ...definitionToSavePayload({ ...workflow, id: created.workflowId }),
  });
}
