/**
 * WorkflowRuntimeEngine — 主入口（spec §整体数据流 + Plan 2 Task 12）。
 *
 * 组装：PlanGenerator → NodeDispatcher（逻辑/智能/审批输入分派）→ OutboxFlusher →
 * ArtifactUploader → CrashRecovery。IPC 暴露发起/查进度/取消；主进程启动时 recover + flushLoop。
 *
 * 智能节点（agent_*）经 agent-retry 跑（attempt 循环 + 配额门 + retry-context + 双层卡死），
 * invokeAgent 由 createEngine 注入（引擎绑好 sdk+env+卡死保护）。
 * 逻辑节点（transform/condition/action/output/trigger/startup_config）经 logic-nodes。
 * 审批/输入节点暂停（Electron 弹窗决策后 resumeApproval/resumeInput 继续）。
 */
import type { WorkflowRuntimeRepository } from '../../db/repositories/workflow-runtime-repository';
import type { RunCtx } from './types';
import { executeLogicNode } from './logic-nodes';
import { runAgentNodeWithRetry, type InvokeAgentFn } from './agent-retry';
import { compileAgentRunSpec } from './agent-spec';
import { startFlushLoop, stopFlushLoop, type FlushDeps } from './outbox-flusher';
import { uploadArtifact, type ArtifactRow } from './artifact-uploader';
import { recoverOnLaunch, resumeRun } from './crash-recovery';
import { cancelAgent } from './agent-runner';

const SMART_TYPES = new Set(['agent_task', 'agent_data_fetch', 'agent_data_process', 'agent_condition', 'agent_output']);
const nowIso = () => new Date().toISOString();

export interface EngineDeps {
  repo: WorkflowRuntimeRepository;
  invokeAgent: InvokeAgentFn;            // 引擎绑 sdk+env+卡死保护后注入
  quota?: () => Promise<boolean>;          // /api/token-quota/check
  postSync: FlushDeps['postSync'];        // POST /agent/v2/runs/{id}/sync
  onTokenExpired?: () => void;
  uploadOssFile?: any;                     // uploadOssFile（artifact-uploader）
  onRecover?: (runs: any[]) => void;
}

export interface StartRunArgs {
  workflowId: string; versionId: string; runId: string; input: any;
  definition: any; startedAt: string;   // definition 已拉取（PlanGenerator 或外部注入）
}

