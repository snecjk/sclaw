import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Clock, GitBranch, Loader2, XCircle } from 'lucide-react';
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
import {
  ArtifactProductCard,
  buildArtifactMetaLine,
} from '@/components/chat/artifact-product-card';
import { getExecutionByRunId } from '@/stores/workflow-memory';
import { hydrateWorkflowRun } from '@/lib/workflow-run-hydration';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import type { WorkflowExecutionState, WorkflowRunStatus } from '@/types/workflow';

interface WorkflowCardProps {
  runId: string;
  templateName: string;
  /** default：对话流独立块（与消息气泡/输入框同宽，仅 mt-3 间距）；inline：嵌在参数已确认展开区内（外层 pl-5 竖线区） */
  layout?: 'default' | 'inline';
  onPreviewArtifact?: (file: AttachedFileMeta) => void;
  onViewWorkflow?: (workflowId: string) => void;
  onCreateScheduledTask?: (workflowId: string) => void;
}

interface StatusTheme {
  labelKey: string;
  icon: typeof Loader2;
  statusTextClass: string;
  statusIconClass: string;
  progressClass: string;
  spin?: boolean;
}

function isTemplateIdLabel(name: string | undefined): boolean {
  const trimmed = name?.trim();
  return !trimmed || trimmed.startsWith('tpl_');
}

/** MasterGo C 组：工作流状态行描边 #E8EAEF（paint_4:1000 / --sto-sidebar-border） */
const workflowRowShellClass =
  'rounded-xl border border-[var(--sto-sidebar-border)]';

const STATUS_THEMES: Record<WorkflowRunStatus | 'pending', StatusTheme> = {
  running: {
    labelKey: 'workflow.statusRunning',
    icon: Loader2,
    statusTextClass: 'text-success',
    statusIconClass: 'text-success',
    progressClass: 'bg-success',
    spin: true,
  },
  completed: {
    labelKey: 'workflow.statusCompleted',
    icon: CheckCircle2,
    statusTextClass: 'text-success',
    statusIconClass: 'text-success',
    progressClass: 'bg-success',
  },
  failed: {
    labelKey: 'workflow.statusFailed',
    icon: XCircle,
    statusTextClass: 'text-destructive',
    statusIconClass: 'text-destructive',
    progressClass: 'bg-destructive',
  },
  timeout: {
    labelKey: 'workflow.statusTimeout',
    icon: Clock,
    statusTextClass: 'text-warning',
    statusIconClass: 'text-warning',
    progressClass: 'bg-warning',
  },
  unknown: {
    labelKey: 'workflow.statusUnknown',
    icon: Circle,
    statusTextClass: 'text-muted-foreground',
    statusIconClass: 'text-muted-foreground',
    progressClass: 'bg-muted-foreground',
  },
  pending: {
    labelKey: 'workflow.statusPending',
    icon: Circle,
    statusTextClass: 'text-muted-foreground',
    statusIconClass: 'text-muted-foreground',
    progressClass: 'bg-muted-foreground',
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
  layout = 'default',
  onPreviewArtifact,
  onViewWorkflow,
  onCreateScheduledTask,
}: WorkflowCardProps) {
  const { t } = useTranslation('chat');
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const agentId = useChatStore((s) => s.currentAgentId);
  const state = useChatStore((s) => s.workflowCardStates[runId]);

  const resolvedName = useMemo(() => {
    const exec = getExecutionByRunId(runId, sessionKey);
    const fromMemory = exec?.templateName?.trim();
    if (fromMemory && !isTemplateIdLabel(fromMemory)) return fromMemory;
    if (templateName && !isTemplateIdLabel(templateName)) return templateName;

    const workflowId = state?.workflowId || exec?.workflowId;
    const isActive = !state || state.status === 'running' || state.status === 'pending';
    if (workflowId && isActive) {
      return t('workflow.backgroundRunningWithId', { workflowId });
    }
    if (workflowId) {
      return t('workflow.withId', { workflowId });
    }

    return fromMemory || templateName || t('workflow.defaultName');
  }, [runId, sessionKey, templateName, state?.workflowId, state?.status, t]);

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
  const isCompleted = display.status === 'completed';
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
  const showWorkflowActions = isTerminal
    && !!display.workflowId
    && (onViewWorkflow || onCreateScheduledTask);
  // MCP 执行成功态：仅展示产物卡，不重复状态行
  const showStatusRow = !(isCompleted && primaryArtifact);

  return (
    <div
      className={cn(
        'w-full space-y-2',
        layout === 'default' && 'mt-3',
      )}
    >
      {display.result?.summary ? (
        <p className="text-sm leading-6 text-foreground">{display.result.summary}</p>
      ) : null}

      {showStatusRow ? (
        <div
          className={cn(
            workflowRowShellClass,
            layout === 'inline' ? 'bg-transparent' : 'bg-card',
            'px-3.5 py-3',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-[13px] font-medium leading-4 text-foreground">
                {resolvedName}
              </p>
              {durationLabel && (isRunning || (isTerminal && display.completedAt)) ? (
                <p className="shrink-0 text-[13px] leading-5 text-muted-foreground">{durationLabel}</p>
              ) : null}
            </div>
            <div
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 text-sm font-medium leading-[18px]',
                theme.statusTextClass,
              )}
            >
              <StatusIcon
                className={cn('h-4 w-4', theme.statusIconClass, theme.spin && 'animate-spin')}
                strokeWidth={2}
                aria-hidden
              />
              {t(theme.labelKey)}
            </div>
          </div>

          {showProgress ? (
            <div className="mt-2.5">
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                {/* 动态进度宽：Tailwind 无法静态表达百分比，保留 inline width */}
                <div
                  className={cn('h-full rounded-full transition-all duration-500', theme.progressClass)}
                  style={{ width: `${Math.max(display.progress, 8)}%` }}
                />
              </div>
            </div>
          ) : null}

          {display.error ? (
            <p className="mt-2 text-[13px] leading-5 text-destructive">{display.error}</p>
          ) : null}
        </div>
      ) : null}

      {primaryArtifact ? (
        <ArtifactProductCard
          title={primaryArtifact.name}
          metaLine={buildArtifactMetaLine({
            fileName: primaryArtifact.name,
            mimeType: primaryArtifact.type || 'application/octet-stream',
            t,
          })}
          actionLabel={
            canPreviewArtifact ? t('workflow.viewArtifact') : t('workflow.openArtifactLink')
          }
          onAction={() => {
            if (canPreviewArtifact) {
              onPreviewArtifact!(artifactToPreviewFile(primaryArtifact));
            } else {
              openExternalUrl(primaryArtifact.url);
            }
          }}
        />
      ) : null}

      {showWorkflowActions ? (
        <div className={cn('flex flex-wrap gap-2', layout === 'default' && 'pl-0')}>
          {onViewWorkflow ? (
            <button
              type="button"
              onClick={() => onViewWorkflow(display.workflowId)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.06]"
            >
              <GitBranch className="h-3.5 w-3.5 text-primary" aria-hidden />
              {t('workflow.viewWorkflowAction')}
            </button>
          ) : null}
          {onCreateScheduledTask ? (
            <button
              type="button"
              onClick={() => onCreateScheduledTask(display.workflowId)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.06]"
            >
              <Clock className="h-3.5 w-3.5 text-primary" aria-hidden />
              {t('workflow.createScheduledTaskAction')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
