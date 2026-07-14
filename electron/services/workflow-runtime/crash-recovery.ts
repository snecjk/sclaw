/**
 * crash-recovery — 启动时收口 + 续跑（spec §8）。
 *
 * - recoverOnLaunch：在途 run（RUNNING/WAITING_APPROVAL/WAITING_INPUT）→ 标 INTERRUPTED
 *   + 在途 node_run 标 INTERRUPTED + outbox(terminal)；弹窗让用户选续跑/重发（onRecover 回调收集）。
 * - resumeRun：加载 wf_run.definition_json + wf_node_run，跳过 SUCCEEDED，从首个非 SUCCEEDED 节点
 *   恢复执行（上游输出从 wf_node_run.output_json 取）。agent 节点重跑靠 retry-context prompt（agent-retry），
 *   action 节点 echo 安全。
 *
 * 不自动续跑——由用户选（避免副作用幂等未覆盖的节点自动重跑）。
 */
import type { WorkflowRuntimeRepository } from '../../db/repositories/workflow-runtime-repository';

const nowIso = () => new Date().toISOString();

export interface RecoverDeps {
  repo: WorkflowRuntimeRepository;
  onRecover?: (runs: any[]) => void;  // 把在途 run 列表交给 renderer 弹窗
}

export async function recoverOnLaunch(deps: RecoverDeps): Promise<void> {
  const stuck = await deps.repo.listRunsByStatus(['RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT']);
  for (const r of stuck) {
    await deps.repo.upsertRun({ ...r, status: 'INTERRUPTED', completed_at: nowIso(), updated_at: nowIso() });
    await (deps.repo as any).markInflightNodeRunsInterrupted?.(r.run_id);
    await deps.repo.enqueueOutbox(r.run_id, 'run', r.run_id, { ...r, status: 'INTERRUPTED' }, 'terminal');
  }
  deps.onRecover?.(stuck);
}

/**
 * 续跑：把 INTERRUPTED run 恢复为 RUNNING，返回该 run 的快照供 engine 继续调度。
 * engine 从 wf_node_run 找首个非 SUCCEEDED 节点重跑（上游输出从 wf_node_run.output_json 取）。
 */
export async function resumeRun(
  repo: WorkflowRuntimeRepository,
  runId: string,
): Promise<{ runId: string; definition: any } | null> {
  const run = await repo.getRun(runId);
  if (!run || run.status !== 'INTERRUPTED') return null;
  await repo.upsertRun({ ...run, status: 'RUNNING', updated_at: nowIso() });
  let definition: any = {};
  try {
    definition = run.definition_json ? JSON.parse(run.definition_json) : {};
  } catch {
    definition = {};
  }
  return { runId, definition };
}
