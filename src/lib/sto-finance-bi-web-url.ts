/**
 * 财务管报（sto-finance-bi）嵌入 URL。
 * 统一走生产域 page.sto.cn（与 MC 免登 ticket 一致）。
 */
export const STO_FINANCE_BI_SYSTEM_CODE = 'sto-finance-bi';

export const FINANCE_BI_PAGE_ORIGIN = 'https://page.sto.cn';
/** preview 应用根路径 */
const FINANCE_BI_PREVIEW_PATH = '/ux/sto-finance-bi-preview/index.html';
/** 登录成功后嵌入的目标路由 */
const FINANCE_BI_EMBED_HASH = '#/data-model/report-list';

export function getStoFinanceBiPageOrigin(): string {
  return FINANCE_BI_PAGE_ORIGIN;
}

/** 将 ticket 中的测试域统一替换为生产域 */
export function alignFinanceBiSkipLoginUrl(skipLoginUrl: string): string {
  const ticket = skipLoginUrl.trim();
  if (!ticket) return ticket;
  return ticket.replace(/https:\/\/page-test\.sto\.cn/g, FINANCE_BI_PAGE_ORIGIN);
}

/** 财务 BI preview 根 URL（登录与业务页同域） */
export function getStoFinanceBiLoginUrl(): string {
  return `${FINANCE_BI_PAGE_ORIGIN}${FINANCE_BI_PREVIEW_PATH}`;
}

