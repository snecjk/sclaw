import { randomUUID } from 'node:crypto';
import type { RunCtx } from './types';
const nowIso = () => new Date().toISOString();

export interface GeneratePlanArgs { repo: RunCtx['repo']; dslClient: { fetchVersion(workflowId: string, versionId: string): Promise<any> };
  workflowId: string; versionId: string; runId?: string; input: any; startedAt: string; }

export async function generatePlan(args: GeneratePlanArgs): Promise<string> {
  const { repo, dslClient, workflowId, versionId, input, startedAt } = args;
  const runId = args.runId ?? randomUUID();
  const ver = await dslClient.fetchVersion(workflowId, versionId);
  const definition = ver.definition ?? ver.workflow ?? ver;
  const nodes: any[] = definition.nodes ?? [];
  const ordered = topoSort(nodes, definition.edges ?? []);
  await repo.upsertRun({ run_id: runId, workflow_id: workflowId, version_id: versionId,
    status: 'RUNNING', mode: 'CLIENT_LOCAL', source: 'client',
    input_json: JSON.stringify(input ?? {}), definition_json: JSON.stringify(definition),
    started_at: startedAt, updated_at: nowIso() });
  for (const n of ordered) {
    await repo.upsertNodeRun({ run_id: runId, node_id: n.id, node_type: n.type, status: 'PENDING', attempt_count: 0 });
  }
  await repo.enqueueOutbox(runId, 'run', runId, { run_id: runId, workflow_id: workflowId,
    version_id: versionId, status: 'RUNNING', mode: 'CLIENT_LOCAL', source: 'client',
    started_at: startedAt }, 'progress');
  return runId;
}

function topoSort(nodes: any[], edges: any[]): any[] {
  const indeg = new Map<string, number>(); const adj = new Map<string, string[]>();
  nodes.forEach(n => { indeg.set(n.id, 0); adj.set(n.id, []); });
  edges.forEach(e => { adj.get(e.source)?.push(e.target); indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1); });
  const q = nodes.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id);
  const out: any[] = [];
  while (q.length) { const id = q.shift()!; const n = nodes.find(x => x.id === id); if (n) out.push(n);
    for (const t of adj.get(id) ?? []) { indeg.set(t, (indeg.get(t) ?? 0) - 1); if ((indeg.get(t) ?? 0) === 0) q.push(t); } }
  return out.length === nodes.length ? out : nodes;  // cycle → preserve original order
}
