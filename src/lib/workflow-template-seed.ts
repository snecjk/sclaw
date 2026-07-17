import type { WorkflowEdge, WorkflowNode } from '@/pages/WorkflowDesigner/types';
import type { WorkflowStudioTemplate, WorkflowStudioTemplateDetail } from '@/lib/workflow-studio-api';

export type WizardGraphSeed = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

/** 列表项预览 — 对齐 MC buildTemplatePreview */
export function buildTemplatePreview(summary: WorkflowStudioTemplate): WizardGraphSeed {
  const nodes = (summary.nodes ?? []).map((node) => ({
    id: node.id,
    type: node.type,
    name: node.name,
    description: '',
    config: {},
  }));
  const edges = (summary.edges ?? []).map((edge) => ({ ...edge }));
  return { nodes, edges };
}

/** 模板详情种子 — 对齐 MC buildWizardTemplateSeed */
export function buildWizardTemplateSeed(detail: WorkflowStudioTemplateDetail): WizardGraphSeed {
  return {
    nodes: detail.workflowDefinition.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      description: node.description ?? '',
      config: structuredClone(node.config ?? {}),
    })),
    edges: detail.workflowDefinition.edges.map((edge) => ({ ...edge })),
  };
}
