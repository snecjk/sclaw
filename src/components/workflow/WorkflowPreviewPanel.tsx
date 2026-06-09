/**
 * Workflow graph preview — nodes & startup parameters from GET /agent/v1/workflows/{workflowId}
 */
import { useMemo } from 'react';
import {
  Loader2,
  AlertCircle,
  Play,
  Settings2,
  Bot,
  GitBranch,
  Circle,
} from 'lucide-react';
import { buildWorkflowPreviewStepCards } from '@/lib/workflow-preview-steps';
import type { WorkflowDetailResponse, WorkflowGraphNode } from '@/types/workflow';

interface WorkflowPreviewPanelProps {
  detail: WorkflowDetailResponse | null;
  loading: boolean;
  error: string | null;
  workflowId: string | null;
}

function nodeIcon(type?: string) {
  switch (type) {
    case 'trigger':
      return Play;
    case 'startup_config':
      return Settings2;
    case 'agent_task':
      return Bot;
    default:
      return Circle;
  }
}

function nodeTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    trigger: '触发器',
    startup_config: '启动配置',
    agent_task: '智能体任务',
    condition: '条件分支',
    output: '输出',
  };
  return type ? (labels[type] ?? type) : '';
}

function sortNodesTopologically(
  nodes: WorkflowGraphNode[],
  edges: WorkflowDetailResponse['edges'],
): WorkflowGraphNode[] {
  if (nodes.length === 0) return [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const sorted: WorkflowGraphNode[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const next of adjacency.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg <= 0) queue.push(next);
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) sorted.push(node);
  }
  return sorted;
}

export function WorkflowPreviewPanel({
  detail,
  loading,
  error,
  workflowId,
}: WorkflowPreviewPanelProps) {
  const stepCards = useMemo(() => {
    if (!detail) return [];
    const orderedNodes = sortNodesTopologically(detail.nodes, detail.edges);
    return buildWorkflowPreviewStepCards(detail, orderedNodes);
  }, [detail]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--sto-brand-6)]" />
        <p>加载工作流定义…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-8 w-8 text-destructive/60" />
        <p className="text-destructive">加载失败</p>
        <p className="text-xs opacity-70">{error}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <GitBranch className="h-8 w-8 opacity-30" />
        <p>暂无工作流数据</p>
        {workflowId && <p className="text-xs font-mono opacity-50">{workflowId}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#F7F8FA]">
      <div className="shrink-0 border-b border-[#E5E6EB] bg-white px-4 py-3">
        <h3 className="text-[14px] font-semibold text-[#1D2129]">{detail.workflowName}</h3>
        {detail.description && (
          <p className="mt-0.5 text-[12px] text-[#86909C]">{detail.description}</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-0">
          {stepCards.map((card, index) => {
            const Icon = nodeIcon(card.nodeType);
            const isLast = index === stepCards.length - 1;
            const typeLabel = nodeTypeLabel(card.nodeType);

            return (
              <div key={card.id} className="relative flex gap-3">
                {!isLast && (
                  <div className="absolute left-[15px] top-8 h-[calc(100%-8px)] w-px bg-[#E5E6EB]" />
                )}
                <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#FFD7A3] bg-[#FFF5E6] text-[12px] font-semibold text-[var(--sto-brand-6)]">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="overflow-hidden rounded-xl border border-[#E5E6EB] bg-white shadow-[0_1px_4px_rgba(29,33,41,0.04)]">
                    <div className="flex items-start gap-2 border-b border-[#F0F2F5] px-3.5 py-2.5">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--sto-brand-6)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-[#1D2129]">{card.title}</span>
                          {card.nodeType && (
                            <span className="rounded-md bg-[#F5F6F7] px-1.5 py-0.5 text-[10px] text-[#86909C]">
                              {typeLabel || card.nodeType}
                            </span>
                          )}
                        </div>
                        {card.nodeDescription && card.fields.length === 0 && (
                          <p className="mt-1 text-[12px] leading-5 text-[#86909C]">{card.nodeDescription}</p>
                        )}
                      </div>
                    </div>

                    {card.fields.length > 0 && (
                      <div className="space-y-2 px-3.5 py-3">
                        {card.fields.map((field) => (
                          <div
                            key={field.key}
                            className="rounded-lg border border-[#EEF0F3] bg-[#FAFBFC] px-3 py-2.5"
                          >
                            <div className="text-[12px] font-medium text-[#4E5969]">{field.label}</div>
                            {field.display ? (
                              <div className="mt-1 text-[13px] leading-5 text-[#1D2129]">{field.display}</div>
                            ) : null}
                            {field.description ? (
                              <div className={field.display ? 'mt-1 text-[11px] leading-4 text-[#86909C]' : 'mt-1 text-[13px] leading-5 text-[#4E5969]'}>
                                {field.description}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
