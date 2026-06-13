/** 画布布局纯函数：节点排列、尺寸计算、上游链路回溯 */
import {
  COL_GAP,
  LEFT_X,
  NODE_W,
  OVERLAY_W,
  TOP_Y,
} from '@/pages/WorkflowBuilder/constants';
import type { WorkflowLink, WorkflowNodeData } from '@/pages/WorkflowBuilder/types';

/** 计算首个节点的左偏移 x，使节点组在可视区居中（扣除侧栏宽度） */
export function computeInitialLeftX(viewportWidth: number, scale: number): number {
  const visW = Math.max(300, viewportWidth - OVERLAY_W);
  const desired = OVERLAY_W + (visW - NODE_W * scale) / 2;
  return Math.max(LEFT_X, Math.round(desired / scale));
}

/** 横排线性布局：按 sourceNodes 数组顺序从 startX 开始依次排列 */
export function layoutFlowNodes(
  sourceNodes: WorkflowNodeData[],
  startX: number,
): WorkflowNodeData[] {
  if (sourceNodes.length === 0) return [];
  const nodeMap = new Map(sourceNodes.map((n) => [n.id, { ...n }]));
  let lastRight = 0;

  for (const node of sourceNodes) {
    const x = lastRight === 0 ? startX : lastRight + COL_GAP;
    node.x = x;
    node.y = TOP_Y;
    lastRight = x + NODE_W;
    nodeMap.set(node.id, node);
  }

  return Array.from(nodeMap.values());
}

/** 在末尾追加新节点（排除 end 类型），返回新节点列表和连线起点 id */
export function layoutNewNodeAtEnd(
  nodes: WorkflowNodeData[],
  newNode: WorkflowNodeData,
  startX: number,
): { nodes: WorkflowNodeData[]; linkFrom: string | null } {
  const mainNodes = nodes.filter((n) => n.kind !== 'end');
  const lastMain = mainNodes.length > 0 ? mainNodes[mainNodes.length - 1] : null;
  const lastRight = lastMain ? lastMain.x + NODE_W : 0;
  const x = lastRight === 0 ? startX : lastRight + COL_GAP;
  const placed = { ...newNode, x, y: TOP_Y };
  return {
    nodes: [...nodes, placed],
    linkFrom: lastMain?.id ?? null,
  };
}

/** 计算画布 SVG 容器尺寸（最右节点 + 最下节点 + 边距） */
export function getCanvasSize(nodes: WorkflowNodeData[]): { width: number; height: number } {
  let mw = 0;
  let mh = 0;
  for (const n of nodes) {
    mw = Math.max(mw, n.x + NODE_W);
    mh = Math.max(mh, n.y + 320);
  }
  return { width: mw ? mw + 180 : 800, height: mh ? mh + 160 : 600 };
}

/** 从 nodeId 沿 links 反向回溯上游链路（最多 10 层防死循环） */
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

/** 检查节点的 dsgroup 字段是否已配置至少一种数据源 */
export function hasDataSourceConfigured(node: WorkflowNodeData): boolean {
  const dsField = node.fields.find((f) => f.type === 'dsgroup');
  if (!dsField?.dataSource) return false;
  const { localFiles = [], sys = [], online = [] } = dsField.dataSource;
  return localFiles.length > 0 || sys.length > 0 || online.length > 0;
}
