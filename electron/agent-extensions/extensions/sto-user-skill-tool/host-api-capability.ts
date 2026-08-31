import { PORTS } from '../../../utils/config';
import {
  StoUserSkillPortError,
  type SaveUserSkillResponse,
  type StoUserSkillPort,
} from './capability';

interface HostApiEnvelope<T> {
  success?: boolean;
  data?: T;
  code?: string;
  error?: unknown;
}

const REQUEST_TIMEOUT_MS = 60_000;

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  options?: { unwrapData?: boolean },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => undefined) as HostApiEnvelope<T> | undefined;
    if (!response.ok || payload?.success === false) {
      const message = payload?.error == null
        ? `${response.status} ${response.statusText}`
        : String(payload.error);
      throw new StoUserSkillPortError(payload?.code ?? 'HOST_API_ERROR', message);
    }
    if (options?.unwrapData === false) return payload as T;
    if (payload?.data === undefined) {
      throw new StoUserSkillPortError(
        'INVALID_HOST_RESPONSE',
        'Host API response is missing data',
      );
    }
    return payload.data;
  } catch (error) {
    if (error instanceof StoUserSkillPortError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new StoUserSkillPortError(
      controller.signal.aborted ? 'HOST_API_TIMEOUT' : 'HOST_API_ERROR',
      message,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createHostApiUserSkillPort(): StoUserSkillPort {
  return {
    save: (input) => request<SaveUserSkillResponse>(
      '/api/skills/save-user',
      input as unknown as Record<string, unknown>,
    ),
    async scheduleOrphanImport(reason) {
      await request<{ scheduled: boolean }>(
        '/api/skills/import-orphans',
        { reason },
        { unwrapData: false },
      );
    },
  };
}
