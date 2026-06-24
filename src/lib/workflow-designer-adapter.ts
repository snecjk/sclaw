import type { WorkflowDefinition } from '@/pages/WorkflowDesigner/types';
import type { WorkflowDetailResponse } from '@/types/workflow';

export function definitionToSavePayload(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    schemaVersion: workflow.schemaVersion || '1',
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
    description: workflow.description,
    nodes: workflow.nodes,
    edges: workflow.edges,
  };
}

export function definitionFromDetail(detail: WorkflowDetailResponse): WorkflowDefinition {
  return {
    schemaVersion: detail.schemaVersion ?? '1',
    id: detail.workflowId,
    name: detail.workflowName,
    version: detail.version,
    description: detail.description ?? undefined,
    nodes: detail.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      description: n.description,
      config: (n.config ?? {}) as Record<string, unknown>,
    })),
    edges: detail.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
  };
}
