/**
 * Condition branch normalization for agent_condition / condition nodes.
 *
 * Ported from memory-center-web WorkflowDesignerPage.tsx (L211-422) and
 * agent-condition.ts. Simplified: `normalizeWorkflowNodeDisplayNames`
 * deferred (display names, not data integrity — TODO port later).
 * `syncAgentConditionNodeConfig` reduced to branch-sync only (instruction
 * text generation deferred to runtime).
 *
 * Ensures outgoing edges from agent_condition nodes have a `sourcePort`
 * (defaulting to `target` when absent) and that the node's `config.branches`
 * array stays in sync with the actual edges — preventing branch-key /
 * target-nodeId drift on load → save round-trips.
 */

import type { WorkflowDefinition } from '@/pages/WorkflowDesigner/types';

// ── Smart-agent kind detection ─────────────────────────────────────

type SmartAgentNodeKind = 'agent_data_fetch' | 'agent_data_process' | 'agent_condition' | 'agent_output';

export function resolveSmartAgentKind(
  type: string,
  _config?: Record<string, unknown> | null,
): SmartAgentNodeKind | null {
  if (
    type === 'agent_data_fetch' ||
    type === 'agent_data_process' ||
    type === 'agent_condition' ||
    type === 'agent_output'
  ) {
    return type as SmartAgentNodeKind;
  }
  return null;
}

function isAgentConditionNode(node: WorkflowDefinition['nodes'][number]): boolean {
  return (
    node.type === 'agent_condition' ||
    resolveSmartAgentKind(node.type, node.config) === 'agent_condition'
  );
}

// ── Edge helpers ────────────────────────────────────────────────────

type ConditionBranchEdge = WorkflowDefinition['edges'][number] & {
  target: string;
  sourcePort: string;
};

/** Collect outgoing edges from a condition node, ensuring sourcePort is filled. */
function collectConditionBranchEdges(
  workflow: WorkflowDefinition,
  nodeId: string,
  nodesById: Map<string, WorkflowDefinition['nodes'][number]>,
): ConditionBranchEdge[] {
  const seen = new Set<string>();
  const edges: ConditionBranchEdge[] = [];

  for (const edge of workflow.edges) {
    if (edge.source !== nodeId || typeof edge.target !== 'string') continue;
    if (!nodesById.has(edge.target)) continue;

    const sourcePort =
      typeof edge.sourcePort === 'string' && edge.sourcePort.trim().length > 0
        ? edge.sourcePort.trim()
        : edge.target;
    const condition = typeof edge.condition === 'string' ? edge.condition.trim() : '';
    const dedupeKey = `${edge.source}::${edge.target}::${sourcePort}::${condition}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    edges.push({ ...edge, target: edge.target, sourcePort });
  }

  return edges;
}

/** Normalize edges from agent_condition nodes: fill sourcePort, dedupe. */
function normalizeConditionEdges(
  workflow: WorkflowDefinition,
  nodesById: Map<string, WorkflowDefinition['nodes'][number]>,
): WorkflowDefinition['edges'] {
  const seen = new Set<string>();
  const edges: WorkflowDefinition['edges'] = [];

  for (const edge of workflow.edges) {
    const sourceNode = nodesById.get(edge.source);
    if (!sourceNode || !isAgentConditionNode(sourceNode)) {
      edges.push(edge);
      continue;
    }

    const sourcePort =
      typeof edge.sourcePort === 'string' && edge.sourcePort.trim().length > 0
        ? edge.sourcePort.trim()
        : edge.target;
    const condition = typeof edge.condition === 'string' ? edge.condition.trim() : '';
    const dedupeKey = `${edge.source}::${edge.target}::${sourcePort}::${condition}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    edges.push({ ...edge, sourcePort });
  }

  return edges;
}

// ── Branch display labels ──────────────────────────────────────────

