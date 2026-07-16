import { randomUUID } from 'node:crypto';
import type { RunCtx } from './types';
import { workflowExecLog } from './logging';
import { formatShanghaiIso } from '../../../shared/workflow-timestamp';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { workspacePath } from './workspace-paths';
const nowIso = () => formatShanghaiIso();

export interface GeneratePlanArgs { repo: RunCtx['repo']; dslClient: { fetchVersion(workflowId: string, versionId: string): Promise<any> };
  workflowId: string; versionId: string; runId?: string; input: any; startedAt: string;
  /** 会话键——emit 桥按它过滤 status-update 广播（use-workflow-completion.ts）。Phase 2b 由 start 注册传入。 */
  sessionKey?: string;
}

/**
 * 本地执行计划生成入口。
 *
 * 负责按 workflowId/versionId 拉取版本 DSL，解析节点与边，初始化 wf_run、
 * wf_node_run(PENDING) 和 run outbox。它只“准备执行计划”，真正的节点启动与流转
 * 在 engine.dispatch 中完成。
 */
export async function generatePlan(args: GeneratePlanArgs): Promise<string> {
  const { repo, dslClient, workflowId, versionId, input, startedAt, sessionKey } = args;
  const runId = args.runId ?? randomUUID();
  const stagedInput = await stageInputArtifacts(input ?? {}, runId);
  workflowExecLog('info', 'plan-start', 'generating local workflow plan', {
    runId,
    workflowId,
    versionId,
    sessionKey,
    inputKeys: Object.keys(input ?? {}).join(','),
  });
  const versionDefinition = await dslClient.fetchVersion(workflowId, versionId);
  const definition = versionDefinition?.definition ?? versionDefinition?.workflow ?? versionDefinition;
  const nodes: any[] = definition.nodes ?? [];
  validateWorkflowDefinition(definition);
  const ordered = topoSort(nodes, definition.edges ?? []);
  workflowExecLog('info', 'plan-definition', 'workflow definition resolved', {
    runId,
    workflowId,
    versionId,
    nodeCount: nodes.length,
    edgeCount: (definition.edges ?? []).length,
  });
  await repo.upsertRun({ run_id: runId, workflow_id: workflowId, version_id: versionId,
    status: 'RUNNING', mode: 'CLIENT_LOCAL', source: 'client',
    input_json: JSON.stringify(stagedInput), definition_json: JSON.stringify(definition),
    started_at: startedAt, updated_at: nowIso(),
    session_key: sessionKey });
  for (const n of ordered) {
    const nodeRun = { run_id: runId, node_id: n.id, node_type: n.type, status: 'PENDING', attempt_count: 0 };
    await repo.upsertNodeRun(nodeRun);
    // 云端从运行开始就应拥有完整节点清单，不能等节点真正执行时才创建镜像。
    // 这样即使第一个节点失败，管理端仍能展示所有后续 PENDING 节点。
    await repo.enqueueOutbox(runId, 'node_run', `${runId}:${n.id}`, nodeRun, 'progress');
  }
  for (const [key, artifact] of collectInputArtifacts(stagedInput)) {
    const artifactId = `${runId}:input:${key}`;
    const row = { artifact_id: artifactId, run_id: runId, node_id: 'input', kind: 'INPUT',
      uri: artifact.uri, file_path: artifact.filePath, content_type: artifact.contentType,
      summary: artifact.name ?? key, created_at: nowIso() };
    await repo.upsertArtifact(row);
    await repo.enqueueOutbox(runId, 'artifact', artifactId, row, 'progress');
  }
  await repo.enqueueOutbox(runId, 'run', runId, { run_id: runId, workflow_id: workflowId,
    version_id: versionId, status: 'RUNNING', mode: 'CLIENT_LOCAL', source: 'client',
    started_at: startedAt }, 'progress');
  workflowExecLog('info', 'plan-ready', 'local workflow plan persisted', {
    runId,
    workflowId,
    versionId,
    nodeRunCount: ordered.length,
  });
  return runId;
}

async function stageInputArtifacts(input: any, runId: string): Promise<any> {
  if (!input || typeof input !== 'object') return input;
  const artifacts = collectInputArtifacts(input);
  if (!artifacts.length) return input;
  const staged = { ...input };
  const directory = workspacePath(runId, 'input');
  for (const [key, artifact] of artifacts) {
    if (!artifact.filePath) continue;
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${key}-${path.basename(artifact.filePath)}`);
    await copyFile(artifact.filePath, target);
    staged[key] = { ...artifact, filePath: target, uri: pathToFileURL(target).href };
  }
  return staged;
}

function collectInputArtifacts(input: any): Array<[string, any]> {
  if (!input || typeof input !== 'object') return [];
  return Object.entries(input).filter(([, value]: [string, any]) =>
    value && typeof value === 'object' && (value.kind === 'artifact' || value.filePath || value.uri));
}

export function topoSort(nodes: any[], edges: any[]): any[] {
  const indeg = new Map<string, number>(); const adj = new Map<string, string[]>();
  nodes.forEach(n => { indeg.set(n.id, 0); adj.set(n.id, []); });
  edges.forEach(e => { adj.get(e.source)?.push(e.target); indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1); });
  const q = nodes.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id);
  const out: any[] = [];
  while (q.length) { const id = q.shift()!; const n = nodes.find(x => x.id === id); if (n) out.push(n);
    for (const t of adj.get(id) ?? []) { indeg.set(t, (indeg.get(t) ?? 0) - 1); if ((indeg.get(t) ?? 0) === 0) q.push(t); } }
  if (out.length !== nodes.length) throw new Error('工作流定义包含循环依赖');
  return out;
}

export function findStartNode(nodes: any[], edges: any[]): any | undefined {
  const incoming = new Set(edges.map((edge) => edge.target));
  return nodes.find((node) => !incoming.has(node.id));
}

export function validateWorkflowDefinition(definition: any): void {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  if (!nodes.length) throw new Error('工作流定义没有节点');
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node?.id || !node?.type) throw new Error('工作流节点缺少 id 或 type');
    if (ids.has(node.id)) throw new Error(`工作流节点 ID 重复: ${node.id}`);
    ids.add(node.id);
  }
  for (const edge of edges) {
    if (!ids.has(edge?.source) || !ids.has(edge?.target)) {
      throw new Error(`工作流连线引用不存在节点: ${edge?.source ?? '?'} -> ${edge?.target ?? '?'}`);
    }
  }
  topoSort(nodes, edges);
  if (!findStartNode(nodes, edges)) throw new Error('工作流定义没有可执行起点');
}
