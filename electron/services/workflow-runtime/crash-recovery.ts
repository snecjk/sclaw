/**
 * crash-recovery — 启动时收口 + 续跑（spec §8）。
 *
 * - recoverOnLaunch：在途 run（RUNNING/WAITING_APPROVAL/WAITING_INPUT）→ 标 INTERRUPTED
 *   + 在途 node_run 标 INTERRUPTED + outbox(terminal)；弹窗让用户选续跑/重发（onRecover 回调收集）。
 * - resumeRun：加载 wf_run.definition_json + wf_node_run，跳过 SUCCEEDED，从首个非 SUCCEEDED 节点
 *   恢复执行（上游输出从 wf_node_run.output_json 取）。被中断的 agent 节点从节点边界以干净会话重启，
 *   action 节点 echo 安全。
 *
 * 不自动续跑——由用户选（避免副作用幂等未覆盖的节点自动重跑）。
 */
import type { WorkflowRuntimeRepository } from '../../db/repositories/workflow-runtime-repository';
import type { WorkflowRunStatus } from '../../../shared/workflow-run-status';
import { workflowExecLog } from './logging';
import { formatShanghaiIso } from '../../../shared/workflow-timestamp';
import { topoSort } from './plan-generator';

const nowIso = () => formatShanghaiIso();

export interface RecoverDeps {
  repo: WorkflowRuntimeRepository;
  onRecover?: (runs: any[]) => void;  // 把在途 run 列表交给 renderer 弹窗
  /** 状态转换桥（gap2）：INTERRUPTED 收口时同步广播，使 UI 卡片落 failed 状态。 */
  onStatusChange?: (runId: string, status: WorkflowRunStatus, extra?: { waitingNodeId?: string; error?: string }) => void;
}

export async function recoverOnLaunch(deps: RecoverDeps): Promise<void> {
  const stuck = await deps.repo.listRunsByStatus(['RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT']);
  workflowExecLog('info', 'recover-scan', 'workflow runtime recovery scan completed', { stuckCount: stuck.length });
  for (const r of stuck) {
    workflowExecLog('warn', 'recover-interrupt', 'interrupting unfinished workflow run on launch', {
      runId: r.run_id,
      workflowId: r.workflow_id,
      versionId: r.version_id,
      status: r.status,
    });
    await deps.repo.upsertRun({ ...r, status: 'INTERRUPTED', completed_at: nowIso(), updated_at: nowIso() });
    await deps.repo.markInflightNodeRunsInterrupted(r.run_id);
    const nodeRuns = await deps.repo.listNodeRuns(r.run_id);
    for (const nodeRun of nodeRuns) {
      await deps.repo.enqueueOutbox(r.run_id, 'node_run', `${r.run_id}:${nodeRun.node_id}`, nodeRun, 'progress');
    }
    await deps.repo.enqueueOutbox(r.run_id, 'run', r.run_id, { ...r, status: 'INTERRUPTED' }, 'terminal');
    deps.onStatusChange?.(r.run_id, 'failed', { error: 'interrupted' });
  }
  deps.onRecover?.(stuck);
}

/**
 * 续跑：把 INTERRUPTED 或用户主动 CANCELLED 的 run 恢复为 RUNNING，返回该 run 的快照供 engine 继续调度。
 * engine 从 wf_node_run 找首个非 SUCCEEDED 节点重跑（上游输出从 wf_node_run.output_json 取）。
 */
export async function resumeRun(
  repo: WorkflowRuntimeRepository,
  runId: string,
): Promise<{ runId: string; definition: any; startNodeId?: string } | null> {
  const run = await repo.getRun(runId);
  if (!run || !['INTERRUPTED', 'CANCELLED'].includes(run.status)) {
    workflowExecLog('warn', 'recover-resume-skip', 'workflow run is not resumable', { runId, status: run?.status });
    return null;
  }
  await repo.upsertRun({ ...run, status: 'RUNNING', completed_at: null, updated_at: nowIso() });
  let definition: any;
  try {
    definition = run.definition_json ? JSON.parse(run.definition_json) : {};
  } catch {
    definition = {};
  }
  const nodeRuns = await repo.listNodeRuns(runId);
  const statusByNode = new Map(nodeRuns.map((nodeRun) => [nodeRun.node_id, nodeRun.status]));
  const ordered = topoSort(definition.nodes ?? [], definition.edges ?? []);
  const firstUnfinished = ordered.find((node) => statusByNode.get(node.id) !== 'SUCCEEDED');
  const interruptedNodeRun = firstUnfinished
    ? nodeRuns.find((nodeRun) => nodeRun.node_id === firstUnfinished.id && nodeRun.status === 'INTERRUPTED')
    : undefined;
  if (interruptedNodeRun) {
    // Resume from the durable node boundary. Completed upstream checkpoints
    // stay intact, while partial output and the aborted Agent session do not.
    await repo.upsertNodeRun({
      ...interruptedNodeRun,
      run_id: runId,
      status: 'PENDING',
      agent_session_id: null,
      input_json: null,
      output_json: null,
      prompt_text: null,
      last_completion_issue: null,
      started_at: null,
      completed_at: null,
    });
  }
  workflowExecLog('info', 'recover-resume-ready', 'workflow run prepared for resume', {
    runId,
    workflowId: run.workflow_id,
    versionId: run.version_id,
    startNodeId: firstUnfinished?.id,
  });
  return { runId, definition, startNodeId: firstUnfinished?.id };
}