/** 登录成功后跳转的报表列表页（免登 returnUrl 目标） */
export function getStoFinanceBiReportSquareUrl(): string {
  return `${FINANCE_BI_PAGE_ORIGIN}${FINANCE_BI_PREVIEW_PATH}${FINANCE_BI_EMBED_HASH}`;
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

/**
 * 有 code 时的嵌入登录 URL（与 preview getCurLocation 约定一致）：
 * …/sto-finance-bi-preview/index.html?code={code}&returnUrl={encodeURIComponent(returnUrl)}#/login
 * - code / returnUrl 必须在 search（# 之前），preview 才读得到 returnUrl
 * - hash 只负责进入登录路由
 */
function buildFinanceCodeLoginUrl(code: string, returnUrl: string): string {
  const login = getStoFinanceBiLoginUrl();
  const params = new URLSearchParams({
    code,
    returnUrl,
  });
  return `${login}?${params.toString()}#/login`;
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
        embedUrl: buildFinanceCodeLoginUrl(code, target),
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
 * MC 免登 ticket 已是登录页（front 或 preview 的 #/login?code=）时，
 * 提取 code 并转为 preview 约定格式：?code=&returnUrl=#/login
 */
function tryBuildFromFinanceFrontTicket(ticket: string): StoFinanceBiEmbedPlan | null {
  try {
    const parsed = new URL(alignFinanceBiSkipLoginUrl(ticket));
    const isFinanceLoginApp =
      parsed.pathname.includes('sto-finance-bi-front')
      || parsed.pathname.includes('sto-finance-bi-preview');
    if (!isFinanceLoginApp) return null;

    const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    if (!rawHash.includes('login')) return null;

    const queryStart = rawHash.indexOf('?');
    const hashParams = new URLSearchParams(queryStart >= 0 ? rawHash.slice(queryStart + 1) : '');
    const searchCode = parsed.searchParams.get('code') || parsed.searchParams.get('authorizationCode');
    const previewTarget = getStoFinanceBiReportSquareUrl();
    const code = hashParams.get('code') || hashParams.get('authorizationCode') || searchCode;

    if (code) {
      return {
        embedUrl: buildFinanceCodeLoginUrl(code, previewTarget),
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
  if (
    (aligned.includes('sto-finance-bi-front') || aligned.includes('sto-finance-bi-preview'))
    && aligned.includes('#/login')
  ) {
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
    const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const queryStart = rawHash.indexOf('?');
    const hashParams = queryStart >= 0
      ? new URLSearchParams(rawHash.slice(queryStart + 1))
      : new URLSearchParams();
    return {
      // preview 约定：code/returnUrl 在 search，hash 仅为 /login
      usesBridgeCodeLogin:
        (parsed.searchParams.has('code') || hashParams.has('code'))
        && rawHash.includes('login'),
      hasReturnUrlInQuery: parsed.searchParams.has('returnUrl') || hashParams.has('returnUrl'),
      hasLoginHash: rawHash.includes('login'),
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
    hints.push('embedUrl 未命中约定格式 ?code=&returnUrl=#/login，preview 可能无法换票/回跳');
  }
  if (
    input.plan.loginMode === 'code'
    && format.usesBridgeCodeLogin
    && !format.hasReturnUrlInQuery
  ) {
    hints.push('缺少 returnUrl；preview 只会落到默认 /data-model');
  }
  try {
    const parsed = new URL(input.plan.embedUrl);
    if (parsed.hash.includes('returnUrl=') && !parsed.searchParams.has('returnUrl')) {
      hints.push('returnUrl 在 hash 内，preview getCurLocation 只读 search，回跳会失效');
    }
  } catch {
    // ignore
  }
  if (input.webview?.lastEvent === 'did-fail-load') {
    hints.push(`webview 加载失败 (${input.webview.errorCode ?? '?'}): ${input.webview.errorDescription ?? 'unknown'}`);
  }
  if (input.webview?.onFront && input.webview.lastEvent === 'did-finish-load') {
    hints.push('登录页加载完成但未跳报表列表：code 可能无效/过期，或换票接口失败（看 Network）');
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
      ? 'preview 使用 ?code=&returnUrl=#/login（search 传参）换票并回跳报表列表'
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
  const onFront = pageUrl.includes('sto-finance-bi-front')
    || (pageUrl.includes('sto-finance-bi-preview') && /#\/login(?:\?|$)/.test(pageUrl));
  const onPreview = pageUrl.includes('sto-finance-bi-preview') && !/#\/login(?:\?|$)/.test(pageUrl);
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
        ? '仍停留在登录页，可能需要手动跳转 returnUrl'
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
          : '检查网络、域名证书或 preview 页面是否可访问',
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

/**
 * 注入到 preview/front 登录页：拦截 fetch / XHR，记录疑似 code 换票接口的请求与响应。
 * 结果挂在 window.__stoFinanceBiAuthApiLog，并同步打到 webview console。
 */
export const FINANCE_BI_CODE_EXCHANGE_HOOK_SCRIPT = `(function() {
  if (window.__stoFinanceBiAuthHookInstalled) {
    return { ok: true, already: true, count: (window.__stoFinanceBiAuthApiLog || []).length };
  }
  window.__stoFinanceBiAuthHookInstalled = true;
  window.__stoFinanceBiAuthApiLog = window.__stoFinanceBiAuthApiLog || [];

  function shouldCapture(url) {
    var lower = String(url || '').toLowerCase();
    var keys = ['login', 'auth', 'sso', 'token', 'code', 'authorization', 'logon', 'ticket', 'session', 'passport', 'user'];
    for (var i = 0; i < keys.length; i++) {
      if (lower.indexOf(keys[i]) >= 0) return true;
    }
    return false;
  }

  function previewText(text, max) {
    try {
      var s = String(text == null ? '' : text);
      if (s.length <= max) return s;
      return s.slice(0, max) + '…(+' + (s.length - max) + ')';
    } catch (e) {
      return '(preview failed)';
    }
  }

  function push(entry) {
    try {
      window.__stoFinanceBiAuthApiLog.push(entry);
      while (window.__stoFinanceBiAuthApiLog.length > 80) {
        window.__stoFinanceBiAuthApiLog.shift();
      }
      console.info('[finance-bi][sso][code-exchange]', entry.method, entry.url, {
        status: entry.status,
        requestBody: entry.requestBodyPreview || null,
        response: entry.responsePreview || null,
        error: entry.error || null,
      });
    } catch (e) {}
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function(input, init) {
      var url = '';
      var method = 'GET';
      var requestBodyPreview = '';
      try {
        url = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input);
        method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (init && init.body != null) {
          requestBodyPreview = previewText(typeof init.body === 'string' ? init.body : JSON.stringify(init.body), 2000);
        }
      } catch (e) {}
      if (!shouldCapture(url)) {
        return originalFetch.apply(this, arguments);
      }
      var startedAt = Date.now();
      return originalFetch.apply(this, arguments).then(function(res) {
        var cloned = res.clone();
        return cloned.text().then(function(text) {
          push({
            type: 'fetch',
            method: method,
            url: url,
            status: res.status,
            requestBodyPreview: requestBodyPreview,
            responsePreview: previewText(text, 4000),
            durationMs: Date.now() - startedAt,
            at: Date.now(),
          });
          return res;
        }).catch(function(err) {
          push({
            type: 'fetch',
            method: method,
            url: url,
            status: res.status,
            requestBodyPreview: requestBodyPreview,
            responsePreview: null,
            error: String(err && err.message ? err.message : err),
            durationMs: Date.now() - startedAt,
            at: Date.now(),
          });
          return res;
        });
      }).catch(function(err) {
        push({
          type: 'fetch',
          method: method,
          url: url,
          status: null,
          requestBodyPreview: requestBodyPreview,
          responsePreview: null,
          error: String(err && err.message ? err.message : err),
          durationMs: Date.now() - startedAt,
          at: Date.now(),
        });
        throw err;
      });
    };
  }

  var XHR = window.XMLHttpRequest;
  if (typeof XHR === 'function') {
    var open = XHR.prototype.open;
    var send = XHR.prototype.send;
    XHR.prototype.open = function(method, url) {
      this.__stoFinanceBiAuth = {
        method: String(method || 'GET').toUpperCase(),
        url: String(url || ''),
        startedAt: 0,
        requestBodyPreview: '',
      };
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function(body) {
      var meta = this.__stoFinanceBiAuth;
      if (!meta || !shouldCapture(meta.url)) {
        return send.apply(this, arguments);
      }
      try {
        if (body != null) {
          meta.requestBodyPreview = previewText(typeof body === 'string' ? body : JSON.stringify(body), 2000);
        }
      } catch (e) {}
      meta.startedAt = Date.now();
      this.addEventListener('loadend', function() {
        var responsePreview = null;
        try {
          responsePreview = previewText(this.responseText || '', 4000);
        } catch (e) {
          responsePreview = '(read responseText failed)';
        }
        push({
          type: 'xhr',
          method: meta.method,
          url: meta.url,
          status: this.status,
          requestBodyPreview: meta.requestBodyPreview,
          responsePreview: responsePreview,
          durationMs: Date.now() - meta.startedAt,
          at: Date.now(),
        });
      });
      return send.apply(this, arguments);
    };
  }

  return { ok: true, installed: true, count: 0 };
})()`;

/** 读取已拦截到的 code 换票接口日志 */
export const FINANCE_BI_CODE_EXCHANGE_DUMP_SCRIPT = `(function() {
  return {
    pageUrl: location.href,
    installed: !!window.__stoFinanceBiAuthHookInstalled,
    entries: Array.isArray(window.__stoFinanceBiAuthApiLog) ? window.__stoFinanceBiAuthApiLog.slice() : [],
  };
})()`;

export interface StoFinanceBiCodeExchangeEntry {
  type?: string;
  method: string;
  url: string;
  status?: number | null;
  requestBodyPreview?: string | null;
  responsePreview?: string | null;
  error?: string | null;
  durationMs?: number;
  at?: number;
}

export function logStoFinanceBiCodeExchangeDump(input: {
  phase: string;
  pageUrl?: string;
  installed?: boolean;
  entries: StoFinanceBiCodeExchangeEntry[];
  /** 只打印自该下标起的新增条目，避免定时 dump 重复刷屏 */
  sinceIndex?: number;
}): void {
  const { phase, pageUrl, installed, entries } = input;
  const sinceIndex = Math.max(0, input.sinceIndex ?? 0);
  const delta = entries.slice(sinceIndex);
  console.info(`[finance-bi][sso][code-exchange] ${phase}`, {
    pageUrl: pageUrl ?? null,
    hookInstalled: installed ?? null,
    totalCount: entries.length,
    newCount: delta.length,
  });
  if (!entries.length) {
    console.warn('[finance-bi][sso][code-exchange] 暂无拦截记录', {
      hint: installed
        ? '钩子已注入但页面未发起疑似换票请求（可能无 code、走 redirect，或接口 URL 不含 login/auth/code 等关键字）'
        : '钩子未注入成功，无法捕获换票请求/响应体',
    });
    return;
  }
  if (!delta.length) {
    console.info('[finance-bi][sso][code-exchange] 无新增请求', {
      totalCount: entries.length,
    });
    return;
  }
  delta.forEach((entry, index) => {
    const seq = sinceIndex + index + 1;
    console.info(`[finance-bi][sso][code-exchange] #${seq} 调用`, {
      type: entry.type ?? null,
      method: entry.method,
      url: entry.url,
      requestBody: entry.requestBodyPreview ?? null,
    });
    console.info(`[finance-bi][sso][code-exchange] #${seq} 返回`, {
      status: entry.status ?? null,
      durationMs: entry.durationMs ?? null,
      response: entry.responsePreview ?? null,
      error: entry.error ?? null,
    });
  });
}

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
