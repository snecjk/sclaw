/**
 * workflow-runtime IPC 暴露 + Electron 主进程注册（Plan 2 Task 12）。
 *
 * 主进程启动时：engine.recover()（收口在途 run）+ engine.startSync()（起 outbox flushLoop）。
 * renderer 经 IPC：workflow-runtime:start / :resume / :cancel / :resumeApproval / :resumeInput。
 */
import { ipcMain } from 'electron';
import { createEngine, type EngineDeps, type StartWorkflowArgs } from './engine';
import { mapWfRunRowToResponse } from './mapper';
import { workflowExecLog } from './logging';
import { takeWorkflowDatabaseId } from './id-pool';

export interface RuntimeHandlers {
  start: (a: any) => Promise<void>;
  /** 端到端发起：拉 DSL → generatePlan 落本地计划 → dispatch。供 IPC `workflow-runtime:start`
   * 及主进程内同进程调用（loopback HTTP 本地路由 /agent/v2/workflows/:id/createRunLog）使用。 */
  startWorkflow: (a: StartWorkflowArgs) => Promise<void>;
  /** 本地 DB 权威读：wf_run + wf_node_run → WorkflowRunResponse。供 IPC `workflow-runtime:getRun`
   * 及主进程内同进程调用（loopback HTTP 本地路由 /agent/v2/runs/:runId）使用。 */
  getRun: (runId: string) => Promise<any | null>;
  resume: (runId: string) => Promise<void>;
  cancel: (runId: string, nodeId: string) => Promise<void>;
  resumeInput: (runId: string, nodeId: string, submittedData: any) => Promise<void>;
  recover: () => Promise<void>;
  startSync: () => void;
  stopSync: () => void;
  retrySync: (runId?: string) => Promise<void>;
}

export function registerWorkflowRuntimeHandlers(deps: EngineDeps): RuntimeHandlers {
  const engine = createEngine(deps);
  const repo = deps.repo;
  /**
   * renderer → main 的本地工作流启动 IPC。
   *
   * src/lib/workflow-api.ts:startWorkflowLocal fire-and-forget 调用该 channel；
   * handler 内部会 await engine.startWorkflow，直到流程进入终态或等待人工节点。
   */
  ipcMain.handle('workflow-runtime:start', async (_e, a) => {
    workflowExecLog('info', 'ipc-start', 'received workflow runtime start ipc', {
      runId: a?.runId,
      workflowId: a?.workflowId,
      versionId: a?.versionId,
      sessionKey: a?.sessionKey,
    });
    void engine.startWorkflow(a).catch((error) => {
      workflowExecLog('error', 'ipc-start-failed', 'workflow runtime start failed', {
        runId: a?.runId, error: error instanceof Error ? error.message : String(error),
      });
    });
    return { accepted: true, runId: a?.runId };
  });
  ipcMain.handle('workflow-runtime:takeDatabaseId', async () => takeWorkflowDatabaseId());
  ipcMain.handle('workflow-runtime:resume', async (_e, runId: string) => {
    workflowExecLog('info', 'ipc-resume', 'received workflow runtime resume ipc', { runId });
    await engine.resumeRun(runId);
  });
  ipcMain.handle('workflow-runtime:cancel', async (_e, arg: string | { runId: string; nodeId?: string }) => {
    const runId = typeof arg === 'string' ? arg : arg.runId;
    const nodeId = typeof arg === 'string' ? '' : (arg.nodeId ?? '');
    workflowExecLog('warn', 'ipc-cancel', 'received workflow runtime cancel ipc', { runId, nodeId });
    await engine.cancel(runId, nodeId);
  });
  ipcMain.handle('workflow-runtime:resumeApproval', async (_e, { runId, nodeId, decision }: any) => {
    workflowExecLog('info', 'ipc-approval-resume', 'received workflow approval resume ipc', { runId, nodeId, decision });
    await engine.resumeApproval(runId, nodeId, decision);
  });
  ipcMain.handle('workflow-runtime:resumeInput', async (_e, { runId, nodeId, submittedData }: any) => {
    workflowExecLog('info', 'ipc-input-resume', 'received workflow input resume ipc', { runId, nodeId, submittedKeys: Object.keys(submittedData ?? {}).join(',') });
    await engine.resumeInput(runId, nodeId, submittedData);
  });
  // gap3 hydration：renderer 重载后据此取回本地执行体状态（wf_run + wf_node_run）。
  ipcMain.handle('workflow-runtime:getRun', async (_e, runId: string) => {
    workflowExecLog('debug', 'ipc-get-run', 'received workflow getRun ipc', { runId });
    const row = await repo.getRun(runId);
    if (!row) return null;
    const nodeRuns = await repo.listNodeRuns(runId);
    const events = await repo.listEvents(runId);
    const [approvalTasks, userInputTasks, artifacts] = await Promise.all([
      repo.listApprovalTasks(runId), repo.listUserInputTasks(runId), repo.listArtifacts(runId),
    ]);
    return mapWfRunRowToResponse(row, { nodeRuns, events, approvalTasks, userInputTasks, artifacts });
  });
  /**
   * 查询当前工作流保存在本机的运行摘要，供画布「本地运行记录」弹窗使用。
   * 详情仍必须通过 getRun 按 runId 单独读取，避免一次 IPC 传输所有事件和产物。
   */
  ipcMain.handle('workflow-runtime:listRuns', async (_e, workflowId: unknown) => {
    if (typeof workflowId !== 'string' || !workflowId.trim()) return [];
    const rows = await repo.listLocalRunSummaries(workflowId.trim());
    return rows.map((row) => ({
      runId: row.run_id,
      workflowId: row.workflow_id,
      versionId: row.version_id,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? null,
    }));
  });
  ipcMain.handle('workflow-runtime:retrySync', async (_e, runId?: string) => {
    await engine.retrySync(runId);
    return { accepted: true };
  });
  return {
    start: (a) => engine.startRun(a),
    startWorkflow: (a) => engine.startWorkflow(a),
    getRun: async (runId) => {
      const row = await repo.getRun(runId);
      if (!row) return null;
      const nodeRuns = await repo.listNodeRuns(runId);
      const events = await repo.listEvents(runId);
      const [approvalTasks, userInputTasks, artifacts] = await Promise.all([
        repo.listApprovalTasks(runId), repo.listUserInputTasks(runId), repo.listArtifacts(runId),
      ]);
      return mapWfRunRowToResponse(row, { nodeRuns, events, approvalTasks, userInputTasks, artifacts });
    },
    resume: (runId) => engine.resumeRun(runId),
    cancel: (runId, nodeId) => engine.cancel(runId, nodeId),
    resumeInput: (runId, nodeId, submittedData) => engine.resumeInput(runId, nodeId, submittedData),
    recover: () => engine.recover(),
    startSync: () => engine.startSync(),
    stopSync: () => engine.stopSync(),
    retrySync: (runId) => engine.retrySync(runId),
  };
}
