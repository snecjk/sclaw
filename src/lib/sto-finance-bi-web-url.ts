/**
 * 财务管报（sto-finance-bi）嵌入 URL。
 * 统一走生产域 page.sto.cn（与 MC 免登 ticket 一致）。
 */
export const STO_FINANCE_BI_SYSTEM_CODE = 'sto-finance-bi';

export const FINANCE_BI_PAGE_ORIGIN = 'https://page.sto.cn';
/** 登录后嵌入 preview 路由 */
const FINANCE_BI_EMBED_HASH = '#/report-square';

export function getStoFinanceBiPageOrigin(): string {
  return FINANCE_BI_PAGE_ORIGIN;
}

/** 将 ticket 中的测试域统一替换为生产域 */
export function alignFinanceBiSkipLoginUrl(skipLoginUrl: string): string {
  const ticket = skipLoginUrl.trim();
  if (!ticket) return ticket;
  return ticket.replace(/https:\/\/page-test\.sto\.cn/g, FINANCE_BI_PAGE_ORIGIN);
}

/** 财务 BI 登录/front 应用根 URL */
export function getStoFinanceBiLoginUrl(): string {
  return `${FINANCE_BI_PAGE_ORIGIN}/ux/sto-finance-bi-front/index.html`;
}

/** 登录成功后跳转的 preview 页（免登 returnUrl 目标） */
export function getStoFinanceBiReportSquareUrl(): string {
  return `${FINANCE_BI_PAGE_ORIGIN}/ux/sto-finance-bi-preview/index.html${FINANCE_BI_EMBED_HASH}`;
}

function pageReachedFinanceBiEmbedTarget(pageUrl: string): boolean {
  if (!pageUrl.includes('sto-finance-bi-preview')) return false;
  const targetHash = FINANCE_BI_EMBED_HASH.replace(/^#/, '');
  return pageUrl.includes(targetHash);
}

/**
 * 构造 front 登录页 redirect（无 SSO ticket 时的兜底入口，与业务站一致）。
 */
export function buildStoFinanceBiLoginRedirectUrl(): string {
  return buildStoFinanceBiEmbedUrl(null);
}

function readMergedUrlParams(url: string): URLSearchParams {
  const params = new URLSearchParams();
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => {
      params.set(key, value);
    });
    const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const queryStart = rawHash.indexOf('?');
    if (queryStart >= 0) {
      new URLSearchParams(rawHash.slice(queryStart + 1)).forEach((value, key) => {
        if (!params.has(key)) params.set(key, value);
      });
    }
  } catch {
    // ignore malformed URLs
  }
  return params;
}

export function extractStoFinanceBiSkipLoginCode(skipLoginUrl?: string | null): string | null {
  const ticket = skipLoginUrl?.trim();
  if (!ticket) return null;
  const aligned = alignFinanceBiSkipLoginUrl(ticket);
  const params = readMergedUrlParams(aligned);
  return params.get('code') || params.get('authorizationCode');
}

export interface StoFinanceBiEmbedPlan {
  embedUrl: string;
  skipLoginCode: string | null;
  returnUrl: string;
  loginMode: 'code' | 'redirect';
  /** 财务 front 登录页实际携带的 query / hash 入参 */
  frontLoginParams: Record<string, string>;
}

/** 与业务站 bridge 脚本一致：?code=&returnUrl=#/login */
function buildFinanceFrontCodeLoginUrl(code: string, returnUrl: string): string {
  const login = getStoFinanceBiLoginUrl();
  return `${login}?code=${encodeURIComponent(code)}&returnUrl=${encodeURIComponent(returnUrl)}#/login`;
}

export function resolveStoFinanceBiEmbedPlan(skipLoginUrl?: string | null): StoFinanceBiEmbedPlan {
  const login = getStoFinanceBiLoginUrl();
  const target = getStoFinanceBiReportSquareUrl();
  const ticket = skipLoginUrl?.trim();

  if (ticket) {
    const frontPlan = tryBuildFromFinanceFrontTicket(ticket);
    if (frontPlan) return frontPlan;

    const code = extractStoFinanceBiSkipLoginCode(ticket);
    if (code) {
      return {
        embedUrl: buildFinanceFrontCodeLoginUrl(code, target),
        skipLoginCode: code,
        returnUrl: target,
        loginMode: 'code',
        frontLoginParams: {
          code,
          returnUrl: target,
        },
      };
    }
  }

  return {
    embedUrl: `${login}#/login?redirect=${encodeURIComponent(target)}`,
    skipLoginCode: null,
    returnUrl: target,
    loginMode: 'redirect',
    frontLoginParams: {
      redirect: target,
    },
  };
}

