/**
 * Use Electron's network stack when available so requests honor
 * session.defaultSession.setProxy(...). Fall back to the Node global fetch
 * for non-Electron test environments or when net.fetch fails with
 * connection errors (e.g. ERR_CONNECTION_CLOSED on some networks).
 *
 * Adds AbortController-based timeout (default 15 s) to prevent requests
 * from hanging indefinitely.
 */

import { logger } from './logger';

const DEFAULT_TIMEOUT_MS = 15_000;

export async function proxyAwareFetch(
  input: string | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Create an AbortController that aborts after timeoutMs
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const mergedInit: RequestInit = {
    ...init,
    signal: init?.signal
      ? // If caller already provided a signal, chain both via AbortSignal.any (Node 16+)
        // Fallback: just use our signal if AbortSignal.any is unavailable
        (AbortSignal as any).any
          ? (AbortSignal as any).any([init.signal, controller.signal])
          : controller.signal
      : controller.signal,
  };
  // Remove custom property so it doesn't get passed to fetch
  delete (mergedInit as any).timeoutMs;

  try {
    if (process.versions.electron) {
      try {
        const { net } = await import('electron');
        return await net.fetch(String(input), mergedInit);
      } catch (e: unknown) {
        // net.fetch 连接失败时（如 ERR_CONNECTION_CLOSED），降级到 Node fetch
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('CONNECTION_CLOSED') || msg.includes('CONNECTION_REFUSED') || msg.includes('net::')) {
          logger.warn(`[proxy-fetch] electron net.fetch failed (${msg}), falling back to Node fetch`);
          // Fall through to the global fetch.
        } else {
          throw e;
        }
      }
    }

    return await fetch(input, mergedInit);
  } catch (e: unknown) {
    // Translate AbortError to a more descriptive timeout error
    if (controller.signal.aborted) {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒未响应），请检查网络后重试`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
