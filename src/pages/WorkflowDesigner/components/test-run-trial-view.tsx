import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleX,
  LoaderCircle,
  Maximize2,
  Volume2,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { invokeIpc } from '@/lib/api-client';
import { isHttpUrl, openExternalUrl } from '@/lib/preview-url';
import type { TestRunDrawerProps } from '@/pages/WorkflowDesigner/components/test-run-drawer';
import { isGlobalToastInteractionTarget } from '@/lib/global-toast-interaction';
import {
  formatTrialRunTime,
  formatTrialRunVersion,
  getTrialRunArtifactTarget,
  resolveTrialRunView,
  type TrialRunDisplayArtifact,
  type TrialRunTimelineItem,
  type TrialRunView,
} from '@/pages/WorkflowDesigner/components/test-run-drawer-model';

interface TrialRunDrawerViewProps extends TestRunDrawerProps {
  timeline: TrialRunTimelineItem[];
  artifacts: TrialRunDisplayArtifact[];
}

const STATUS_STYLE: Record<TrialRunView, string> = {
  running: 'text-[#FF6700]',
  cancelled: 'text-[#FAAD14]',
  failed: 'text-[#FA3C3C]',
  completed: 'text-[#00B54B]',
};

function openArtifact(artifact: TrialRunDisplayArtifact) {
  const target = getTrialRunArtifactTarget(artifact);
  if (!target) return;
  if (isHttpUrl(target)) {
    openExternalUrl(target);
    return;
  }
  const localPath = artifact.filePath?.trim()
    || (target.startsWith('file://') ? decodeURIComponent(target.replace(/^file:\/\/\/?/, '')) : target);
  if (localPath) void invokeIpc('shell:openPath', localPath);
}