/** Build display labels for condition branch targets (simplified: node name fallback). */
function buildConditionBranchDisplayLabels(
  workflow: WorkflowDefinition,
  targetNodeIds: string[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const targetNodeId of targetNodeIds) {
    const node = workflow.nodes.find((n) => n.id === targetNodeId);
    if (!node) continue;
    const baseLabel = (node.name?.trim() || node.type).trim() || node.type;
    labels.set(node.id, baseLabel);
  }
  return labels;
}

// ── Main normalization ─────────────────────────────────────────────

/**
 * Normalize condition branch edges and sync agent_condition node config.branches.
 *
 * Ported from web WorkflowDesignerPage.tsx normalizeConditionBranches (L322-422).
 * `normalizeWorkflowNodeDisplayNames` step skipped (display names, not
 * data integrity — TODO: port later if condition-node UX requires it).
 */
export function normalizeConditionBranches(
  workflow: WorkflowDefinition,
): WorkflowDefinition {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const nextEdges = normalizeConditionEdges(workflow, nodesById);

  const nextNodes = workflow.nodes.map((node) => {
    if (!isAgentConditionNode(node)) return node;

    const outgoingEdges = collectConditionBranchEdges(
      { ...workflow, edges: nextEdges },
      node.id,
      nodesById,
    );

    // Merge outgoing edges with existing branches, preferring edge data
    const existingBranches = Array.isArray(node.config?.branches)
      ? (node.config.branches as Array<Record<string, unknown>>)
          .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
          .map((b) => ({ ...b }))
      : [];

    const remainingBranches = [...existingBranches];
    const consumeExistingBranch = (edge: ConditionBranchEdge) => {
      const matchers = [
        (branch: Record<string, unknown>) =>
          String(branch.targetNodeId ?? '').trim() === edge.target &&
          String(branch.branchKey ?? '').trim() === edge.sourcePort,
        (branch: Record<string, unknown>) =>
          String(branch.branchKey ?? '').trim() === edge.sourcePort,
        (branch: Record<string, unknown>) =>
          String(branch.targetNodeId ?? '').trim() === edge.target,
      ];
      for (const matcher of matchers) {
        const index = remainingBranches.findIndex(matcher);
        if (index >= 0) {
          const [branch] = remainingBranches.splice(index, 1);
          return branch;
        }
      }
      return null;
    };

    const branchTargetIds = outgoingEdges.map((edge) => edge.target);
    const displayLabels = buildConditionBranchDisplayLabels(workflow, branchTargetIds);

    const branches = outgoingEdges.map((edge) => {
      const existing = consumeExistingBranch(edge);
      return {
        targetNodeId: edge.target,
        branchKey:
          typeof existing?.branchKey === 'string' && String(existing.branchKey).trim().length > 0
            ? String(existing.branchKey).trim()
            : edge.sourcePort,
        label:
          typeof existing?.label === 'string' && String(existing.label).trim().length > 0
            ? String(existing.label)
            : (displayLabels.get(edge.target) ?? edge.target),
        description: typeof existing?.description === 'string' ? String(existing.description) : '',
        routeRuleHint:
          typeof existing?.routeRuleHint === 'string' && String(existing.routeRuleHint).trim().length > 0
            ? String(existing.routeRuleHint)
            : typeof edge.condition === 'string'
              ? edge.condition
              : '',
        isFallback: Boolean(existing?.isFallback),
      };
    });

    // Ensure at least one fallback branch (last by default)
    const fallbackIndex = branches.findIndex((b) => b.isFallback);
    const normalizedBranches = branches.map((branch, index) => ({
      ...branch,
      isFallback: fallbackIndex >= 0 ? index === fallbackIndex : index === branches.length - 1,
    }));

    // Sync branches into node config (simplified: no instruction text rebuild)
    return {
      ...node,
      config: { ...node.config, branches: normalizedBranches },
    };
  });

  return { ...workflow, nodes: nextNodes, edges: nextEdges };
}
