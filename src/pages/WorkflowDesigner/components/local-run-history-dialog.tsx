import { AlertCircle, CheckCircle2, Circle, CircleDot, Clock3, History, RotateCcw, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { listLocalWorkflowRuns, type LocalWorkflowRunSummary } from '@/lib/workflow-api';
import { cn } from '@/lib/utils';
import { subscribeHostEvent } from '@/lib/host-events';
import {
  formatLocalRunDuration,
  formatLocalRunTime,
  formatLocalRunVersion,
  resolveLocalRunHistoryStatus,
  type LocalRunHistoryStatus,
} from './local-run-history-utils';

interface LocalRunHistoryDialogProps {
  open: boolean;
  workflowId?: string;
  workflowName?: string;
  onClose: () => void;
  onSelectRun: (runId: string) => Promise<boolean>;
}

const STATUS_META: Record<LocalRunHistoryStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  success: { label: '成功', className: 'bg-[var(--sto-feature-success-background)] text-[var(--sto-feature-success-foreground)]', Icon: CheckCircle2 },
  failed: { label: '失败', className: 'bg-destructive/10 text-[var(--sto-danger-primary)]', Icon: XCircle },
  cancelled: { label: '已取消', className: 'bg-[var(--sto-feature-muted-background)] text-[var(--sto-feature-secondary-foreground)]', Icon: Circle },
  interrupted: { label: '已中断', className: 'bg-[var(--sto-workflow-status-warning-background)] text-[var(--sto-workflow-status-warning-foreground)]', Icon: AlertCircle },
  running: { label: '进行中', className: 'bg-primary/10 text-[var(--sto-brand-primary)]', Icon: CircleDot },
};

export function LocalRunHistoryDialog({ open, workflowId, workflowName, onClose, onSelectRun }: LocalRunHistoryDialogProps) {
  const [runs, setRuns] = useState<LocalWorkflowRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectingRunId, setSelectingRunId] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    try {
      setRuns(await listLocalWorkflowRuns(workflowId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地运行记录加载失败');
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadRuns(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRuns, open]);

  useEffect(() => {
    if (!open) return;
    return subscribeHostEvent('workflow:status-update', () => void loadRuns());
  }, [loadRuns, open]);

  const handleSelect = async (runId: string) => {
    setSelectingRunId(runId);
    try {
      if (await onSelectRun(runId)) onClose();
      else setError('该运行记录已不可用，请刷新后重试');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取运行详情');
    } finally {
      setSelectingRunId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent
        side="right"
        className="no-drag flex w-full flex-col gap-0 border-l border-border bg-background p-0 text-foreground sm:max-w-[min(500px,100vw)]"
      >
        <header
          data-testid="local-run-history-header"
          className="flex h-[52px] shrink-0 items-center justify-between px-3"
        >
          <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4" aria-hidden />
            本地运行记录
          </SheetTitle>
          <SheetDescription className="sr-only">
            查看当前工作流保存在本机的运行记录
          </SheetDescription>
          <button
            type="button"
            aria-label="关闭本地运行记录"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="mx-3 mb-2 flex min-w-0 items-center gap-2 rounded-[10px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{workflowName || '当前工作流'}</span>
          {workflowId ? (
            <span className="inline-flex min-w-0 max-w-[65%] shrink items-center gap-1 rounded-md bg-background px-2 py-1 text-[11px]">
              <span className="shrink-0">工作流 ID</span>
              <code className="truncate font-mono text-foreground" title={workflowId}>{workflowId}</code>
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
          {loading && runs.length === 0 ? <RunHistorySkeleton /> : null}
          {!loading && error ? <ErrorState message={error} onRetry={() => void loadRuns()} /> : null}
          {!loading && !error && runs.length === 0 ? <EmptyState /> : null}
          {!error && runs.length > 0 ? <ol className="space-y-1">{runs.map((run, index) => <RunHistoryItem key={run.runId} run={run} latest={index === 0} busy={selectingRunId === run.runId} onClick={() => void handleSelect(run.runId)} />)}</ol> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RunHistoryItem({ run, latest, busy, onClick }: { run: LocalWorkflowRunSummary; latest: boolean; busy: boolean; onClick: () => void }) {
  const status = resolveLocalRunHistoryStatus(run.status);
  const { Icon, label, className } = STATUS_META[status];
  return <li><button type="button" disabled={busy} onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', className)}><Icon className="h-4 w-4" /></span>
    <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-sm font-medium text-foreground">{label}</span>{latest ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">最近</span> : null}<code className="min-w-0 truncate rounded bg-muted/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground" title={run.runId}>运行 ID {run.runId}</code></span><span className="mt-1 block text-xs text-muted-foreground">{formatLocalRunTime(run.startedAt)} · {formatLocalRunVersion(run)}</span></span>
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{busy ? '打开中' : formatLocalRunDuration(run)}</span>
  </button></li>;
}

function RunHistorySkeleton() { return <div className="space-y-2 p-2">{[0, 1, 2].map((index) => <div key={index} className="flex items-center gap-3 rounded-xl px-3 py-3"><div className="h-8 w-8 animate-pulse rounded-full bg-muted" /><div className="flex-1 space-y-2"><div className="h-3 w-16 animate-pulse rounded bg-muted" /><div className="h-3 w-28 animate-pulse rounded bg-muted" /></div><div className="h-3 w-12 animate-pulse rounded bg-muted" /></div>)}</div>; }
function EmptyState() { return <div className="flex min-h-[240px] flex-col items-center justify-center px-6 text-center"><History className="mb-3 h-8 w-8 text-muted-foreground/60" /><p className="text-sm font-medium text-foreground">还没有本地运行记录</p></div>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="flex min-h-[240px] flex-col items-center justify-center px-6 text-center"><AlertCircle className="mb-3 h-7 w-7 text-destructive" /><p className="max-w-sm text-sm text-muted-foreground">{message}</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}><RotateCcw className="mr-1 h-3.5 w-3.5" />重试</Button></div>; }
