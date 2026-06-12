import {
  BRANCH_PARENT,
  COL_GAP,
  LEFT_X,
  NODE_W,
  OVERLAY_W,
  TOP_Y,
} from '@/pages/Workflow/constants';
import type { WorkflowLink, WorkflowNodeData } from '@/pages/Workflow/types';

export function computeInitialLeftX(viewportWidth: number, scale: number): number {
  const visW = Math.max(300, viewportWidth - OVERLAY_W);
  const desired = OVERLAY_W + (visW - NODE_W * scale) / 2;
  return Math.max(LEFT_X, Math.round(desired / scale));
}

export function layoutFlowNodes(
  sourceNodes: WorkflowNodeData[],
  startX: number,
): WorkflowNodeData[] {
  const nodeMap = new Map(sourceNodes.map((n) => [n.id, { ...n }]));
  const mainOrder = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].filter((id) => nodeMap.has(id));
  let lastRight = 0;

  for (const id of mainOrder) {
    const node = nodeMap.get(id);
    if (!node) continue;

    if (BRANCH_PARENT[id]) {
      const anchor = nodeMap.get(BRANCH_PARENT[id]);
      node.x = anchor ? anchor.x : startX;
      node.y = anchor ? anchor.y + 290 : TOP_Y;
    } else {
      const x = lastRight === 0 ? startX : lastRight + COL_GAP;
      node.x = x;
      node.y = TOP_Y;
      lastRight = x + NODE_W;
    }
    nodeMap.set(id, node);
  }

  return Array.from(nodeMap.values());
}

export function layoutNewNodeAtEnd(
  nodes: WorkflowNodeData[],
  newNode: WorkflowNodeData,
  startX: number,
): { nodes: WorkflowNodeData[]; linkFrom: string | null } {
  const mainNodes = nodes.filter((n) => n.id.startsWith('n') || n.kind !== 'end');
  const lastMain = mainNodes.length > 0 ? mainNodes[mainNodes.length - 1] : null;
  const lastRight = lastMain ? lastMain.x + NODE_W : 0;
  const x = lastRight === 0 ? startX : lastRight + COL_GAP;
  const placed = { ...newNode, x, y: TOP_Y };
  return {
    nodes: [...nodes, placed],
    linkFrom: lastMain?.id ?? null,
  };
}

export function getCanvasSize(nodes: WorkflowNodeData[]): { width: number; height: number } {
  let mw = 0;
  let mh = 0;
  for (const n of nodes) {
    mw = Math.max(mw, n.x + NODE_W);
    mh = Math.max(mh, n.y + 320);
  }
  return { width: mw ? mw + 180 : 800, height: mh ? mh + 160 : 600 };
}

export function getUpstreamChain(links: WorkflowLink[], nodeId: string): string[] {
  const chain = [nodeId];
  let cur = links.find((l) => l.to === nodeId)?.from ?? null;
  let guard = 0;
  while (cur && guard++ < 10) {
    chain.unshift(cur);
    cur = links.find((l) => l.to === cur)?.from ?? null;
  }
  return chain;
}

export function hasDataSourceConfigured(node: WorkflowNodeData): boolean {
  const dsField = node.fields.find((f) => f.type === 'dsgroup');
  if (!dsField?.dataSource) return false;
  const { localFiles = [], sys = [], online = [] } = dsField.dataSource;
  return localFiles.length > 0 || sys.length > 0 || online.length > 0;
}
