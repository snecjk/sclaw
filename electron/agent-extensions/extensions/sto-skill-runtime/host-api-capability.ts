import { PORTS } from '../../../utils/config';
import {
  StoSkillRuntimePortError,
  type DeleteUserSkillResponse,
  type RuntimeSkillReadRequest,
  type RuntimeSkillSearchRequest,
  type RuntimeSkillSearchResponse,
  type SaveUserSkillRequest,
  type SaveUserSkillResponse,
  type StoSkillRuntimePort,
} from './capability';

interface HostApiEnvelope<T> {
  success?: boolean;
  data?: T;
  code?: string;
  error?: unknown;
}

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  options?: { unwrapData?: boolean },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => undefined) as HostApiEnvelope<T> | undefined;
    if (!response.ok || payload?.success === false) {
      throw new StoSkillRuntimePortError(
        payload?.code ?? 'HOST_API_ERROR',
        payload?.error == null ? `${response.status} ${response.statusText}` : String(payload.error),
      );
    }
    if (options?.unwrapData === false) return payload as T;
    if (payload?.data === undefined) {
      throw new StoSkillRuntimePortError(
        'INVALID_HOST_RESPONSE',
        'Host API response is missing data',
      );
    }
    return payload.data;
  } catch (error) {
    if (error instanceof StoSkillRuntimePortError) throw error;
    throw new StoSkillRuntimePortError(
      controller.signal.aborted ? 'HOST_API_TIMEOUT' : 'HOST_API_ERROR',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createHostApiSkillRuntimePort(): StoSkillRuntimePort {
  return {
    delete: (input) => request<DeleteUserSkillResponse>('/api/skills/delete-user', input),
    search: (input: RuntimeSkillSearchRequest) => request<RuntimeSkillSearchResponse>(
      '/api/skills/runtime/search', input as unknown as Record<string, unknown>,
    ),
    recordRead: (input: RuntimeSkillReadRequest) => request<{ slug: string; recorded: true }>(
      '/api/skills/runtime/read', input as unknown as Record<string, unknown>,
    ),
    save: (input: SaveUserSkillRequest) => request<SaveUserSkillResponse>(
      '/api/skills/save-user', input as unknown as Record<string, unknown>,
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
