import { getStoToken } from '../utils/auth-store';
import { logger } from '../utils/logger';
import { buildStoMemoryCenterAuthHeaders } from '../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../utils/sto-domain';
import { proxyAwareFetch } from '../utils/proxy-fetch';

type MemoryCenterEnvelope<T> = {
  success?: boolean;
  errMessage?: string;
  data?: T;
  traceId?: string;
};

export async function requestMemoryCenter<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
  logScope = '[mem0][remote]',
): Promise<T> {
  const token = await getStoToken();
  if (!token) throw new Error('Sto token is missing');

  const baseUrl = await resolveStoBaseUrl();
  logger.info(`${logScope} request start`, {
    path,
    method: init?.method || 'GET',
    timeoutMs: init?.timeoutMs ?? 15_000,
  });
  const response = await proxyAwareFetch(`${baseUrl}${path}`, {
    timeoutMs: 15_000,
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...buildStoMemoryCenterAuthHeaders(token),
      ...(init?.headers ?? {}),
    },
  });

  const body = await response.json() as MemoryCenterEnvelope<T>;
  if (!response.ok || body.success === false) {
    logger.error(`${logScope} request failed`, {
      path,
      method: init?.method || 'GET',
      status: response.status,
      errMessage: body.errMessage,
      traceId: body.traceId,
    });
    throw new Error(body.errMessage || `Memory center request failed: ${response.status}`);
  }
  return body.data as T;
}
