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
  /** 本地 DB 权威读；默认 status 视图，detail/diagnostic 必须显式请求。 */
  getRun: (runId: string, options?: { view?: WorkflowRunView }) => Promise<any | null>;
  resume: (runId: string) => Promise<void>;
  cancel: (runId: string, nodeId: string) => Promise<void>;
  resumeInput: (runId: string, nodeId: string, submittedData: any) => Promise<void>;
  recover: () => Promise<void>;
  startSync: () => void;
  stopSync: () => void;
  retrySync: (runId?: string) => Promise<void>;
}

export type WorkflowStartAcceptance =
  | { accepted: true; runId: string; replay: boolean }
  | { accepted: false; runId: string; error: string };

export type WorkflowRunView = 'status' | 'detail' | 'diagnostic';

export function registerWorkflowRuntimeHandlers(deps: EngineDeps): RuntimeHandlers {
  const engine = createEngine(deps);
  const repo = deps.repo;
  const startAcceptances = new Map<string, Promise<WorkflowStartAcceptance>>();
  const acceptWorkflowStart = (args: StartWorkflowArgs): Promise<WorkflowStartAcceptance> => {
    const runId = args?.runId?.trim() ?? '';
    const existingOperation = startAcceptances.get(runId);
    if (existingOperation) return existingOperation;
    const operation = (async (): Promise<WorkflowStartAcceptance> => {
      try {
        if (!runId || !args.workflowId?.trim() || !args.versionId?.trim()) {
          return { accepted: false, runId, error: 'workflow start identity is incomplete' };
        }
        if (!Number.isSafeInteger(args.runDatabaseId) || args.runDatabaseId <= 0) {
          return { accepted: false, runId, error: 'workflow runDatabaseId must be a positive JavaScript-safe integer' };
        }
        const existing = await repo.getRun(runId);
        if (existing) {
          const sameIdentity = String(existing.workflow_id) === args.workflowId
            && String(existing.version_id) === args.versionId
            && String(existing.session_key ?? '') === String(args.sessionKey ?? '');
          return sameIdentity
            ? { accepted: true, runId, replay: true }
            : { accepted: false, runId, error: 'workflow runId is already bound to a different workflow identity' };
        }
        await repo.upsertRun({
          id: args.runDatabaseId,
          run_id: runId,
          workflow_id: args.workflowId,
          version_id: args.versionId,
          workflow_version: args.workflowVersion ?? null,
          status: 'RUNNING',
          mode: 'CLIENT_LOCAL',
          source: 'client',
          trigger_type: args.triggerType ?? (args.chatCard ? 'chat' : 'workflow_manual'),
          input_json: JSON.stringify(args.input ?? {}),
          definition_json: '{}',
          started_at: args.startedAt,
          session_key: args.sessionKey,
          engine_type: args.engineType,
          engine_model: args.engineModel ?? null,
          chat_card_visible: args.chatCard ? 1 : 0,
          chat_anchor_user_message_id: args.chatCard?.anchorUserMessageId ?? null,
          chat_card_title: args.chatCard?.title ?? null,
          chat_params_summary: args.chatCard?.paramsSummary ?? null,
        });
        void engine.startWorkflow(args).catch((error) => {
          workflowExecLog('error', 'ipc-start-failed', 'workflow runtime start failed', {
            runId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return { accepted: true, runId, replay: false };
      } catch (error) {
        return {
          accepted: false,
          runId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })();
    startAcceptances.set(runId, operation);
    void operation.finally(() => {
      if (startAcceptances.get(runId) === operation) startAcceptances.delete(runId);
    });
    return operation;
  };
  const loadRun = async (runId: string, options: { view?: WorkflowRunView } = {}) => {
    const view = options.view ?? 'status';
    const diagnostic = view === 'diagnostic';
    const row = diagnostic
      ? await repo.getRun(runId)
      : await repo.getRunSummary(runId, { includeTimelineText: view === 'detail' });
    if (!row) return null;
    const includeTimeline = view === 'detail' || diagnostic;
    const waitingApproval = String(row.status).toUpperCase() === 'WAITING_APPROVAL';
    const waitingInput = String(row.status).toUpperCase() === 'WAITING_INPUT';
    const [nodeRuns, events, approvalTasks, userInputTasks, artifacts] = await Promise.all([
      diagnostic ? repo.listNodeRuns(runId) : repo.listNodeRunSummaries(runId),
      includeTimeline ? repo.listEvents(runId) : Promise.resolve([]),
      diagnostic || waitingApproval ? repo.listApprovalTasks(runId) : Promise.resolve([]),
      diagnostic || waitingInput ? repo.listUserInputTasks(runId) : Promise.resolve([]),
      repo.listArtifacts(runId),
    ]);
    return mapWfRunRowToResponse(row, { view, nodeRuns, events, approvalTasks, userInputTasks, artifacts });
  };
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
      requestedExecEngine: a?.engineType,
    });
    return acceptWorkflowStart(a);
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
  // Renderer hydration defaults to compact status; Designer explicitly asks for detail.
  ipcMain.handle('workflow-runtime:getRun', async (_e, arg: string | { runId: string; view?: WorkflowRunView }) => {
    const runId = typeof arg === 'string' ? arg : arg.runId;
    const view = typeof arg === 'string' ? 'status' : (arg.view ?? 'status');
    workflowExecLog('debug', 'ipc-get-run', 'received workflow getRun ipc', { runId, view });
    return loadRun(runId, { view });
  });
  ipcMain.handle('workflow-runtime:registerChatCard', async (_e, arg: {
    runId?: string;
    sessionKey?: string;
    anchorUserMessageId?: string | null;
    title?: string | null;
    paramsSummary?: string | null;
  }) => {
    if (!arg?.runId || !arg?.sessionKey) return { registered: false };
    const registered = await repo.registerChatRunCard(arg.runId, {
      sessionKey: arg.sessionKey,
      anchorUserMessageId: arg.anchorUserMessageId,
      title: arg.title,
      paramsSummary: arg.paramsSummary,
    });
    return { registered };
  });
  ipcMain.handle('workflow-runtime:listChatCards', async (_e, sessionKey: unknown) => {
    if (typeof sessionKey !== 'string' || !sessionKey.trim()) return [];
    const rows = await repo.listChatRunCardRefsBySession(sessionKey);
    return rows.map((row) => ({
      runId: row.run_id,
      sessionKey: row.session_key,
      anchorUserMessageId: row.chat_anchor_user_message_id ?? null,
      title: row.chat_card_title ?? row.workflow_id ?? '工作流',
      paramsSummary: row.chat_params_summary ?? null,
      startedAt: row.started_at,
    }));
  });
  ipcMain.handle('workflow-runtime:getChatCard', async (_e, runId: unknown) => {
    if (typeof runId !== 'string' || !runId.trim()) return null;
    if (!(await repo.isChatRunCardVisible(runId))) return null;
    return loadRun(runId, { view: 'status' });
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
      workflowVersion: resolveWorkflowVersion(row),
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
    startWorkflow: async (a) => {
      const acceptance = await acceptWorkflowStart(a);
      if (!acceptance.accepted) throw new Error(acceptance.error);
    },
    getRun: loadRun,
    resume: (runId) => engine.resumeRun(runId),
    cancel: (runId, nodeId) => engine.cancel(runId, nodeId),
    resumeInput: (runId, nodeId, submittedData) => engine.resumeInput(runId, nodeId, submittedData),
    recover: () => engine.recover(),
    startSync: () => engine.startSync(),
    stopSync: () => engine.stopSync(),
    retrySync: (runId) => engine.retrySync(runId),
  };
}

/** Older local rows predate wf_run.workflow_version; infer from their persisted DSL when possible. */
function resolveWorkflowVersion(row: { workflow_version?: unknown; definition_json?: unknown }): string | number | null {
  const stored = normalizeWorkflowVersion(row.workflow_version);
  if (stored != null) return stored;
  if (typeof row.definition_json !== 'string') return null;
  try {
    return normalizeWorkflowVersion(JSON.parse(row.definition_json)?.version);
  } catch {
    return null;
  }
}

function normalizeWorkflowVersion(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}
