import { useMemo } from 'react';
import { CheckCircle2, Circle, Loader2, XCircle, FileText, Clock } from 'lucide-react';
import { WorkflowExecutionSteps } from './WorkflowExecutionSteps';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';

interface WorkflowCardProps {
  runId: string;
  templateName: string;
}

export function WorkflowCard({ runId, templateName }: WorkflowCardProps) {
  const { t } = useTranslation('chat');
  const state = useChatStore((s) => s.workflowCardStates[runId]);

  const display = useMemo<import('../../types/workflow').WorkflowExecutionState>(() => {
    if (!state) {
      return {
        runId,
        workflowId: '',
        status: 'pending',
        progress: 0,
        steps: [],
      };
    }
    return state;
  }, [state, runId]);

  const statusConfig = useMemo(() => {
    switch (display.status) {
      case 'completed':
        return { label: t('workflow.statusCompleted'), color: 'text-green-600', icon: CheckCircle2, bg: 'bg-green-50 dark:bg-green-950/20' };
      case 'failed':
        return { label: t('workflow.statusFailed'), color: 'text-red-600', icon: XCircle, bg: 'bg-red-50 dark:bg-red-950/20' };
      case 'running':
        return { label: t('workflow.statusRunning'), color: 'text-amber-600', icon: Loader2, bg: 'bg-amber-50 dark:bg-amber-950/20' };
      case 'timeout':
        return { label: t('workflow.statusTimeout'), color: 'text-orange-600', icon: Clock, bg: 'bg-orange-50 dark:bg-orange-950/20' };
      case 'unknown':
        return { label: t('workflow.statusUnknown'), color: 'text-slate-500', icon: Circle, bg: 'bg-slate-50 dark:bg-slate-950/20' };
      default:
        return { label: t('workflow.statusPending'), color: 'text-slate-500', icon: Circle, bg: 'bg-slate-50 dark:bg-slate-950/20' };
    }
  }, [display.status, t]);

  const StatusIcon = statusConfig.icon;

  return (
    <div className={cn('mt-2 rounded-xl border p-3 text-sm', statusConfig.bg, 'border-border/60')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIcon className={cn('h-4 w-4 shrink-0', statusConfig.color, display.status === 'running' && 'animate-spin')} />
          <span className="font-medium text-foreground truncate">{templateName}</span>
        </div>
        <span className={cn('text-xs font-medium shrink-0', statusConfig.color)}>{statusConfig.label}</span>
      </div>

      {/* Progress bar */}
      {display.status === 'running' && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${display.progress}%` }}
            />
          </div>
          {display.currentStep && (
            <p className="mt-1 text-xs text-muted-foreground">{display.currentStep}</p>
          )}
        </div>
      )}

      {/* Steps timeline */}
      <WorkflowExecutionSteps steps={display.steps} />

      {/* Error */}
      {display.error && (
        <p className="mt-2 text-xs text-red-600">{display.error}</p>
      )}

      {/* Result artifacts */}
      {display.result?.artifacts && display.result.artifacts.length > 0 && (
        <div className="mt-2 space-y-1">
          {display.result.artifacts.map((artifact) => (
            <a
              key={artifact.id}
              href={artifact.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <FileText className="h-3 w-3" />
              {artifact.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
