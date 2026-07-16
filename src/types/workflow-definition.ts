/** Agent workflow definition aligned with the memory-center API. */
export type WorkflowNode = {
  id: string;
  type: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  condition?: string;
  sourcePort?: string;
  targetPort?: string;
};

export type WorkflowDefinition = {
  schemaVersion: string;
  id: string;
  name: string;
  version: number;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
