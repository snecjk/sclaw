/**
 * Workflow run SSE proxy (Main Process).
 *
 * Connects to resolveStoBaseUrl() — same backend domain as workflow create/start —
 * and forwards SSE events to Renderer via IPC.
 */
import { ipcMain } from 'electron';
import { safeBroadcastToAllWebContents } from '../safe-web-contents-send';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getStoToken } from '../../utils/auth-store';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { logger } from '../../utils/logger';

interface ActiveStream {
  runId: string;
  abort: AbortController;
}

const activeStreams = new Map<string, ActiveStream>();

/** SSE streams are long-lived; do not use proxyAwareFetch default 15s timeout. */
const SSE_FETCH_TIMEOUT_MS = 0;

function formatStreamError(err: unknown, streamUrl: string): string {
  const base = err instanceof Error ? err.message : String(err);
  return `SSE ${streamUrl} failed: ${base}`;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function broadcast(channel: string, payload: unknown): void {
  safeBroadcastToAllWebContents(channel, payload);
}

async function startStream(runId: string): Promise<void> {
  if (activeStreams.has(runId)) {
    logger.warn(`[workflow-trace] SSE stream already active runId=${runId}`);
    return;
  }

  const baseUrl = await resolveStoBaseUrl();
  const streamUrl = `${baseUrl}/agent/v1/runs/${runId}/stream`;
  logger.info(`[workflow-trace] SSE connect ${streamUrl}`);

  const token = await getStoToken();
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'X-Trace-Id': `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  };
  if (token) headers.stoToken = token;

  const abort = new AbortController();
  activeStreams.set(runId, { runId, abort });

  try {
    const response = await proxyAwareFetch(streamUrl, {
      method: 'GET',
      headers,
      signal: abort.signal,
      timeoutMs: SSE_FETCH_TIMEOUT_MS,
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(
        `HTTP ${response.status} ${response.statusText}${body ? ` body=${body}` : ''}`,
      );
    }
    if (!response.body) {
      throw new Error(`HTTP ${response.status} empty response body`);
    }

    logger.info(`[workflow-trace] SSE connected runId=${runId} status=${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventCount = 0;

    while (!abort.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentData += line.slice(5);
        } else if (line === '' && currentEvent && currentData) {
          eventCount += 1;
          if (currentEvent === 'run.update') {
            logger.info(`[workflow-trace] SSE run.update #%d runId=%s`, eventCount, runId);
          }
          broadcast('workflow:stream:event', { runId, event: currentEvent, data: currentData });
          currentEvent = '';
          currentData = '';
        }
      }
    }

    logger.info(`[workflow-trace] SSE ended runId=${runId} events=${eventCount}`);
  } catch (err) {
    const errStr = String(err);
    if (!errStr.includes('aborted') && !errStr.includes('AbortError')) {
      const message = formatStreamError(err, streamUrl);
      logger.error(`[workflow-trace] SSE failed runId=${runId} url=${streamUrl}:`, err);
      broadcast('workflow:stream:error', { runId, error: message, url: streamUrl });
    }
  } finally {
    activeStreams.delete(runId);
  }
}

function stopStream(runId: string): void {
  const stream = activeStreams.get(runId);
  if (!stream) return;
  stream.abort.abort();
  activeStreams.delete(runId);
  logger.info(`[workflow-trace] SSE unsubscribe runId=${runId}`);
}

export function registerWorkflowStreamHandlers(): void {
  ipcMain.handle('workflow:stream:subscribe', async (_, runId: string) => {
    if (!runId || typeof runId !== 'string') {
      throw new Error('Invalid runId');
    }
    void startStream(runId);
    return { success: true };
  });

  ipcMain.handle('workflow:stream:unsubscribe', async (_, runId: string) => {
    stopStream(runId);
    return { success: true };
  });
}
