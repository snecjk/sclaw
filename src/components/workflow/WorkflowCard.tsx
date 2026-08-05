import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Clock, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { workflowResultSummaryClass } from '@/lib/surfaces';
import {
  breakdownWorkflowDurationMs,
  getWorkflowDurationMs,
} from '@/lib/format-workflow-duration';
import {
  artifactToPreviewFile,
  isUserFacingArtifactUrl,
  openExternalUrl,
} from '@/lib/preview-url';
import { shouldPreviewInSidePanel } from '@/lib/preview-href';
import type { AttachedFileMeta } from '@/stores/chat';
import {
  ArtifactProductCard,
  buildArtifactMetaLine,
} from '@/components/chat/artifact-product-card';
import { buildArtifactCardMenuItems } from '@/lib/artifact-card-menu';
import { isTerminalWorkflowRunStatus } from '@/lib/workflow-run-status';
import { getWorkflowProgressDetails } from '@/lib/workflow-card-progress';
import { getChatWorkflowCard } from '@/lib/workflow-api';
import { parseWorkflowParamsSummaryGroups } from '@/lib/workflow-form-utils';
import type { WorkflowExecutionState, WorkflowRunStatus } from '@/types/workflow';

interface WorkflowCardProps {
  runId: string;
  templateName: string;
  paramsSummary?: string | null;
  /** default：对话流独立块（与消息气泡/输入框同宽，仅 mt-3 间距）；inline：嵌在参数已确认展开区内（外层 pl-5 竖线区） */
  layout?: 'default' | 'inline';
  /**
   * full：状态行 + 结果区（独立场景默认）
   * status：仅状态行（参数已确认折叠区内）
   * results：仅摘要 + 产物 + 操作（与折叠块平级，无左竖线缩进）
   */
  section?: 'full' | 'status' | 'results';
  onPreviewArtifact?: (file: AttachedFileMeta) => void;
  onCreateScheduledTask?: (workflowId: string) => void;
  onOpenWorkflow?: (workflowId: string) => void;
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
  return !trimmed || /^(?:tpl|wf)_/i.test(trimmed);
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
  cancelled: {
    labelKey: 'workflow.statusCancelled',
    icon: Circle,
    statusTextClass: 'text-muted-foreground',
    statusIconClass: 'text-muted-foreground',
    progressClass: 'bg-muted-foreground',
  },
  waiting_approval: {
    labelKey: 'workflow.statusWaitingApproval',
    icon: Clock,
    statusTextClass: 'text-warning',
    statusIconClass: 'text-warning',
    progressClass: 'bg-warning',
  },
  waiting_input: {
    labelKey: 'workflow.statusWaitingInput',
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
  paramsSummary,
  layout = 'default',
  section = 'full',
  onPreviewArtifact,
  onCreateScheduledTask,
  onOpenWorkflow,
}: WorkflowCardProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<WorkflowExecutionState | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [paramsExpanded, setParamsExpanded] = useState(true);

  const resolvedName = (() => {
    if (templateName && !isTemplateIdLabel(templateName)) return templateName;
    return t('workflow.defaultName');
  })();

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let inFlight = false;
    let failures = 0;
    const backoff = [3_000, 6_000, 12_000, 30_000];

    const schedule = (delay: number) => {
      if (disposed) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const snapshot = await getChatWorkflowCard(runId);
        if (disposed) return;
        if (!snapshot) {
          setNotFound(true);
          setQueryError(null);
          return;
        }
        failures = 0;
        setNotFound(false);
        setQueryError(null);
        setState(snapshot);
        if (!isTerminalWorkflowRunStatus(snapshot.status)) {
          schedule(snapshot.status === 'waiting_approval' || snapshot.status === 'waiting_input' ? 5_000 : 3_000);
        }
      } catch (error) {
        if (disposed) return;
        setQueryError(error instanceof Error ? error.message : String(error));
        const delay = backoff[Math.min(failures, backoff.length - 1)];
        failures += 1;
        schedule(delay);
      } finally {
        inFlight = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
      else if (timer !== undefined) window.clearTimeout(timer);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [runId, retryNonce]);

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
  const progressDetails = getWorkflowProgressDetails(display);
  const isRunning = progressDetails.isActive;
  const isTerminal = isTerminalWorkflowRunStatus(display.status);
  const durationLabel = useDurationLabel(display.startedAt, display.completedAt, isRunning);
  const showProgress = isRunning;
  const userFacingArtifacts = (display.status === 'completed' ? display.result?.artifacts ?? [] : []).filter(
    (artifact) => isUserFacingArtifactUrl(artifact.filePath || artifact.url),
  );
  const showWorkflowActions = isTerminal
    && !!display.workflowId
    && !!onCreateScheduledTask;

