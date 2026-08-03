/** Agent workflow definition — aligned with memory-center-web */

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

export type CanvasNodeData = {
  id: string;
  name: string;
  kind: string;
  subtitle: string;
  summary?: string;
  status: string;
  workflowNode?: WorkflowNode;
  workflow?: WorkflowDefinition;
  onNodeChange?: (node: WorkflowNode) => void;
  onDeleteNode?: (nodeId: string) => void;
};

export type CanvasNodeView = {
  id: string;
  type: string;
  name: string;
  subtitle: string;
  x: number;
  y: number;
};
