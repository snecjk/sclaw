import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlowCardAction, FlowCardContentBlock } from '../../../shared/flow-card-protocol';
import { dispatchFlowCardAction } from '@/lib/flow-card-actions';
import { filterQuoteFlowCardActions } from '@/lib/flow-card-quote-actions';
import {
  parseFlowCardProgressSteps,
  useFlowCardProgressAnimation,
  type FlowCardProgressStep,
  type FlowCardProgressStepStatus,
} from '@/lib/flow-card-progress';

/** Render light markdown: **bold** only (matches design copy). */
function renderInlineEmphasis(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      return (
        <strong key={index} className="font-semibold text-[#111827] dark:text-[var(--sto-text-primary)]">
          {bold[1]}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

interface FlowCardProps {
  card: FlowCardContentBlock;
}

function readErrorCount(card: FlowCardContentBlock): number | null {
  const value = card.data?.errorCount;
  return typeof value === 'number' && value > 0 ? value : null;
}

function readHttpDataUrl(card: FlowCardContentBlock, keys: string[]): string | null {
  for (const key of keys) {
    const value = card.data?.[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
      return value.trim();
    }
  }
  return null;
}

/** Ensure validation-failure cards expose a download button when ossUrl is present. */
function resolveCardActions(card: FlowCardContentBlock): FlowCardAction[] {
  const actions = filterQuoteFlowCardActions(card, [...(card.actions ?? [])]);
  const downloadUrl = readHttpDataUrl(card, ['downloadUrl', 'ossUrl', 'errorFileUrl']);
  if (!downloadUrl) return actions;

  const alreadyHasDownload = actions.some(
    (action) => action.kind === 'nav.openExternal' || action.id === 'download_errors',
  );
  if (alreadyHasDownload) return actions;

  actions.unshift({
    id: 'download_errors',
    label: '下载校验失败文件',
    variant: 'secondary',
    kind: 'nav.openExternal',
    params: { url: downloadUrl },
  });
  return filterQuoteFlowCardActions(card, actions);
}

function StepStatusIcon({ status }: { status: FlowCardProgressStepStatus }) {
  if (status === 'done') {
    return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />;
  }
  if (status === 'error') {
    return <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />;
  }
  if (status === 'active') {
    return (
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#F58220] shadow-[0_0_0_3px_rgba(245,130,32,0.2)]"
        aria-hidden
      />
    );
  }
  return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#D1D5DB] dark:bg-[var(--sto-text-tertiary)]" aria-hidden />;
}

/**
 * Design-like multi-step progress.
 * Hold on step 1 until validationOutcome arrives, then advance to the end.
 */
function FlowCardProgress({
  card,
  steps,
  outcome,
  statuses,
  allDone,
}: {
  card: FlowCardContentBlock;
  steps: FlowCardProgressStep[];
  outcome: ReturnType<typeof useFlowCardProgressAnimation>['outcome'];
  statuses: FlowCardProgressStepStatus[];
  allDone: boolean;
}) {
  if (steps.length === 0) return null;

  const rawTitle = card.title?.trim() || '正在解析报价表';
  const headerLabel = allDone
    ? (outcome === 'fail' ? '校验未通过' : '已完成')
    : `${rawTitle.replace(/…$/, '').replace(/\.\.\.$/, '')}…`;

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-[#374151] dark:text-[var(--sto-text-primary)]">
        {allDone ? (
          outcome === 'fail' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          )
        ) : (
          <span className="inline-flex items-center gap-1 text-[#F58220]" aria-hidden>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F58220]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F58220] [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F58220] [animation-delay:240ms]" />
          </span>
        )}
        <span>{headerLabel}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {steps.map((step: FlowCardProgressStep, index: number) => {
          const status = statuses[index] ?? 'pending';
          return (
            <li key={step.id} className="flex items-start gap-2.5">
              <StepStatusIcon status={status} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'm-0 text-[13px] leading-[1.4]',
                    status === 'active' && 'font-semibold text-[#F58220]',
                    status === 'done' && 'font-medium text-[#111827] dark:text-[var(--sto-text-primary)]',
                    status === 'error' && 'font-semibold text-red-600 dark:text-[var(--sto-toast-error-icon)]',
                    status === 'pending' && 'font-medium text-[#9CA3AF] dark:text-[var(--sto-text-tertiary)]',
                  )}
                >
                  {step.title}
                </p>
                {step.detail ? (
                  <p
                    className={cn(
                      'm-0 mt-0.5 text-[12px] leading-[1.4]',
                      status === 'pending' ? 'text-[#D1D5DB]' : 'text-[#9CA3AF]',
                      'dark:text-[var(--sto-text-tertiary)]',
                      status === 'active' && 'text-[#F58220]/90]',
                    )}
                  >
                    {step.detail}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Visual language aligned with stoclaw-design `quote-ops-ai__bubble--bot`
 * + inline upload actions (quotation-ops-console.css).
 */
export function FlowCard({ card }: FlowCardProps) {
  const errorCount = readErrorCount(card);
  const actions = resolveCardActions(card);
  const progressSteps = parseFlowCardProgressSteps(card.data);
  const showProgress = progressSteps.length > 0;
  const {
    steps: progressStepList,
    outcome,
    statuses,
    allDone,
    progressSettled,
  } = useFlowCardProgressAnimation(card);

  return (
    <div
      className={cn(
        'w-full max-w-full box-border rounded-xl border px-3.5 py-3 text-[13px] leading-[1.55] text-[#374151] dark:text-[var(--sto-text-primary)]',
        card.phase === 'errors'
          ? 'border-red-200 bg-red-50/50 dark:border-[var(--sto-toast-error-border)] dark:bg-destructive/5'
          : card.phase === 'submitted'
            ? 'border-border bg-muted/20 dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-primary)]'
            : 'border-[#EEF0F3] bg-[#F8FAFC] dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-secondary)]',
      )}
      data-flow-card-id={card.cardId}
      data-flow-card-phase={card.phase}
    >
      {showProgress ? (
        <FlowCardProgress
          card={card}
          steps={progressStepList}
          outcome={outcome}
          statuses={statuses}
          allDone={allDone}
        />
      ) : null}

      {!showProgress ? (
        <div className="flex items-start gap-2">
          {card.phase === 'validating' ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
          {card.phase === 'errors' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
          ) : null}
          {card.phase === 'submitted' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          ) : null}
          <div className="min-w-0 flex-1">
            {card.title ? (
              <p className="m-0 mb-2 text-[13px] leading-[1.55] text-[#374151] last:mb-0 dark:text-[var(--sto-text-primary)]">
                {renderInlineEmphasis(card.title)}
              </p>
            ) : null}
            {card.body ? (
              <p className="m-0 mb-2 text-[13px] leading-[1.55] text-[#374151] last:mb-0 dark:text-[var(--sto-text-primary)]">
                {renderInlineEmphasis(card.body)}
              </p>
            ) : null}
            {card.hint ? (
              <p className="m-0 text-[12px] leading-[1.45] text-[#9CA3AF] dark:text-[var(--sto-text-tertiary)]">
                {renderInlineEmphasis(card.hint)}
              </p>
            ) : null}
            {errorCount !== null ? (
              <p className="mt-2 mb-0 text-[12px] font-medium text-red-600 dark:text-[var(--sto-toast-error-icon)]">
                {errorCount}
                {' '}
                处待修正
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {showProgress && progressSettled && (card.body || errorCount !== null) && card.phase !== 'validating' ? (
        <div className="mt-3 border-t border-[#EEF0F3] pt-2.5 dark:border-[var(--sto-border-default)]">
          {card.body ? (
            <p className="m-0 mb-2 text-[13px] leading-[1.55] text-[#374151] last:mb-0 dark:text-[var(--sto-text-primary)]">
              {renderInlineEmphasis(card.body)}
            </p>
          ) : null}
          {errorCount !== null ? (
            <p className="m-0 text-[12px] font-medium text-red-600 dark:text-[var(--sto-toast-error-icon)]">
              {errorCount}
              {' '}
              处待修正
            </p>
          ) : null}
        </div>
      ) : null}

      {actions.length > 0 && (!showProgress || progressSettled) ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {actions.map((action) => {
            const isSecondary = action.variant === 'secondary';
            return (
              <button
                key={action.id}
                type="button"
                disabled={action.disabled}
                className={cn(
                  'inline-flex min-h-7 items-center justify-center rounded-md px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  isSecondary
                    ? 'border border-[#E5E7EB] bg-white text-[#374151] hover:border-[#D1D5DB] hover:bg-[#F9FAFB] dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)] dark:text-[var(--sto-text-primary)] dark:hover:border-[var(--sto-border-heavy)] dark:hover:bg-[var(--sto-control-hover-bg)]'
                    : 'border border-[#F58220] bg-[#F58220] text-white shadow-[0_2px_8px_rgba(245,130,32,0.2)] hover:bg-[#E57418] dark:border-[var(--sto-dialog-action-background)] dark:bg-[var(--sto-dialog-action-background)] dark:text-[var(--sto-dialog-action-foreground)] dark:shadow-none dark:hover:bg-[var(--sto-dialog-action-hover-background)]',
                )}
                onClick={() => dispatchFlowCardAction(action, card)}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
