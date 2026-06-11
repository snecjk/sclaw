import { buildWorkflowFieldPreviewRows } from '@/lib/workflow-form-utils';
import type {
  WorkflowDetailResponse,
  WorkflowGraphNode,
  WorkflowSchema,
  WorkflowStep,
} from '@/types/workflow';

export interface WorkflowPreviewFieldRow {
  key: string;
  label: string;
  display: string;
  description?: string;
}

export interface WorkflowPreviewStepCard {
  id: string;
  title: string;
  nodeType?: string;
  nodeDescription?: string;
  fields: WorkflowPreviewFieldRow[];
}

function resolveSchemaSteps(schema: WorkflowSchema, node?: WorkflowGraphNode): WorkflowStep[] {
  const fromSchema = schema.steps ?? [];
  if (fromSchema.length > 0) {
    return [...fromSchema].sort((a, b) => a.order - b.order);
  }

  const configSteps = node?.config?.steps;
  if (Array.isArray(configSteps) && configSteps.length > 0) {
    return configSteps
      .map((step) => step as WorkflowStep)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  return [];
}

function fieldsForStep(
  schema: WorkflowSchema,
  stepId: string,
  values: Record<string, unknown>,
): WorkflowPreviewFieldRow[] {
  return schema.fields
    .filter((field) => field.group === stepId)
    .sort((a, b) => a.order - b.order)
    .flatMap((field) => buildWorkflowFieldPreviewRows(field, values));
}

function expandStartupConfigNode(
  node: WorkflowGraphNode,
  schema: WorkflowSchema,
  values: Record<string, unknown>,
): WorkflowPreviewStepCard[] {
  const steps = resolveSchemaSteps(schema, node);

  if (steps.length > 0) {
    return steps.map((step) => ({
      id: `${node.id}:${step.id}`,
      title: step.title,
      nodeType: node.type,
      nodeDescription: node.description,
      fields: fieldsForStep(schema, step.id, values),
    }));
  }

  const fields = schema.fields
    .sort((a, b) => a.order - b.order)
    .flatMap((field) => buildWorkflowFieldPreviewRows(field, values));

  if (fields.length === 0 && !node.description?.trim()) return [];

  return [{
    id: node.id,
    title: node.name,
    nodeType: node.type,
    nodeDescription: node.description,
    fields,
  }];
}

/** Merge graph nodes with startup step parameters — fully driven by API payload. */
export function buildWorkflowPreviewStepCards(
  detail: WorkflowDetailResponse,
  orderedNodes: WorkflowGraphNode[],
): WorkflowPreviewStepCard[] {
  const schema = detail.startup?.schema;
  const values = detail.startup?.defaultPreset?.values ?? {};
  const cards: WorkflowPreviewStepCard[] = [];

  if (!schema?.enabled) {
    return orderedNodes.map((node) => ({
      id: node.id,
      title: node.name,
      nodeType: node.type,
      nodeDescription: node.description,
      fields: [],
    }));
  }

  const startupNodeId = schema.nodeId;
  let startupExpanded = false;

  for (const node of orderedNodes) {
    if (node.type === 'startup_config' || node.id === startupNodeId) {
      startupExpanded = true;
      cards.push(...expandStartupConfigNode(node, schema, values));
      continue;
    }

    cards.push({
      id: node.id,
      title: node.name,
      nodeType: node.type,
      nodeDescription: node.description,
      fields: [],
    });
  }

  if (!startupExpanded && (schema.steps.length > 0 || schema.fields.length > 0)) {
    const fallbackNode = orderedNodes.find((n) => n.id === startupNodeId) ?? {
      id: startupNodeId,
      type: 'startup_config',
      name: '启动配置',
    };
    cards.push(...expandStartupConfigNode(fallbackNode, schema, values));
  }

  return cards;
}
