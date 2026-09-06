import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { InputComposerToolbarIconTooltip } from '@/components/input-composer/input-composer-toolbar-icon-tooltip';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useCurrentChatRuntimeView } from '@/stores/chat/runtime-selectors';
import { useCurrentChatDisplayMessageCount } from '@/stores/chat/display-selectors';
import type { AgentEngineType } from '../../../../shared/agent-engine';
import type { CanonicalChatEvent, ChatContextUsage } from '../../../../shared/chat-runtime-protocol';
import { isSessionTooSmallToCompact } from './context-compaction-error';
import {
  MANUAL_CONTEXT_COMPACTION_MIN_PERCENT,
  meetsManualContextCompactionThreshold,
  selectLatestContextUsage,
} from './context-usage-selection';

type ContextUsageResponse = {
  success: boolean;
  supported: boolean;
  canCompact?: boolean;
  usage: ChatContextUsage | null;
};

// PI owns the actual compaction deadline (currently 120s). Keep the renderer
// request alive slightly longer so a still-running compaction is not reported
// as a failed 15s Host API request while the worker continues in the background.
const MANUAL_COMPACTION_REQUEST_TIMEOUT_MS = 130_000;

function ContextUsageRing({ percent }: { percent: number }) {
  const normalized = Math.max(0, Math.min(100, percent));
  const circumference = 2 * Math.PI * 8;
  return (
    <svg className="h-[22px] w-[22px] -rotate-90" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - normalized / 100)}
      />
    </svg>
  );
}

