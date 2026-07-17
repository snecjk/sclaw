/** Client-only DSL normalization and deterministic preflight. No persistence or schema migration. */
export function normalizeRuntimeDefinition(definition: any): any {
  const nodes = (definition?.nodes ?? []).map((node: any) => {
    const config = { ...(node.config ?? {}) };
    if (node.type === 'condition' || node.type === 'agent_condition') {
      if (!Array.isArray(config.branches) || config.branches.length === 0) {
        config.branches = [
          { branchKey: config.truePort ?? config.trueBranch ?? 'yes' },
          { branchKey: config.falsePort ?? config.falseBranch ?? 'no', isFallback: true },
        ];
      } else {
        config.branches = config.branches.map((branch: any) => ({ ...branch, branchKey: branch.branchKey ?? branch.key }));
      }
    }
    return { ...node, config };
  });
  const edges = (definition?.edges ?? []).map((edge: any) => ({
    ...edge,
    sourcePort: edge.sourcePort ?? edge.condition ?? edge.branch ?? edge.branchKey ?? undefined,
  }));
  return { ...definition, nodes, edges };
}

export function validateRuntimeDefinition(definition: any): void {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  if (!nodes.length) throw new Error('工作流定义没有节点');
  const byId = new Map<string, any>();
  for (const node of nodes) {
    if (!node?.id || !node?.type || byId.has(node.id)) throw new Error(`工作流节点无效: ${node?.id ?? '?'}`);
    byId.set(node.id, node);
  }
  for (const edge of edges) if (!byId.has(edge?.source) || !byId.has(edge?.target)) throw new Error(`工作流连线引用不存在节点: ${edge?.source ?? '?'} -> ${edge?.target ?? '?'}`);
  for (const node of nodes) {
    const incoming = edges.filter((edge: any) => edge.target === node.id);
    if (incoming.length > 1 && !['all', 'any', 'first'].includes(node.config?.inputPolicy)) {
      throw new Error(`节点 ${node.id} 有多个输入，必须声明 inputPolicy(all/any/first)`);
    }
    if (node.type === 'condition' || node.type === 'agent_condition') {
      const ports = (node.config?.branches ?? []).map((branch: any) => branch.branchKey).filter(Boolean);
      if (!ports.length || new Set(ports).size !== ports.length) throw new Error(`条件节点 ${node.id} 的分支端口无效`);
      for (const edge of edges.filter((item: any) => item.source === node.id)) {
        if (!edge.sourcePort || !ports.includes(edge.sourcePort)) throw new Error(`条件节点 ${node.id} 的出边必须声明合法 sourcePort`);
      }
    }
    const outgoing = edges.filter((edge: any) => edge.source === node.id);
    if (outgoing.length > 1 && node.type !== 'condition' && node.type !== 'agent_condition') {
      throw new Error(`节点 ${node.id} 有多个出边；当前 DSL 仅允许条件节点分支`);
    }
  }
  // Kahn cycle detection and reachability from the only deterministic start node.
  const indegree = new Map<string, number>(nodes.map((node: any): [string, number] => [String(node.id), 0]));
  for (const edge of edges) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  const starts = nodes.filter((node: any) => indegree.get(node.id) === 0);
  if (starts.length !== 1) throw new Error('工作流必须且只能有一个起始节点');
  const reached = new Set<string>(); const queue = [starts[0].id];
  while (queue.length) { const id = queue.shift()!; if (reached.has(id)) continue; reached.add(id); edges.filter((edge: any) => edge.source === id).forEach((edge: any) => queue.push(edge.target)); }
  if (reached.size !== nodes.length) throw new Error('工作流包含不可达节点');
  const work = new Map<string, number>(indegree); const queue2: string[] = starts.map((node: any) => String(node.id)); let count = 0;
  while (queue2.length) { const id = queue2.shift()!; count += 1; for (const edge of edges.filter((item: any) => item.source === id)) { const value = (work.get(edge.target) ?? 0) - 1; work.set(edge.target, value); if (value === 0) queue2.push(edge.target); } }
  if (count !== nodes.length) throw new Error('工作流定义包含循环依赖');
}
