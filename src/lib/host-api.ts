import { invokeIpc } from '@/lib/api-client';
import { trackUiEvent } from './telemetry';
import { normalizeAppError } from './error-model';

const HOST_API_PORT = 3210;
const HOST_API_BASE = `http://127.0.0.1:${HOST_API_PORT}`;

type HostApiProxyResponse = {
  ok?: boolean;
  data?: {
    status?: number;
    ok?: boolean;
    json?: unknown;
    text?: string;
  };
  error?: { message?: string } | string;
  // backward compatibility fields
  success: boolean;
  status?: number;
  json?: unknown;
  text?: string;
};

type HostApiProxyData = {
  status?: number;
  /** Mirrors Response.ok from the proxied HTTP response (false for 4xx/5xx). */
  ok?: boolean;
  json?: unknown;
  text?: string;
};

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore body parse failure
    }
    throw normalizeAppError(new Error(message), {
      source: 'browser-fallback',
      status: response.status,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

function resolveProxyErrorMessage(error: HostApiProxyResponse['error']): string {
  return typeof error === 'string'
    ? error
    : (error?.message || 'Host API proxy request failed');
}

function parseUnifiedProxyResponse<T>(
  response: HostApiProxyResponse,
  path: string,
  method: string,
  startedAt: number,
): T {
  if (!response.ok) {
    throw new Error(resolveProxyErrorMessage(response.error));
  }

  const data: HostApiProxyData = response.data ?? {};
  const httpStatus = typeof data.status === 'number' ? data.status : 200;
  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'ipc-proxy',
    durationMs: Date.now() - startedAt,
    status: httpStatus,
  });

  if (httpStatus === 204) return undefined as T;
  if (httpStatus >= 400 || data.ok === false) {
    const json = data.json as Record<string, unknown> | undefined;
    const message =
      (json && typeof json.error === 'string' && json.error) ||
      (json && typeof json.message === 'string' && json.message) ||
      `HTTP ${httpStatus}`;
    throw normalizeAppError(new Error(message), {
      source: 'ipc-proxy',
      path,
      method,
      status: httpStatus,
    });
  }

  if (data.json !== undefined) return data.json as T;
  return data.text as T;
}

function parseLegacyProxyResponse<T>(
  response: HostApiProxyResponse,
  path: string,
  method: string,
  startedAt: number,
): T {
  if (!response.success) {
    throw new Error(resolveProxyErrorMessage(response.error));
  }

  if (!response.ok) {
    const message = response.text
      || (typeof response.json === 'object' && response.json != null && 'error' in (response.json as Record<string, unknown>)
        ? String((response.json as Record<string, unknown>).error)
        : `HTTP ${response.status ?? 'unknown'}`);
    throw new Error(message);
  }

  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'ipc-proxy-legacy',
    durationMs: Date.now() - startedAt,
    status: response.status ?? 200,
  });

  if (response.status === 204) return undefined as T;
  if (response.json !== undefined) return response.json as T;
  return response.text as T;
}

function shouldFallbackToBrowser(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('invalid ipc channel: hostapi:fetch')
    || normalized.includes("no handler registered for 'hostapi:fetch'")
    || normalized.includes('no handler registered for "hostapi:fetch"')
    || normalized.includes('no handler registered for hostapi:fetch')
    || normalized.includes('window is not defined');
}

function allowLocalhostFallback(): boolean {
  try {
    return window.localStorage.getItem('stoclaw:allow-localhost-fallback') === '1';
  } catch {
    return false;
  }
}

export async function hostApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = Date.now();
  const method = init?.method || 'GET';
  // In Electron renderer, always proxy through main process to avoid CORS.
  try {
    const response = await invokeIpc<HostApiProxyResponse>('hostapi:fetch', {
      path,
      method,
      headers: headersToRecord(init?.headers),
      body: init?.body ?? null,
    });

    if (typeof response?.ok === 'boolean' && 'data' in response) {
      return parseUnifiedProxyResponse<T>(response, path, method, startedAt);
    }

    return parseLegacyProxyResponse<T>(response, path, method, startedAt);
  } catch (error) {
    const normalized = normalizeAppError(error, { source: 'ipc-proxy', path, method });
    const message = normalized.message;
    trackUiEvent('hostapi.fetch_error', {
      path,
      method,
      source: 'ipc-proxy',
      durationMs: Date.now() - startedAt,
      message,
      code: normalized.code,
    });
    if (!shouldFallbackToBrowser(message)) {
      throw normalized;
    }
    if (!allowLocalhostFallback()) {
      trackUiEvent('hostapi.fetch_error', {
        path,
        method,
        source: 'ipc-proxy',
        durationMs: Date.now() - startedAt,
        message: 'localhost fallback blocked by policy',
        code: 'CHANNEL_UNAVAILABLE',
      });
      throw normalized;
    }
  }

  // Browser-only fallback (non-Electron environments).
  const response = await fetch(`${HOST_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'browser-fallback',
    durationMs: Date.now() - startedAt,
    status: response.status,
  });
  try {
    return await parseResponse<T>(response);
  } catch (error) {
    throw normalizeAppError(error, { source: 'browser-fallback', path, method });
  }
}

/**
 * Fetch a streaming endpoint (e.g. SSE) from the local Host API.
 * Unlike `hostApiFetch`, this bypasses IPC and returns the raw Response
 * so the caller can read `response.body` as a ReadableStream.
 */
export async function hostApiFetchStream(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${HOST_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
  });
}

export function createHostEventSource(path = '/api/events'): EventSource {
  return new EventSource(`${HOST_API_BASE}${path}`);
}

export function getHostApiBase(): string {
  return HOST_API_BASE;
}

export interface DingTalkMentionSearchResponse {
  items: Array<{
    type: 'user' | 'group';
    id: string;
    title: string;
    subtitle?: string | null;
    avatar?: string | null;
    corpId?: string | null;
  }>;
  needsAuth?: boolean;
  needsInstall?: boolean;
  recent?: boolean;
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface DingTalkStatusResponse {
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  authenticated: boolean;
  skillMode: string | null;
}

export async function searchDingTalkMentions(
  query: string,
  limit = query.trim() ? 20 : 10,
  cursor?: string,
): Promise<DingTalkMentionSearchResponse> {
  return hostApiFetch<DingTalkMentionSearchResponse>('/api/dingtalk/mention-search', {
    method: 'POST',
    body: JSON.stringify({
      query,
      limit,
      cursor: cursor?.trim() || undefined,
      types: ['user', 'conversation'],
    }),
  });
}

export async function fetchDingTalkStatus(): Promise<DingTalkStatusResponse> {
  return hostApiFetch<DingTalkStatusResponse>('/api/dingtalk/status');
}

export async function loginDingTalk(): Promise<{ success: boolean; authenticated?: boolean }> {
  return hostApiFetch<{ success: boolean; authenticated?: boolean }>('/api/dingtalk/auth/login', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface DwsInstallResponse {
  success: boolean;
  path?: string | null;
  version?: string | null;
  updated?: boolean;
  error?: string;
}

export async function installDwsCli(): Promise<DwsInstallResponse> {
  return hostApiFetch<DwsInstallResponse>('/api/dingtalk/install', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
