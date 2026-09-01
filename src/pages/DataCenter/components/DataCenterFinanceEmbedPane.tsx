import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SclawBrowserFrame } from '@/components/sclaw-browser/SclawBrowserFrame';
import { invokeIpc } from '@/lib/api-client';
import { fetchAppPlazaSkipLoginLink } from '@/lib/app-plaza-api';
import { createSclawBrowserEmbedRuntimeId } from '@/lib/sclaw-browser-chat-session';
import {
  registerSclawBrowserRuntime,
  unregisterSclawBrowserRuntime,
  executeSclawBrowserScript,
  getSclawBrowserNetworkLog,
  getSclawEmbedSessionCookies,
} from '@/lib/sclaw-browser-host-api';
import {
  filterFinanceBiLoginNetworkEvents,
  FINANCE_BI_CODE_EXCHANGE_DUMP_SCRIPT,
  FINANCE_BI_CODE_EXCHANGE_HOOK_SCRIPT,
  FINANCE_BI_WEB_STORAGE_PROBE_SCRIPT,
  logStoFinanceBiCodeExchangeDump,
  logStoFinanceBiCodeLoginInfo,
  logStoFinanceBiEmbedTrace,
  logStoFinanceBiSsoDiagnostics,
  logStoFinanceBiWebviewFinalUrl,
  logStoFinanceBiWebviewLifecycle,
  resolveStoFinanceBiEmbedPlan,
  STO_FINANCE_BI_SYSTEM_CODE,
  type StoFinanceBiCodeExchangeEntry,
  type StoFinanceBiWebviewSnapshot,
} from '@/lib/sto-finance-bi-web-url';
import { isStoEmbedBrowserUrl } from '@/components/sclaw-browser/constants';
import type { SclawBrowserLifecycleEvent } from '@/components/sclaw-browser/SclawBrowserFrame';
import { useAuthStore } from '@/stores/auth';
import '@/components/sclaw-browser/sclaw-browser-overlay.css';
import { FeedbackState } from './entries';

interface DataCenterFinanceEmbedPaneProps {
  className?: string;
}

interface SessionPrepResult {
  url: string;
  ok: boolean;
  error?: string;
  skipped?: boolean;
}