/**
 * MC 免登 ticket 已是 front 登录页（#/login?code=）时，
 * 提取 code 并转为业务站 bridge 格式：?code=&returnUrl=#/login
 */
function tryBuildFromFinanceFrontTicket(ticket: string): StoFinanceBiEmbedPlan | null {
  try {
    const parsed = new URL(alignFinanceBiSkipLoginUrl(ticket));
    if (!parsed.pathname.includes('sto-finance-bi-front')) return null;

    const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    if (!rawHash.includes('login')) return null;

    const queryStart = rawHash.indexOf('?');
    const hashParams = new URLSearchParams(queryStart >= 0 ? rawHash.slice(queryStart + 1) : '');
    const previewTarget = getStoFinanceBiReportSquareUrl();
    const code = hashParams.get('code') || hashParams.get('authorizationCode');

    if (code) {
      return {
        embedUrl: buildFinanceFrontCodeLoginUrl(code, previewTarget),
        skipLoginCode: code,
        returnUrl: previewTarget,
        loginMode: 'code',
        frontLoginParams: {
          code,
          returnUrl: previewTarget,
        },
      };
    }

    return {
      embedUrl: `${getStoFinanceBiLoginUrl()}#/login?redirect=${encodeURIComponent(previewTarget)}`,
      skipLoginCode: null,
      returnUrl: previewTarget,
      loginMode: 'redirect',
      frontLoginParams: {
        redirect: previewTarget,
      },
    };
  } catch {
    return null;
  }
}

export const STO_FINANCE_BI_SKIP_LOGIN_API = {
  rendererPath: '/api/app-plaza/skip-login-link',
  rendererMethod: 'GET',
  upstreamPath: '/agent/v1/app-plaza/skip-login-link',
  upstreamMethod: 'POST',
  query: {
    systemCode: STO_FINANCE_BI_SYSTEM_CODE,
  },
} as const;

export type StoFinanceBiTicketKind = 'mc-front-hash' | 'sso-ticket' | 'empty' | 'unknown';

export function classifyStoFinanceBiSkipLoginTicket(ticket?: string | null): {
  kind: StoFinanceBiTicketKind;
  host: string | null;
  hasCode: boolean;
  codeLength: number;
  codePreview: string | null;
} {
  const raw = ticket?.trim();
  if (!raw) {
    return { kind: 'empty', host: null, hasCode: false, codeLength: 0, codePreview: null };
  }
  const aligned = alignFinanceBiSkipLoginUrl(raw);
  let host: string | null = null;
  try {
    host = new URL(aligned).host;
  } catch {
    host = null;
  }
  const code = extractStoFinanceBiSkipLoginCode(aligned);
  const codePreview = code ? `${code.slice(0, 6)}…${code.slice(-4)}` : null;
  let kind: StoFinanceBiTicketKind = 'unknown';
  if (aligned.includes('sto-finance-bi-front') && aligned.includes('#/login')) {
    kind = 'mc-front-hash';
  } else if (aligned.includes('sto-sso-web') || aligned.includes('sso')) {
    kind = 'sso-ticket';
  }
  return {
    kind,
    host,
    hasCode: Boolean(code),
    codeLength: code?.length ?? 0,
    codePreview,
  };
}

function describeEmbedUrlFormat(embedUrl: string): {
  usesBridgeCodeLogin: boolean;
  hasReturnUrlInQuery: boolean;
  hasLoginHash: boolean;
} {
  try {
    const parsed = new URL(embedUrl);
    return {
      usesBridgeCodeLogin: parsed.searchParams.has('code') && parsed.hash.includes('login'),
      hasReturnUrlInQuery: parsed.searchParams.has('returnUrl'),
      hasLoginHash: parsed.hash.includes('login'),
    };
  } catch {
    return { usesBridgeCodeLogin: false, hasReturnUrlInQuery: false, hasLoginHash: false };
  }
}

