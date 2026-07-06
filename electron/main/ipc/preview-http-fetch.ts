import { ipcMain } from 'electron';
import { proxyAwareFetch } from '../../utils/proxy-fetch';

export type PreviewHttpFetchRequest = {
  url: string;
  allowedOrigin?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type PreviewHttpFetchResult = {
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  bodyBase64?: string;
  error?: string;
};

/** Validate preview fetch URL and optional same-origin constraint. */
export function validatePreviewHttpFetchRequest(request: PreviewHttpFetchRequest): string | null {
  const url = typeof request?.url === 'string' ? request.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return `Invalid preview fetch URL: ${String(request?.url)}`;
  }

  const allowedOrigin = typeof request.allowedOrigin === 'string' ? request.allowedOrigin.trim() : '';
  if (!allowedOrigin) return null;

  try {
    const parsed = new URL(url);
    if (parsed.origin !== allowedOrigin) {
      return `Preview fetch blocked: origin mismatch (${parsed.origin} ≠ ${allowedOrigin})`;
    }
  } catch {
    return `Invalid preview fetch URL: ${url}`;
  }

  return null;
}

export async function executePreviewHttpFetch(
  request: PreviewHttpFetchRequest,
  fetchImpl: typeof proxyAwareFetch = proxyAwareFetch,
): Promise<PreviewHttpFetchResult> {
  const validationError = validatePreviewHttpFetchRequest(request);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const url = request.url.trim();

  try {
    const method = (request.method || 'GET').toUpperCase();
    const headers: Record<string, string> = { ...(request.headers || {}) };
    const response = await fetchImpl(url, {
      method,
      headers,
      body: request.body,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return {
      ok: true,
      status: response.status,
      headers: responseHeaders,
      bodyBase64: buffer.toString('base64'),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerPreviewHttpFetchHandlers(): void {
  ipcMain.handle('preview:httpFetch', async (_, request: PreviewHttpFetchRequest) => {
    return executePreviewHttpFetch(request);
  });
}