export function createEngine(deps: EngineDeps) {
  const repo = deps.repo;

  // 给 agent-retry 用的 ctx.emit：写事件流水
  const makeCtx = (runId: string, def: any, seqRef: { n: number }): RunCtx => ({
    runId, workflowId: '', versionId: '', definition: def, repo,
    emit: async (type: string, payload: any, nodeId?: string) => {
      await repo.insertEvent({ run_id: runId, sequence: ++seqRef.n, type, node_id: nodeId, message: JSON.stringify(payload) });
    },
  });

  async function dispatch(runId: string, def: any, startNodeId?: string): Promise<void> {
    const nodes: any[] = def?.nodes ?? [];
    const edges: any[] = def?.edges ?? [];
    const seqRef = { n: 0 };
    let cur = startNodeId ? nodes.find((n) => n.id === startNodeId) : nodes[0];
    while (cur) {
      await repo.upsertNodeRun({ run_id: runId, node_id: cur.id, node_type: cur.type, status: 'RUNNING', started_at: nowIso() });
      await repo.enqueueOutbox(runId, 'node_run', `${runId}:${cur.id}`, { run_id: runId, node_id: cur.id, status: 'RUNNING' }, 'progress');
      let result: { action: 'continue' | 'pause'; output?: any };
      let upstream: any = {}; // 简化：上游输出 map（生产从 wf_node_run.output_json 取）
      if (SMART_TYPES.has(cur.type)) {
        const spec = compileAgentRunSpec(cur, makeCtx(runId, def, seqRef));
        const agentResult = await runAgentNodeWithRetry(makeCtx(runId, def, seqRef), cur, spec, { invokeAgent: deps.invokeAgent, quota: deps.quota });
        result = { action: agentResult.status === 'succeeded' ? 'continue' : 'pause', output: agentResult.output };
        if (agentResult.status === 'failed') {
          await repo.upsertRun({ run_id: runId, status: 'FAILED', error: agentResult.error, completed_at: nowIso(), updated_at: nowIso() });
          await repo.enqueueOutbox(runId, 'run', runId, { run_id: runId, status: 'FAILED', error: agentResult.error }, 'terminal');
          return;
        }
      } else if (cur.type === 'human_approval' || cur.type === 'user_input') {
        const st = cur.type === 'human_approval' ? 'WAITING_APPROVAL' : 'WAITING_INPUT';
        await repo.upsertRun({ run_id: runId, status: st, waiting_node_id: cur.id, updated_at: nowIso() });
        await repo.enqueueOutbox(runId, 'run', runId, { run_id: runId, status: st, waiting_node_id: cur.id }, 'progress');
        return; // 暂停，Electron 弹窗决策后 resumeApproval/resumeInput 继续
      } else {
        result = await executeLogicNode(cur, upstream, makeCtx(runId, def, seqRef));
      }
      await repo.upsertNodeRun({ run_id: runId, node_id: cur.id, status: 'SUCCEEDED', output_json: JSON.stringify(result.output ?? {}), completed_at: nowIso() });
      await repo.enqueueOutbox(runId, 'node_run', `${runId}:${cur.id}`, { run_id: runId, node_id: cur.id, status: 'SUCCEEDED', output_json: JSON.stringify(result.output ?? {}) }, 'progress');
      cur = nextNode(cur, edges, nodes, result.output);
    }
    await repo.upsertRun({ run_id: runId, status: 'SUCCEEDED', completed_at: nowIso(), updated_at: nowIso() });
    await repo.enqueueOutbox(runId, 'run', runId, { run_id: runId, status: 'SUCCEEDED', completed_at: nowIso() }, 'terminal');
  }

  return {
    async startRun(args: StartRunArgs): Promise<void> {
      // 若未传 definition，可走 generatePlan 拉取；这里 definition 已由外部拉取注入
      await dispatch(args.runId, args.definition);
    },
    async resumeRun(runId: string): Promise<void> {
      const r = await resumeRun(repo, runId);
      if (r) await dispatch(r.runId, r.definition);
    },
    async resumeApproval(runId: string, _nodeId: string, _decision: any): Promise<void> {
      await repo.upsertRun({ run_id: runId, status: 'RUNNING', waiting_node_id: undefined, updated_at: nowIso() });
      const run = await repo.getRun(runId);
      if (run) await dispatch(runId, run.definition_json ? JSON.parse(run.definition_json) : {});
    },
    cancel(runId: string, nodeId: string): void {
      cancelAgent(runId, nodeId);
    },
    async recover(): Promise<void> {
      await recoverOnLaunch({ repo, onRecover: deps.onRecover });
    },
    startSync(): void {
      startFlushLoop({ repo, postSync: deps.postSync, onTokenExpired: deps.onTokenExpired });
    },
    stopSync(): void {
      stopFlushLoop();
    },
    // 供 NodeDispatcher 在智能节点产出 artifact 后调
    async uploadArtifact(art: ArtifactRow): Promise<void> {
      await uploadArtifact({ repo, uploadOssFile: deps.uploadOssFile }, art);
    },
  };
}

/** 选下一节点（移植 _resolve_next_node 的简化版）。 */
function nextNode(cur: any, edges: any[], nodes: any[], output: any): any {
  // condition 节点：按 output.branch 选带 branch 标签的边
  const branch = output?.branch ?? output?.branchKey;
  let edge: any;
  if (branch) {
    edge = edges.find((e: any) => e.source === cur.id && (e.branch === branch || e.branchKey === branch || e.label === branch))
      ?? edges.find((e: any) => e.source === cur.id);
  } else {
    edge = edges.find((e: any) => e.source === cur.id);
  }
  if (!edge) return null;
  return nodes.find((n: any) => n.id === edge.target) ?? null;
}