function inferSsoFailureHint(input: {
  skipLoginError?: unknown;
  plan: StoFinanceBiEmbedPlan;
  ticket: ReturnType<typeof classifyStoFinanceBiSkipLoginTicket>;
  auth?: { isAuthenticated: boolean };
  webview?: { lastEvent?: string; errorCode?: number; errorDescription?: string; onFront?: boolean; reachedEmbedTarget?: boolean };
}): string[] {
  const hints: string[] = [];
  if (input.auth && !input.auth.isAuthenticated) {
    hints.push('StoClaw 未登录，MC 无法签发有效免登 ticket');
  }
  if (input.skipLoginError) {
    hints.push('免登接口失败：检查 memory-center 是否配置 sto-finance-bi 及 Host API 连通性');
  }
  if (!input.plan.skipLoginCode && input.plan.loginMode === 'redirect') {
    hints.push('无 code，已降级为 redirect 登录，需用户在 front 页手动登录');
  }
  if (input.ticket.hasCode && input.ticket.codeLength < 16) {
    hints.push('code 长度异常偏短，ticket 可能已过期或被截断');
  }
  const format = describeEmbedUrlFormat(input.plan.embedUrl);
  if (input.plan.loginMode === 'code' && !format.usesBridgeCodeLogin) {
    hints.push('embedUrl 未命中 bridge 格式 ?code=&returnUrl=#/login，front 可能无法识别');
  }
  if (input.webview?.lastEvent === 'did-fail-load') {
    hints.push(`webview 加载失败 (${input.webview.errorCode ?? '?'}): ${input.webview.errorDescription ?? 'unknown'}`);
  }
  if (input.webview?.onFront && input.webview.lastEvent === 'did-finish-load') {
    hints.push('front 登录页加载完成但未跳 preview：code 可能无效/过期，或 front 换票接口失败（看 Network）');
  }
  if (input.webview?.reachedEmbedTarget && input.webview.lastEvent === 'did-finish-load') {
    hints.push('已到 preview 目标路由但界面空白：优先查 preview 域接口 401/403 或 webview 高度');
  }
  if (hints.length === 0) {
    hints.push('暂未识别明确失败点，继续观察 [finance-bi][webview] 导航事件');
  }
  return hints;
}

export function logStoFinanceBiSsoDiagnostics(input: {
  phase: string;
  skipLoginUrl?: string | null;
  skipLoginError?: unknown;
  plan?: StoFinanceBiEmbedPlan | null;
  auth?: { isAuthenticated: boolean; userCode?: string | null; ssoEnvironment?: string | null };
  sessionPrep?: Array<{ url: string; ok: boolean; error?: string; skipped?: boolean }>;
  elapsedMs?: number;
  webview?: {
    requestedUrl?: string;
    pageUrl?: string;
    lastEvent?: string;
    errorCode?: number;
    errorDescription?: string;
    onFront?: boolean;
    onPreview?: boolean;
    reachedEmbedTarget?: boolean;
  };
}): void {
  const ticket = classifyStoFinanceBiSkipLoginTicket(input.skipLoginUrl);
  const plan = input.plan ?? null;
  const embedFormat = plan ? describeEmbedUrlFormat(plan.embedUrl) : null;
  const hints = plan
    ? inferSsoFailureHint({
      skipLoginError: input.skipLoginError,
      plan,
      ticket,
      auth: input.auth,
      webview: input.webview,
    })
    : ['embed plan 未生成，检查上方 fetch / resolve 错误'];

  console.info(`[finance-bi][sso] ${input.phase}`, {
    elapsedMs: input.elapsedMs ?? null,
    auth: input.auth ?? null,
    ticket,
    skipLoginError: input.skipLoginError instanceof Error
      ? { message: input.skipLoginError.message, name: input.skipLoginError.name }
      : input.skipLoginError ?? null,
    plan: plan
      ? {
        loginMode: plan.loginMode,
        skipLoginCodePreview: plan.skipLoginCode
          ? `${plan.skipLoginCode.slice(0, 6)}…${plan.skipLoginCode.slice(-4)}`
          : null,
        returnUrl: plan.returnUrl,
        embedUrl: plan.embedUrl,
        embedFormat,
        frontLoginParams: plan.frontLoginParams,
      }
      : null,
    sessionPrep: input.sessionPrep ?? null,
    webview: input.webview ?? null,
    failureHints: hints,
  });
}