function ContextUsageControlInner({
  sessionKey,
  engineType,
}: {
  sessionKey: string;
  engineType: Extract<AgentEngineType, 'pi'>;
}) {
  const { t } = useTranslation('chat');
  const runtime = useCurrentChatRuntimeView();
  const [fetchedUsage, setFetchedUsage] = useState<ChatContextUsage | null>(null);
  const [canCompact, setCanCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const failureHandledRef = useRef(false);
  const latestUsage = selectLatestContextUsage(runtime.contextUsage, fetchedUsage);
  const usage = latestUsage;
  const compactionActive = runtime.activity?.type === 'context_compaction';
  const busy = runtime.sending || compactionActive || requesting;

  useEffect(() => {
    let cancelled = false;
    void hostApiFetch<ContextUsageResponse>(
      `/api/chat/context-usage?sessionKey=${encodeURIComponent(sessionKey)}&engineType=${engineType}`,
    ).then((response) => {
      if (cancelled) return;
      setFetchedUsage(response.usage);
      setCanCompact(response.supported && response.canCompact === true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [engineType, sessionKey]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => subscribeHostEvent<CanonicalChatEvent>('chat-runtime:event', (event) => {
    if (event.sessionKey !== sessionKey) return;
    const payload = event.payload && typeof event.payload === 'object'
      ? event.payload as Record<string, unknown>
      : null;
    if (payload?.reason !== 'manual') return;
    if (event.type === 'context.compaction.failed') {
      if (failureHandledRef.current) return;
      failureHandledRef.current = true;
      const errorMessage = typeof payload.errorMessage === 'string'
        ? payload.errorMessage
        : t('composer.contextCompactUnknownError');
      if (isSessionTooSmallToCompact(errorMessage)) {
        toast.info(t('composer.contextCompactNotNeeded'));
        return;
      }
      toast.error(t('composer.contextCompactFailed', {
        message: errorMessage,
      }));
      return;
    }
    if (event.type !== 'context.compaction.completed') return;
    toast.success(t('composer.contextCompactSuccessPending'));
  }), [sessionKey, t]);

  const percent = usage?.percent;
  const roundedPercent = percent == null ? null : Math.round(percent);
  const meetsCompactionThreshold = meetsManualContextCompactionThreshold(percent);
  const belowCompactionThreshold = roundedPercent != null && !meetsCompactionThreshold;
  const compactDisabled = busy || !canCompact || !meetsCompactionThreshold;
  const tone = roundedPercent != null && roundedPercent >= 90
    ? 'text-destructive'
    : roundedPercent != null && roundedPercent >= 75
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-muted-foreground';
  const tooltip = useMemo(() => {
    if (runtime.sending) return t('composer.contextCompactAfterReply');
    if (percent == null) return t('composer.contextUsagePending');
    return t('composer.contextUsageTooltip', {
      percent: Math.round(percent),
    });
  }, [percent, runtime.sending, t]);

  const handleCompact = async () => {
    if (compactDisabled) return;
    failureHandledRef.current = false;
    setRequesting(true);
    setOpen(false);
    try {
      await hostApiFetch('/api/chat/compact', {
        method: 'POST',
        body: JSON.stringify({ sessionKey, engineType }),
        timeoutMs: MANUAL_COMPACTION_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (!failureHandledRef.current) {
        failureHandledRef.current = true;
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (isSessionTooSmallToCompact(errorMessage)) {
          toast.info(t('composer.contextCompactNotNeeded'));
          return;
        }
        toast.error(t('composer.contextCompactFailed', {
          message: errorMessage,
        }));
      }
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <InputComposerToolbarIconTooltip label={tooltip}>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'h-[30px] w-[30px] rounded-xl p-1',
              tone,
              open && 'bg-[var(--sto-control-subtle-hover-background)] text-foreground',
            )}
            disabled={busy || !canCompact}
            aria-label={tooltip}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {compactionActive || requesting ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
            ) : (
              <ContextUsageRing percent={roundedPercent ?? 0} />
            )}
          </Button>
        </span>
      </InputComposerToolbarIconTooltip>

      {open ? (
        <div
          role="dialog"
          aria-label={t('composer.contextCompactTitle')}
          className={cn(
            'sto-overlay sto-overlay--glass-border absolute bottom-full right-0 z-[60000] mb-2 w-[340px] max-w-[calc(100vw-32px)] rounded-2xl border p-4',
            'bg-[var(--sto-panel-bg)] shadow-[var(--sto-shadow-selector-raised)]',
          )}
        >
          <h3 className="text-[14px] font-medium text-foreground">{t('composer.contextCompactTitle')}</h3>
          <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
            {t('composer.contextCompactDescription')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={roundedPercent ?? undefined}
            >
              <div
                className={cn('h-full rounded-full', (roundedPercent ?? 0) >= 90 ? 'bg-destructive' : (roundedPercent ?? 0) >= 75 ? 'bg-amber-500' : 'bg-muted-foreground')}
                style={{ width: `${roundedPercent ?? 0}%` }}
              />
            </div>
            <span className="w-9 text-right text-[12px] tabular-nums text-foreground">{roundedPercent ?? '—'}%</span>
          </div>
          <p className="mt-2 text-[11px] leading-[18px] text-muted-foreground">
            {t('composer.contextCompactNotice')}
          </p>
          {belowCompactionThreshold ? (
            <p className="mt-2 text-[11px] leading-[18px] text-amber-600 dark:text-amber-400">
              {t('composer.contextCompactThresholdHint', {
                percent: MANUAL_CONTEXT_COMPACTION_MIN_PERCENT,
              })}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              className="h-8 rounded-md px-3 text-[12px]"
              disabled={compactDisabled}
              onClick={() => { void handleCompact(); }}
            >
              {t('composer.contextCompactConfirm')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ContextUsageControl({ engineType }: { engineType?: AgentEngineType }) {
  const sessionKey = useChatStore((state) => state.currentSessionKey);
  const messageCount = useCurrentChatDisplayMessageCount();
  if (!sessionKey || messageCount === 0 || engineType !== 'pi') return null;
  return <ContextUsageControlInner key={`${engineType}:${sessionKey}`} sessionKey={sessionKey} engineType={engineType} />;
}
