import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Loader2, Workflow, XCircle, Clock, FileText, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  breakdownWorkflowDurationMs,
  getWorkflowDurationMs,
} from '@/lib/format-workflow-duration';
import {
  artifactToPreviewFile,
  isPreviewableArtifactUrl,
  isUserFacingArtifactUrl,
  openExternalUrl,
} from '@/lib/preview-url';
import { useChatStore, type AttachedFileMeta } from '@/stores/chat';
import { getExecutionByRunId } from '@/stores/workflow-memory';
import { hydrateWorkflowRun } from '@/lib/workflow-run-hydration';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import type { WorkflowExecutionState, WorkflowRunStatus } from '@/types/workflow';

interface WorkflowCardProps {
  runId: string;
  templateName: string;
  onPreviewArtifact?: (file: AttachedFileMeta) => void;
  onViewWorkflow?: (workflowId: string) => void;
}

interface StatusTheme {
  labelKey: string;
  icon: typeof Loader2;
  badgeClass: string;
  dotClass: string;
  cardClass: string;
  progressClass: string;
  spin?: boolean;
}

const STATUS_THEMES: Record<WorkflowRunStatus | 'pending', StatusTheme> = {
  running: {
    labelKey: 'workflow.statusRunning',
    icon: Loader2,
    badgeClass: 'text-[#D95700] bg-[#FFF5E6]',
    dotClass: 'bg-[#FF6F00]',
    cardClass: 'border-[#FFD7A3]/60 bg-[#FFFBF5]',
    progressClass: 'bg-[#FF6F00]',
    spin: true,
  },
  completed: {
    labelKey: 'workflow.statusCompleted',
    icon: CheckCircle2,
    badgeClass: 'text-[#008F40] bg-[#DCF5E2]',
    dotClass: 'bg-[#00B54B]',
    cardClass: 'border-[#ACE8BC]/50 bg-[#FAFFFC]',
    progressClass: 'bg-[#00B54B]',
  },
  failed: {
    labelKey: 'workflow.statusFailed',
    icon: XCircle,
    badgeClass: 'text-[#D4282E] bg-[#FFF2F0]',
    dotClass: 'bg-[#FA3C3C]',
    cardClass: 'border-[#FFBFB8]/50 bg-[#FFFAFA]',
    progressClass: 'bg-[#FA3C3C]',
  },
  timeout: {
    labelKey: 'workflow.statusTimeout',
    icon: Clock,
    badgeClass: 'text-[#AD6B00] bg-[#FFFBE6]',
    dotClass: 'bg-[#FAAD14]',
    cardClass: 'border-[#FFE58F]/60 bg-[#FFFDF5]',
    progressClass: 'bg-[#FAAD14]',
  },
  unknown: {
    labelKey: 'workflow.statusUnknown',
    icon: Circle,
    badgeClass: 'text-[#4E5969] bg-[#F0F2F5]',
    dotClass: 'bg-[#86909C]',
    cardClass: 'border-[#E5E6EB] bg-white',
    progressClass: 'bg-[#86909C]',
  },
  pending: {
    labelKey: 'workflow.statusPending',
    icon: Circle,
    badgeClass: 'text-[#4E5969] bg-[#F0F2F5]',
    dotClass: 'bg-[#86909C]',
    cardClass: 'border-[#E5E6EB] bg-white',
    progressClass: 'bg-[#86909C]',
  },
};

function useDurationLabel(
  startedAt: string | undefined,
  completedAt: string | undefined,
  isRunning: boolean,
): string | null {
  const { t } = useTranslation('chat');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning || !startedAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isRunning, startedAt]);

  return useMemo(() => {
    const durationMs = getWorkflowDurationMs(startedAt, completedAt, now);
    if (durationMs === null) return null;

    const parts = breakdownWorkflowDurationMs(durationMs);
    let durationText: string;
    switch (parts.kind) {
      case 'seconds':
        durationText = t('workflow.durationSeconds', { count: parts.seconds });
        break;
      case 'minutes':
        durationText = t('workflow.durationMinutes', { count: parts.minutes });
        break;
      case 'halfHour':
        durationText = t('workflow.durationHalfHour');
        break;
      case 'hours':
        durationText = t('workflow.durationHours', { count: parts.hours });
        break;
      case 'hoursHalf':
        durationText = t('workflow.durationHoursHalf', { count: parts.hours });
        break;
      case 'hoursMinutes':
        durationText = t('workflow.durationHoursMinutes', {
          hours: parts.hours,
          minutes: parts.remainMinutes,
        });
        break;
    }

    if (isRunning) {
      return t('workflow.runningFor', { duration: durationText });
    }
    if (completedAt) {
      return t('workflow.elapsed', { duration: durationText });
    }
    return null;
  }, [startedAt, completedAt, isRunning, now, t]);
}

