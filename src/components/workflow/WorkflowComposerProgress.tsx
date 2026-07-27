import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getRunViaIpc } from '@/lib/workflow-api';
import { isActiveWorkflowRunStatus, normalizeWorkflowStepStatus } from '@/lib/workflow-run-status';
import { getExecutionByRunId } from '@/stores/workflow-memory';
import type { WorkflowExecutionState } from '@/types/workflow';

interface WorkflowComposerProgressProps {
  sessionKey: string;
  states: Record<string, WorkflowExecutionState>;
}

interface ProgressSnapshot {
  state: WorkflowExecutionState;
  completed: number;
  total: number;
  currentNode?: string;
  attempt?: number;
}

function toSnapshot(state: WorkflowExecutionState): ProgressSnapshot {
  const total = Math.max(state.steps.length, 1);
  const completed = state.steps.filter((step) => step.status === 'completed').length;
  const current = state.steps.find((step) => step.status === 'running');
  const attempt = undefined;
  return { state, completed, total, currentNode: current?.name ?? state.currentStep ?? state.waitingNodeId ?? undefined, attempt };
}

function formatElapsed(startedAt?: string): string {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(started)) return '刚刚开始';
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

/**
 * A compact, session-scoped progress surface below the composer.  Status IPC
 * updates make it appear immediately; while a run is active we refresh the
 * local runtime snapshot every three seconds so node progress cannot go stale.
 */
export function WorkflowComposerProgress({ sessionKey, states }: WorkflowComposerProgressProps) {
  const candidates = Object.values(states)
    .filter((state) => getExecutionByRunId(state.runId, sessionKey))
    .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''));
  const active = candidates.find((state) => isActiveWorkflowRunStatus(state.status));
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(active ? toSnapshot(active) : null);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const run = await getRunViaIpc(active.runId);
        if (!run || cancelled) return;
        const total = Math.max(run.nodeRuns.length, 1);
        const completed = run.nodeRuns.filter((node) => normalizeWorkflowStepStatus(node.status) === 'completed').length;
        const current = run.nodeRuns.find((node) => normalizeWorkflowStepStatus(node.status) === 'running');
        setSnapshot({
          state: {
            ...active,
            status: run.status,
            progress: run.status === 'completed' ? 100 : Math.min(99, Math.floor((completed / total) * 100)),
            startedAt: run.startedAt ?? active.startedAt,
            error: run.error ?? active.error,
          },
          completed,
          total,
          currentNode: current?.nodeId ?? run.waitingNodeId ?? active.currentStep,
          attempt: current?.attemptCount,
        });
      } catch {
        // The UI state remains a useful fallback if IPC is temporarily unavailable.
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  if (!active) return null;
  const displayedSnapshot = snapshot?.state.runId === active.runId ? snapshot : toSnapshot(active);
  if (!isActiveWorkflowRunStatus(displayedSnapshot.state.status)) return null;
  const percent = Math.min(99, Math.max(displayedSnapshot.state.progress, Math.floor((displayedSnapshot.completed / displayedSnapshot.total) * 100)));
  const statusText = displayedSnapshot.state.status === 'waiting_approval'
    ? '等待审批'
    : displayedSnapshot.state.status === 'waiting_input'
      ? '等待补充信息'
      : displayedSnapshot.currentNode
        ? `正在执行 ${displayedSnapshot.currentNode}`
        : '正在准备工作流';

  return (
    <section className="mt-2 rounded-xl border border-primary/20 bg-primary/[0.045] px-3 py-2.5 text-xs" aria-live="polite" aria-label="工作流执行进度">
      <div className="flex items-center justify-between gap-3 text-foreground">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          <span className="truncate">{statusText}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{displayedSnapshot.completed}/{displayedSnapshot.total}{displayedSnapshot.attempt ? ` · 第 ${displayedSnapshot.attempt} 次` : ''} · {formatElapsed(displayedSnapshot.state.startedAt)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.max(percent, 3)}%` }} />
      </div>
    </section>
  );
}
