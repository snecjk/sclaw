import { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { glassNestedCard, glassSectionSurface, glassSegmentTrack, stoMainInnerShell } from '@/lib/surfaces';
import { useGatewayStore } from '@/stores/gateway';
import { useAuthStore, resolveAiResourceIsSite } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { formatMillionToken } from '@/lib/token-display';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { FeedbackState } from '@/components/common/FeedbackState';
import { MillionTokenText } from '@/components/common/MillionTokenText';
import {
  filterUsageHistoryByWindow,
  groupUsageHistory,
  type UsageGroupBy,
  type UsageHistoryEntry,
  type UsageWindow,
} from './usage-history';

const DEFAULT_USAGE_FETCH_MAX_ATTEMPTS = 2;
const WINDOWS_USAGE_FETCH_MAX_ATTEMPTS = 3;
const USAGE_FETCH_RETRY_DELAY_MS = 1500;

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings']);
  const user = useAuthStore((s) => s.user);
  const impersonationOrigin = useAuthStore((s) => s.impersonationOrigin);
  const isSiteForAi = resolveAiResourceIsSite(user?.categoryCode, impersonationOrigin);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const usageFetchMaxAttempts = window.electron.platform === 'win32'
    ? WINDOWS_USAGE_FETCH_MAX_ATTEMPTS
    : DEFAULT_USAGE_FETCH_MAX_ATTEMPTS;

  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);
  const [selectedUsageEntry, setSelectedUsageEntry] = useState<UsageHistoryEntry | null>(null);

  type TokenBalanceState = {
    status: 'idle' | 'loading' | 'done' | 'error';
    spend: number;
    maxBudget: number;
  };
  const [tokenBalance, setTokenBalance] = useState<TokenBalanceState>({
    status: 'idle',
    spend: 0,
    maxBudget: 0,
  });
  const [balanceApplyLoading, setBalanceApplyLoading] = useState(false);

  type FetchState = {
    status: 'idle' | 'loading' | 'done';
    data: UsageHistoryEntry[];
  };
  type FetchAction =
    | { type: 'start' }
    | { type: 'done'; data: UsageHistoryEntry[] }
    | { type: 'reset' };

  const [fetchState, dispatchFetch] = useReducer(
    (state: FetchState, action: FetchAction): FetchState => {
      switch (action.type) {
        case 'start':
          return { status: 'loading', data: state.data };
        case 'done':
          return { status: 'done', data: action.data };
        case 'reset':
          return { status: 'idle', data: [] };
        default:
          return state;
      }
    },
    { status: 'idle' as const, data: [] as UsageHistoryEntry[] },
  );

  const usageFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageFetchGenerationRef = useRef(0);

  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchTokenBalance() {
      setTokenBalance((prev) => ({ ...prev, status: 'loading' }));
      try {
        const res = await hostApiFetch<{ tokenId: string; spend: number; maxBudget: number }>('/api/token-balance');
        if (cancelled) return;
        setTokenBalance({
          status: 'done',
          spend: res.spend ?? 0,
          maxBudget: res.maxBudget ?? 0,
        });
      } catch {
        if (cancelled) return;
        setTokenBalance((prev) => ({ ...prev, status: 'error' }));
      }
    }
    void fetchTokenBalance();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (usageFetchTimerRef.current) {
      clearTimeout(usageFetchTimerRef.current);
      usageFetchTimerRef.current = null;
    }

    // If Gateway is not running, skip fetching but keep existing data.
    // A disconnect banner will be shown in the UI instead of clearing the list.
    if (!isGatewayRunning) {
      return;
    }

    dispatchFetch({ type: 'start' });
    const generation = usageFetchGenerationRef.current + 1;
    usageFetchGenerationRef.current = generation;
    const restartMarker = `${gatewayStatus.pid ?? 'na'}:${gatewayStatus.connectedAt ?? 'na'}`;
    trackUiEvent('models.token_usage_fetch_started', {
      generation,
      restartMarker,
    });

    // Safety timeout: if the fetch cycle hasn't resolved after 30 s,
    // force-resolve to "done" with empty data to avoid an infinite spinner.
    const safetyTimeout = setTimeout(() => {
      if (usageFetchGenerationRef.current !== generation) return;
      trackUiEvent('models.token_usage_fetch_safety_timeout', {
        generation,
        restartMarker,
      });
      dispatchFetch({ type: 'done', data: [] });
    }, 30_000);

    const fetchUsageHistoryWithRetry = async (attempt: number) => {
      trackUiEvent('models.token_usage_fetch_attempt', {
        generation,
        attempt,
        restartMarker,
      });
      try {
        const entries = await hostApiFetch<UsageHistoryEntry[]>('/api/usage/recent-token-history');
        if (usageFetchGenerationRef.current !== generation) return;

        const normalized = Array.isArray(entries) ? entries : [];
        setUsagePage(1);
        trackUiEvent('models.token_usage_fetch_succeeded', {
          generation,
          attempt,
          records: normalized.length,
          restartMarker,
        });

        if (normalized.length === 0 && attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', {
            generation,
            attempt,
            reason: 'empty',
            restartMarker,
          });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, USAGE_FETCH_RETRY_DELAY_MS);
        } else {
          if (normalized.length === 0) {
            trackUiEvent('models.token_usage_fetch_exhausted', {
              generation,
              attempt,
              reason: 'empty',
              restartMarker,
            });
          }
          dispatchFetch({ type: 'done', data: normalized });
        }
      } catch (error) {
        if (usageFetchGenerationRef.current !== generation) return;
        trackUiEvent('models.token_usage_fetch_failed_attempt', {
          generation,
          attempt,
          restartMarker,
          message: error instanceof Error ? error.message : String(error),
        });
        if (attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', {
            generation,
            attempt,
            reason: 'error',
            restartMarker,
          });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, USAGE_FETCH_RETRY_DELAY_MS);
          return;
        }
        dispatchFetch({ type: 'done', data: [] });
        trackUiEvent('models.token_usage_fetch_exhausted', {
          generation,
          attempt,
          reason: 'error',
          restartMarker,
        });
      }
    };

    void fetchUsageHistoryWithRetry(1);

    return () => {
      clearTimeout(safetyTimeout);
      if (usageFetchTimerRef.current) {
        clearTimeout(usageFetchTimerRef.current);
        usageFetchTimerRef.current = null;
      }
    };
  }, [isGatewayRunning, gatewayStatus.connectedAt, gatewayStatus.pid, usageFetchMaxAttempts]);

  const usageHistory = fetchState.data;
  // Keep data visible even when Gateway disconnects; show a banner instead of hiding the list.
  const visibleUsageHistory = usageHistory;
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const usageGroups = groupUsageHistory(filteredUsageHistory, usageGroupBy);
  const usagePageSize = 5;
  const usageTotalPages = Math.max(1, Math.ceil(filteredUsageHistory.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = filteredUsageHistory.slice((safeUsagePage - 1) * usagePageSize, safeUsagePage * usagePageSize);
  const usageLoading = isGatewayRunning && fetchState.status === 'loading';

  const segmentWrap = glassSegmentTrack;
  const segmentBtn = (active: boolean) =>
    cn(
      'rounded-[6px] px-3 text-[13px] font-medium',
      active
        ? 'bg-primary/[0.12] text-foreground shadow-[0_1px_0_hsl(var(--glass-highlight)/0.2)]'
        : 'text-muted-foreground hover:bg-primary/[0.06] hover:text-foreground',
    );

  const handleBalanceApplyClick = async () => {
    if (balanceApplyLoading) return;
    trackUiEvent('models.token_balance_apply_clicked');
    setBalanceApplyLoading(true);
    try {
      const result = await hostApiFetch<{ url?: string; source?: string }>(
        '/api/auth/hq-balance-apply-url',
      );
      const url = result.url?.trim();
      if (!url) {
        throw new Error('未获取到申请链接');
      }
      trackUiEvent('models.token_balance_apply_opened', { source: result.source ?? 'unknown' });
      await window.electron.openExternal(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackUiEvent('models.token_balance_apply_failed', { error: message });
      toast.error(t('dashboard:tokenBalance.applyFailed', '获取申请链接失败，请稍后重试'));
    } finally {
      setBalanceApplyLoading(false);
    }
  };

  return (
    <div className={cn(stoMainInnerShell, 'flex flex-col gap-8 pb-10')}>
      <header className="shrink-0 border-b border-border pb-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-primary/[0.08] text-primary shadow-[0_8px_24px_rgba(255,111,0,0.10)]">
            <Cpu className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.65rem]">
              {t('dashboard:models.title')}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {t('dashboard:models.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-10">
        <section className={glassSectionSurface}>
          <ProvidersSettings />
        </section>

        <section className={glassSectionSurface}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {t('dashboard:tokenBalance.title', 'Token 余额')}
            </h2>
            {!isSiteForAi ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-md border-border bg-transparent px-3 text-[13px] hover:bg-primary/[0.06]"
                onClick={() => {
                  void handleBalanceApplyClick();
                }}
                disabled={balanceApplyLoading}
              >
                {balanceApplyLoading
                  ? t('dashboard:tokenBalance.applying', '加载中...')
                  : t('dashboard:tokenBalance.apply', '余额申请')}
              </Button>
            ) : null}
          </div>
          {tokenBalance.status === 'loading' ? (
            <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-white/50 py-12 text-muted-foreground backdrop-blur-sm dark:bg-[hsl(var(--glass-bg)/0.35)]">
              <FeedbackState state="loading" title={t('dashboard:tokenBalance.loading', '正在加载 Token 余额...')} />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md border border-border bg-white/60 p-4 backdrop-blur-sm dark:bg-[hsl(var(--glass-bg)/0.25)]">
                  <p className="text-[13px] text-muted-foreground">{t('dashboard:tokenBalance.available', '可用额度')}</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {tokenBalance.maxBudget > 0
                      ? Math.max(0, tokenBalance.maxBudget - tokenBalance.spend).toFixed(2)
                      : '--'}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">元</span>
                  </p>
                </div>
                <div className="rounded-md border border-border bg-white/60 p-4 backdrop-blur-sm dark:bg-[hsl(var(--glass-bg)/0.25)]">
                  <p className="text-[13px] text-muted-foreground">{t('dashboard:tokenBalance.total', '总额度')}</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {tokenBalance.maxBudget > 0 ? tokenBalance.maxBudget.toFixed(2) : '--'}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">元</span>
                  </p>
                </div>
              </div>
              {tokenBalance.maxBudget > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">{t('dashboard:tokenBalance.usage', '额度使用')}</span>
                    <span className="text-muted-foreground">
                      {(() => {
                        const pct = tokenBalance.maxBudget > 0
                          ? Math.round((tokenBalance.spend / tokenBalance.maxBudget) * 100)
                          : 0;
                        const remaining = Math.max(0, 100 - pct);
                        return t('dashboard:tokenBalance.usagePercent', '已用 {{pct}}% · 剩余 {{remaining}}%', { pct, remaining });
                      })()}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-primary/[0.08]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500"
                      style={{
                        width: `${Math.min(100, tokenBalance.maxBudget > 0 ? (tokenBalance.spend / tokenBalance.maxBudget) * 100 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <p className="text-[12px] text-muted-foreground">
                {t('dashboard:tokenBalance.hint', '当前可用余额，消耗后自动扣减')}
              </p>
            </div>
          )}
        </section>

        <section className={glassSectionSurface}>
          <h2 className="mb-5 text-lg font-semibold tracking-tight text-foreground">
            {t('dashboard:recentTokenHistory.title', 'Token Usage History')}
          </h2>
          <p className="mb-4 text-[12px] text-muted-foreground">Token 展示单位按值自适应：Token / 千Token / 百万Token（保留 2 位小数）</p>
          <div>
            {usageLoading ? (
              <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-white/50 py-12 text-muted-foreground backdrop-blur-sm dark:bg-[hsl(var(--glass-bg)/0.35)]">
                <FeedbackState state="loading" title={t('dashboard:recentTokenHistory.loading')} />
              </div>
            ) : visibleUsageHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-white/50 py-12 text-muted-foreground backdrop-blur-sm dark:bg-[hsl(var(--glass-bg)/0.35)]">
                <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.empty')} />
                {!isGatewayRunning && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>Gateway 已断开，无法获取最新数据</span>
                  </div>
                )}
              </div>
            ) : filteredUsageHistory.length === 0 ? (
              <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-white/50 py-12 text-muted-foreground backdrop-blur-sm dark:bg-[hsl(var(--glass-bg)/0.35)]">
                <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.emptyForWindow')} />
              </div>
            ) : (
              <div className="space-y-6">
                {!isGatewayRunning && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>Gateway 已断开，以下数据为历史缓存，可能不是最新状态</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className={segmentWrap}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUsageGroupBy('model');
                          setUsagePage(1);
                        }}
                        className={segmentBtn(usageGroupBy === 'model')}
                      >
                        {t('dashboard:recentTokenHistory.groupByModel')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUsageGroupBy('day');
                          setUsagePage(1);
                        }}
                        className={segmentBtn(usageGroupBy === 'day')}
                      >
                        {t('dashboard:recentTokenHistory.groupByTime')}
                      </Button>
                    </div>
                    <div className={segmentWrap}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUsageWindow('7d');
                          setUsagePage(1);
                        }}
                        className={segmentBtn(usageWindow === '7d')}
                      >
                        {t('dashboard:recentTokenHistory.last7Days')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUsageWindow('30d');
                          setUsagePage(1);
                        }}
                        className={segmentBtn(usageWindow === '30d')}
                      >
                        {t('dashboard:recentTokenHistory.last30Days')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setUsageWindow('all');
                          setUsagePage(1);
                        }}
                        className={segmentBtn(usageWindow === 'all')}
                      >
                        {t('dashboard:recentTokenHistory.allTime')}
                      </Button>
                    </div>
                  </div>
                  <p className="text-[13px] font-medium text-muted-foreground">
                    {t('dashboard:recentTokenHistory.showingLast', { count: filteredUsageHistory.length })}
                  </p>
                </div>

                <UsageBarChart
                  groups={usageGroups}
                  emptyLabel={t('dashboard:recentTokenHistory.empty')}
                  totalLabel={t('dashboard:recentTokenHistory.totalTokens')}
                  inputLabel={t('dashboard:recentTokenHistory.inputShort')}
                  outputLabel={t('dashboard:recentTokenHistory.outputShort')}
                  cacheLabel={t('dashboard:recentTokenHistory.cacheShort')}
                />

                <div className="space-y-3 pt-2">
                  {pagedUsageHistory.map((entry) => (
                    <div
                      key={`${entry.sessionId}-${entry.timestamp}`}
                      className={cn(
                        'rounded-md border border-border p-4 transition-colors hover:border-border hover:shadow-md',
                        glassNestedCard,
                        'hover:bg-white/80 dark:hover:bg-[hsl(var(--glass-bg)/0.2)]',
                      )}
                    >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-[15px] text-foreground truncate">
                              {entry.model || t('dashboard:recentTokenHistory.unknownModel')}
                            </p>
                            <p className="text-[13px] text-muted-foreground truncate mt-0.5">
                              {[entry.provider, entry.agentId, entry.sessionId].filter(Boolean).join(' • ')}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-[15px]"><MillionTokenText value={entry.totalTokens} /></p>
                            <p className="text-[12px] text-muted-foreground mt-0.5">
                              {formatUsageTimestamp(entry.timestamp)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] font-medium text-muted-foreground">
                          <span className="flex items-center gap-1.5"><div className="h-2 w-2 shrink-0 rounded-full bg-link" />{t('dashboard:recentTokenHistory.input', { value: formatTokenCount(entry.inputTokens) })}</span>
                          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-violet-500"></div>{t('dashboard:recentTokenHistory.output', { value: formatTokenCount(entry.outputTokens) })}</span>
                          {entry.cacheReadTokens > 0 && (
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500"></div>{t('dashboard:recentTokenHistory.cacheRead', { value: formatTokenCount(entry.cacheReadTokens) })}</span>
                          )}
                          {entry.cacheWriteTokens > 0 && (
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500"></div>{t('dashboard:recentTokenHistory.cacheWrite', { value: formatTokenCount(entry.cacheWriteTokens) })}</span>
                          )}
                          {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) && (
                            <span className="ml-auto flex items-center gap-1.5 rounded-md bg-primary/[0.08] px-2 py-0.5 text-foreground/80">
                              {t('dashboard:recentTokenHistory.cost', { amount: entry.costUsd.toFixed(4) })}
                            </span>
                          )}
                          {devModeUnlocked && entry.content && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 rounded-md px-2.5 text-[11.5px] border-border"
                              onClick={() => setSelectedUsageEntry(entry)}
                            >
                              {t('dashboard:recentTokenHistory.viewContent')}
                            </Button>
                          )}
                        </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-[13px] font-medium text-muted-foreground">
                    {t('dashboard:recentTokenHistory.page', { current: safeUsagePage, total: usageTotalPages })}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUsagePage((page) => Math.max(1, page - 1))}
                      disabled={safeUsagePage <= 1}
                      className="h-9 rounded-md border-border px-4 bg-transparent hover:bg-primary/[0.06]"
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      {t('dashboard:recentTokenHistory.prev')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUsagePage((page) => Math.min(usageTotalPages, page + 1))}
                      disabled={safeUsagePage >= usageTotalPages}
                      className="h-9 rounded-md border-border px-4 bg-transparent hover:bg-primary/[0.06]"
                    >
                      {t('dashboard:recentTokenHistory.next')}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      {devModeUnlocked && selectedUsageEntry && (
        <UsageContentPopup
          entry={selectedUsageEntry}
          onClose={() => setSelectedUsageEntry(null)}
          title={t('dashboard:recentTokenHistory.contentDialogTitle')}
          closeLabel={t('dashboard:recentTokenHistory.close')}
          unknownModelLabel={t('dashboard:recentTokenHistory.unknownModel')}
        />
      )}
    </div>
  );
}

function formatTokenCount(value: number): string {
  return formatMillionToken(value);
}

function formatUsageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function UsageBarChart({
  groups,
  emptyLabel,
  totalLabel,
  inputLabel,
  outputLabel,
  cacheLabel,
}: {
  groups: Array<{
    label: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }>;
  emptyLabel: string;
  totalLabel: string;
  inputLabel: string;
  outputLabel: string;
  cacheLabel: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-white/50 p-8 text-center text-[14px] font-medium text-muted-foreground backdrop-blur-sm dark:bg-[hsl(var(--glass-bg)/0.25)]">
        {emptyLabel}
      </div>
    );
  }

  const maxTokens = Math.max(...groups.map((group) => group.totalTokens), 1);

  return (
    <div className={cn('space-y-4 rounded-md border border-border p-5', glassNestedCard)}>
      <div className="flex flex-wrap gap-4 text-[13px] font-medium text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-link" />
          {inputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
          {outputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          {cacheLabel}
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className="truncate font-semibold text-foreground">{group.label}</span>
                            <span className="text-muted-foreground font-medium">
              {totalLabel}: <MillionTokenText value={group.totalTokens} />
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-md bg-primary/[0.08]">
            <div
              className="flex h-full overflow-hidden rounded-md"
              style={{
                width: group.totalTokens > 0
                  ? `${Math.max((group.totalTokens / maxTokens) * 100, 6)}%`
                  : '0%',
              }}
            >
              {group.inputTokens > 0 && (
                <div
                  className="h-full bg-link"
                  style={{ width: `${(group.inputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.outputTokens > 0 && (
                <div
                  className="h-full bg-violet-500"
                  style={{ width: `${(group.outputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.cacheTokens > 0 && (
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${(group.cacheTokens / group.totalTokens) * 100}%` }}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default Models;

function UsageContentPopup({
  entry,
  onClose,
  title,
  closeLabel,
  unknownModelLabel,
}: {
  entry: UsageHistoryEntry;
  onClose: () => void;
  title: string;
  closeLabel: string;
  unknownModelLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm dark:bg-black/60" role="dialog" aria-modal="true">
      <div className="glass-panel w-full max-w-3xl rounded-lg border border-glass-border shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-glass-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {(entry.model || unknownModelLabel)} • {formatUsageTimestamp(entry.timestamp)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-mono">
            {entry.content}
          </pre>
        </div>
        <div className="flex justify-end border-t border-glass-border px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