export function logStoFinanceBiEmbedTrace(input: {
  skipLoginUrl?: string | null;
  skipLoginError?: unknown;
  plan: StoFinanceBiEmbedPlan;
}): void {
  const { skipLoginUrl, skipLoginError, plan } = input;
  const ticket = classifyStoFinanceBiSkipLoginTicket(skipLoginUrl);
  const embedFormat = describeEmbedUrlFormat(plan.embedUrl);
  console.info('[finance-bi] 1/3 获取免登 ticket', {
    api: STO_FINANCE_BI_SKIP_LOGIN_API,
    requestQuery: STO_FINANCE_BI_SKIP_LOGIN_API.query,
    skipLoginUrl: skipLoginUrl ?? null,
    ticketKind: ticket.kind,
    ticketHost: ticket.host,
    skipLoginError: skipLoginError instanceof Error
      ? skipLoginError.message
      : skipLoginError ?? null,
  });
  console.info('[finance-bi] 2/3 解析免登 code', {
    codePreview: ticket.codePreview,
    codeLength: ticket.codeLength,
    hasCode: Boolean(plan.skipLoginCode),
    loginMode: plan.loginMode,
    returnUrl: plan.returnUrl,
  });
  console.info('[finance-bi] 3/3 财务 front 登录入口', {
    embedUrl: plan.embedUrl,
    embedFormat,
    frontLoginParams: plan.frontLoginParams,
    note: plan.loginMode === 'code'
      ? 'front 页使用 ?code= + returnUrl + #/login 完成 SSO 换票并跳转 preview 目标页'
      : '无 code，走 hash redirect 登录兜底',
  });
}

/** 将免登 ticket 转为财务 front 可识别的登录 URL。 */
export function buildStoFinanceBiEmbedUrl(skipLoginUrl?: string | null): string {
  return resolveStoFinanceBiEmbedPlan(skipLoginUrl).embedUrl;
}

export interface StoFinanceBiWebviewSnapshot {
  requestedUrl: string;
  pageUrl: string;
  pageTitle: string;
  canGoBack: boolean;
  lastEvent: string;
  updatedAt: string;
}

export function logStoFinanceBiWebviewLifecycle(
  requestedUrl: string,
  event: {
    type: string;
    url?: string;
    title?: string;
    canGoBack?: boolean;
    errorCode?: number;
    errorDescription?: string;
    isMainFrame?: boolean;
  },
  snapshot: StoFinanceBiWebviewSnapshot,
): void {
  const pageUrl = event.url ?? snapshot.pageUrl;
  const onFront = pageUrl.includes('sto-finance-bi-front');
  const onPreview = pageUrl.includes('sto-finance-bi-preview');
  const reachedEmbedTarget = pageReachedFinanceBiEmbedTarget(pageUrl);

  console.info('[finance-bi][webview]', event.type, {
    requestedUrl,
    pageUrl,
    pageTitle: event.title ?? snapshot.pageTitle,
    canGoBack: event.canGoBack ?? snapshot.canGoBack,
    errorCode: event.errorCode,
    errorDescription: event.errorDescription,
    isMainFrame: event.isMainFrame,
    onFront,
    onPreview,
    reachedEmbedTarget,
    snapshot,
  });

  if (event.type === 'did-finish-load' || event.type === 'did-fail-load') {
    const diagnosisPayload = {
      ...snapshot,
      onFront,
      onPreview,
      reachedEmbedTarget,
      diagnosis: onFront
        ? '仍停留在 front 登录页，可能需要手动跳转 returnUrl'
        : reachedEmbedTarget
          ? `已到达 embed 目标页 ${FINANCE_BI_EMBED_HASH}（若界面空白，优先检查 webview 高度/样式）`
          : onPreview
            ? `已在 preview 域，但未命中 embed 目标路由 ${FINANCE_BI_EMBED_HASH}`
            : '未进入财务 BI 页面',
    };
    console.info('[finance-bi][webview] snapshot', diagnosisPayload);
    if (event.type === 'did-fail-load') {
      console.warn('[finance-bi][sso] webview 加载失败', {
        requestedUrl,
        pageUrl,
        errorCode: event.errorCode,
        errorDescription: event.errorDescription,
        isMainFrame: event.isMainFrame,
        hint: event.errorCode === -3
          ? 'ERR_ABORTED：通常是 SPA 内部跳转中断导航，若后续 did-finish-load 成功可忽略'
          : '检查网络、域名证书或 front/preview 页面是否可访问',
      });
    }
  }
}

