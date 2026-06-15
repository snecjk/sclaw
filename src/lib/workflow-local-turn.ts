/**
 * Local-only chat turns for workflow execution.
 *
 * After create/start via Agent Workflow API, execution is client-driven.
 * Do NOT forward these turns to Gateway chat.send — the model may incorrectly
 * try sai-cli or other tools to "run" the workflow again.
 */
import { buildWorkflowValuesSummary, buildWorkflowValuesSummaryFallback } from '@/lib/workflow-form-utils';
import { useChatStore } from '@/stores/chat';
import { getExecutionByRunId, getSessionWorkflows, listSessionExecutions } from '@/stores/workflow-memory';
import type { ContentBlock, RawMessage } from '@/stores/chat/types';

function toMs(ts?: number): number {
  if (!ts) return 0;
  return ts < 1e12 ? ts * 1000 : ts;
}

function messageHasWorkflowCard(msg: RawMessage): boolean {
  return Array.isArray(msg.content)
    && (msg.content as ContentBlock[]).some((b) => b.type === 'workflow_card');
}

function messageHasWorkflowCardWithRunId(msg: RawMessage, runId: string): boolean {
  return Array.isArray(msg.content)
    && (msg.content as ContentBlock[]).some(
      (b) => b.type === 'workflow_card' && b.runId === runId,
    );
}

function formatCollectedInputsFallback(inputs: Record<string, unknown>): string {
  return buildWorkflowValuesSummaryFallback(inputs);
}

/** Resolve user-facing parameter text for a workflow run in a session. */
export function resolveWorkflowParamsUserText(sessionKey: string, runId: string): string {
  const exec = getExecutionByRunId(runId, sessionKey);
  if (exec?.paramsSummary) return exec.paramsSummary;

  const wf = getSessionWorkflows(sessionKey).find((w) => w.lastRunId === runId || w.workflowId === exec?.workflowId);
  const inputs = exec?.collectedInputs ?? wf?.collectedInputs;
  if (!inputs || Object.keys(inputs).length === 0) {
    return wf?.templateName ? `启动工作流「${wf.templateName}」` : '参数已确认';
  }

  return formatCollectedInputsFallback(inputs);
}

interface RunTurnRestore {
  runId: string;
  workflowId: string;
  templateName: string;
  createdAt: number;
  userText: string;
}

/** Re-append workflow execution turns from localStorage when Gateway history omits them. */
export function mergeWorkflowTurnsFromMemory(
  loaded: RawMessage[],
  sessionKey: string,
): RawMessage[] {
  const runsToRestore: RunTurnRestore[] = [];
  const seenRunIds = new Set<string>();

  for (const exec of listSessionExecutions(sessionKey)) {
    if (loaded.some((m) => messageHasWorkflowCardWithRunId(m, exec.runId)) || seenRunIds.has(exec.runId)) continue;
    seenRunIds.add(exec.runId);
    runsToRestore.push({
      runId: exec.runId,
      workflowId: exec.workflowId,
      templateName: exec.templateName,
      createdAt: exec.createdAt,
      userText: resolveWorkflowParamsUserText(sessionKey, exec.runId),
    });
  }

  for (const wf of getSessionWorkflows(sessionKey)) {
    if (!wf.lastRunId || seenRunIds.has(wf.lastRunId)) continue;
    if (loaded.some((m) => messageHasWorkflowCardWithRunId(m, wf.lastRunId!))) continue;
    seenRunIds.add(wf.lastRunId);
    runsToRestore.push({
      runId: wf.lastRunId,
      workflowId: wf.workflowId,
      templateName: wf.templateName,
      createdAt: wf.completedAt ?? wf.createdAt,
      userText: resolveWorkflowParamsUserText(sessionKey, wf.lastRunId),
    });
  }

  if (runsToRestore.length === 0) return loaded;

  runsToRestore.sort((a, b) => a.createdAt - b.createdAt);

  const extras: RawMessage[] = [];
  for (const run of runsToRestore) {
    const ts = run.createdAt / 1000;
    extras.push(
      {
        role: 'user',
        content: run.userText,
        timestamp: ts,
        id: crypto.randomUUID(),
      } as RawMessage,
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: `参数已确认，工作流已在后台启动执行（工作流 ID: ${run.workflowId}），请稍候查看执行进度。`,
          },
          { type: 'workflow_card', runId: run.runId, templateName: run.templateName },
        ],
        timestamp: ts + 0.001,
        id: crypto.randomUUID(),
      } as RawMessage,
    );
  }

  return [...loaded, ...extras].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
}

/** Keep local workflow execution turns when Gateway history reload wipes them. */
export function mergeLocalWorkflowTurnsFromCurrent(
  loaded: RawMessage[],
  current: RawMessage[],
): RawMessage[] {
  if (current.length === 0) return loaded;

  const loadedIds = new Set(loaded.map((m) => m.id).filter(Boolean));
  const extras: RawMessage[] = [];

  for (let i = 0; i < current.length; i++) {
    const msg = current[i];
    if (msg.id && loadedIds.has(msg.id)) continue;
    if (!messageHasWorkflowCard(msg)) continue;

    const prev = i > 0 ? current[i - 1] : undefined;
    if (prev?.role === 'user' && (!prev.id || !loadedIds.has(prev.id))) {
      if (!extras.some((e) => e.id && e.id === prev.id)) {
        extras.push(prev);
      }
    }
    extras.push(msg);
  }

  if (extras.length === 0) return loaded;
  return [...loaded, ...extras].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
}

export interface WorkflowStartedLocalTurnParams {
  userText: string;
  templateName: string;
  runId: string;
  workflowId?: string;
  assistantText?: string;
}

export function appendWorkflowStartedLocalTurn(params: WorkflowStartedLocalTurnParams): void {
  const {
    userText,
    templateName,
    runId,
    workflowId,
    assistantText = workflowId
      ? `参数已确认，工作流已在后台启动执行（工作流 ID: ${workflowId}），请稍候查看执行进度。`
      : '参数已确认，工作流已在后台启动执行，请稍候查看执行进度。',
  } = params;

  const now = Date.now() / 1000;
  useChatStore.setState((s) => ({
    messages: [
      ...s.messages,
      {
        role: 'user',
        content: userText,
        timestamp: now,
        id: crypto.randomUUID(),
      } as RawMessage,
      {
        role: 'assistant',
        content: [
          { type: 'text', text: assistantText },
          { type: 'workflow_card', runId, templateName },
        ],
        timestamp: now + 0.001,
        id: crypto.randomUUID(),
      } as RawMessage,
    ],
    lastUserMessageAt: Date.now(),
    sending: false,
  }));
}

/** Build parameter summary text when schema is available at submit time. */
export function buildWorkflowStartUserText(
  schema: import('@/types/workflow').WorkflowSchema | undefined,
  values: Record<string, unknown>,
): string {
  if (schema) return buildWorkflowValuesSummary(schema, values);
  return formatCollectedInputsFallback(values);
}