function TrialRunTimeline({ items }: { items: TrialRunTimelineItem[] }) {
  const { t } = useTranslation('workflow');
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-width:thin]">
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t('run.noEvents')}</p>
      ) : (
        <ol>
          {items.map((item, index) => (
            <li className="relative grid grid-cols-[12px_minmax(0,1fr)_auto] gap-x-2 pb-3 last:pb-0" key={item.id}>
              <span className="relative flex justify-center pt-1.5" aria-hidden>
                <span data-testid="trial-run-timeline-dot" className="z-10 h-1.5 w-1.5 rounded-full bg-[#C9CDD4]" />
                {index < items.length - 1 ? (
                  <span data-testid="trial-run-timeline-line" className="absolute bottom-[-6px] top-3 w-px bg-[#E5E6EB]" />
                ) : null}
              </span>
              <div className="min-w-0">
                <p className="text-xs leading-5 text-muted-foreground">{item.label}</p>
                {item.detail ? <p className="whitespace-pre-wrap break-words pl-3 text-xs leading-5 text-muted-foreground">{item.detail}</p> : null}
              </div>
              {item.timestamp ? (
                <time className="pt-0.5 text-[11px] leading-5 text-muted-foreground">
                  {formatTrialRunTime(item.timestamp)}
                </time>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ProcessCard({
  items,
  children,
}: {
  items: TrialRunTimelineItem[];
  children?: ReactNode;
}) {
  const { t } = useTranslation('workflow');
  return (
    <section
      data-testid="trial-run-process-card"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-border bg-card"
    >
      <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
        <h3 className="text-xs font-medium text-foreground">{t('run.process')}</h3>
      </div>
      {children}
      <TrialRunTimeline items={items} />
    </section>
  );
}

function ArtifactCard({ artifacts }: { artifacts: TrialRunDisplayArtifact[] }) {
  const { t } = useTranslation('workflow');
  const first = artifacts[0];
  const firstTarget = first ? getTrialRunArtifactTarget(first) : '';
  return (
    <section
      data-testid="trial-run-artifact-card"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-border bg-card"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <h3 className="text-xs font-medium text-foreground">{t('run.artifactName')}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            aria-label={t('run.openArtifact')}
            disabled={!firstTarget}
            onClick={() => first && openArtifact(first)}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
        {artifacts.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{t('run.noArtifacts')}</p>
        ) : (
          <ul className="space-y-2">
            {artifacts.map((artifact) => {
              const target = getTrialRunArtifactTarget(artifact);
              return (
                <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2" key={`${artifact.source}:${artifact.id}`}>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-xs font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:font-normal disabled:text-muted-foreground disabled:no-underline"
                    disabled={!target}
                    title={target ? t('run.clickViewAttachment') : undefined}
                    onClick={() => openArtifact(artifact)}
                  >
                    {artifact.name}
                  </button>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{artifact.contentType ?? artifact.type}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function TrialStatusRow({
  view,
  version,
  processExpanded,
  onToggleProcess,
}: {
  view: TrialRunView;
  version?: string | number | null;
  processExpanded: boolean;
  onToggleProcess: () => void;
}) {
  const { t } = useTranslation('workflow');
  const config = {
    running: { label: t('run.stateRunning'), Icon: LoaderCircle },
    cancelled: { label: t('run.stateCancelled'), Icon: CircleAlert },
    failed: { label: t('run.stateFailed'), Icon: CircleX },
    completed: { label: t('run.stateCompleted'), Icon: CircleCheck },
  }[view];
  const { Icon } = config;
  return (
    <div
      data-testid="trial-run-status"
      className={`flex h-[42px] shrink-0 items-center gap-2 rounded-[10px] border border-[#E5E6EB] bg-white px-3 ${STATUS_STYLE[view]}`}
    >
      <Icon className={`h-3.5 w-3.5 ${view === 'running' ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
      <strong className="text-xs font-medium">{config.label}</strong>
      <span className="text-[11px] text-[#86909C]">
        {t('run.currentVersion')}：{formatTrialRunVersion(version)}
      </span>
      {view === 'completed' ? (
        <button
          type="button"
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={processExpanded}
          aria-label={processExpanded ? t('run.collapseProcess') : t('run.expandProcess')}
          onClick={onToggleProcess}
        >
          {t('run.process')}
          {processExpanded ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
        </button>
      ) : null}
    </div>
  );
}

export function TrialRunDrawerView(props: TrialRunDrawerViewProps) {
  const { t } = useTranslation('workflow');
  const [processExpanded, setProcessExpanded] = useState(false);
  const [inputJson, setInputJson] = useState('{}');
  const [inputError, setInputError] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [dismissedNoticeRunId, setDismissedNoticeRunId] = useState<string | null>(null);
  const status = props.executionState?.status;
  const view = resolveTrialRunView({
    isStarting: props.isStarting,
    isRunActive: props.isRunActive,
    status,
    launchError: props.launchError,
  });
  const workflowVersion = props.run?.workflowVersion ?? props.workflowVersion;
  const noticeRunId = props.runId ?? '__starting__';
  const showRunningNotice = view === 'running' && dismissedNoticeRunId !== noticeRunId;
  const footer = view === 'running' && props.onCancel
    ? { label: props.isCancelling ? t('run.cancelling') : t('run.cancelRun'), action: props.onCancel }
    : view === 'cancelled' && props.onContinue
      ? { label: t('run.continueRun'), action: props.onContinue }
      : props.onRerun
        ? { label: t('run.rerunPlain'), action: props.onRerun }
        : props.onReturnToConversation
          ? {
              label: props.returnToConversationLabel ?? '返回发起会话',
              action: props.onReturnToConversation,
            }
          : null;

  return (
    <Sheet open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border bg-background p-0 text-foreground sm:max-w-[min(500px,100vw)]"
        onPointerDownOutside={(event) => {
          // Keep the trial drawer mounted until the toast action reaches its
          // onClick handler. That handler coordinates closing this drawer and
          // opening the result drawer in a single interaction.
          if (isGlobalToastInteractionTarget(event.target)) event.preventDefault();
        }}
      >
        <header data-testid="trial-run-header" className="flex h-[52px] shrink-0 items-center justify-between px-3">
          <SheetTitle className="text-sm font-semibold">{t('run.resultTitle')}</SheetTitle>
          <SheetDescription className="sr-only">{t('run.resultDescription')}</SheetDescription>
          <button
            type="button"
            aria-label={t('detail.close')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={props.onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 py-2">
          {showRunningNotice ? (
            <div
              data-testid="trial-run-notice"
              className="flex min-h-[52px] shrink-0 items-start gap-2 rounded-[10px] border border-[#FFD6BA] bg-[#FFF1E8] px-3 py-2 text-xs leading-4 text-[#1D2129]"
            >
              <Volume2 data-testid="trial-run-notice-icon" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF6700]" aria-hidden />
              <p className="min-w-0 flex-1">{t('run.runningNotice')}</p>
              <button
                type="button"
                aria-label={t('run.dismissNotice')}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#1D2129] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6700]"
                onClick={() => setDismissedNoticeRunId(noticeRunId)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
          <TrialStatusRow
            view={view}
            version={workflowVersion}
            processExpanded={processExpanded}
            onToggleProcess={() => setProcessExpanded((expanded) => !expanded)}
          />

          {view === 'running' ? (
            <ProcessCard items={props.timeline}>
              {status === 'waiting_approval' && props.onDecideApproval ? (
                <div className="border-b border-border bg-brand/5 p-3">
                  <p className="text-xs font-medium text-foreground">{t('run.approval')}</p>
                  <Textarea
                    className="mt-2 min-h-16 bg-background text-xs"
                    value={decisionNote}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    placeholder={t('run.approvalNote')}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => props.onDecideApproval?.(false, decisionNote)}>{t('run.reject')}</Button>
                    <Button size="sm" onClick={() => props.onDecideApproval?.(true, decisionNote)}>{t('run.approve')}</Button>
                  </div>
                </div>
              ) : null}
              {status === 'waiting_input' && props.onSubmitInput ? (
                <div className="border-b border-border bg-brand/5 p-3">
                  <p className="text-xs font-medium text-foreground">{t('run.supplementalInput')}</p>
                  <Textarea
                    className="mt-2 min-h-20 bg-background font-mono text-xs"
                    value={inputJson}
                    aria-invalid={Boolean(inputError)}
                    onChange={(event) => setInputJson(event.target.value)}
                  />
                  {inputError ? <p className="mt-1 text-xs text-destructive">{inputError}</p> : null}
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={() => {
                      try {
                        props.onSubmitInput?.(JSON.parse(inputJson));
                        setInputError(null);
                      } catch {
                        setInputError(t('run.inputInvalid'));
                      }
                    }}>{t('run.submit')}</Button>
                  </div>
                </div>
              ) : null}
            </ProcessCard>
          ) : null}

          {view === 'cancelled' || view === 'failed' ? (
            <ProcessCard items={props.timeline}>
              {view === 'failed' ? (
                <p className="border-b border-destructive/15 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {props.launchError ?? props.executionState?.error ?? props.run?.error ?? t('run.failedFallback')}
                </p>
              ) : null}
            </ProcessCard>
          ) : null}

          {view === 'completed' ? (
            <>
              {processExpanded ? <ProcessCard items={props.timeline} /> : null}
              <ArtifactCard artifacts={props.artifacts} />
            </>
          ) : null}
        </div>

        {footer ? (
          <footer data-testid="trial-run-footer" className="flex h-[60px] shrink-0 items-center border-t border-border px-3">
            <Button
              type="button"
              className="h-9 w-full rounded-[10px] bg-foreground text-background hover:bg-foreground/90"
              disabled={props.isCancelling}
              onClick={footer.action}
            >
              {footer.label}
            </Button>
          </footer>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
