import { PORTS } from '../../../utils/config';
import {
  StoBrowserBridgePortError,
  type BrowserBridgeSession,
  type StoBrowserBridgePort,
} from './capability';

interface HostApiErrorPayload {
  success?: boolean;
  error?: unknown;
}

const COMMAND_TIMEOUT_MS = 30_000;
const RESULT_POLL_MS = 50;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StoBrowserBridgePortError('BROWSER_COMMAND_ABORTED', '浏览器命令已取消');
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}${path}`, init);
    const payload = await response.json().catch(() => undefined) as
      | (T & HostApiErrorPayload)
      | undefined;
    if (!response.ok) {
      const message = payload?.error == null
        ? `${response.status} ${response.statusText}`
        : String(payload.error);
      throw new StoBrowserBridgePortError('BROWSER_BRIDGE_HOST_ERROR', message);
    }
    if (payload === undefined) {
      throw new StoBrowserBridgePortError(
        'INVALID_HOST_RESPONSE',
        'Browser Bridge Host API returned an empty response',
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof StoBrowserBridgePortError) throw error;
    if (init?.signal?.aborted) {
      throw new StoBrowserBridgePortError('BROWSER_COMMAND_ABORTED', '浏览器命令已取消');
    }
    throw new StoBrowserBridgePortError(
      'BROWSER_BRIDGE_HOST_ERROR',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, RESULT_POLL_MS);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new StoBrowserBridgePortError('BROWSER_COMMAND_ABORTED', '浏览器命令已取消'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createHostApiBrowserBridgePort(): StoBrowserBridgePort {
  return {
    async listSessions(signal) {
      throwIfAborted(signal);
      const response = await fetchJson<{ sessions?: BrowserBridgeSession[] }>(
        '/api/browser-bridge/sessions',
        { signal },
      );
      return response.sessions ?? [];
    },
    async ensureSession(signal, url) {
      throwIfAborted(signal);
      const response = await fetchJson<{ sessionId?: string }>(
        '/api/browser-bridge/ensure-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal,
        },
      );
      if (!response.sessionId) {
        throw new StoBrowserBridgePortError(
          'BROWSER_NOT_CONNECTED',
          '浏览器未连接。请安装 SClaw Web Bridge 扩展，并在 SClaw 中允许连接 Google Chrome。',
        );
      }
      return response.sessionId;
    },
    async runCommand({ sessionId, action, payload, signal }) {
      throwIfAborted(signal);
      const command = await fetchJson<{ commandId?: string }>(
        '/api/browser-bridge/command',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, action, payload }),
          signal,
        },
      );
      if (!command.commandId) {
        throw new StoBrowserBridgePortError(
          'INVALID_HOST_RESPONSE',
          'Browser Bridge command response is missing commandId',
        );
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < COMMAND_TIMEOUT_MS) {
        throwIfAborted(signal);
        const response = await fetchJson<{
          ready?: boolean;
          result?: { result?: unknown };
        }>(
          `/api/browser-bridge/result?commandId=${encodeURIComponent(command.commandId)}`,
          { signal },
        );
        if (response.ready && response.result) return response.result.result;
        await waitForPoll(signal);
      }
      throw new StoBrowserBridgePortError(
        'BROWSER_COMMAND_TIMEOUT',
        `浏览器命令超时: ${action}`,
      );
    },
  };
}