export function WorkflowCard({
  runId,
  templateName,
  onPreviewArtifact,
  onViewWorkflow,
}: WorkflowCardProps) {
  const { t } = useTranslation('chat');
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const agentId = useChatStore((s) => s.currentAgentId);
  const state = useChatStore((s) => s.workflowCardStates[runId]);

  const resolvedName = useMemo(() => {
    const exec = getExecutionByRunId(runId, sessionKey);
    const fromMemory = exec?.templateName?.trim();
    if (fromMemory && !fromMemory.startsWith('tpl_')) return fromMemory;
    if (templateName && !templateName.startsWith('tpl_')) return templateName;
    return fromMemory || templateName;
  }, [runId, sessionKey, templateName]);

  useEffect(() => {
    const needsHydrate = !state
      || !isTerminalWorkflowRunStatus(state.status)
      || (!state.result?.summary && !(state.result?.artifacts?.length));
    if (!needsHydrate) return;
    void hydrateWorkflowRun(runId, { sessionKey, agentId });
  }, [runId, sessionKey, agentId, state?.status, state?.result?.summary, state?.result?.artifacts]);

  const display = useMemo<WorkflowExecutionState>(() => {
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

  const statusKey = display.status in STATUS_THEMES ? display.status : 'pending';
  const theme = STATUS_THEMES[statusKey];
  const StatusIcon = theme.icon;
  const isRunning = display.status === 'running';
  const isTerminal = isTerminalWorkflowRunStatus(display.status);
  const durationLabel = useDurationLabel(display.startedAt, display.completedAt, isRunning);
  const showProgress = isRunning && display.progress > 0;
  const userFacingArtifacts = (display.result?.artifacts ?? []).filter(
    (artifact) => isUserFacingArtifactUrl(artifact.url),
  );
  const primaryArtifact = userFacingArtifacts[0];
  const canPreviewArtifact = Boolean(
    primaryArtifact
    && onPreviewArtifact
    && isPreviewableArtifactUrl(primaryArtifact.url, primaryArtifact.type),
  );

  return (
    <div
      className={cn(
        'mt-3 w-full max-w-md overflow-hidden rounded-2xl border shadow-[0_2px_8px_rgba(29,33,41,0.04)]',
        theme.cardClass,
      )}
    >
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm ring-1 ring-black/[0.04]">
            <Workflow className="h-4 w-4 text-[#FF6F00]" strokeWidth={2.2} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h4 className="truncate text-[15px] font-semibold leading-6 text-[#1D2129]">
                {resolvedName}
              </h4>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                  theme.badgeClass,
                )}
              >
                <StatusIcon
                  className={cn('h-3.5 w-3.5', theme.spin && 'animate-spin')}
                  strokeWidth={2.2}
                />
                {t(theme.labelKey)}
              </span>
            </div>

            {durationLabel && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-[#86909C]">
                <span className={cn('inline-block h-1.5 w-1.5 rounded-full', theme.dotClass)} />
                {durationLabel}
              </p>
            )}

            {display.result?.summary && (
              <p className="mt-2 line-clamp-3 text-xs leading-5 text-[#4E5969]">
                {display.result.summary}
              </p>
            )}
          </div>
        </div>

        {showProgress && (
          <div className="mt-3 pl-12">
            <div className="h-1 overflow-hidden rounded-full bg-[#F0F2F5]">
              <div
                className={cn('h-full rounded-full transition-all duration-500', theme.progressClass)}
                style={{ width: `${Math.max(display.progress, 8)}%` }}
              />
            </div>
          </div>
        )}

        {display.error && (
          <p className="mt-2.5 pl-12 text-xs leading-5 text-[#FA3C3C]">{display.error}</p>
        )}

        {(primaryArtifact || (isTerminal && display.workflowId && onViewWorkflow)) && (
          <div className="mt-3 space-y-2 pl-12">
            {primaryArtifact && (
              <div className="flex items-center gap-3 rounded-xl border border-[#E5E6EB] bg-white px-3.5 py-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF5E6]">
                  <FileText className="h-4 w-4 text-[#FF6F00]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[#1D2129]">{primaryArtifact.name}</p>
                  <p className="truncate text-[11px] text-[#86909C]">
                    {primaryArtifact.type || 'output'}
                  </p>
                </div>
                {canPreviewArtifact ? (
                  <button
                    type="button"
                    onClick={() => onPreviewArtifact!(artifactToPreviewFile(primaryArtifact))}
                    className="shrink-0 rounded-full border border-[#FF6F00]/30 px-3 py-1 text-[12px] font-medium text-[#FF6F00] transition-colors hover:bg-[#FFF5E6]"
                  >
                    查看预览
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openExternalUrl(primaryArtifact.url)}
                    className="shrink-0 text-[12px] font-medium text-[#4760FE] hover:underline"
                  >
                    打开链接
                  </button>
                )}
              </div>
            )}

            {isTerminal && display.workflowId && onViewWorkflow && (
              <button
                type="button"
                onClick={() => onViewWorkflow(display.workflowId)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E6EB] bg-white px-3 py-1.5 text-[12px] font-medium text-[#1D2129] transition-colors hover:border-[#FFD7A3] hover:bg-[#FFFBF5]"
              >
                <GitBranch className="h-3.5 w-3.5 text-[#FF6F00]" />
                查看工作流
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
