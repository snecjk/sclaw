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
import type { AgentRunSpec, RunCtx } from './types';
import path from 'node:path';
import { evaluateCondition as evaluateWorkflowCondition, executeLogicNode } from './logic-nodes';
import { runAgentNodeWithRetry, type InvokeAgentFn } from './agent-retry';
import { deriveWorkflowNodeSessionId } from './node-session';
import { flushOnce, startFlushLoop, stopFlushLoop, type FlushDeps } from './outbox-flusher';
import { recordArtifact as persistArtifact, type ArtifactRow } from './artifact-recorder';
import { recoverOnLaunch, resumeRun } from './crash-recovery';
import { cancelAgent } from './agent-runner-claude';
import { cancelOpenClawWorkflowAgent } from './agent-runner-openclaw';
import { findStartNode, generatePlan, validateWorkflowDefinition } from './plan-generator';
import { buildConditionContext, resolveNodeInput } from './input-resolver';
import { workspacePath } from './workspace-paths';
import { workflowExecLog } from './logging';
import { formatShanghaiIso } from '../../../shared/workflow-timestamp';
import { hydrateNodeInputFiles } from './node-input-files';
import { createFailurePacket, createWorkflowPacket, getWorkflowPacketFailureMessage, isWorkflowPacket } from './workflow-packet';
import { normalizeRuntimeDefinition } from './runtime-definition';
import { normalizeArtifactFirstPayloadSchema, promoteCarriedOutputArtifacts } from './artifact-output';

const SMART_TYPES = new Set(['agent_task', 'agent_data_fetch', 'agent_data_process', 'agent_condition', 'agent_output']);
const nowIso = () => formatShanghaiIso();
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);

export interface EngineDeps {
  repo: WorkflowRuntimeRepository;
  invokeAgent: InvokeAgentFn;            // 引擎绑 sdk+env+卡死保护后注入
  quota?: () => Promise<boolean>;          // /api/token-quota/check
  /** Release an engine-owned node session only after its node reaches a terminal state. */
  releaseAgentSession?: (runId: string, nodeSessionId: string) => Promise<void>;
  postSync: FlushDeps['postSync'];        // POST /agent/v2/runs/{id}/sync
  onTokenExpired?: () => void;
  onRecover?: (runs: any[]) => void;
  /** 状态转换桥（gap2）：dispatch 热路径 4 个转换点 + crash-recovery 调用，
   * bootstrap 读 run 行拿 session_key 组装 WorkflowStatusPayload 广播到所有 renderer。 */
  onStatusChange?: (runId: string, status: import('../../../shared/workflow-run-status').WorkflowRunStatus, extra?: { waitingNodeId?: string; error?: string }) => void;
  /** Event bridge for renderer timelines. The event is already durable before this callback fires. */
  onEvent?: (runId: string, event: { sequence: number; type: string; nodeId?: string }) => void;
  dslClient: { fetchVersion(workflowId: string, versionId: string): Promise<any> };  // GET /agent/v2/workflows/getVersion/{version_pk}
}

export interface StartRunArgs {
  workflowId: string; versionId: string; runId: string; input: any;
  definition: any; startedAt: string;   // definition 已拉取（PlanGenerator 或外部注入）
}

/** 端到端发起：renderer 仅给 runId（v2 createRunLog 注册所得）+ workflowId/versionId/input，
 * engine 内部拉 DSL → generatePlan 落本地计划 → dispatch 执行。 */
export interface StartWorkflowArgs {
  runId: string; workflowId: string; versionId: string; input: any; startedAt: string;
  /** 版本序号，供本地运行历史展示；不能用 versionId（数据库主键）替代。 */
  workflowVersion?: string | number | null;
  runDatabaseId: number;
  /** 会话键——透传给 generatePlan 落 wf_run.session_key（emit 桥 + getRun hydration 用）。Phase 2b 由 start 注册传入。 */
  sessionKey?: string;
  /** 本地业务发起入口，仅落 wf_run，不同步云端。 */
  triggerType?: 'chat' | 'scheduled_task' | 'workflow_manual' | 'designer_test' | 'api';
  engineType: 'claude' | 'openclaw';
  engineModel?: string;
  /**
   * Present only for a workflow started from a chat launch tool. Persisting
   * this with the first wf_run upsert makes card discovery independent from
   * renderer tool-result/event delivery.
   */
  chatCard?: {
    title?: string | null;
    paramsSummary?: string | null;
    anchorUserMessageId?: string | null;
  };
}