  const showStatus = section === 'full' || section === 'status';
  const showResults = section === 'full' || section === 'results';
  const hasResultsContent = showResults && (
    Boolean(display.result?.summary)
    || userFacingArtifacts.length > 0
    || showWorkflowActions
  );
  const workflowIdentity = display.workflowId
    ? `${resolvedName}（${display.workflowId}）`
    : resolvedName;
  const confirmedParamGroups = useMemo(
    () => (paramsSummary ? parseWorkflowParamsSummaryGroups(paramsSummary) : []),
    [paramsSummary],
  );
  const collapsedParamsPreview = useMemo(() => {
    const firstGroup = confirmedParamGroups[0];
    if (firstGroup) return `${firstGroup.title}：${firstGroup.content}`;
    return paramsSummary
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('已确认以下参数')) ?? '';
  }, [confirmedParamGroups, paramsSummary]);

  const statusRow = showStatus ? (
    <div
      className={cn(
        workflowRowShellClass,
        layout === 'inline' ? 'bg-transparent' : 'bg-card',
        'px-3.5 py-3',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] leading-5">

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-muted-foreground">{t('workflow.nameLabel')}</span>
          {display.workflowId && onOpenWorkflow ? (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex max-w-[min(42vw,360px)] truncate rounded-sm px-1 py-0.5 font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenWorkflow(display.workflowId)}
                >
                  {workflowIdentity}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="text-xs">
                {t('workflow.viewWorkflow')}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="truncate font-medium text-foreground" title={workflowIdentity}>
              {workflowIdentity}
            </span>
          )}
          <span className="shrink-0 text-muted-foreground">{t('workflow.runIdLabel')}</span>
          <code
              className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground"
              title={runId}
          >
            {runId}
          </code>
        </div>

        {durationLabel && (isRunning || (isTerminal && display.completedAt)) ? (
          <p className="shrink-0 text-muted-foreground">{durationLabel}</p>
        ) : null}
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

      {paramsSummary ? (
        <div className="mt-3 border-t border-border/70 pt-2.5">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={paramsExpanded}
            onClick={() => setParamsExpanded((value) => !value)}
          >
            {paramsExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
            <span>{t('workflow.confirmedParameters')}</span>
            {!paramsExpanded && collapsedParamsPreview ? (
              <span className="max-w-[min(42vw,360px)] truncate text-[12px] font-normal text-muted-foreground" title={collapsedParamsPreview}>
                {collapsedParamsPreview}
              </span>
            ) : null}
          </button>

          {paramsExpanded ? (
            confirmedParamGroups.length > 0 ? (
              <dl className="mt-2.5 grid gap-2">
                {confirmedParamGroups.map((group) => (
                  <div key={`${group.title}-${group.content}`} className="grid gap-0.5">
                    <dt className="text-[12px] font-medium leading-4 text-foreground/80">{group.title}</dt>
                    <dd className="m-0 break-words text-[13px] leading-5 text-muted-foreground">{group.content}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-muted-foreground">
                {paramsSummary}
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {showProgress ? (
        <div className="mt-2.5">
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-label={t('workflow.progressLabel')}>
            {/* 动态进度宽：Tailwind 无法静态表达百分比，保留 inline width */}
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                theme.progressClass,
                display.progress === 0 && 'animate-pulse',
              )}
              style={{ width: `${display.progress > 0 ? Math.max(display.progress, 8) : 28}%` }}
            />
          </div>
          {progressDetails.helperText ? (
            <p className="mt-1.5 truncate text-[12px] leading-4 text-muted-foreground">
              {progressDetails.helperText === 'preparing' ? t('workflow.preparingProgress') : null}
              {progressDetails.helperText === 'steps'
                ? t('workflow.stepProgress', {
                  completed: progressDetails.completedSteps,
                  total: progressDetails.totalSteps,
                  current: progressDetails.currentStep ?? t('workflow.stepPending'),
                })
                : null}
              {progressDetails.helperText === 'waitingApproval' ? t('workflow.waitingApprovalProgress') : null}
              {progressDetails.helperText === 'waitingInput' ? t('workflow.waitingInputProgress') : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {display.error ? (
        <p className="mt-2 text-[13px] leading-5 text-destructive">{display.error}</p>
      ) : null}
      {notFound || queryError ? (
        <div className="mt-2 flex items-center justify-between gap-3 text-[13px] leading-5 text-destructive">
          <span>{notFound ? t('workflow.runUnavailable') : queryError}</span>
          <button
            type="button"
            className="shrink-0 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setRetryNonce((value) => value + 1)}
          >
            {t('workflow.retryQuery')}
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  const resultsBlock = hasResultsContent ? (
    <>
      {display.result?.summary ? (
        <p className={workflowResultSummaryClass}>
          {display.result.summary}
        </p>
      ) : null}

      {userFacingArtifacts.length > 0 ? (
        <div className="space-y-2">
          {userFacingArtifacts.map((artifact) => {
            const previewFile = artifactToPreviewFile(artifact);
            const previewable = shouldPreviewInSidePanel(previewFile.filePath || artifact.url);
            return (
              <ArtifactProductCard
                key={artifact.id || artifact.url || artifact.name}
                title={artifact.name}
                metaLine={buildArtifactMetaLine({
                  fileName: artifact.name,
                  mimeType: artifact.type || 'application/octet-stream',
                  t,
                })}
                actionLabel={previewable ? t('artifact.preview') : t('workflow.openArtifactLink')}
                menuItems={buildArtifactCardMenuItems(previewFile, t)}
                onAction={() => {
                  if (previewable && onPreviewArtifact) {
                    onPreviewArtifact(previewFile);
                    return;
                  }
                  openExternalUrl(artifact.url);
                }}
              />
            );
          })}
        </div>
      ) : null}

      {showWorkflowActions ? (
        <div className={cn('flex flex-wrap gap-2', layout === 'default' && 'pl-0')}>
          <button
            type="button"
            onClick={() => onCreateScheduledTask!(display.workflowId)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.06]"
          >
            <Clock className="h-3.5 w-3.5 text-primary" aria-hidden />
            {t('workflow.createScheduledTaskAction')}
          </button>
        </div>
      ) : null}
    </>
  ) : null;

  if (!statusRow && !resultsBlock) return null;

  return (
    <div
      id={`workflow-card-${runId}`}
      tabIndex={-1}
      className={cn(
        'w-full space-y-2',
        layout === 'default' && section === 'full' && 'mt-3',
      )}
    >
      {statusRow}
      {resultsBlock}
    </div>
  );
}