async function prepareStoSessionIfNeeded(url: string): Promise<SessionPrepResult> {
  if (!window.electron) {
    return { url, ok: true, skipped: true, error: 'non-electron' };
  }
  if (!isStoEmbedBrowserUrl(url)) {
    return { url, ok: true, skipped: true, error: 'not-sto-embed-url' };
  }
  try {
    await invokeIpc('sclaw-browser:prepareSession', { url });
    return { url, ok: true };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readAuthSnapshot() {
  const { isAuthenticated, user, ssoEnvironment } = useAuthStore.getState();
  return {
    isAuthenticated,
    userCode: user?.code ?? null,
    ssoEnvironment: ssoEnvironment ?? null,
  };
}

export function DataCenterFinanceEmbedPane({ className }: DataCenterFinanceEmbedPaneProps) {
  const { t } = useTranslation('common');
  const embedRuntimeIdRef = useRef(createSclawBrowserEmbedRuntimeId());
  const webviewSnapshotRef = useRef<StoFinanceBiWebviewSnapshot>({
    requestedUrl: '',
    pageUrl: '',
    pageTitle: '',
    canGoBack: false,
    lastEvent: '',
    updatedAt: '',
  });
  const returnUrlRef = useRef('');
  const forcedPreviewRef = useRef(false);
  const frontForceNavigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionPrepRef = useRef<SessionPrepResult[]>([]);
  const skipLoginErrorRef = useRef<unknown>(null);
  const skipLoginUrlRef = useRef<string | null>(null);
  const planRef = useRef<ReturnType<typeof resolveStoFinanceBiEmbedPlan> | null>(null);
  const resolveStartedAtRef = useRef(0);
  const lastCodeLoginProbeUrlRef = useRef('');
  const networkProbeSinceRef = useRef(0);
  const lastFinalUrlLoggedRef = useRef('');
  const codeExchangeHookInstalledRef = useRef(false);
  const codeExchangeDumpTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const codeExchangeLoggedCountRef = useRef(0);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearCodeExchangeDumpTimers = () => {
    for (const timer of codeExchangeDumpTimersRef.current) {
      clearTimeout(timer);
    }
    codeExchangeDumpTimersRef.current = [];
  };

  const dumpCodeExchangeApiLog = async (phase: string, opts?: { onlyNew?: boolean }) => {
    const runtimeId = embedRuntimeIdRef.current;
    const onlyNew = opts?.onlyNew !== false;
    try {
      const raw = await executeSclawBrowserScript(runtimeId, FINANCE_BI_CODE_EXCHANGE_DUMP_SCRIPT);
      const payload = (raw && typeof raw === 'object')
        ? raw as {
          pageUrl?: string;
          installed?: boolean;
          entries?: StoFinanceBiCodeExchangeEntry[];
        }
        : null;
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      const sinceIndex = onlyNew ? codeExchangeLoggedCountRef.current : 0;
      logStoFinanceBiCodeExchangeDump({
        phase,
        pageUrl: payload?.pageUrl,
        installed: payload?.installed,
        entries,
        sinceIndex,
      });
      codeExchangeLoggedCountRef.current = entries.length;
    } catch (error) {
      console.warn('[finance-bi][sso][code-exchange] 读取换票日志失败', {
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const installCodeExchangeHook = async (phase: string) => {
    if (codeExchangeHookInstalledRef.current) return;
    const runtimeId = embedRuntimeIdRef.current;
    try {
      const raw = await executeSclawBrowserScript(runtimeId, FINANCE_BI_CODE_EXCHANGE_HOOK_SCRIPT);
      const result = (raw && typeof raw === 'object')
        ? raw as { ok?: boolean; already?: boolean; installed?: boolean; count?: number }
        : null;
      codeExchangeHookInstalledRef.current = true;
      console.info('[finance-bi][sso][code-exchange] 钩子注入', {
        phase,
        already: Boolean(result?.already),
        installed: Boolean(result?.installed || result?.ok),
        priorCount: result?.count ?? 0,
      });
    } catch (error) {
      codeExchangeHookInstalledRef.current = false;
      console.warn('[finance-bi][sso][code-exchange] 钩子注入失败', {
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /** 仅延迟采样一次新增请求，避免 1.5/4/8s 整表重复刷屏 */
  const scheduleCodeExchangeDumps = () => {
    if (codeExchangeDumpTimersRef.current.length > 0) return;
    const timer = setTimeout(() => {
      void dumpCodeExchangeApiLog('换票采样', { onlyNew: true });
    }, 2500);
    codeExchangeDumpTimersRef.current.push(timer);
  };

  const emitSsoDiagnostics = (phase: string, webview?: Parameters<typeof logStoFinanceBiSsoDiagnostics>[0]['webview']) => {
    logStoFinanceBiSsoDiagnostics({
      phase,
      skipLoginUrl: skipLoginUrlRef.current,
      skipLoginError: skipLoginErrorRef.current,
      plan: planRef.current,
      auth: readAuthSnapshot(),
      sessionPrep: sessionPrepRef.current,
      elapsedMs: resolveStartedAtRef.current ? Date.now() - resolveStartedAtRef.current : undefined,
      webview,
    });
  };

  const probeCodeLoginInfo = async (phase: string, pageUrl: string) => {
    if (!pageUrl || pageUrl === lastCodeLoginProbeUrlRef.current) return;
    lastCodeLoginProbeUrlRef.current = pageUrl;

    const runtimeId = embedRuntimeIdRef.current;
    const code = planRef.current?.skipLoginCode ?? null;
    const codePreview = code ? `${code.slice(0, 6)}…${code.slice(-4)}` : null;

    let webStorage: {
      pageUrl?: string;
      documentCookie?: string;
      localStorage?: Record<string, string>;
      sessionStorage?: Record<string, string>;
    } | null = null;
    try {
      const raw = await executeSclawBrowserScript(runtimeId, FINANCE_BI_WEB_STORAGE_PROBE_SCRIPT);
      if (raw && typeof raw === 'object') {
        const probe = raw as {
          pageUrl?: string;
          documentCookie?: string;
          localStorage?: Record<string, string>;
          sessionStorage?: Record<string, string>;
        };
        webStorage = {
          pageUrl: probe.pageUrl,
          documentCookie: probe.documentCookie,
          localStorage: probe.localStorage
            ? Object.fromEntries(Object.entries(probe.localStorage).map(([k, v]) => [
              k,
              v.length <= 16 ? `(${v.length} chars)` : `${v.slice(0, 8)}…${v.slice(-6)} (${v.length})`,
            ]))
            : undefined,
          sessionStorage: probe.sessionStorage
            ? Object.fromEntries(Object.entries(probe.sessionStorage).map(([k, v]) => [
              k,
              v.length <= 16 ? `(${v.length} chars)` : `${v.slice(0, 8)}…${v.slice(-6)} (${v.length})`,
            ]))
            : undefined,
        };
      }
    } catch (error) {
      webStorage = {
        pageUrl,
        localStorage: {
          __probeError: error instanceof Error ? error.message : String(error),
        },
      };
    }

    let embedSessionCookies: Awaited<ReturnType<typeof getSclawEmbedSessionCookies>> = [];
    try {
      embedSessionCookies = await getSclawEmbedSessionCookies(pageUrl);
    } catch {
      embedSessionCookies = [];
    }

    let loginNetworkEvents: ReturnType<typeof filterFinanceBiLoginNetworkEvents> = [];
    try {
      const events = await getSclawBrowserNetworkLog(runtimeId, networkProbeSinceRef.current);
      loginNetworkEvents = filterFinanceBiLoginNetworkEvents(events);
    } catch {
      loginNetworkEvents = [];
    }

    logStoFinanceBiCodeLoginInfo({
      phase,
      pageUrl,
      skipLoginCodePreview: codePreview,
      embedSessionCookies: embedSessionCookies.map((cookie) => ({
        name: cookie.name,
        valuePreview: cookie.valuePreview,
        domain: cookie.domain,
        httpOnly: cookie.httpOnly,
      })),
      webStorage,
      loginNetworkEvents: loginNetworkEvents.map((event) => ({
        method: event.method,
        url: event.url,
        statusCode: event.statusCode,
        resourceType: event.resourceType,
      })),
    });
  };

  useEffect(() => {
    let cancelled = false;

    async function resolveEmbedUrl() {
      resolveStartedAtRef.current = Date.now();
      setLoading(true);
      setError(null);
      skipLoginErrorRef.current = null;
      skipLoginUrlRef.current = null;
      sessionPrepRef.current = [];
      planRef.current = null;
      lastCodeLoginProbeUrlRef.current = '';
      lastFinalUrlLoggedRef.current = '';
      networkProbeSinceRef.current = Date.now();
      codeExchangeHookInstalledRef.current = false;
      codeExchangeLoggedCountRef.current = 0;
      clearCodeExchangeDumpTimers();
      forcedPreviewRef.current = false;

      logStoFinanceBiSsoDiagnostics({
        phase: '开始 SSO 流程',
        auth: readAuthSnapshot(),
      });

      let skipLoginUrl: string | null = null;
      let skipLoginError: unknown;
      try {
        const fetchStartedAt = Date.now();
        skipLoginUrl = await fetchAppPlazaSkipLoginLink(STO_FINANCE_BI_SYSTEM_CODE);
        skipLoginUrlRef.current = skipLoginUrl;
        console.info('[finance-bi][sso] 免登接口成功', {
          elapsedMs: Date.now() - fetchStartedAt,
          skipLoginUrl,
        });

        const plan = resolveStoFinanceBiEmbedPlan(skipLoginUrl);
        planRef.current = plan;
        logStoFinanceBiEmbedTrace({ skipLoginUrl, plan });
        returnUrlRef.current = plan.returnUrl;
        forcedPreviewRef.current = false;

        sessionPrepRef.current = [
          await prepareStoSessionIfNeeded(plan.embedUrl),
          await prepareStoSessionIfNeeded(plan.returnUrl),
        ];
        console.info('[finance-bi][sso] session 预热结果', sessionPrepRef.current);

        if (!cancelled) {
          setEmbedUrl(plan.embedUrl);
        }
        emitSsoDiagnostics('embed 计划就绪，即将加载 webview');
      } catch (error) {
        skipLoginError = error;
        skipLoginErrorRef.current = error;
        console.warn('[finance-bi][sso] 免登接口失败，走 redirect 兜底', {
          error: error instanceof Error ? { message: error.message, name: error.name } : error,
        });

        const plan = resolveStoFinanceBiEmbedPlan(null);
        planRef.current = plan;
        logStoFinanceBiEmbedTrace({ skipLoginUrl, skipLoginError, plan });
        returnUrlRef.current = plan.returnUrl;
        forcedPreviewRef.current = false;

        sessionPrepRef.current = [
          await prepareStoSessionIfNeeded(plan.embedUrl),
          await prepareStoSessionIfNeeded(plan.returnUrl),
        ];
        console.info('[finance-bi][sso] session 预热结果（兜底）', sessionPrepRef.current);

        if (!cancelled) {
          setEmbedUrl(plan.embedUrl);
        }
        emitSsoDiagnostics('免登失败，已降级为 redirect 登录');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void resolveEmbedUrl();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (frontForceNavigateTimerRef.current) {
        clearTimeout(frontForceNavigateTimerRef.current);
        frontForceNavigateTimerRef.current = null;
      }
      clearCodeExchangeDumpTimers();
    };
  }, []);

  useEffect(() => {
    if (!embedUrl) return;
    const runtimeId = embedRuntimeIdRef.current;
    void registerSclawBrowserRuntime({
      runtimeId,
      appTitle: t('dataCenterPage.sections.financeReport'),
      initialUrl: embedUrl,
      appId: 'data-center-finance-report',
      bound: true,
    }).then((result) => {
      console.info('[finance-bi][sso] registerSclawBrowserRuntime', { runtimeId, embedUrl, result });
    });
    return () => {
      void unregisterSclawBrowserRuntime(runtimeId);
    };
  }, [embedUrl, t]);

  const logFinalRenderedUrl = (pageUrl: string, pageTitle: string, event: string) => {
    const trimmed = pageUrl.trim();
    if (!trimmed || trimmed === 'about:blank' || trimmed === lastFinalUrlLoggedRef.current) return;
    lastFinalUrlLoggedRef.current = trimmed;
    logStoFinanceBiWebviewFinalUrl({
      initialRequestedUrl: embedUrl ?? '',
      finalRenderedUrl: trimmed,
      returnUrl: returnUrlRef.current,
      pageTitle,
      event,
    });
  };

  const handleWebviewLifecycle = (event: SclawBrowserLifecycleEvent) => {
    if (!embedUrl) return;
    const snapshot = webviewSnapshotRef.current;
    snapshot.requestedUrl = embedUrl;
    snapshot.lastEvent = event.type;
    snapshot.updatedAt = new Date().toISOString();
    if (event.url) snapshot.pageUrl = event.url;
    if (event.title) snapshot.pageTitle = event.title;
    if (typeof event.canGoBack === 'boolean') snapshot.canGoBack = event.canGoBack;
    logStoFinanceBiWebviewLifecycle(embedUrl, event, { ...snapshot });

    const pageUrl = event.url ?? snapshot.pageUrl;
    const onLoginPage = pageUrl.includes('sto-finance-bi-front')
      || (pageUrl.includes('sto-finance-bi-preview') && /#\/login(?:\?|$)/.test(pageUrl));
    const shouldInstallAuthHook = onLoginPage || /#\/login(?:\?|$)/.test(embedUrl);
    const onPreview = pageUrl.includes('sto-finance-bi-preview') && !/#\/login(?:\?|$)/.test(pageUrl);
    const reachedPreview = onPreview;
    const embedTargetHash = returnUrlRef.current.split('#')[1] ?? '';
    const reachedTarget = reachedPreview && embedTargetHash && pageUrl.includes(embedTargetHash);

    if (event.type === 'did-finish-load' || event.type === 'did-fail-load') {
      emitSsoDiagnostics(`webview ${event.type}`, {
        requestedUrl: embedUrl,
        pageUrl,
        lastEvent: event.type,
        errorCode: event.errorCode,
        errorDescription: event.errorDescription,
        onFront: onLoginPage,
        onPreview,
        reachedEmbedTarget: reachedTarget,
      });
    }

    if ((event.type === 'dom-ready' || event.type === 'did-finish-load') && shouldInstallAuthHook) {
      void installCodeExchangeHook(event.type).then(() => {
        scheduleCodeExchangeDumps();
      });
    }

    if (event.type === 'did-finish-load') {
      const phase = onLoginPage
        ? '登录换票完成'
        : onPreview
          ? 'preview 页加载完成'
          : '页面加载完成';
      void probeCodeLoginInfo(phase, pageUrl);
      if (!onLoginPage) {
        void dumpCodeExchangeApiLog(phase, { onlyNew: true });
      }
      logFinalRenderedUrl(
        pageUrl,
        event.title ?? snapshot.pageTitle,
        event.type,
      );
    }

    if (event.type === 'did-stop-loading') {
      logFinalRenderedUrl(
        pageUrl,
        event.title ?? snapshot.pageTitle,
        event.type,
      );
    }

    if (
      event.type === 'did-finish-load'
      && reachedTarget
      && pageUrl !== embedUrl
    ) {
      console.info('[finance-bi][webview] sync embedUrl to preview page', pageUrl);
      setEmbedUrl(pageUrl);
    }

    if (event.type === 'did-finish-load' && onLoginPage) {
      if (frontForceNavigateTimerRef.current) {
        clearTimeout(frontForceNavigateTimerRef.current);
      }
      // 登录页 did-finish-load 只表示 HTML 加载完，不能在此处强制跳目标页（会打断 code 换票 JS）
      frontForceNavigateTimerRef.current = setTimeout(() => {
        const currentUrl = webviewSnapshotRef.current.pageUrl;
        const stillOnLogin = currentUrl.includes('sto-finance-bi-front')
          || (currentUrl.includes('sto-finance-bi-preview') && /#\/login(?:\?|$)/.test(currentUrl));
        if (
          forcedPreviewRef.current
          || !returnUrlRef.current
          || !stillOnLogin
        ) {
          return;
        }
        forcedPreviewRef.current = true;
        console.warn('[finance-bi][sso] 登录页停留超时兜底：强制跳转 returnUrl', {
          loginUrl: currentUrl,
          returnUrl: returnUrlRef.current,
          hint: '登录页在 12s 内未完成换票跳转，才触发强制跳转',
        });
        void dumpCodeExchangeApiLog('超时兜底前', { onlyNew: true }).finally(() => {
          void prepareStoSessionIfNeeded(returnUrlRef.current).finally(() => {
            setEmbedUrl(returnUrlRef.current);
          });
        });
      }, 12_000);
    }

    if (event.type === 'did-finish-load' && reachedTarget) {
      if (frontForceNavigateTimerRef.current) {
        clearTimeout(frontForceNavigateTimerRef.current);
        frontForceNavigateTimerRef.current = null;
      }
      clearCodeExchangeDumpTimers();
    }
  };

  if (loading) {
    return (
      <div className={className}>
        <div className="flex min-h-[320px] flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('dataCenterPage.financeReport.loading')}
        </div>
      </div>
    );
  }

  if (error || !embedUrl) {
    return (
      <div className={className}>
        <FeedbackState
          icon={<AlertCircle className="h-8 w-8" />}
          title={t('dataCenterPage.financeReport.loadFailedTitle')}
          description={error || t('dataCenterPage.financeReport.loadFailedDescription')}
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="data-center-finance-embed flex min-h-[560px] min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border-none bg-white dark:bg-background">
        <div className="sclaw-browser-drawer__frame-host data-center-finance-embed__frame-host h-full min-h-[560px] w-full flex-1">
          <SclawBrowserFrame
            url={embedUrl}
            title={t('dataCenterPage.sections.financeReport')}
            appId="data-center-finance-report"
            embedRuntimeId={embedRuntimeIdRef.current}
            bound
            active
            onWebviewLifecycle={handleWebviewLifecycle}
            onPageUrl={(pageUrl) => {
              webviewSnapshotRef.current.pageUrl = pageUrl;
              logFinalRenderedUrl(
                pageUrl,
                webviewSnapshotRef.current.pageTitle,
                'onPageUrl',
              );
            }}
            onPageTitle={(pageTitle) => {
              webviewSnapshotRef.current.pageTitle = pageTitle;
              if (webviewSnapshotRef.current.pageUrl) {
                logFinalRenderedUrl(
                  webviewSnapshotRef.current.pageUrl,
                  pageTitle,
                  'onPageTitle',
                );
              }
            }}
            onNavStateChange={({ canGoBack }) => {
              webviewSnapshotRef.current.canGoBack = canGoBack;
            }}
          />
        </div>
      </div>
    </div>
  );
}
