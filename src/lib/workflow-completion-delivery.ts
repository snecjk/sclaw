/**
 * Deliver workflow completion summaries via the chat model (Gateway sendMessage).
 * Persists delivery flag in localStorage to avoid duplicate summaries on refresh.
 */
import { getWorkflowRun, runToExecutionState } from '@/lib/workflow-api';
import { WORKFLOW_COMPLETE_TAG } from '@/lib/workflow-context';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { useChatStore, type RawMessage } from '@/stores/chat';
import {
  getExecutionByRunId,
  markCompletionSummaryDelivered,
  patchWorkflowExecution,
  updateWorkflowRunMetadata,
} from '@/stores/workflow-memory';
import type { WorkflowExecutionState } from '@/types/workflow';

const deliveryInFlight = new Set<string>();

export function messagesHasCompletionSummary(
  messages: RawMessage[],
  runId: string,
): boolean {
  return messages.some((m) => {
    if (m.role !== 'user') return false;
    const text = typeof m.content === 'string' ? m.content : '';
    return text.includes(WORKFLOW_COMPLETE_TAG) && text.includes(runId);
  });
}

function buildCompletionPrompt(
  templateName: string,
  state: WorkflowExecutionState,
  runId: string,
): string {
  const lines: string[] = [
    WORKFLOW_COMPLETE_TAG,
    '',
    `工作流名称：${templateName}`,
    `执行状态：${state.status === 'completed' ? '成功' : state.status === 'failed' ? '失败' : state.status}`,
    `运行 ID：${runId}`,
  ];

  if (state.workflowId) lines.push(`工作流 ID：${state.workflowId}`);

  if (state.startedAt) lines.push(`开始时间：${state.startedAt}`);
  if (state.completedAt) lines.push(`完成时间：${state.completedAt}`);

  if (state.result?.summary) {
    lines.push('', '执行摘要：', state.result.summary);
  }

  if (state.result?.artifacts && state.result.artifacts.length > 0) {
    lines.push('', '产物列表：');
    for (const artifact of state.result.artifacts) {
      lines.push(`- ${artifact.name}（类型：${artifact.type}，链接：${artifact.url}）`);
    }
  }

  if (state.error) {
    lines.push('', '异常信息：', state.error);
  }

  lines.push('', '请根据以上信息生成一段自然语言总结，包含执行状态、关键结果与产物引用。');
  lines.push(
    '',
    '产物引用要求（必须遵守）：引用产物时一律使用上方产物列表中的 http(s) 链接，并以 Markdown 链接格式输出（如 [文件名](链接)）；严禁输出云端运行环境的内部文件路径（如 /runtime/、/workspace/ 开头的路径），用户无法访问这些路径；没有可用链接的产物只写文件名，不要编造链接。',
  );

  return lines.join('\n');
}

/** Push a model-authored completion summary when a run reaches a terminal state. */
export async function deliverWorkflowCompletionIfNeeded(
  runId: string,
  sessionKey: string,
  prefetchedState?: WorkflowExecutionState,
): Promise<void> {
  if (deliveryInFlight.has(runId)) return;

  const chatState = useChatStore.getState();
  if (chatState.currentSessionKey !== sessionKey) return;

  const exec = getExecutionByRunId(runId, sessionKey);
  if (exec?.completionSummaryDelivered) return;
  if (messagesHasCompletionSummary(chatState.messages, runId)) {
    markCompletionSummaryDelivered(sessionKey, runId);
    return;
  }

  deliveryInFlight.add(runId);
  try {
    let state = prefetchedState;
    let workflowId = state?.workflowId ?? exec?.workflowId ?? '';
    let templateName = exec?.templateName ?? '工作流';

    if (!state || !isTerminalWorkflowRunStatus(state.status)) {
      const run = await getWorkflowRun(runId);
      state = runToExecutionState(run);
      workflowId = run.workflowId;
      templateName = run.startup?.presetName || exec?.templateName || templateName;
    }

    if (!state || !isTerminalWorkflowRunStatus(state.status)) return;
    if (state.status !== 'completed' && state.status !== 'failed') return;

    chatState.setWorkflowCardState(runId, state);
    patchWorkflowExecution(sessionKey, runId, {
      status: state.status,
      updatedAt: Date.now(),
    });

    const latest = useChatStore.getState();
    if (latest.currentSessionKey !== sessionKey) return;
    if (latest.sending) return;
    if (messagesHasCompletionSummary(latest.messages, runId)) {
      markCompletionSummaryDelivered(sessionKey, runId);
      return;
    }

    const prompt = buildCompletionPrompt(templateName, state, runId);
    await latest.sendMessage({ text: prompt, workflowId, runId });

    markCompletionSummaryDelivered(sessionKey, runId);
    if (workflowId) {
      updateWorkflowRunMetadata(sessionKey, workflowId, {
        lastRunId: runId,
        lastStatus: state.status,
        completedAt: Date.now(),
      });
    }
  } catch (err) {
    console.error('[workflow-completion-delivery] failed:', err);
  } finally {
    deliveryInFlight.delete(runId);
  }
}
