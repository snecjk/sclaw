import { captureStoTokenFromUrl, getStoToken } from './auth-token';

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method' | 'headers'> {
  method?: RequestMethod;
  /** JSON body — serialized automatically. */
  data?: unknown;
  /** Raw body override when not using `data`. */
  body?: BodyInit | null;
  headers?: HeadersInit;
  /** Query object merged into URL. */
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Default true — send cookies cross-site when CORS allows. */
  withCredentials?: boolean;
  /** Override / clear stoToken for this call. Pass null to skip token headers. */
  stoToken?: string | null;
  timeoutMs?: number;
}

export class RequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.payload = payload;
  }
}

function buildUrl(url: string, params?: RequestOptions['params']): string {
  if (!params) return url;
  const base = url.startsWith('http') ? new URL(url) : new URL(url, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    base.searchParams.set(key, String(value));
  }
  if (url.startsWith('http')) return base.toString();
  return `${base.pathname}${base.search}${base.hash}`;
}

function resolveStoToken(explicit?: string | null): string | null {
  if (explicit === null) return null;
  if (typeof explicit === 'string') {
    const trimmed = explicit.trim();
    return trimmed || null;
  }
  return getStoToken();
}

/**
 * Browser fetch wrapper:
 * - credentials include cookies by default
 * - URL / session stoToken written to `stoToken` + `stotoken` headers
 */
export async function request<T = unknown>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  captureStoTokenFromUrl();

  const {
    method = 'GET',
    data,
    body,
    headers: inputHeaders,
    params,
    withCredentials = true,
    stoToken,
    timeoutMs = 60_000,
    signal,
    ...rest
  } = options;

  const headers = new Headers(inputHeaders);
  const token = resolveStoToken(stoToken);
  if (token) {
    if (!headers.has('stoToken')) headers.set('stoToken', token);
    if (!headers.has('stotoken')) headers.set('stotoken', token);
  }

  let finalBody = body ?? null;
  if (data !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    finalBody = JSON.stringify(data);
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(buildUrl(url, params), {
      ...rest,
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? null : finalBody,
      credentials: withCredentials ? 'include' : 'same-origin',
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'message' in payload
          ? String((payload as { message?: unknown }).message ?? response.statusText)
          : response.statusText || `HTTP ${response.status}`;
      throw new RequestError(message, response.status, payload);
    }

    return payload as T;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export const http = {
  get: <T = unknown>(url: string, options?: Omit<RequestOptions, 'method' | 'data' | 'body'>) =>
    request<T>(url, { ...options, method: 'GET' }),
  post: <T = unknown>(url: string, data?: unknown, options?: Omit<RequestOptions, 'method' | 'data'>) =>
    request<T>(url, { ...options, method: 'POST', data }),
  put: <T = unknown>(url: string, data?: unknown, options?: Omit<RequestOptions, 'method' | 'data'>) =>
    request<T>(url, { ...options, method: 'PUT', data }),
  patch: <T = unknown>(url: string, data?: unknown, options?: Omit<RequestOptions, 'method' | 'data'>) =>
    request<T>(url, { ...options, method: 'PATCH', data }),
  delete: <T = unknown>(url: string, options?: Omit<RequestOptions, 'method' | 'data' | 'body'>) =>
    request<T>(url, { ...options, method: 'DELETE' }),
};
