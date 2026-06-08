/**
 * Workflow Completion Hook
 *
 * Listens for workflow execution completion via IPC, fetches the full run
 * result, and triggers an AI summary by sending a structured user message.
 */
import { useEffect, useRef } from 'react';
import { getWorkflowRun, runToExecutionState } from '@/lib/workflow-api';
import { useChatStore } from '@/stores/chat';
import { updateWorkflowRunMetadata } from '@/stores/workflow-memory';
import type { WorkflowExecutionState } from '@/types/workflow';

interface WorkflowStatusPayload {
  runId: string;
  sessionKey: string;
  status: WorkflowExecutionState['status'];
  result?: WorkflowExecutionState['result'];
  error?: string;
}

const COMPLETION_TAG = '[workflow:complete]';

/**
 * Build a structured summary prompt from workflow execution result.
 */
function buildCompletionPrompt(
  templateName: string,
  state: WorkflowExecutionState,
  runId: string,
): string {
  const lines: string[] = [
    `${COMPLETION_TAG}`,
    '',
    `工作流名称：${templateName}`,
    `执行状态：${state.status === 'completed' ? '成功' : state.status === 'failed' ? '失败' : state.status}`,
    `运行 ID：${runId}`,
  ];

  if (state.startedAt) {
    lines.push(`开始时间：${state.startedAt}`);
  }
  if (state.completedAt) {
    lines.push(`完成时间：${state.completedAt}`);
  }

  if (state.result?.kpis && state.result.kpis.length > 0) {
    lines.push('', '核心指标：');
    for (const kpi of state.result.kpis) {
      const changeStr = kpi.change
        ? `（${kpi.changeType === 'decrease' ? '下降' : '上升'} ${kpi.change}）`
        : '';
      lines.push(`- ${kpi.name}：${kpi.value}${changeStr}`);
    }
  }

  if (state.result?.summary) {
    lines.push('', '执行摘要：');
    lines.push(state.result.summary);
  }

  if (state.result?.artifacts && state.result.artifacts.length > 0) {
    lines.push('', '产物列表：');
    for (const artifact of state.result.artifacts) {
      lines.push(`- ${artifact.name}（类型：${artifact.type}，链接：${artifact.url}）`);
    }
  }

  if (state.error) {
    lines.push('', '异常信息：');
    lines.push(state.error);
    lines.push('', '建议下一步：');
    lines.push('- 如果问题是暂时的，可以尝试重新执行');
    lines.push('- 如果参数可能不正确，可以修改参数后再次执行');
    lines.push('- 如果问题持续存在，请联系技术支持');
  }

  lines.push('', '请根据以上信息生成一段自然语言总结，包含执行状态、关键指标、异常波动分析和产物引用。');

  return lines.join('\n');
}

/**
 * React hook that listens for completed workflow executions and triggers
 * an AI summary message in the current chat session.
 */
export function useWorkflowCompletion(sessionKey: string) {
  const processedRuns = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());

  // Reset processed runs when the session changes to allow new workflows
  // in a different session to trigger summaries.
  useEffect(() => {
    processedRuns.current.clear();
    inFlightRef.current.clear();
  }, [sessionKey]);

  useEffect(() => {
    const handler = async (payload: unknown) => {
      const data = payload as WorkflowStatusPayload;
      if (data.sessionKey !== sessionKey) return;
      if (data.status !== 'completed' && data.status !== 'failed') return;

      const runId = data.runId;
      if (processedRuns.current.has(runId)) return;
      if (inFlightRef.current.has(runId)) return;

      processedRuns.current.add(runId);
      inFlightRef.current.add(runId);

      try {
        const run = await getWorkflowRun(runId);
        const state = runToExecutionState(run);
        const templateName = run.startup?.presetName || run.workflowId || '工作流';

        const prompt = buildCompletionPrompt(templateName, state, runId);

        const chatState = useChatStore.getState();
        // Only trigger summary if the run belongs to the current session
        if (chatState.currentSessionKey !== sessionKey) return;
        // Avoid sending another summary while the chat is already sending
        if (chatState.sending) return;

        await chatState.sendMessage({ text: prompt, workflowId: run.workflowId, runId });

        // Update memory with completion metadata
        updateWorkflowRunMetadata(sessionKey, run.workflowId, {
          lastRunId: runId,
          lastStatus: state.status,
          completedAt: Date.now(),
        });
      } catch (err) {
        console.error('[useWorkflowCompletion] failed to fetch run or send summary:', err);
      } finally {
        inFlightRef.current.delete(runId);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('workflow:status-update', handler as (payload: unknown) => void);
    const inFlight = inFlightRef.current;
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      inFlight.clear();
    };
  }, [sessionKey]);
}