export function createEngine(deps: EngineDeps) {
  const repo = deps.repo;

  // 给 agent-retry 用的 ctx.emit：写事件流水
  const makeCtx = (runId: string, def: any, seqRef: { n: number }, runtime?: Record<string, any>): RunCtx => ({
    runId, workflowId: String(runtime?.workflowId ?? def?.id ?? ''), versionId: String(runtime?.versionId ?? def?.version ?? ''), definition: def, repo,
    ...(runtime ?? {}),
    emit: async (type: string, payload: any, nodeId?: string) => {
      const event = { run_id: runId, sequence: ++seqRef.n, type, node_id: nodeId,
        tool_id: payload?.toolId ?? payload?.toolName, call_id: payload?.callId,
        skill_id: payload?.skillId, approval_id: payload?.approvalId,
        output_uri: payload?.outputUri, file_path: payload?.filePath,
        reason: payload?.reason, message: JSON.stringify(payload) };
      await repo.insertEvent(event);
      await repo.enqueueOutbox(runId, 'event', `${runId}:${event.sequence}`, event, 'progress');
      deps.onEvent?.(runId, { sequence: event.sequence, type, nodeId });
    },
  });

  /**
   * 节点调度执行核心。
   *
   * 调用来源：
   * - startWorkflow/startRun：从首节点开始执行。
   * - resumeRun/resumeApproval/resumeInput：从恢复点或等待节点的下一个节点继续执行。
   *
   * 关键副作用：
   * - 将每个节点写入 wf_node_run，并在节点进入 RUNNING 时固化 input_json。
   * - 根据节点类型分派到智能节点、逻辑节点、人工审批/输入节点。
   * - 每次状态变化写入 wf_outbox，供同步服务上报 memory-center。
   * - 遇到等待节点会暂停 run；全部节点结束后标记 run 为 SUCCEEDED。
   */
  async function dispatchUnsafe(
    runId: string,
    def: any,
    startNodeId?: string,
    meta?: { workflowId?: string; versionId?: string },
    initialInput?: any,
  ): Promise<void> {
    def = normalizeRuntimeDefinition(def);
    const nodes: any[] = def?.nodes ?? [];
    const edges: any[] = def?.edges ?? [];
    const existingNodeRuns = await repo.listNodeRuns(runId).catch(() => []);
    const seqRef = { n: (await repo.nextEventSequence(runId)) - 1 };
    const upstream = buildUpstreamMap(existingNodeRuns);
    const startupSchema = resolveStartupSchema(def);
    let hasExecutedSmartNode = existingNodeRuns.some((nodeRun) => SMART_TYPES.has(nodeRun.node_type) && nodeRun.status === 'SUCCEEDED');
    const runRow = await Promise.resolve(repo.getRun(runId)).catch(() => undefined);
    const execEngine = runRow?.engine_type === 'openclaw' ? 'openclaw' : 'claude';
    const runInput = initialInput ?? parseJson(runRow?.input_json) ?? {};
    const runSnapshotBase = {
      run_id: runId,
      workflow_id: meta?.workflowId ?? runRow?.workflow_id,
      version_id: meta?.versionId ?? runRow?.version_id,
      mode: 'CLIENT_LOCAL',
      source: 'client',
      started_at: runRow?.started_at ?? nowIso(),
    };
    // 与 memory-center 保持同一语义：仅 output 节点的输出是流程最终输出；
    // last_agent_* 只记录最近一次智能节点执行结果。
    let finalOutputJson = runRow?.output_json ?? undefined;
    workflowExecLog('info', 'dispatch-start', 'dispatching workflow run', {
      runId,
      workflowId: runSnapshotBase.workflow_id,
      versionId: runSnapshotBase.version_id,
      startNodeId,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    });
    validateWorkflowDefinition(def);
    let cur = startNodeId ? nodes.find((n) => n.id === startNodeId) : findStartNode(nodes, edges);
    if (!cur) throw new Error(`找不到工作流恢复节点: ${startNodeId ?? 'start'}`);
    await makeCtx(runId, def, seqRef).emit('workflow.started', { workflowId: runSnapshotBase.workflow_id });

    while (cur) {
      if (!(await isRunActive(runId))) return;
      const runtimeInputs = { runInput, upstream, workflowOutput: parseJson(finalOutputJson) };
      let nodeInput = cur.type === 'condition' || cur.type === 'human_approval'
        ? buildConditionContext(runtimeInputs)
        : resolveNodeInput(cur, runtimeInputs);
      const runtimeUploadFiles = (runInput as any)?.__workflowRuntimeUploads?.[cur.id];
      if (Array.isArray(runtimeUploadFiles) && runtimeUploadFiles.length > 0) {
        const base = nodeInput && typeof nodeInput === 'object' && !Array.isArray(nodeInput) ? nodeInput : {};
        nodeInput = { ...base, files: [...(Array.isArray((base as any).files) ? (base as any).files : []), ...runtimeUploadFiles] };
      }
      const hydratedInput = await hydrateNodeInputFiles(cur, nodeInput, runId);
      nodeInput = hydratedInput.input;
      for (const file of hydratedInput.files) {
        const artifactId = `${runId}:${cur.id}:input:${file.fileId}`;
        const artifact = { artifact_id: artifactId, run_id: runId, node_id: cur.id, kind: 'INPUT',
          uri: file.ossKey ? `artifact://uploads/${file.ossKey}` : file.uri, file_path: file.filePath,
          content_type: file.contentType, summary: file.name, created_at: nowIso() };
        await repo.upsertArtifact(artifact);
        await repo.enqueueOutbox(runId, 'artifact', artifactId, artifact, 'progress');
      }
      const nodeInputJson = stringifyJson(nodeInput);
      workflowExecLog('info', 'node-start', 'workflow node started', {
        runId,
        workflowId: runSnapshotBase.workflow_id,
        versionId: runSnapshotBase.version_id,
        nodeId: cur.id,
        nodeType: cur.type,
        execEngine,
      });
      await repo.upsertNodeRun({ run_id: runId, node_id: cur.id, node_type: cur.type, status: 'RUNNING', input_json: nodeInputJson, started_at: nowIso() });
      await repo.enqueueOutbox(runId, 'node_run', `${runId}:${cur.id}`, { run_id: runId, node_id: cur.id, node_type: cur.type, status: 'RUNNING', input_json: nodeInputJson }, 'progress');
      await makeCtx(runId, def, seqRef).emit('node.started', {
        nodeName: cur.name ?? cur.title ?? cur.id,
        nodeType: cur.type,
      }, cur.id);
      let result: { action: 'continue' | 'pause'; output?: any };
      // 智能节点：编译为 agent run spec 后交给 agent-retry，内部处理配额、重试和卡死保护。
      if (SMART_TYPES.has(cur.type)) {
        // Log before invoking either transport so an initialization, gateway,
        // or model failure still leaves an unambiguous engine audit record.
        workflowExecLog('info', 'agent-engine-selected', 'smart node execution engine selected', {
          runId,
          workflowId: runSnapshotBase.workflow_id,
          nodeId: cur.id,
          nodeType: cur.type,
          execEngine,
        });
        if (cur.type === 'agent_data_fetch'
          && ['runtime_upload', 'mixed'].includes(cur.config?.businessConfig?.inputProvisionMode)
          && !containsArtifact(nodeInput)) {
          throw new Error(`智能取数节点 ${cur.name ?? cur.id} 缺少运行时上传文件`);
        }
        const agentCtx = makeCtx(runId, def, seqRef, {
          resolvedInputs: nodeInput,
          startupInputs: runInput,
          startupSchema,
          isFirstAgentNode: !hasExecutedSmartNode,
          workflowId: runSnapshotBase.workflow_id,
          versionId: runSnapshotBase.version_id,
        });
        const spec = compileLocalAgentSpec(cur, agentCtx, runSnapshotBase.version_id);
        const agentResult = await runAgentNodeWithRetry(agentCtx, cur, spec, {
          invokeAgent: deps.invokeAgent,
          quota: deps.quota,
          execEngine,
        });
        const agentSessionId = deriveWorkflowNodeSessionId(runId, cur.id);
        if (agentResult.status !== 'manual_review' && deps.releaseAgentSession) {
          await deps.releaseAgentSession(runId, agentSessionId).catch((error) => {
            workflowExecLog('warn', 'agent-session-release-failed', 'failed to release terminal node agent session', {
              runId, nodeId: cur.id, error: error instanceof Error ? error.message : String(error),
            });
          });
        }
        if (agentResult.status === 'succeeded') hasExecutedSmartNode = true;
        result = { action: agentResult.status === 'succeeded' ? 'continue' : 'pause', output: agentResult.output };
        if (agentResult.status === 'manual_review') {
          const taskId = `${runId}:${cur.id}`;
          const task = { task_id: taskId, run_id: runId, node_id: cur.id, status: 'PENDING',
            reason: agentResult.error ?? '智能节点输出需要人工复核', requested_at: nowIso() };
          await repo.upsertApprovalTask(task);
          await repo.enqueueOutbox(runId, 'approval', taskId, task, 'progress');
          await repo.upsertNodeRun({ run_id: runId, node_id: cur.id, node_type: cur.type,
            status: 'WAITING_APPROVAL', input_json: nodeInputJson, output_json: stringifyJson(agentResult.output),
            last_completion_issue: agentResult.error, started_at: nowIso() });
          await repo.upsertRun({ run_id: runId, status: 'WAITING_APPROVAL', waiting_node_id: cur.id });
          await repo.enqueueOutbox(runId, 'run', runId, { ...runSnapshotBase, status: 'WAITING_APPROVAL', waiting_node_id: cur.id }, 'progress');
          deps.onStatusChange?.(runId, 'waiting_approval', { waitingNodeId: cur.id });
          return;
        }
        if (agentResult.status === 'failed') {
          const failurePacket = isWorkflowPacket(agentResult.output) ? agentResult.output : createFailurePacket({
            runId, nodeId: cur.id, nodeType: cur.type, attempt: maxNodeAttempt(existingNodeRuns, cur.id),
            code: 'AGENT_EXECUTION_FAILED', category: 'agent_execution', message: agentResult.error ?? '智能节点执行失败', retryable: false,
          });
          const failureMessage = getWorkflowPacketFailureMessage(failurePacket) ?? agentResult.error ?? '智能节点执行失败';
          const finalResult = await buildFailureResult(runId, cur.id, failurePacket);
          const changed = await repo.updateRunIfActive(runId, { status: 'FAILED', error: failureMessage, output_json: stringifyJson(finalResult), completed_at: nowIso() });
          if (!changed) return;
          await repo.upsertNodeRun({ run_id: runId, node_id: cur.id, node_type: cur.type, status: 'FAILED', input_json: nodeInputJson, output_json: stringifyJson(failurePacket), last_completion_issue: failureMessage, completed_at: nowIso() });
          await repo.enqueueOutbox(runId, 'node_run', `${runId}:${cur.id}`, {
            run_id: runId,
            node_id: cur.id,
            node_type: cur.type,
            status: 'FAILED',
            input_json: nodeInputJson,
            output_json: stringifyJson(failurePacket), last_completion_issue: failureMessage,
          }, 'progress');
          await finalizeUnfinishedNodeRuns(runId, 'failed', cur.id);
          await makeCtx(runId, def, seqRef).emit('workflow.failed', { nodeId: cur.id, error: failureMessage, failure: failurePacket }, cur.id);
          await repo.enqueueOutbox(runId, 'run', runId, { ...runSnapshotBase, status: 'FAILED', error: failureMessage, output_json: stringifyJson(finalResult), completed_at: nowIso() }, 'terminal');
          workflowExecLog('error', 'run-failed', 'agent node failed workflow run', {
            runId,
            workflowId: runSnapshotBase.workflow_id,
            versionId: runSnapshotBase.version_id,
            nodeId: cur.id,
            nodeType: cur.type,
            error: failureMessage,
          });
          deps.onStatusChange?.(runId, 'failed', { error: failureMessage });
          return;
        }
        result.output = agentResult.output;
        const lastAgentOutputJson = stringifyJson(result.output ?? {});
        await repo.upsertRun({
          run_id: runId,
          last_agent_output_json: lastAgentOutputJson,
          last_agent_raw_text: agentResult.rawText ?? '',
          error: '',
        });
        await repo.enqueueOutbox(runId, 'run', runId, {
          ...runSnapshotBase,
          status: 'RUNNING',
          last_agent_output_json: lastAgentOutputJson,
          last_agent_raw_text: agentResult.rawText ?? '',
          error: '',
        }, 'progress');
      // 人工节点：创建待办任务并暂停流程，等待 resumeApproval/resumeInput 再继续。
      } else if (cur.type === 'human_approval' || cur.type === 'user_input') {
        if (cur.type === 'human_approval' && cur.config?.condition
          && !evaluateWorkflowCondition(cur.config.condition, buildConditionContext(runtimeInputs))) {
          result = { action: 'continue', output: { skipped: true, reason: 'condition_not_matched' } };
          await repo.upsertNodeRun({ run_id: runId, node_id: cur.id, node_type: cur.type, status: 'SKIPPED', input_json: nodeInputJson, output_json: stringifyJson(result.output), completed_at: nowIso() });
          await repo.enqueueOutbox(runId, 'node_run', `${runId}:${cur.id}`, { run_id: runId, node_id: cur.id, node_type: cur.type, status: 'SKIPPED', input_json: nodeInputJson, output_json: stringifyJson(result.output) }, 'progress');
          upstream[cur.id] = result.output;
          cur = nextNode(cur, edges, nodes, result.output);
          continue;
        }
        const st = cur.type === 'human_approval' ? 'WAITING_APPROVAL' : 'WAITING_INPUT';
        const taskId = `${runId}:${cur.id}`;
        if (cur.type === 'human_approval') {
          const task = {
            task_id: taskId,
            run_id: runId,
            node_id: cur.id,
            status: 'PENDING',
            assignee_role: cur.config?.assigneeRole,
            reason: cur.config?.reason,
            requested_at: nowIso(),
          };
          await repo.upsertApprovalTask?.(task);
          await repo.enqueueOutbox(runId, 'approval', taskId, task, 'progress');
        } else {
          const task = {
            task_id: taskId,
            run_id: runId,
            node_id: cur.id,
            status: 'PENDING',
            assignee_role: cur.config?.assigneeRole,
            title: cur.config?.title,
            instruction: cur.config?.instruction,
            form_schema_json: JSON.stringify(cur.config?.fields ?? cur.config?.formSchema ?? cur.config?.schema ?? []),
            requested_at: nowIso(),
          };
          await repo.upsertUserInputTask?.(task);
          await repo.enqueueOutbox(runId, 'user_input', taskId, task, 'progress');
        }
        await repo.upsertNodeRun({ run_id: runId, node_id: cur.id, node_type: cur.type, status: st, input_json: nodeInputJson, started_at: nowIso() });
        await repo.enqueueOutbox(runId, 'node_run', `${runId}:${cur.id}`, { run_id: runId, node_id: cur.id, node_type: cur.type, status: st, input_json: nodeInputJson }, 'progress');
        await repo.upsertRun({ run_id: runId, status: st, waiting_node_id: cur.id, updated_at: nowIso() });
        await repo.enqueueOutbox(runId, 'run', runId, { ...runSnapshotBase, status: st, waiting_node_id: cur.id }, 'progress');
        workflowExecLog('info', 'run-waiting', 'workflow run waiting for user action', {
          runId,
          workflowId: runSnapshotBase.workflow_id,
          versionId: runSnapshotBase.version_id,
          nodeId: cur.id,
          nodeType: cur.type,
          status: st,
        });
        deps.onStatusChange?.(runId, cur.type === 'human_approval' ? 'waiting_approval' : 'waiting_input', { waitingNodeId: cur.id });
        return; // 暂停，Electron 弹窗决策后 resumeApproval/resumeInput 继续
      } else {
        // 逻辑节点：trigger 使用整次运行输入，其它节点使用已成功上游节点的 output map。
        result = await executeLogicNode(cur, nodeInput, makeCtx(runId, def, seqRef));
      }
      if (!isWorkflowPacket(result.output)) {
        const legacyOutput: any = result.output ?? {};
        result.output = createWorkflowPacket({
          runId, nodeId: cur.id, nodeType: cur.type,
          attempt: maxNodeAttempt(existingNodeRuns, cur.id), payload: legacyOutput,
          status: cur.type === 'human_approval' || cur.type === 'user_input' ? 'waiting' : 'succeeded',
          selectedPort: legacyOutput?.branchKey ?? legacyOutput?.branch ?? null,
        });
      }
      if (!(await isRunActive(runId))) return;
      if (cur.type === 'output') result.output = materializeOutput(result.output);
      upstream[cur.id] = result.output ?? {};
      await enqueueArtifactsFromOutput(
        runId,
        cur.id,
        result.output,
        cur.type === 'output' ? 'OUTPUT' : 'INTERMEDIATE',
      );
      await repo.upsertNodeRun({ run_id: runId, node_id: cur.id, node_type: cur.type, status: 'SUCCEEDED', input_json: nodeInputJson, output_json: stringifyJson(result.output ?? {}), completed_at: nowIso() });
      const completedNode = await repo.getNodeRun(runId, cur.id);
      await repo.enqueueOutbox(runId, 'node_run', `${runId}:${cur.id}`, {
        run_id: runId, node_id: cur.id, node_type: cur.type, status: 'SUCCEEDED',
        input_json: nodeInputJson, output_json: stringifyJson(result.output ?? {}),
        attempt_count: completedNode?.attempt_count ?? 0, prompt_text: completedNode?.prompt_text,
        last_completion_issue: completedNode?.last_completion_issue, started_at: completedNode?.started_at,
        completed_at: completedNode?.completed_at,
      }, 'progress');
      await makeCtx(runId, def, seqRef).emit('node.completed', {
        nodeName: cur.name ?? cur.title ?? cur.id,
        nodeType: cur.type,
      }, cur.id);
      if (cur.type === 'output') {
        finalOutputJson = stringifyJson(result.output ?? {});
        await repo.upsertRun({ run_id: runId, output_json: finalOutputJson });
        await repo.enqueueOutbox(runId, 'run', runId, {
          ...runSnapshotBase,
          status: 'RUNNING',
          output_json: finalOutputJson,
        }, 'progress');
      }
      workflowExecLog('info', 'node-succeeded', 'workflow node succeeded', {
        runId,
        workflowId: runSnapshotBase.workflow_id,
        versionId: runSnapshotBase.version_id,
        nodeId: cur.id,
        nodeType: cur.type,
      });
      cur = nextNode(cur, edges, nodes, result.output);
    }
    const completedAt = nowIso();
    const terminalRun = {
      ...runSnapshotBase,
      status: 'SUCCEEDED',
      completed_at: completedAt,
      ...(finalOutputJson === undefined ? {} : { output_json: finalOutputJson }),
    };
    const completed = await repo.updateRunIfActive(runId, terminalRun);
    if (!completed) return;
    // 条件分支中未被选择的节点也必须在云端收口，不能永久显示 PENDING。
    await finalizeUnfinishedNodeRuns(runId, 'succeeded');
    await makeCtx(runId, def, seqRef).emit('workflow.completed', { workflowId: runSnapshotBase.workflow_id });
    // 终态 run 必须是本次运行最后一条 outbox；否则云端终态锁会挡住完成事件。
    await repo.enqueueOutbox(runId, 'run', runId, terminalRun, 'terminal');
    workflowExecLog('info', 'run-succeeded', 'workflow run completed', {
      runId,
      workflowId: runSnapshotBase.workflow_id,
      versionId: runSnapshotBase.version_id,
    });
    deps.onStatusChange?.(runId, 'completed');
  }

  async function dispatch(
    runId: string,
    def: any,
    startNodeId?: string,
    meta?: { workflowId?: string; versionId?: string },
    initialInput?: any,
  ): Promise<void> {
    try {
      await dispatchUnsafe(runId, def, startNodeId, meta, initialInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const run = await repo.getRun(runId).catch(() => undefined);
      const changed = await repo.updateRunIfActive(runId, { status: 'FAILED', error: message, completed_at: nowIso() }).catch(() => false);
      if (changed) {
        await finalizeUnfinishedNodeRuns(runId, 'failed').catch(() => undefined);
        await releaseRunAgentSessions(runId);
        await repo.enqueueOutbox(runId, 'run', runId, {
          run_id: runId, workflow_id: meta?.workflowId ?? run?.workflow_id,
          version_id: meta?.versionId ?? run?.version_id, status: 'FAILED', error: message,
          mode: 'CLIENT_LOCAL', source: 'client', started_at: run?.started_at ?? nowIso(), completed_at: nowIso(),
        }, 'terminal').catch(() => undefined);
        deps.onStatusChange?.(runId, 'failed', { error: message });
      }
      workflowExecLog('error', 'dispatch-failed', 'workflow dispatch failed', { runId, error: message });
    }
  }

  async function isRunActive(runId: string): Promise<boolean> {
    const row = await repo.getRun(runId);
    return Boolean(row && row.status === 'RUNNING');
  }

  function materializeOutput(output: any): any {
    if (!isWorkflowPacket(output)) return output;
    return promoteCarriedOutputArtifacts(output);
  }

  function compileLocalAgentSpec(node: any, ctx: RunCtx, versionId: unknown): AgentRunSpec {
    const config = node?.config ?? {};
    // Existing published DSLs use config.task/runtime/guardrails, while newer
    // designer nodes use config.agentConfig.*.  Read both shapes before
    // composing the client prompt; never silently turn a historical task into
    // an empty objective.
    const agent = config.agentConfig ?? {};
    const task = agent.task ?? config.task ?? {};
    const runtime = agent.runtime ?? config.runtime ?? {};
    const guardrails = agent.guardrails ?? config.guardrails ?? {};
    const completionContract = guardrails.completionContract ?? config.completionContract ?? {};
    const inputConfig = agent.inputs ?? config.inputs ?? config.input ?? {};
    const configuredSchema = config.outputContract?.schema ?? completionContract.dataJsonSchema ?? { type: 'object' };
    const dataJsonSchema = normalizeArtifactFirstPayloadSchema(configuredSchema);
    return {
      schemaVersion: 'agent-run-spec/v1', workflowId: ctx.workflowId, workflowVersion: String(versionId ?? ''), runId: ctx.runId, nodeId: node.id,
      task: { name: task.name ?? node.name ?? node.id, goal: task.goal ?? config.goal ?? config.instruction ?? '', instruction: task.instruction ?? '', outputSchema: task.outputSchema },
      target: { provider: 'client_local', kind: node.type, model: agent.model ?? runtime.model },
      inputs: inputConfig, allowedSkills: guardrails.allowedSkills ?? [], allowedTools: guardrails.allowedTools ?? [], outputSchema: '',
      metadata: { branches: config.branches },
      runtimeContext: { smartNode: { kind: node.type }, startup: { schema: ctx.startupSchema ?? {}, resolvedInputs: ctx.startupInputs ?? {} }, isFirstAgentNode: Boolean(ctx.isFirstAgentNode), workspacePath: workspacePath(ctx.runId, node.id) } as any,
      permissionPolicy: { mode: guardrails.approvalMode === 'readonly' ? 'readonly' : 'workspace_write' }, limits: { timeoutMs: guardrails.timeoutMs, maxToolCalls: guardrails.maxToolCalls },
      completionContract: {
        resultKind: completionContract.resultKind,
        dataJsonSchema,
        outputJsonSchema: completionContract.outputJsonSchema ?? { type: 'object' },
        responseExample: completionContract.responseExample,
        maxAttempts: config.maxAttempts ?? completionContract.maxAttempts ?? 2,
        onIncomplete: completionContract.onIncomplete ?? 'retry',
      },
      guardrails: { timeoutMs: guardrails.timeoutMs }, prompt: '',
    };
  }

  async function buildFailureResult(runId: string, failedNodeId: string, failure: unknown): Promise<any> {
    const nodeRuns = await repo.listNodeRuns(runId);
    return {
      protocolVersion: 'workflow-execution-result/v1', status: 'failed', failedNodeId, failure,
      completedNodeIds: nodeRuns.filter((nodeRun) => nodeRun.status === 'SUCCEEDED').map((nodeRun) => nodeRun.node_id),
    };
  }

  return {
    /**
     * 客户端流程启动入口。
     *
     * renderer 先调用后端 v2 createRunLog 注册 runId/versionId，再通过 IPC 进入这里。
     * 这里负责拉取版本 DSL、落本地执行计划（wf_run/wf_node_run/outbox），最后交给 dispatch
     * 正式启动节点调度。
     */
    async startWorkflow(args: StartWorkflowArgs): Promise<void> {
      const triggerType = args.triggerType ?? (args.chatCard ? 'chat' : 'workflow_manual');
      // 端到端：拉 DSL → generatePlan 落本地计划（wf_run + wf_node_run + outbox）→ dispatch
      workflowExecLog('info', 'run-start', 'starting client-local workflow run', {
        runId: args.runId,
        workflowId: args.workflowId,
        versionId: args.versionId,
        sessionKey: args.sessionKey,
        requestedExecEngine: args.engineType,
      });
      if (!Number.isSafeInteger(args.runDatabaseId) || args.runDatabaseId <= 0) {
        throw new Error('workflow runDatabaseId must be a positive JavaScript-safe integer');
      }
      if (args.engineType !== 'claude' && args.engineType !== 'openclaw') {
        throw new Error('workflow execution engine is required');
      }
      try {
        // Persist the run identity before the remote DSL fetch. Chat-card
        // registration and compact status reads can now bind immediately even
        // when plan generation is slow; generatePlan enriches this same row.
        await repo.upsertRun({
          id: args.runDatabaseId,
          run_id: args.runId,
          workflow_id: args.workflowId,
          version_id: args.versionId,
          workflow_version: args.workflowVersion ?? null,
          status: 'RUNNING',
          mode: 'CLIENT_LOCAL',
          source: 'client',
          trigger_type: triggerType,
          input_json: stringifyJson(args.input ?? {}),
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
        await generatePlan({ repo, dslClient: deps.dslClient, workflowId: args.workflowId,
          versionId: args.versionId, runId: args.runId, input: args.input, startedAt: args.startedAt,
          sessionKey: args.sessionKey, workflowVersion: args.workflowVersion, runDatabaseId: args.runDatabaseId,
          triggerType, engineType: args.engineType, engineModel: args.engineModel });
        const run = await repo.getRun(args.runId);
        const definition = run?.definition_json ? JSON.parse(run.definition_json) : {};
        await dispatch(args.runId, definition, undefined, { workflowId: args.workflowId, versionId: args.versionId }, parseJson(run?.input_json) ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await repo.upsertRun({ id: args.runDatabaseId, run_id: args.runId, workflow_id: args.workflowId, version_id: args.versionId,
          workflow_version: args.workflowVersion ?? null,
          status: 'FAILED', mode: 'CLIENT_LOCAL', source: 'client', input_json: stringifyJson(args.input ?? {}),
          trigger_type: triggerType,
          definition_json: '{}', error: message, started_at: args.startedAt, completed_at: nowIso(), session_key: args.sessionKey,
          engine_type: args.engineType, engine_model: args.engineModel ?? null });
        await finalizeUnfinishedNodeRuns(args.runId, 'failed').catch(() => undefined);
        await repo.enqueueOutbox(args.runId, 'run', args.runId, { run_id: args.runId, workflow_id: args.workflowId,
          version_id: args.versionId, status: 'FAILED', mode: 'CLIENT_LOCAL', source: 'client',
          error: message, started_at: args.startedAt, completed_at: nowIso() }, 'terminal');
        deps.onStatusChange?.(args.runId, 'failed', { error: message });
        throw error;
      }
    },
    async startRun(args: StartRunArgs): Promise<void> {
      // definition 已由外部拉取注入（测试/直用）
      await dispatch(args.runId, args.definition, undefined, { workflowId: args.workflowId, versionId: args.versionId }, args.input ?? {});
    },
    /** 恢复异常中断或用户取消的运行：从首个未完成节点重新进入 dispatch。 */
    async resumeRun(runId: string): Promise<void> {
      workflowExecLog('info', 'run-resume', 'resuming interrupted or cancelled workflow run', { runId });
      const r = await resumeRun(repo, runId);
      if (!r) return;
      const resumedRun = await repo.getRun(r.runId);
      await repo.enqueueOutbox(r.runId, 'run', r.runId, {
        run_id: r.runId,
        workflow_id: resumedRun?.workflow_id,
        version_id: resumedRun?.version_id,
        mode: resumedRun?.mode ?? 'CLIENT_LOCAL',
        source: resumedRun?.source ?? 'client',
        status: 'RUNNING',
        started_at: resumedRun?.started_at ?? nowIso(),
        completed_at: null,
      }, 'progress');
      deps.onStatusChange?.(r.runId, 'running');
      await flushOnce({ repo, postSync: deps.postSync, onTokenExpired: deps.onTokenExpired });
      await dispatch(r.runId, r.definition, r.startNodeId);
    },
    /** 审批通过/拒绝后的继续执行入口：根据审批结果选下一条边。 */
    async resumeApproval(runId: string, nodeId: string, decision: any): Promise<void> {
      workflowExecLog('info', 'approval-resume', 'resuming workflow approval node', { runId, nodeId });
      const run = await repo.getRun(runId);
      if (run?.status === 'WAITING_APPROVAL' && run.waiting_node_id === nodeId) {
        const def = run.definition_json ? JSON.parse(run.definition_json) : {};
        const approved = typeof decision === 'object' ? decision.approved !== false && decision.decision !== 'rejected' : decision !== false && decision !== 'rejected';
        const output = { approved, decision: approved ? 'approved' : 'rejected', note: decision?.note ?? '' };
        const task = { task_id: `${runId}:${nodeId}`, run_id: runId, node_id: nodeId,
          status: approved ? 'APPROVED' : 'REJECTED', decision_note: output.note, requested_at: nowIso(), decided_at: nowIso() };
        await repo.upsertApprovalTask(task);
        await repo.enqueueOutbox(runId, 'approval', task.task_id, task, 'progress');
        const waitingNode = (def.nodes ?? []).find((node: any) => node.id === nodeId);
        await completeWaitingNode(runId, nodeId, waitingNode?.type ?? 'human_approval', output);
        await repo.updateRunIfActive(runId, { status: 'RUNNING', waiting_node_id: null });
        deps.onStatusChange?.(runId, 'running');
        const next = nextNode({ id: nodeId }, def.edges ?? [], def.nodes ?? [], output);
        await dispatch(runId, def, next?.id, { workflowId: run.workflow_id, versionId: run.version_id });
      }
    },
    /** 用户输入提交后的继续执行入口：保存提交值后根据输入结果选下一条边。 */
    async resumeInput(runId: string, nodeId: string, submittedData: any): Promise<void> {
      workflowExecLog('info', 'input-resume', 'resuming workflow input node', { runId, nodeId, submittedKeys: Object.keys(submittedData ?? {}).join(',') });
      const run = await repo.getRun(runId);
      if (run?.status === 'WAITING_INPUT' && run.waiting_node_id === nodeId) {
        const def = run.definition_json ? JSON.parse(run.definition_json) : {};
        const task = {
          task_id: `${runId}:${nodeId}`,
          run_id: runId,
          node_id: nodeId,
          status: 'SUBMITTED',
          submitted_data_json: JSON.stringify(submittedData ?? {}),
          requested_at: nowIso(),
          submitted_at: nowIso(),
        };
        await repo.upsertUserInputTask(task);
        await repo.enqueueOutbox(runId, 'user_input', task.task_id, task, 'progress');
        await completeWaitingNode(runId, nodeId, 'user_input', { submitted: true, values: submittedData ?? {} });
        await repo.updateRunIfActive(runId, { status: 'RUNNING', waiting_node_id: null });
        deps.onStatusChange?.(runId, 'running');
        const next = nextNode({ id: nodeId }, def.edges ?? [], def.nodes ?? [], submittedData);
        await dispatch(runId, def, next?.id, { workflowId: run.workflow_id, versionId: run.version_id });
      }
    },
    async cancel(runId: string, nodeId: string): Promise<void> {
      workflowExecLog('warn', 'run-cancel', 'cancelling workflow run', { runId, nodeId });
      cancelAgent(runId, nodeId);
      cancelOpenClawWorkflowAgent(runId, nodeId);
      const run = await repo.getRun(runId).catch(() => undefined);
      if (run && TERMINAL_STATUSES.has(run.status)) return;
      const changed = await repo.updateRunIfActive(runId, { status: 'CANCELLED', completed_at: nowIso() });
      if (!changed) return;
      await finalizeUnfinishedNodeRuns(runId, 'cancelled');
      await releaseRunAgentSessions(runId);
      await repo.enqueueOutbox(runId, 'run', runId, {
        run_id: runId,
        workflow_id: run?.workflow_id,
        version_id: run?.version_id,
        mode: run?.mode ?? 'CLIENT_LOCAL',
        source: run?.source ?? 'client',
        status: 'CANCELLED',
        started_at: run?.started_at ?? nowIso(),
        completed_at: nowIso(),
      }, 'terminal');
      // The client is the source of truth for a user cancellation. Do not wait
      // for the background two-second loop before telling the cloud about the
      // terminal state; a failed request remains in the outbox for backoff.
      await repo.retryFailedOutbox(runId);
      await flushOnce({ repo, postSync: deps.postSync, onTokenExpired: deps.onTokenExpired });
      workflowExecLog('warn', 'run-cancelled', 'workflow run marked cancelled', { runId, nodeId });
      deps.onStatusChange?.(runId, 'cancelled', { error: 'cancelled' });
    },
    async recover(): Promise<void> {
      await recoverOnLaunch({ repo, onRecover: deps.onRecover, onStatusChange: deps.onStatusChange });
    },
    startSync(): void {
      startFlushLoop({ repo, postSync: deps.postSync, onTokenExpired: deps.onTokenExpired });
    },
    stopSync(): void {
      stopFlushLoop();
    },
    // 供 NodeDispatcher 在智能节点产出 artifact 后记录本地元数据。
    async recordArtifact(art: ArtifactRow): Promise<void> {
      await persistArtifact(repo, art);
    },
    async retrySync(runId?: string): Promise<void> {
      await repo.retryFailedOutbox(runId);
      if (!runId) {
        await flushOnce({ repo, postSync: deps.postSync, onTokenExpired: deps.onTokenExpired });
        return;
      }
      const run = await repo.getRun(runId);
      if (!run || !TERMINAL_STATUSES.has(run.status)) return;
      if (run.status === 'FAILED') await finalizeUnfinishedNodeRuns(runId, 'failed');
      else if (run.status === 'CANCELLED' || run.status === 'INTERRUPTED') await finalizeUnfinishedNodeRuns(runId, 'cancelled');
      else await finalizeUnfinishedNodeRuns(runId, 'succeeded');
      // Rebuild the complete child snapshot for historical runs whose original
      // terminal entry reached the cloud before later node/artifact batches.
      const [nodeRuns, events, artifacts, approvalTasks, userInputTasks] = await Promise.all([
        repo.listNodeRuns(runId), repo.listEvents(runId), repo.listArtifacts(runId),
        repo.listApprovalTasks(runId), repo.listUserInputTasks(runId),
      ]);
      for (const nodeRun of nodeRuns) await repo.enqueueOutbox(runId, 'node_run', `${runId}:${nodeRun.node_id}`, nodeRun, 'progress');
      for (const event of events) await repo.enqueueOutbox(runId, 'event', `${runId}:${event.sequence}`, event, 'progress');
      for (const artifact of artifacts) await repo.enqueueOutbox(runId, 'artifact', artifact.artifact_id, artifact, 'progress');
      for (const task of approvalTasks) await repo.enqueueOutbox(runId, 'approval', task.task_id, task, 'progress');
      for (const task of userInputTasks) await repo.enqueueOutbox(runId, 'user_input', task.task_id, task, 'progress');
      await flushOnce({ repo, postSync: deps.postSync, onTokenExpired: deps.onTokenExpired });
    },
  };

  async function completeWaitingNode(runId: string, nodeId: string, nodeType: string, output: any): Promise<void> {
    const packet = createWorkflowPacket({ runId, nodeId, nodeType, status: 'succeeded', payload: output });
    const payload = { run_id: runId, node_id: nodeId, node_type: nodeType, status: 'SUCCEEDED', output_json: stringifyJson(packet), completed_at: nowIso() };
    await repo.upsertNodeRun(payload);
    await repo.enqueueOutbox(runId, 'node_run', `${runId}:${nodeId}`, payload, 'progress');
    const seq = await repo.nextEventSequence(runId);
    const event = { run_id: runId, sequence: seq, type: nodeType === 'human_approval' ? 'approval.decided' : 'user_input.submitted', node_id: nodeId, message: stringifyJson(packet) };
    await repo.insertEvent(event);
    await repo.enqueueOutbox(runId, 'event', `${runId}:${seq}`, event, 'progress');
  }

  async function finalizeUnfinishedNodeRuns(
    runId: string,
    outcome: 'failed' | 'cancelled' | 'succeeded',
    failedNodeId?: string,
  ): Promise<void> {
    const nodeRuns = await repo.listNodeRuns(runId);
    for (const nodeRun of nodeRuns) {
      if (['SUCCEEDED', 'FAILED', 'SKIPPED', 'INTERRUPTED'].includes(nodeRun.status)) continue;
      let status: 'FAILED' | 'SKIPPED' | 'INTERRUPTED';
      if (outcome === 'cancelled') status = 'INTERRUPTED';
      else if (outcome === 'succeeded' || nodeRun.status === 'PENDING') status = 'SKIPPED';
      else status = nodeRun.node_id === failedNodeId || !failedNodeId ? 'FAILED' : 'SKIPPED';
      const completed = {
        run_id: runId,
        node_id: nodeRun.node_id,
        node_type: nodeRun.node_type,
        status,
        attempt_count: nodeRun.attempt_count ?? 0,
        input_json: nodeRun.input_json,
        output_json: nodeRun.output_json,
        prompt_text: nodeRun.prompt_text,
        last_completion_issue: nodeRun.last_completion_issue,
        started_at: nodeRun.started_at,
        completed_at: nowIso(),
      };
      await repo.upsertNodeRun(completed);
      await repo.enqueueOutbox(runId, 'node_run', `${runId}:${nodeRun.node_id}`, completed, 'progress');
    }
  }

  /** Clear all local engine transcripts only when the enclosing run is terminal. */
  async function releaseRunAgentSessions(runId: string): Promise<void> {
    if (!deps.releaseAgentSession) return;
    const nodeRuns = await repo.listNodeRuns(runId).catch(() => []);
    await Promise.all(nodeRuns
      .filter((nodeRun) => Boolean(nodeRun.agent_session_id))
      .map((nodeRun) => deps.releaseAgentSession!(runId, nodeRun.agent_session_id).catch((error) => {
        workflowExecLog('warn', 'agent-session-release-failed', 'failed to release terminal node agent session', {
          runId,
          nodeId: nodeRun.node_id,
          error: error instanceof Error ? error.message : String(error),
        });
      })));
  }

  async function enqueueArtifactsFromOutput(
    runId: string,
    nodeId: string,
    output: unknown,
    kind: 'OUTPUT' | 'INTERMEDIATE',
  ): Promise<void> {
    const declaredArtifacts = isWorkflowPacket(output) ? output.artifacts : [];
    const ownedArtifacts = declaredArtifacts.filter((artifact) =>
      artifact.artifactId.startsWith(`${runId}:${nodeId}:`)
      && typeof artifact.resourceId === 'string'
      && artifact.resourceId,
    );
    await Promise.all(ownedArtifacts.map(async (declared) => {
      const filePath = path.resolve(workspacePath(runId, nodeId), declared.resourceId!);
      await persistArtifact(repo, {
        artifact_id: declared.artifactId,
        run_id: runId,
        node_id: nodeId,
        kind: declared.kind ?? kind,
        file_path: filePath,
        content_type: declared.contentType,
        summary: declared.name,
        created_at: nowIso(),
      });
    }));
  }
}

/** 选下一节点：优先按分支端口匹配，未命中时走无条件默认边。 */
function nextNode(cur: any, edges: any[], nodes: any[], output: any): any {
  const outgoing = edges.filter((e: any) => e.source === cur.id);
  const branch = output?.control?.selectedPort ?? output?.branch ?? output?.branchKey ?? output?.branch_key;
  let edge: any = null;
  if (branch) {
    const key = String(branch);
    edge = outgoing.find((e: any) => (
      e.sourcePort === key
      || e.condition === key
      || e.branch === key
      || e.branchKey === key
      || e.label === key
    ));
  }
  edge ??= outgoing.find((e: any) => !e.sourcePort && !e.condition && !e.branch && !e.branchKey);
  // A graph with several unconditional outgoing edges is invalid at preflight;
  // never make execution depend on array ordering.
  if (!edge && outgoing.length > 1) throw new Error(`节点 ${cur.id} 存在多个未绑定出边`);
  if (!edge) return null;
  return nodes.find((n: any) => n.id === edge.target) ?? null;
}

function buildUpstreamMap(nodeRuns: any[]): Record<string, any> {
  const upstream: Record<string, any> = {};
  for (const n of nodeRuns) {
    if (n.status !== 'SUCCEEDED' || !n.output_json) continue;
    upstream[n.node_id] = parseJson(n.output_json);
  }
  return upstream;
}

function maxNodeAttempt(nodeRuns: any[], nodeId: string): number {
  return Number(nodeRuns.find((nodeRun) => nodeRun.node_id === nodeId)?.attempt_count ?? 0);
}

function resolveStartupSchema(definition: any): Record<string, unknown> {
  if (definition?.startupSchema && typeof definition.startupSchema === 'object') return definition.startupSchema;
  const startupNode = Array.isArray(definition?.nodes)
    ? definition.nodes.find((node: any) => node?.type === 'startup_config')
    : undefined;
  const config = startupNode?.config ?? {};
  return {
    nodeId: startupNode?.id ?? '',
    enabled: Array.isArray(config.fields) && config.fields.length > 0,
    steps: Array.isArray(config.steps) ? config.steps : [],
    fields: Array.isArray(config.fields) ? config.fields : [],
  };
}

function parseJson(value: unknown): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyJson(value: unknown): string {
  if (typeof value === 'string') return value;
  const seen = new WeakSet<object>();
  return JSON.stringify(value ?? {}, (_key, current) => {
    if (current && typeof current === 'object') {
      if (seen.has(current)) return undefined;
      seen.add(current);
    }
    return current;
  });
}

function containsArtifact(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if ((value as any).kind === 'artifact' || (value as any).filePath || String((value as any).uri ?? '').startsWith('file:')) return true;
  return Object.values(value as Record<string, unknown>).some(containsArtifact);
}