export function logStoFinanceBiWebviewFinalUrl(input: {
  initialRequestedUrl: string;
  finalRenderedUrl: string;
  returnUrl?: string;
  pageTitle?: string;
  event?: string;
}): void {
  const { initialRequestedUrl, finalRenderedUrl, returnUrl, pageTitle, event } = input;
  const sameAsRequested = finalRenderedUrl === initialRequestedUrl;
  const reachedReturnUrl = Boolean(
    returnUrl
    && finalRenderedUrl.replace(/#.*$/, '') === returnUrl.replace(/#.*$/, '')
    && (!returnUrl.includes('#') || finalRenderedUrl.includes(returnUrl.split('#')[1] ?? '')),
  );

  console.info('[finance-bi][webview] 最终渲染链接', finalRenderedUrl);
  console.info('[finance-bi][webview] 最终渲染详情', {
    finalRenderedUrl,
    initialRequestedUrl,
    returnUrl: returnUrl ?? null,
    pageTitle: pageTitle ?? '',
    event: event ?? '',
    sameAsRequested,
    reachedReturnUrl,
  });
}

const FINANCE_BI_LOGIN_NETWORK_KEYWORDS = [
  'login',
  'auth',
  'sso',
  'token',
  'code',
  'session',
  'ticket',
  'oauth',
  'passport',
  'user',
  'skip',
] as const;

export function filterFinanceBiLoginNetworkEvents(
  events: Array<{ method: string; url: string; statusCode?: number; resourceType?: string; timestamp: number }>,
): typeof events {
  return events.filter((event) => {
    const lower = event.url.toLowerCase();
    return FINANCE_BI_LOGIN_NETWORK_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
}

/** 在 webview 内探测 localStorage / sessionStorage / document.cookie */
export const FINANCE_BI_WEB_STORAGE_PROBE_SCRIPT = `(function() {
  function readStorage(store) {
    var out = {};
    try {
      for (var i = 0; i < store.length; i++) {
        var key = store.key(i);
        if (key) out[key] = store.getItem(key) || '';
      }
    } catch (e) {
      out.__error = String(e && e.message ? e.message : e);
    }
    return out;
  }
  return {
    pageUrl: location.href,
    documentCookie: document.cookie || '',
    localStorage: readStorage(localStorage),
    sessionStorage: readStorage(sessionStorage),
  };
})()`;

export interface StoFinanceBiCodeLoginInfo {
  phase: string;
  pageUrl: string;
  skipLoginCodePreview: string | null;
  embedSessionCookies: Array<{
    name: string;
    valuePreview: string;
    domain: string;
    httpOnly: boolean;
  }>;
  webStorage: {
    pageUrl?: string;
    documentCookie?: string;
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
  } | null;
  loginNetworkEvents: Array<{
    method: string;
    url: string;
    statusCode?: number;
    resourceType?: string;
  }>;
}

export function logStoFinanceBiCodeLoginInfo(info: StoFinanceBiCodeLoginInfo): void {
  console.info('[finance-bi][sso] code 换票登录信息', {
    phase: info.phase,
    pageUrl: info.pageUrl,
    skipLoginCodePreview: info.skipLoginCodePreview,
    embedSessionCookies: info.embedSessionCookies,
    webStorage: info.webStorage,
    loginNetworkEvents: info.loginNetworkEvents,
    hint: info.loginNetworkEvents.some((e) => (e.statusCode ?? 0) >= 400)
      ? '存在登录相关接口 4xx/5xx，code 换票可能失败'
      : info.embedSessionCookies.length === 0 && !info.webStorage?.documentCookie
        ? '未发现 cookie / storage，front 可能未成功写入登录态'
        : '登录态已写入 embed session，若仍空白请查 preview 业务接口权限',
  });
}
